from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from threading import Event, Thread

from learnstepper.desktop_service import DesktopService

ROOT = Path(__file__).resolve().parents[1]


class FakeGateway:
    def __init__(self) -> None:
        self.closed = False
        self.notification_handler = None
        self.login_id = "login-1"
        self.authenticated = True
        self.cancel_fails = False
        self.calls: list[str] = []
        self.read_started: Event | None = None
        self.allow_read: Event | None = None

    def request(self, method: str, params: dict | None = None) -> dict:
        self.calls.append(method)
        if method == "account/login/start":
            return {
                "type": "chatgpt",
                "loginId": self.login_id,
                "authUrl": "https://auth.openai.com/codex-login",
                "accessToken": "must-never-cross-the-desktop-boundary",
            }
        if method == "account/login/cancel" and self.cancel_fails:
            raise OSError("cancel failed")
        if method in {"account/login/cancel", "account/logout"}:
            return {}
        if method == "account/read":
            if self.read_started is not None:
                self.read_started.set()
            if self.allow_read is not None:
                self.allow_read.wait(timeout=2)
            if not self.authenticated:
                return {"account": None, "requiresOpenaiAuth": True}
            return {
                "account": {"type": "chatgpt", "email": "learner@example.test", "planType": "plus"},
                "requiresOpenaiAuth": False,
            }
        return {}

    def set_notification_handler(self, handler) -> None:
        self.notification_handler = handler

    def notify(self, method: str, params: dict) -> None:
        assert self.notification_handler is not None
        self.notification_handler(method, params)

    def close(self) -> None:
        self.closed = True


class DesktopServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        self.gateway = FakeGateway()
        self.service = DesktopService(
            data_directory=Path(self.tempdir.name),
            application_root=ROOT,
            gateway_factory=lambda: self.gateway,
        )
        self.addCleanup(self.service.close)

    def test_forwards_closed_ipc_envelopes_and_persists_data_across_restart(self) -> None:
        saved = self.service.handle_frame(
            {
                "id": "save-profile",
                "envelope": {
                    "type": "command",
                    "name": "profile.update",
                    "request_id": "11111111-1111-4111-8111-111111111111",
                    "payload": {"display_name": "学習者", "locale": "ja-JP", "timezone": "Asia/Tokyo"},
                },
            }
        )
        self.assertTrue(saved["response"]["ok"])
        self.service.close()

        restarted = DesktopService(
            data_directory=Path(self.tempdir.name),
            application_root=ROOT,
            gateway_factory=FakeGateway,
        )
        self.addCleanup(restarted.close)
        loaded = restarted.handle_frame(
            {"id": "load-profile", "envelope": {"type": "query", "name": "profile.get", "payload": {}}}
        )
        self.assertEqual("学習者", loaded["response"]["data"]["display_name"])

    def test_reports_runtime_status_without_returning_account_identity(self) -> None:
        result = self.service.handle_frame({"id": "status", "type": "status"})

        self.assertEqual(
            {
                "core": "available",
                "database": "available",
                "appServer": "available",
                "authentication": "authenticated",
            },
            result["status"],
        )
        self.assertNotIn("learner@example.test", str(result))

    def test_emits_typed_renderer_events_to_the_host(self) -> None:
        delivered: list[dict] = []
        self.service.subscribe_events(delivered.append)

        self.service.events.publish("turn.completed", project_id="project-1", payload={"status": "completed"})

        self.assertEqual("event", delivered[0]["type"])
        self.assertEqual("turn.completed", delivered[0]["event"]["name"])

    def test_rejects_malformed_transport_frames_without_crashing(self) -> None:
        result = self.service.handle_frame({"id": "bad", "envelope": []})

        self.assertEqual("VALIDATION_ERROR", result["response"]["error"]["code"])

    def test_keeps_local_storage_available_when_codex_is_unavailable(self) -> None:
        unavailable = DesktopService(
            data_directory=Path(self.tempdir.name) / "offline",
            application_root=ROOT,
            gateway_factory=lambda: (_ for _ in ()).throw(OSError("codex missing")),
        )
        self.addCleanup(unavailable.close)

        status = unavailable.handle_frame({"id": "status", "type": "status"})
        profiles = unavailable.handle_frame(
            {"id": "profiles", "envelope": {"type": "query", "name": "curriculumProfile.list", "payload": {}}}
        )

        self.assertEqual("unavailable", status["status"]["appServer"])
        self.assertTrue(profiles["response"]["ok"])

    def test_login_returns_only_sanitized_browser_state_and_url(self) -> None:
        result = self.service.handle_frame({"id": "login", "type": "auth", "action": "login"})

        self.assertEqual("auth", result["type"])
        self.assertEqual(
            {"state": "awaiting_browser", "auth_url": "https://auth.openai.com/codex-login"},
            result["authentication"],
        )
        self.assertNotIn("token", str(result).lower())
        self.assertNotIn("login-1", str(result))

    def test_only_matching_login_completion_authenticates_and_emits_event(self) -> None:
        delivered: list[dict] = []
        self.service.subscribe_events(delivered.append)
        self.service.handle_frame({"id": "login", "type": "auth", "action": "login"})

        self.gateway.notify("account/login/completed", {"loginId": "stale", "success": True})
        stale_status = self.service.handle_frame({"id": "s1", "type": "status"})
        self.assertEqual("awaiting_browser", stale_status["status"]["authentication"])

        self.gateway.notify("account/login/completed", {"loginId": "login-1", "success": True})
        completed_status = self.service.handle_frame({"id": "s2", "type": "status"})
        self.assertEqual("authenticated", completed_status["status"]["authentication"])
        self.assertEqual("authentication.changed", delivered[-1]["event"]["name"])
        self.assertEqual("authenticated", delivered[-1]["event"]["payload"]["authentication"])
        self.assertNotIn("learner@example.test", str(delivered))

    def test_verifies_completion_and_tracks_later_account_updates(self) -> None:
        delivered: list[dict] = []
        self.service.subscribe_events(delivered.append)
        self.service.handle_frame({"id": "login", "type": "auth", "action": "login"})
        self.gateway.notify("account/login/completed", {"loginId": "login-1", "success": True})
        states = [frame["event"]["payload"]["authentication"] for frame in delivered]
        self.assertEqual(["awaiting_browser", "verifying", "authenticated"], states)

        self.gateway.authenticated = False
        self.gateway.notify("account/updated", {})
        status = self.service.handle_frame({"id": "status", "type": "status"})
        self.assertEqual("unauthenticated", status["status"]["authentication"])

    def test_codex_command_disables_non_learning_tools_and_uses_keyring(self) -> None:
        command = DesktopService.codex_command("/bundle/codex")

        self.assertEqual(["/bundle/codex", "app-server", "--stdio"], command[:3])
        self.assertIn('cli_auth_credentials_store="keyring"', command)
        self.assertIn("features.shell_tool=false", command)
        self.assertIn("features.apps=false", command)
        self.assertIn("features.unified_exec=false", command)
        self.assertIn("features.browser_use=false", command)
        self.assertIn("features.browser_use_external=false", command)
        self.assertIn("features.browser_use_full_cdp_access=false", command)
        self.assertIn("features.in_app_browser=false", command)
        self.assertIn("features.computer_use=false", command)
        self.assertIn('web_search="disabled"', command)

    def test_cancel_can_preempt_account_verification_and_logs_out_a_late_completion(self) -> None:
        self.service.handle_frame({"id": "login", "type": "auth", "action": "login"})
        self.gateway.read_started = Event()
        self.gateway.allow_read = Event()
        completion = Thread(
            target=lambda: self.gateway.notify(
                "account/login/completed", {"loginId": "login-1", "success": True}
            )
        )
        completion.start()
        self.assertTrue(self.gateway.read_started.wait(timeout=1))

        cancelled = self.service.handle_frame({"id": "cancel", "type": "auth", "action": "cancel"})
        self.assertEqual("unauthenticated", cancelled["authentication"]["state"])
        blocked_retry = self.service.handle_frame({"id": "blocked-retry", "type": "auth", "action": "login"})
        self.assertEqual("error", blocked_retry["authentication"]["state"])
        self.gateway.allow_read.set()
        completion.join(timeout=1)

        status = self.service.handle_frame({"id": "status", "type": "status"})
        self.assertEqual("unauthenticated", status["status"]["authentication"])
        self.assertIn("account/logout", self.gateway.calls)
        retried = self.service.handle_frame({"id": "retry", "type": "auth", "action": "login"})
        self.assertEqual("awaiting_browser", retried["authentication"]["state"])

    def test_login_retry_replaces_a_stale_login_after_cancel_failure(self) -> None:
        self.service.handle_frame({"id": "login", "type": "auth", "action": "login"})
        self.gateway.cancel_fails = True
        failed = self.service.handle_frame({"id": "cancel", "type": "auth", "action": "cancel"})
        self.assertEqual("error", failed["authentication"]["state"])

        self.gateway.cancel_fails = False
        retried = self.service.handle_frame({"id": "retry", "type": "auth", "action": "login"})
        self.assertEqual("awaiting_browser", retried["authentication"]["state"])
        self.assertEqual(2, self.gateway.calls.count("account/login/start"))
