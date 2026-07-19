from __future__ import annotations

import json
import os
import queue
import re
import subprocess
import threading
from collections.abc import Callable, Mapping, Sequence
from contextlib import suppress
from pathlib import Path
from typing import Any

from learnstepper.errors import ApplicationError


class StdioCodexGateway:
    """Injected, shell-free JSON-RPC/JSONL Codex App Server adapter."""

    MAX_LINE_BYTES = 1_048_576
    MAX_PENDING_NOTIFICATIONS = 1_000

    def __init__(
        self,
        command: Sequence[str],
        *,
        timeout_seconds: float = 30,
        expected_version: str = "0.144.5",
        notification_handler: Callable[[str, dict[str, Any]], None] | None = None,
        environment: Mapping[str, str] | None = None,
        working_directory: str | None = None,
    ) -> None:
        if not command or any(not isinstance(part, str) or not part for part in command):
            raise ValueError("command must be a non-empty argv sequence")
        executable = Path(command[0]).expanduser().resolve()
        safe_environment = {
            name: os.environ[name]
            for name in ("HOME", "CODEX_HOME", "PATH", "LANG", "LC_ALL", "TMPDIR", "USER")
            if name in os.environ
        }
        if environment is not None:
            safe_environment.update(environment)
        self._timeout = timeout_seconds
        self._handler = notification_handler
        self._next_id = 0
        self._state_lock = threading.Lock()
        self._write_lock = threading.Lock()
        self._pending: dict[int, queue.Queue[dict[str, Any] | Exception]] = {}
        self._closed = False
        self._fatal_error: ApplicationError | None = None
        self._notifications: queue.Queue[tuple[str, dict[str, Any]] | None] = queue.Queue(
            maxsize=self.MAX_PENDING_NOTIFICATIONS
        )
        self._process = subprocess.Popen(  # noqa: S603 - executable argv is an injected trusted application setting
            [str(executable), *command[1:]],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            shell=False,
            bufsize=0,
            env=safe_environment,
            cwd=working_directory or str(executable.parent),
        )
        self._notification_worker = threading.Thread(
            target=self._notification_loop, name="codex-app-server-notifications", daemon=True
        )
        self._notification_worker.start()
        self._reader = threading.Thread(target=self._reader_loop, name="codex-app-server-reader", daemon=True)
        self._reader.start()
        try:
            initialized = self._raw_request(
                "initialize",
                {
                    "clientInfo": {"name": "learnstepper", "version": "0.1.0"},
                    "capabilities": {"experimentalApi": False},
                },
            )
            required = ("codexHome", "platformFamily", "platformOs", "userAgent")
            if any(not isinstance(initialized.get(field), str) or not initialized[field] for field in required):
                raise ApplicationError("APP_SERVER_UNAVAILABLE", "App Server initialize response is invalid")
            version_match = re.fullmatch(
                r"learnstepper/(?P<version>\d+\.\d+\.\d+)(?: \(.+\).*)?",
                str(initialized["userAgent"]),
            )
            if version_match is None or version_match.group("version") != expected_version:
                raise ApplicationError("APP_SERVER_UNAVAILABLE", "App Server protocol version is unsupported")
            self._write({"jsonrpc": "2.0", "method": "initialized", "params": {}})
        except Exception:
            self.close()
            raise

    def request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if not isinstance(method, str) or not method:
            raise ValueError("method must be nonblank")
        return self._raw_request(method, params or {})

    def set_notification_handler(self, handler: Callable[[str, dict[str, Any]], None]) -> None:
        self._handler = handler

    def _raw_request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        response_queue: queue.Queue[dict[str, Any] | Exception] = queue.Queue(maxsize=1)
        with self._state_lock:
            if self._fatal_error is not None:
                raise self._fatal_error
            if self._closed:
                raise ApplicationError("APP_SERVER_UNAVAILABLE", "App Server is not running", retryable=True)
            self._next_id += 1
            request_id = self._next_id
            self._pending[request_id] = response_queue
        try:
            self._write({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
            try:
                response = response_queue.get(timeout=self._timeout)
            except queue.Empty as error:
                raise ApplicationError(
                    "APP_SERVER_UNAVAILABLE", "App Server response timed out", retryable=True
                ) from error
            if isinstance(response, Exception):
                raise response
            if "error" in response:
                raise ApplicationError("APP_SERVER_UNAVAILABLE", "App Server request failed", retryable=True)
            result = response.get("result")
            if not isinstance(result, dict):
                raise ApplicationError("APP_SERVER_UNAVAILABLE", "App Server returned an invalid response")
            return result
        finally:
            with self._state_lock:
                self._pending.pop(request_id, None)

    def _write(self, message: dict[str, Any]) -> None:
        encoded = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
        if len(encoded) > self.MAX_LINE_BYTES:
            raise ApplicationError("VALIDATION_ERROR", "App Server request exceeds the maximum size")
        with self._write_lock:
            if self._process.poll() is not None or self._process.stdin is None:
                raise ApplicationError("APP_SERVER_UNAVAILABLE", "App Server is not running", retryable=True)
            try:
                self._process.stdin.write(encoded)
                self._process.stdin.flush()
            except OSError as error:
                raise ApplicationError("APP_SERVER_UNAVAILABLE", "App Server write failed", retryable=True) from error

    def _reader_loop(self) -> None:
        if self._process.stdout is None:
            self._fail_pending("App Server output is unavailable")
            return
        try:
            while True:
                line = self._process.stdout.readline(self.MAX_LINE_BYTES + 1)
                if not line:
                    self._fail_pending("App Server exited before responding")
                    return
                if len(line) > self.MAX_LINE_BYTES or not line.endswith(b"\n"):
                    self._fail_pending("App Server response exceeds the maximum size")
                    return
                try:
                    message = json.loads(line.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    self._fail_pending("App Server returned invalid JSON")
                    return
                if not isinstance(message, dict):
                    self._fail_pending("App Server response must be an object")
                    return
                response_id = message.get("id")
                if response_id is not None:
                    if isinstance(response_id, int):
                        with self._state_lock:
                            pending = self._pending.get(response_id)
                        if pending is not None:
                            try:
                                pending.put_nowait(message)
                            except queue.Full:
                                self._fail_pending("App Server returned duplicate responses")
                                return
                    continue
                method = message.get("method")
                params = message.get("params", {})
                handler = self._handler
                if isinstance(method, str) and isinstance(params, dict) and handler is not None:
                    try:
                        self._notifications.put_nowait((method, params))
                    except queue.Full:
                        self._fail_pending("App Server notification queue overflowed")
                        if self._process.poll() is None:
                            self._process.terminate()
                        return
        except (OSError, ValueError):
            self._fail_pending("App Server output could not be read")

    def _notification_loop(self) -> None:
        while True:
            notification = self._notifications.get()
            if notification is None:
                return
            method, params = notification
            handler = self._handler
            if handler is not None:
                # A malformed provider event cannot corrupt the JSON-RPC response stream.
                with suppress(Exception):
                    handler(method, params)

    def _fail_pending(self, message: str) -> None:
        error = ApplicationError("APP_SERVER_UNAVAILABLE", message, retryable=True)
        with self._state_lock:
            if self._fatal_error is None:
                self._fatal_error = error
            pending = list(self._pending.values())
        for response_queue in pending:
            with suppress(queue.Full):
                response_queue.put_nowait(error)

    def close(self) -> None:
        with self._state_lock:
            if self._closed:
                return
            self._closed = True
        self._fail_pending("App Server was closed")
        if self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self._process.kill()
                self._process.wait(timeout=2)
        for stream in (self._process.stdin, self._process.stdout, self._process.stderr):
            if stream is not None:
                stream.close()
        if threading.current_thread() is not self._reader:
            self._reader.join(timeout=2)
        with suppress(queue.Full):
            self._notifications.put_nowait(None)
        if threading.current_thread() is not self._notification_worker:
            self._notification_worker.join(timeout=2)
