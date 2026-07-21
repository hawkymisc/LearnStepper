"""Local JSONL sidecar used only by the macOS Electron development host."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from threading import Lock, RLock
from typing import Any, Protocol

from learnstepper.codex import StdioCodexGateway
from learnstepper.conversation import CodexGateway, ConversationConfig, ConversationCoordinator
from learnstepper.core import ApplicationCore, AttainmentPolicy
from learnstepper.errors import ApplicationError
from learnstepper.events import RendererEventBroker
from learnstepper.ipc import LocalIPC
from learnstepper.persistence import SQLiteDatabase

MAX_TRANSPORT_LINE_BYTES = 1024 * 1024
MAX_MCP_DISCOVERY_BYTES = 1024 * 1024
MAX_MCP_SERVERS = 128
MAX_MCP_STATUS_PAGES = 8
MCP_NAME_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,128}")


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

class DesktopService:
    """Builds the local Core once and exposes its closed IPC contract over JSONL frames."""

    def __init__(
        self,
        *,
        data_directory: Path,
        application_root: Path,
        gateway_factory: GatewayFactory | None = None,
        codex_executable: str | None = None,
    ) -> None:
        self._data_directory = Path(data_directory)
        self._application_root = Path(application_root)
        self._event_listeners: list[Callable[[dict[str, Any]], None]] = []
        self._closed = False
        self._event_lock = Lock()
        self._status_lock = RLock()
        self._codex_executable = codex_executable
        self.events = RendererEventBroker()
        self.events.subscribe(self._publish_event)

        database = SQLiteDatabase(self._data_directory / "learnstepper.sqlite3")
        self._core = ApplicationCore(
            database=database,
            curricula_dir=self._application_root / "curricula" / "structured",
            attainment_policy=AttainmentPolicy(minimum_score=0.8),
        )
        self._core.initialize()
        self._gateway, self._status = self._open_gateway(gateway_factory)
        codex_workspace = self._data_directory / "codex-workspace"
        codex_workspace.mkdir(parents=True, exist_ok=True)
        self._conversation = ConversationCoordinator(
            database=database,
            gateway=self._gateway,
            events=self.events,
            config=ConversationConfig(working_directory=str(codex_workspace)),
        )
        set_handler = getattr(self._gateway, "set_notification_handler", None)
        if callable(set_handler):
            set_handler(self._handle_gateway_notification)
        self._ipc = LocalIPC(self._core, conversation=self._conversation)

    def _open_gateway(self, factory: GatewayFactory | None) -> tuple[CodexGateway, dict[str, str]]:
        if factory is None and (
            self._codex_executable is None or not Path(self._codex_executable).is_file()
        ):
            return UnavailableGateway("CODEX_CLI_UNAVAILABLE"), {
                "core": "available",
                "database": "available",
                "codexCli": "missing",
                "appServer": "unavailable",
                "authentication": "unauthenticated",
            }
        try:
            gateway = factory() if factory is not None else self._default_gateway()
            self._verify_mcp_isolation(gateway)
            account = gateway.request("account/read", {})
            authenticated = self._is_authenticated(account)
            return gateway, {
                "core": "available",
                "database": "available",
                "codexCli": "available",
                "appServer": "available",
                "authentication": "authenticated" if authenticated else "unauthenticated",
            }
        except ApplicationError as error:
            if "gateway" in locals():
                gateway.close()
            print(f"LearnStepper Codex gateway unavailable: {error.code}: {error.message}", file=sys.stderr)
            return UnavailableGateway(error.code), {
                "core": "available",
                "database": "available",
                "codexCli": "unsupported" if error.code == "CODEX_CLI_UNSUPPORTED" else "available",
                "appServer": "unavailable",
                "authentication": "unauthenticated" if error.code == "AUTH_REQUIRED" else "error",
            }
        except (OSError, ValueError):
            if "gateway" in locals():
                gateway.close()
            print("LearnStepper Codex gateway unavailable: host runtime error", file=sys.stderr)
            return UnavailableGateway(), {
                "core": "available",
                "database": "available",
                "codexCli": "available",
                "appServer": "unavailable",
                "authentication": "error",
            }

    @staticmethod
    def _is_authenticated(response: dict[str, Any]) -> bool:
        account = response.get("account")
        return (
            set(response) == {"account", "requiresOpenaiAuth"}
            and isinstance(response.get("requiresOpenaiAuth"), bool)
            and isinstance(account, dict)
            and set(account) == {"type", "email", "planType"}
            and account.get("type") == "chatgpt"
            and isinstance(account.get("email"), (str, type(None)))
            and isinstance(account.get("planType"), str)
        )

    def _default_gateway(self) -> CodexGateway:
        executable = self._codex_executable
        if executable is None or not Path(executable).is_file():
            raise OSError("codex executable is not available")
        mcp_overrides = self._discover_mcp_isolation_overrides(executable)
        return StdioCodexGateway(
            self.codex_command(executable, mcp_overrides=mcp_overrides),
            expected_version="0.144.5",
        )

    @staticmethod
    def _codex_config_values(*, disable_plugins: bool = True) -> list[str]:
        values = [
            "mcp_servers={}",
            'model_provider="openai"',
            "analytics.enabled=false",
            "project_doc_max_bytes=0",
            "features.remote_plugin=false",
            "features.skill_mcp_dependency_install=false",
            "features.memories=false",
            "features.image_generation=false",
            "features.workspace_dependencies=false",
            "features.tool_suggest=false",
            "features.shell_snapshot=false",
            "features.code_mode=false",
            "features.code_mode_host=false",
            "features.shell_tool=false",
            "features.unified_exec=false",
            "features.browser_use=false",
            "features.browser_use_external=false",
            "features.browser_use_full_cdp_access=false",
            "features.in_app_browser=false",
            "features.computer_use=false",
            "features.apps=false",
            "features.hooks=false",
            "features.multi_agent=false",
            "features.goals=false",
            "features.enable_mcp_apps=false",
            "features.tool_call_mcp_elicitation=false",
            "features.auth_elicitation=false",
            'web_search="disabled"',
            "notify=[]",
            'chatgpt_base_url="https://chatgpt.com/backend-api/"',
            'openai_base_url="https://chatgpt.com/backend-api/codex"',
        ]
        if disable_plugins:
            values.extend(["features.plugins=false", "features.plugin_sharing=false"])
        return values

    @classmethod
    def codex_command(cls, executable: str, *, mcp_overrides: list[str] | None = None) -> list[str]:
        values = [*cls._codex_config_values(), *(mcp_overrides or [])]
        command = [executable, "app-server", "--stdio"]
        for value in values:
            command.extend(["-c", value])
        return command

    @staticmethod
    def mcp_isolation_overrides(entries: Any) -> list[str]:
        if not isinstance(entries, list) or len(entries) > MAX_MCP_SERVERS:
            raise ApplicationError("APP_SERVER_UNAVAILABLE", "Codex MCP configuration could not be isolated")
        transports: dict[str, str] = {}
        for entry in entries:
            if not isinstance(entry, dict):
                raise ApplicationError("APP_SERVER_UNAVAILABLE", "Codex MCP configuration could not be isolated")
            name = entry.get("name")
            enabled = entry.get("enabled")
            transport = entry.get("transport")
            transport_type = transport.get("type") if isinstance(transport, dict) else None
            if (
                not isinstance(name, str)
                or MCP_NAME_PATTERN.fullmatch(name) is None
                or not isinstance(enabled, bool)
                or transport_type not in {"stdio", "streamable_http"}
                or name in transports
            ):
                raise ApplicationError("APP_SERVER_UNAVAILABLE", "Codex MCP configuration could not be isolated")
            transports[name] = str(transport_type)
        transports.setdefault("node_repl", "stdio")
        overrides: list[str] = []
        ordered_names = [name for name in sorted(transports) if name != "node_repl"] + ["node_repl"]
        for name in ordered_names:
            replacement = (
                '{command="/usr/bin/false",enabled=false}'
                if transports[name] == "stdio"
                else '{url="http://127.0.0.1",enabled=false}'
            )
            overrides.append(f"mcp_servers.{name}={replacement}")
        return overrides

    @staticmethod
    def _safe_codex_environment() -> dict[str, str]:
        return {
            name: os.environ[name]
            for name in ("HOME", "CODEX_HOME", "PATH", "LANG", "LC_ALL", "TMPDIR", "USER")
            if name in os.environ
        }

    @classmethod
    def _list_mcp_servers(cls, executable: str, config_values: list[str]) -> list[dict[str, Any]]:
        resolved = str(Path(executable).expanduser().resolve())
        command = [resolved]
        for value in config_values:
            command.extend(["-c", value])
        command.extend(["mcp", "list", "--json"])
        try:
            result = subprocess.run(  # noqa: S603 - absolute executable and fixed argv, never a shell
                command,
                capture_output=True,
                check=False,
                encoding="utf-8",
                errors="strict",
                env=cls._safe_codex_environment(),
                shell=False,
                timeout=10,
            )
        except (OSError, subprocess.SubprocessError, UnicodeError) as error:
            raise ApplicationError(
                "APP_SERVER_UNAVAILABLE", "Codex MCP configuration could not be isolated"
            ) from error
        if result.returncode != 0 or len(result.stdout.encode("utf-8")) > MAX_MCP_DISCOVERY_BYTES:
            raise ApplicationError("APP_SERVER_UNAVAILABLE", "Codex MCP configuration could not be isolated")
        try:
            entries = json.loads(result.stdout)
        except (json.JSONDecodeError, TypeError) as error:
            raise ApplicationError(
                "APP_SERVER_UNAVAILABLE", "Codex MCP configuration could not be isolated"
            ) from error
        if not isinstance(entries, list) or any(not isinstance(entry, dict) for entry in entries):
            raise ApplicationError("APP_SERVER_UNAVAILABLE", "Codex MCP configuration could not be isolated")
        return entries

    @classmethod
    def _discover_mcp_isolation_overrides(cls, executable: str) -> list[str]:
        discovered = cls._list_mcp_servers(executable, cls._codex_config_values(disable_plugins=False))
        isolation = cls.mcp_isolation_overrides(discovered)
        verified = cls._list_mcp_servers(executable, [*cls._codex_config_values(), *isolation])
        if len(verified) > MAX_MCP_SERVERS or any(entry.get("enabled") is not False for entry in verified):
            raise ApplicationError("APP_SERVER_UNAVAILABLE", "Codex MCP configuration could not be isolated")
        return isolation

    @staticmethod
    def _verify_mcp_isolation(gateway: CodexGateway) -> None:
        cursor: str | None = None
        seen_cursors: set[str] = set()
        total = 0
        for _ in range(MAX_MCP_STATUS_PAGES):
            response = gateway.request("mcpServerStatus/list", {} if cursor is None else {"cursor": cursor})
            if not isinstance(response, dict) or set(response) != {"data", "nextCursor"}:
                raise ApplicationError("APP_SERVER_UNAVAILABLE", "Codex MCP isolation status is invalid")
            data = response.get("data")
            next_cursor = response.get("nextCursor")
            if not isinstance(data, list) or any(not isinstance(entry, dict) for entry in data):
                raise ApplicationError("APP_SERVER_UNAVAILABLE", "Codex MCP isolation status is invalid")
            total += len(data)
            if total > MAX_MCP_SERVERS:
                raise ApplicationError("APP_SERVER_UNAVAILABLE", "Codex MCP isolation status is invalid")
            for entry in data:
                if any(
                    bool(entry.get(field))
                    for field in ("tools", "resources", "resourceTemplates", "serverInfo")
                ):
                    raise ApplicationError("APP_SERVER_UNAVAILABLE", "Codex MCP isolation failed")
            if next_cursor is None:
                return
            if (
                not isinstance(next_cursor, str)
                or not next_cursor
                or len(next_cursor) > 512
                or next_cursor in seen_cursors
            ):
                raise ApplicationError("APP_SERVER_UNAVAILABLE", "Codex MCP isolation status is invalid")
            seen_cursors.add(next_cursor)
            cursor = next_cursor
        raise ApplicationError("APP_SERVER_UNAVAILABLE", "Codex MCP isolation status is invalid")

    def _authentication(self, state: str) -> dict[str, str]:
        with self._status_lock:
            self._status["authentication"] = state
        self.events.publish("authentication.changed", payload={"authentication": state})
        return {"state": state}

    def _handle_auth(self, frame_id: str, action: str) -> dict[str, Any]:
        if action != "refresh":
            return self._transport_error(frame_id, "Unknown authentication action")
        account = self._gateway.request("account/read", {"refreshToken": True})
        authentication = self._authentication(
            "authenticated" if self._is_authenticated(account) else "unauthenticated"
        )
        return {"type": "auth", "id": frame_id, "authentication": authentication}

    def _handle_gateway_notification(self, method: str, params: dict[str, Any]) -> None:
        if method == "account/updated":
            with self._status_lock:
                try:
                    authenticated = self._is_authenticated(self._gateway.request("account/read", {}))
                except (ApplicationError, OSError, ValueError):
                    authenticated = False
                self._authentication("authenticated" if authenticated else "unauthenticated")
            return
        self._conversation.handle_notification(method, params)

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
        if frame.get("type") == "auth" and set(frame) == {"id", "type", "action"}:
            action = frame.get("action")
            if not isinstance(action, str):
                return self._transport_error(frame_id, "Authentication action must be a string")
            try:
                return self._handle_auth(frame_id, action)
            except (ApplicationError, OSError, ValueError):
                return {"type": "auth", "id": frame_id, "authentication": self._authentication("error")}
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
    parser.add_argument("--codex-executable")
    arguments = parser.parse_args()
    service = DesktopService(
        data_directory=Path(arguments.data_dir),
        application_root=Path(arguments.app_root),
        codex_executable=arguments.codex_executable,
    )
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
