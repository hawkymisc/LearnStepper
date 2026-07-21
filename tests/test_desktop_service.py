from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from learnstepper.desktop_service import DesktopService
from learnstepper.errors import ApplicationError

ROOT = Path(__file__).resolve().parents[1]


class FakeGateway:
    def __init__(self) -> None:
        self.closed = False
        self.notification_handler = None
        self.authenticated = True
        self.calls: list[str] = []
        self.last_params: dict | None = None

    def request(self, method: str, params: dict | None = None) -> dict:
        self.calls.append(method)
        self.last_params = params
        if method == "mcpServerStatus/list":
            return {"data": [], "nextCursor": None}
        if method == "account/read":
            if not self.authenticated:
                return {"account": None, "requiresOpenaiAuth": True}
            return {
                "account": {"type": "chatgpt", "email": "learner@example.test", "planType": "plus"},
                "requiresOpenaiAuth": True,
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
                "codexCli": "available",
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
        )
        self.addCleanup(unavailable.close)

        status = unavailable.handle_frame({"id": "status", "type": "status"})
        profiles = unavailable.handle_frame(
            {"id": "profiles", "envelope": {"type": "query", "name": "curriculumProfile.list", "payload": {}}}
        )

        self.assertEqual("unavailable", status["status"]["appServer"])
        self.assertEqual("missing", status["status"]["codexCli"])
        self.assertEqual("unauthenticated", status["status"]["authentication"])
        self.assertTrue(profiles["response"]["ok"])

    def test_refresh_reads_external_cli_authentication_without_login_data(self) -> None:
        self.gateway.authenticated = False
        result = self.service.handle_frame({"id": "refresh", "type": "auth", "action": "refresh"})

        self.assertEqual("auth", result["type"])
        self.assertEqual({"state": "unauthenticated"}, result["authentication"])
        self.assertEqual("account/read", self.gateway.calls[-1])
        self.assertEqual({"refreshToken": True}, self.gateway.last_params)
        self.assertNotIn("learner@example.test", str(result))

    def test_refresh_after_external_device_login_authenticates_and_emits_event(self) -> None:
        delivered: list[dict] = []
        self.service.subscribe_events(delivered.append)
        self.gateway.authenticated = False
        self.service.handle_frame({"id": "refresh-1", "type": "auth", "action": "refresh"})
        self.gateway.authenticated = True

        refreshed = self.service.handle_frame({"id": "refresh-2", "type": "auth", "action": "refresh"})
        completed_status = self.service.handle_frame({"id": "status", "type": "status"})
        self.assertEqual("authenticated", refreshed["authentication"]["state"])
        self.assertEqual("authenticated", completed_status["status"]["authentication"])
        self.assertEqual("authentication.changed", delivered[-1]["event"]["name"])
        self.assertEqual("authenticated", delivered[-1]["event"]["payload"]["authentication"])
        self.assertNotIn("learner@example.test", str(delivered))

    def test_tracks_external_account_updates(self) -> None:
        self.gateway.authenticated = False
        self.gateway.notify("account/updated", {})
        status = self.service.handle_frame({"id": "status", "type": "status"})
        self.assertEqual("unauthenticated", status["status"]["authentication"])

    def test_codex_command_disables_non_learning_tools_without_overriding_credentials(self) -> None:
        command = DesktopService.codex_command("/usr/local/bin/codex")

        self.assertEqual(["/usr/local/bin/codex", "app-server", "--stdio"], command[:3])
        self.assertNotIn('cli_auth_credentials_store="keyring"', command)
        self.assertIn("mcp_servers={}", command)
        self.assertIn('model_provider="openai"', command)
        self.assertIn("analytics.enabled=false", command)
        self.assertIn("project_doc_max_bytes=0", command)
        self.assertIn("features.remote_plugin=false", command)
        self.assertIn("features.plugins=false", command)
        self.assertIn("features.plugin_sharing=false", command)
        self.assertIn("features.enable_mcp_apps=false", command)
        self.assertIn("features.tool_call_mcp_elicitation=false", command)
        self.assertIn("features.auth_elicitation=false", command)
        self.assertIn("features.skill_mcp_dependency_install=false", command)
        self.assertIn("features.memories=false", command)
        self.assertIn("features.image_generation=false", command)
        self.assertIn("features.workspace_dependencies=false", command)
        self.assertIn("features.tool_suggest=false", command)
        self.assertIn("features.shell_snapshot=false", command)
        self.assertIn("features.code_mode=false", command)
        self.assertIn("features.code_mode_host=false", command)
        self.assertIn("features.shell_tool=false", command)
        self.assertIn("features.apps=false", command)
        self.assertIn("features.unified_exec=false", command)
        self.assertIn("features.browser_use=false", command)
        self.assertIn("features.browser_use_external=false", command)
        self.assertIn("features.browser_use_full_cdp_access=false", command)
        self.assertIn("features.in_app_browser=false", command)
        self.assertIn("features.computer_use=false", command)
        self.assertIn("notify=[]", command)
        self.assertIn('chatgpt_base_url="https://chatgpt.com/backend-api/"', command)
        self.assertIn('openai_base_url="https://chatgpt.com/backend-api/codex"', command)
        self.assertIn('web_search="disabled"', command)

    def test_builds_secret_free_fail_closed_mcp_overrides(self) -> None:
        overrides = DesktopService.mcp_isolation_overrides(
            [
                {
                    "name": "local-tools",
                    "enabled": True,
                    "transport": {"type": "stdio", "command": "secret-command", "env": {"TOKEN": "secret"}},
                },
                {
                    "name": "remote-tools",
                    "enabled": True,
                    "transport": {"type": "streamable_http", "url": "https://private.example.test"},
                },
            ]
        )

        self.assertIn('mcp_servers.local-tools={command="/usr/bin/false",enabled=false}', overrides)
        self.assertIn('mcp_servers.remote-tools={url="http://127.0.0.1",enabled=false}', overrides)
        self.assertIn('mcp_servers.node_repl={command="/usr/bin/false",enabled=false}', overrides)
        self.assertNotIn("secret", str(overrides))
        self.assertNotIn("private.example.test", str(overrides))

    def test_rejects_invalid_mcp_discovery_without_exposing_values(self) -> None:
        with self.assertRaises(ApplicationError) as raised:
            DesktopService.mcp_isolation_overrides(
                [{"name": "invalid name", "enabled": True, "transport": {"type": "stdio"}}]
            )

        self.assertEqual("APP_SERVER_UNAVAILABLE", raised.exception.code)
        self.assertNotIn("invalid name", raised.exception.message)

    def test_discovers_then_verifies_mcp_isolation_without_reusing_secret_configuration(self) -> None:
        discovered = [
            {
                "name": "private-tools",
                "enabled": True,
                "transport": {"type": "stdio", "command": "secret-command", "env": {"TOKEN": "secret"}},
            }
        ]
        verified = [
            {
                "name": "private-tools",
                "enabled": False,
                "transport": {"type": "stdio", "command": "/usr/bin/false"},
            },
            {
                "name": "node_repl",
                "enabled": False,
                "transport": {"type": "stdio", "command": "/usr/bin/false"},
            },
        ]
        completed = [
            subprocess.CompletedProcess([], 0, json.dumps(discovered), "private stderr"),
            subprocess.CompletedProcess([], 0, json.dumps(verified), "private stderr"),
        ]

        with patch("learnstepper.desktop_service.subprocess.run", side_effect=completed) as runner:
            overrides = DesktopService._discover_mcp_isolation_overrides("/usr/local/bin/codex")

        self.assertEqual(2, runner.call_count)
        self.assertIn('mcp_servers.private-tools={command="/usr/bin/false",enabled=false}', overrides)
        self.assertIn('mcp_servers.node_repl={command="/usr/bin/false",enabled=false}', overrides)
        verification_command = runner.call_args_list[1].args[0]
        self.assertNotIn("secret-command", str(verification_command))
        self.assertNotIn("private stderr", str(overrides))

    def test_rejects_mcp_isolation_when_verified_configuration_remains_enabled(self) -> None:
        discovered = [{"name": "tools", "enabled": True, "transport": {"type": "stdio"}}]
        still_enabled = [{"name": "tools", "enabled": True, "transport": {"type": "stdio"}}]
        completed = [
            subprocess.CompletedProcess([], 0, json.dumps(discovered), ""),
            subprocess.CompletedProcess([], 0, json.dumps(still_enabled), ""),
        ]

        with (
            patch("learnstepper.desktop_service.subprocess.run", side_effect=completed),
            self.assertRaises(ApplicationError) as raised,
        ):
            DesktopService._discover_mcp_isolation_overrides("/usr/local/bin/codex")

        self.assertEqual("APP_SERVER_UNAVAILABLE", raised.exception.code)

    def test_fails_closed_when_app_server_still_exposes_mcp_capabilities(self) -> None:
        gateway = FakeGateway()
        original_request = gateway.request

        def request(method: str, params: dict | None = None) -> dict:
            if method == "mcpServerStatus/list":
                return {
                    "data": [
                        {
                            "name": "unexpected",
                            "tools": {"write": {}},
                            "resources": [],
                            "resourceTemplates": [],
                            "serverInfo": {"name": "unexpected"},
                            "authStatus": "unsupported",
                        }
                    ],
                    "nextCursor": None,
                }
            return original_request(method, params)

        gateway.request = request  # type: ignore[method-assign]
        service = DesktopService(
            data_directory=Path(self.tempdir.name) / "mcp-fail-closed",
            application_root=ROOT,
            gateway_factory=lambda: gateway,
        )
        self.addCleanup(service.close)

        status = service.handle_frame({"id": "status", "type": "status"})["status"]
        self.assertTrue(gateway.closed)
        self.assertEqual("unavailable", status["appServer"])
        self.assertEqual("error", status["authentication"])

    def test_mcp_status_verification_reads_every_page(self) -> None:
        gateway = FakeGateway()
        requests: list[dict] = []

        def request(method: str, params: dict | None = None) -> dict:
            self.assertEqual("mcpServerStatus/list", method)
            requests.append(params or {})
            if params == {"cursor": "page-2"}:
                return {"data": [], "nextCursor": None}
            return {"data": [], "nextCursor": "page-2"}

        gateway.request = request  # type: ignore[method-assign]
        DesktopService._verify_mcp_isolation(gateway)

        self.assertEqual([{}, {"cursor": "page-2"}], requests)

    def test_mcp_status_verification_rejects_capabilities_on_a_later_page(self) -> None:
        gateway = FakeGateway()

        def request(method: str, params: dict | None = None) -> dict:
            if params == {"cursor": "page-2"}:
                return {"data": [{"tools": {"write": {}}}], "nextCursor": None}
            return {"data": [], "nextCursor": "page-2"}

        gateway.request = request  # type: ignore[method-assign]
        with self.assertRaises(ApplicationError) as raised:
            DesktopService._verify_mcp_isolation(gateway)

        self.assertEqual("APP_SERVER_UNAVAILABLE", raised.exception.code)

    def test_mcp_status_verification_rejects_a_cursor_cycle(self) -> None:
        gateway = FakeGateway()
        gateway.request = lambda method, params=None: {"data": [], "nextCursor": "repeat"}  # type: ignore[method-assign]

        with self.assertRaises(ApplicationError) as raised:
            DesktopService._verify_mcp_isolation(gateway)

        self.assertEqual("APP_SERVER_UNAVAILABLE", raised.exception.code)

    def test_default_gateway_reuses_external_cli_home_without_app_owned_codex_home(self) -> None:
        data_directory = Path(self.tempdir.name) / "external-runtime"
        gateway = FakeGateway()
        with (
            patch("learnstepper.desktop_service.StdioCodexGateway", return_value=gateway) as constructor,
            patch.object(DesktopService, "_discover_mcp_isolation_overrides", return_value=[]),
        ):
            service = DesktopService(
                data_directory=data_directory,
                application_root=ROOT,
                codex_executable=str(Path(__file__).resolve()),
            )
        self.addCleanup(service.close)

        self.assertFalse((data_directory / "codex").exists())
        self.assertNotIn("environment", constructor.call_args.kwargs)

    def test_reports_unsupported_external_cli_separately(self) -> None:
        unsupported = DesktopService(
            data_directory=Path(self.tempdir.name) / "unsupported",
            application_root=ROOT,
            gateway_factory=lambda: (_ for _ in ()).throw(
                ApplicationError("CODEX_CLI_UNSUPPORTED", "wrong version")
            ),
        )
        self.addCleanup(unsupported.close)

        status = unsupported.handle_frame({"id": "status", "type": "status"})["status"]
        self.assertEqual("unsupported", status["codexCli"])
        self.assertEqual("unavailable", status["appServer"])

    def test_rejects_removed_browser_login_actions(self) -> None:
        result = self.service.handle_frame({"id": "login", "type": "auth", "action": "login"})

        self.assertEqual("VALIDATION_ERROR", result["response"]["error"]["code"])
        self.assertNotIn("account/login/start", self.gateway.calls)
