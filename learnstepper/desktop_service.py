"""Local JSONL sidecar used only by the macOS Electron development host."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from collections.abc import Callable
from pathlib import Path
from threading import Event, Lock, Thread
from typing import Any, Protocol

from learnstepper.codex import StdioCodexGateway
from learnstepper.conversation import CodexGateway, ConversationConfig, ConversationCoordinator
from learnstepper.core import ApplicationCore, AttainmentPolicy
from learnstepper.errors import ApplicationError
from learnstepper.events import RendererEventBroker
from learnstepper.ipc import LocalIPC
from learnstepper.persistence import SQLiteDatabase

MAX_TRANSPORT_LINE_BYTES = 1024 * 1024


class GatewayFactory(Protocol):
    def __call__(self) -> CodexGateway: ...


class UnavailableGateway:
    def __init__(self, code: str = "APP_SERVER_UNAVAILABLE") -> None:
        self._code = code

    def request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        del method, params
        raise ApplicationError(self._code, "Codex App Server is unavailable", retryable=True)

    def close(self) -> None:
        return None


class SwitchableGateway:
    """Keeps local IPC available while Codex startup is probed in the background."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._target: CodexGateway = UnavailableGateway()
        self._closed = False

    def request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._lock:
            target = self._target
        return target.request(method, params)

    def replace(self, target: CodexGateway) -> None:
        with self._lock:
            if self._closed:
                target.close()
                return
            previous = self._target
            self._target = target
        previous.close()

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            target = self._target
        target.close()

