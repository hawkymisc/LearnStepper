"""Local JSONL sidecar used only by the macOS Electron development host."""

from __future__ import annotations

import argparse
import json
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
        self._active_login_id: str | None = None
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

    def _default_gateway(self) -> CodexGateway:
        executable = self._codex_executable
        if executable is None or not Path(executable).is_file():
            raise OSError("codex executable is not available")
        return StdioCodexGateway(self.codex_command(executable), expected_version="0.144.5")

    @staticmethod
    def codex_command(executable: str) -> list[str]:
        return [
            executable,
            "app-server",
            "--stdio",
            "-c",
            'cli_auth_credentials_store="keyring"',
            "-c",
            "features.shell_tool=false",
            "-c",
            "features.unified_exec=false",
            "-c",
            "features.browser_use=false",
            "-c",
            "features.browser_use_external=false",
            "-c",
            "features.browser_use_full_cdp_access=false",
            "-c",
            "features.in_app_browser=false",
            "-c",
            "features.computer_use=false",
            "-c",
            "features.apps=false",
            "-c",
            "features.hooks=false",
            "-c",
            "features.multi_agent=false",
            "-c",
            "features.goals=false",
            "-c",
            'web_search="disabled"',
        ]

    def _authentication(self, state: str) -> dict[str, str]:
        with self._status_lock:
            self._status["authentication"] = state
        self.events.publish("authentication.changed", payload={"authentication": state})
        return {"state": state}

    def _handle_auth(self, frame_id: str, action: str) -> dict[str, Any]:
        if action == "login":
            with self._status_lock:
                stale_login_id = self._active_login_id
            if stale_login_id is not None:
                self._gateway.request("account/login/cancel", {"loginId": stale_login_id})
                with self._status_lock:
                    if self._active_login_id == stale_login_id:
                        self._active_login_id = None
            result = self._gateway.request(
                "account/login/start",
                {
                    "type": "chatgpt",
                    "appBrand": "codex",
                    "codexStreamlinedLogin": True,
                    "useHostedLoginSuccessPage": True,
                },
            )
            login_id, auth_url = result.get("loginId"), result.get("authUrl")
            if not isinstance(login_id, str) or not login_id or not isinstance(auth_url, str) or not auth_url:
                raise ApplicationError("APP_SERVER_UNAVAILABLE", "Codex returned an invalid login response")
            with self._status_lock:
                self._active_login_id = login_id
            authentication = self._authentication("awaiting_browser")
            authentication["auth_url"] = auth_url
        elif action == "cancel":
            with self._status_lock:
                login_id = self._active_login_id
                self._active_login_id = None
            if login_id is not None:
                try:
                    self._gateway.request("account/login/cancel", {"loginId": login_id})
                except (ApplicationError, OSError, ValueError):
                    with self._status_lock:
                        if self._active_login_id is None:
                            self._active_login_id = login_id
                    self._authentication("awaiting_browser")
                    raise
            else:
                account = self._gateway.request("account/read", {})
                if self._is_authenticated(account):
                    self._gateway.request("account/logout", {})
            authentication = self._authentication("unauthenticated")
        elif action == "logout":
            self._gateway.request("account/logout", {})
            with self._status_lock:
                self._active_login_id = None
            authentication = self._authentication("unauthenticated")
        else:
            return self._transport_error(frame_id, "Unknown authentication action")
        return {"type": "auth", "id": frame_id, "authentication": authentication}

    def _handle_gateway_notification(self, method: str, params: dict[str, Any]) -> None:
        if method == "account/login/completed":
            with self._status_lock:
                login_id = params.get("loginId")
                if not isinstance(login_id, str) or login_id != self._active_login_id:
                    return
                if params.get("success") is not True:
                    self._active_login_id = None
                    self._authentication("error")
                    return
                self._authentication("verifying")
            try:
                authenticated = self._is_authenticated(self._gateway.request("account/read", {}))
            except (ApplicationError, OSError, ValueError):
                authenticated = False
            with self._status_lock:
                cancelled = self._active_login_id != login_id
                if not cancelled:
                    self._active_login_id = None
                    self._authentication("authenticated" if authenticated else "error")
            if cancelled and authenticated:
                try:
                    self._gateway.request("account/logout", {})
                except (ApplicationError, OSError, ValueError):
                    self._authentication("error")
                else:
                    self._authentication("unauthenticated")
            return
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
    parser.add_argument("--codex-executable", required=True)
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
