from __future__ import annotations

import tempfile
import threading
import time
import unittest
from pathlib import Path

from learnstepper.desktop_service import DesktopService

ROOT = Path(__file__).resolve().parents[1]


class FakeGateway:
    def __init__(self) -> None:
        self.closed = False

    def request(self, method: str, params: dict | None = None) -> dict:
        if method == "account/read":
            return {
                "account": {"type": "chatgpt", "email": "learner@example.test", "planType": "plus"},
                "requiresOpenaiAuth": False,
            }
        return {}

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
        self.assertTrue(self.service.wait_for_gateway_probe(timeout=1))
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
        self.assertTrue(unavailable.wait_for_gateway_probe(timeout=1))

        status = unavailable.handle_frame({"id": "status", "type": "status"})
        profiles = unavailable.handle_frame(
            {"id": "profiles", "envelope": {"type": "query", "name": "curriculumProfile.list", "payload": {}}}
        )

        self.assertEqual("unavailable", status["status"]["appServer"])
        self.assertTrue(profiles["response"]["ok"])

    def test_blocked_codex_probe_does_not_block_local_core_queries(self) -> None:
        release_probe = threading.Event()

        def blocked_gateway() -> FakeGateway:
            release_probe.wait(timeout=2)
            return FakeGateway()

        started = time.monotonic()
        service = DesktopService(
            data_directory=Path(self.tempdir.name) / "blocked-probe",
            application_root=ROOT,
            gateway_factory=blocked_gateway,
        )
        self.addCleanup(service.close)
        self.addCleanup(release_probe.set)
        delivered: list[dict] = []
        service.subscribe_events(delivered.append)

        profiles = service.handle_frame(
            {"id": "profiles", "envelope": {"type": "query", "name": "curriculumProfile.list", "payload": {}}}
        )
        status = service.handle_frame({"id": "status", "type": "status"})

        self.assertLess(time.monotonic() - started, 0.5)
        self.assertTrue(profiles["response"]["ok"])
        self.assertEqual("checking", status["status"]["appServer"])

        release_probe.set()
        self.assertTrue(service.wait_for_gateway_probe(timeout=1))
        self.assertEqual("runtime.statusChanged", delivered[-1]["event"]["name"])
        self.assertEqual("authenticated", delivered[-1]["event"]["payload"]["authentication"])