class DesktopService:
    """Builds the local Core once and exposes its closed IPC contract over JSONL frames."""

    def __init__(
        self,
        *,
        data_directory: Path,
        application_root: Path,
        gateway_factory: GatewayFactory | None = None,
    ) -> None:
        self._data_directory = Path(data_directory)
        self._application_root = Path(application_root)
        self._event_listeners: list[Callable[[dict[str, Any]], None]] = []
        self._closed = False
        self._event_lock = Lock()
        self._status_lock = Lock()
        self._gateway_probe_complete = Event()
        self.events = RendererEventBroker()
        self.events.subscribe(self._publish_event)

        database = SQLiteDatabase(self._data_directory / "learnstepper.sqlite3")
        self._core = ApplicationCore(
            database=database,
            curricula_dir=self._application_root / "curricula" / "structured",
            attainment_policy=AttainmentPolicy(minimum_score=0.8),
        )
        self._core.initialize()
        self._gateway = SwitchableGateway()
        self._status = {
            "core": "available",
            "database": "available",
            "appServer": "checking",
            "authentication": "checking",
        }
        self._conversation = ConversationCoordinator(
            database=database,
            gateway=self._gateway,
            events=self.events,
            config=ConversationConfig(),
        )
        self._ipc = LocalIPC(self._core, conversation=self._conversation)
        self._gateway_probe = Thread(target=self._probe_gateway, args=(gateway_factory,), daemon=True)
        self._gateway_probe.start()

    def _probe_gateway(self, factory: GatewayFactory | None) -> None:
        try:
            gateway, status = self._open_gateway(factory)
            self._gateway.replace(gateway)
            with self._status_lock:
                self._status = status
            self.events.publish("runtime.statusChanged", payload=dict(status))
        finally:
            self._gateway_probe_complete.set()

    def wait_for_gateway_probe(self, timeout: float | None = None) -> bool:
        return self._gateway_probe_complete.wait(timeout)

    def _open_gateway(self, factory: GatewayFactory | None) -> tuple[CodexGateway, dict[str, str]]:
        try:
            gateway = factory() if factory is not None else self._default_gateway()
            account = gateway.request("account/read", {})
            authenticated = self._is_authenticated(account)
            return gateway, {
                "core": "available",
                "database": "available",
                "appServer": "available",
                "authentication": "authenticated" if authenticated else "unauthenticated",
            }
        except ApplicationError as error:
            if "gateway" in locals():
                gateway.close()
            return UnavailableGateway(error.code), {
                "core": "available",
                "database": "available",
                "appServer": "unavailable",
                "authentication": "unauthenticated" if error.code == "AUTH_REQUIRED" else "checking",
            }
        except (OSError, ValueError):
            if "gateway" in locals():
                gateway.close()
            return UnavailableGateway(), {
                "core": "available",
                "database": "available",
                "appServer": "unavailable",
                "authentication": "checking",
            }

    @staticmethod
    def _is_authenticated(response: dict[str, Any]) -> bool:
        account = response.get("account")
        return (
            set(response) == {"account", "requiresOpenaiAuth"}
            and response.get("requiresOpenaiAuth") is False
            and isinstance(account, dict)
            and account.get("type") == "chatgpt"
            and isinstance(account.get("email"), (str, type(None)))
            and isinstance(account.get("planType"), str)
        )

    @staticmethod
    def _default_gateway() -> CodexGateway:
        executable = shutil.which("codex")
        if executable is None:
            raise OSError("codex executable is not available")
        return StdioCodexGateway([executable, "app-server", "--stdio"], expected_version="0.144.5")

    def subscribe_events(self, listener: Callable[[dict[str, Any]], None]) -> Callable[[], None]:
        with self._event_lock:
            self._event_listeners.append(listener)

        def unsubscribe() -> None:
            with self._event_lock:
                if listener in self._event_listeners:
                    self._event_listeners.remove(listener)

        return unsubscribe

    def _publish_event(self, event: dict[str, Any]) -> None:
        with self._event_lock:
            listeners = list(self._event_listeners)
        frame = {"type": "event", "event": event}
        for listener in listeners:
            try:
                listener(frame)
            except Exception:
                continue

    def handle_frame(self, frame: Any) -> dict[str, Any]:
        frame_id = frame.get("id") if isinstance(frame, dict) and isinstance(frame.get("id"), str) else None
        if not isinstance(frame, dict) or not isinstance(frame_id, str) or not frame_id:
            return self._transport_error(frame_id, "Transport frame requires a nonblank id")
        if frame.get("type") == "status" and set(frame) == {"id", "type"}:
            with self._status_lock:
                status = dict(self._status)
            return {"type": "status", "id": frame_id, "status": status}
        if set(frame) != {"id", "envelope"} or not isinstance(frame.get("envelope"), dict):
            return self._transport_error(frame_id, "Transport frame requires one IPC envelope")
        return {"type": "response", "id": frame_id, "response": self._ipc.handle(frame["envelope"])}

    @staticmethod
    def _transport_error(frame_id: str | None, message: str) -> dict[str, Any]:
        return {
            "type": "response",
            "id": frame_id,
            "response": {"ok": False, "error": {"code": "VALIDATION_ERROR", "message": message}},
        }

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._gateway.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="LearnStepper Electron IPC sidecar")
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--app-root", required=True)
    arguments = parser.parse_args()
    service = DesktopService(data_directory=Path(arguments.data_dir), application_root=Path(arguments.app_root))
    write_lock = Lock()

    def emit(frame: dict[str, Any]) -> None:
        with write_lock:
            sys.stdout.write(json.dumps(frame, ensure_ascii=False, separators=(",", ":")) + "\n")
            sys.stdout.flush()

    service.subscribe_events(emit)
    try:
        while raw_line := sys.stdin.buffer.readline(MAX_TRANSPORT_LINE_BYTES + 1):
            if len(raw_line) > MAX_TRANSPORT_LINE_BYTES:
                emit(service._transport_error(None, "Transport frame exceeds the maximum line size"))
                while raw_line and not raw_line.endswith(b"\n"):
                    raw_line = sys.stdin.buffer.readline(MAX_TRANSPORT_LINE_BYTES + 1)
                continue
            try:
                frame = json.loads(raw_line)
            except (json.JSONDecodeError, UnicodeDecodeError):
                emit(service._transport_error(None, "Transport frame must be JSON"))
                continue
            emit(service.handle_frame(frame))
    finally:
        service.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
