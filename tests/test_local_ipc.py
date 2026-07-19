from __future__ import annotations

import tempfile
import unittest
import uuid
from datetime import UTC, datetime
from pathlib import Path

from learnstepper.core import ApplicationCore, AttainmentPolicy
from learnstepper.ipc import LocalIPC
from learnstepper.persistence import SQLiteDatabase

ROOT = Path(__file__).resolve().parents[1]


class CoreOnlyConversationStub:
    @staticmethod
    def handles_command(name: str) -> bool:
        return False

    @staticmethod
    def handles_query(name: str) -> bool:
        return False


class MisconfiguredConversationStub(CoreOnlyConversationStub):
    @staticmethod
    def command(*, name: str, payload: dict, request_id: str) -> dict:
        return {"owner": "conversation", "name": name}

    @staticmethod
    def query(*, name: str, payload: dict) -> dict:
        return {"owner": "conversation", "name": name}


def request_id(label: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"learnstepper-test:{label}"))


class LocalIPCContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        core = ApplicationCore(
            database=SQLiteDatabase(Path(self.tempdir.name) / "ipc.sqlite3"),
            curricula_dir=ROOT / "curricula" / "structured",
            attainment_policy=AttainmentPolicy(minimum_score=0.8),
            clock=lambda: datetime(2026, 7, 18, 6, 0, tzinfo=UTC),
        )
        core.initialize()
        self.core = core
        self.ipc = LocalIPC(core, conversation=CoreOnlyConversationStub())

    def test_conversation_coordinator_is_required(self) -> None:
        with self.assertRaises(TypeError):
            LocalIPC(self.core)

    def test_conversation_api_never_falls_back_to_legacy_core_handlers(self) -> None:
        ipc = LocalIPC(self.core, conversation=MisconfiguredConversationStub())  # type: ignore[arg-type]
        command = ipc.handle(
            {
                "type": "command",
                "name": "session.start",
                "request_id": request_id("conversation-routing"),
                "payload": {},
            }
        )
        query = ipc.handle({"type": "query", "name": "session.get", "payload": {}})
        self.assertEqual("conversation", command["data"]["owner"])
        self.assertEqual("conversation", query["data"]["owner"])

    def test_command_and_query_use_closed_envelopes(self) -> None:
        command = self.ipc.handle(
            {
                "type": "command",
                "name": "profile.update",
                "request_id": request_id("ipc-profile"),
                "payload": {
                    "display_name": "Learner",
                    "locale": "ja-JP",
                    "timezone": "Asia/Tokyo",
                },
            }
        )
        self.assertTrue(command["ok"])
        query = self.ipc.handle({"type": "query", "name": "profile.get", "payload": {}})
        self.assertTrue(query["ok"])
        self.assertEqual("Learner", query["data"]["display_name"])

        rejected = self.ipc.handle(
            {
                "type": "query",
                "name": "profile.get",
                "payload": {},
                "unexpected": "field",
            }
        )
        self.assertFalse(rejected["ok"])
        self.assertEqual("VALIDATION_ERROR", rejected["error"]["code"])

    def test_errors_are_classified_and_do_not_echo_secret_input(self) -> None:
        secret = "secret-access-token-value"
        response = self.ipc.handle(
            {
                "type": "command",
                "name": "profile.update",
                "request_id": request_id("ipc-secret"),
                "payload": {
                    "display_name": "Learner",
                    "locale": "ja-JP",
                    "timezone": "Asia/Tokyo",
                    "access_token": secret,
                },
            }
        )
        self.assertFalse(response["ok"])
        self.assertEqual("VALIDATION_ERROR", response["error"]["code"])
        self.assertEqual(request_id("ipc-secret"), response["error"]["request_id"])
        self.assertNotIn(secret, str(response))

        enum_response = self.ipc.handle(
            {
                "type": "command",
                "name": "project.create",
                "request_id": request_id("ipc-secret-enum"),
                "payload": {
                    "mode": secret,
                    "title": "Title",
                    "topic": "Topic",
                    "purpose": "Purpose",
                    "curriculum_id": None,
                    "current_level": "beginner",
                    "target_level": "advanced",
                    "target_date": None,
                    "preferred_session_minutes": 30,
                    "constraints": {"prerequisites": [], "uses": [], "exclusions": []},
                },
            }
        )
        self.assertFalse(enum_response["ok"])
        self.assertNotIn(secret, str(enum_response))

        unknown_field_response = self.ipc.handle(
            {
                "type": "query",
                "name": "profile.get",
                "payload": {secret: True},
            }
        )
        self.assertFalse(unknown_field_response["ok"])
        self.assertNotIn(secret, str(unknown_field_response))

        unknown_name_response = self.ipc.handle({"type": "query", "name": secret, "payload": {}})
        self.assertFalse(unknown_name_response["ok"])
        self.assertNotIn(secret, str(unknown_name_response))

    def test_response_budget_rejects_unbounded_query_results(self) -> None:
        class OversizedCore:
            def query(self, *, name: str, payload: dict) -> dict:
                return {"content": "x" * (LocalIPC.MAX_RESPONSE_BYTES + 1)}

        response = LocalIPC(OversizedCore(), conversation=CoreOnlyConversationStub()).handle(  # type: ignore[arg-type]
            {"type": "query", "name": "large", "payload": {}}
        )
        self.assertFalse(response["ok"])
        self.assertEqual("RESPONSE_TOO_LARGE", response["error"]["code"])

    def test_payload_limits_reject_oversize_deep_and_wide_values(self) -> None:
        cases = [
            {"value": "x" * 65_537},
            {"value": list(range(1001))},
        ]
        deep: dict = {"value": "leaf"}
        for _ in range(33):
            deep = {"value": deep}
        cases.append(deep)
        for payload in cases:
            response = self.ipc.handle({"type": "query", "name": "profile.get", "payload": payload})
            self.assertFalse(response["ok"])
            self.assertEqual("VALIDATION_ERROR", response["error"]["code"])

    def test_command_request_id_requires_canonical_uuid(self) -> None:
        response = self.ipc.handle(
            {"type": "command", "name": "profile.update", "request_id": "not-a-uuid", "payload": {}}
        )
        self.assertFalse(response["ok"])
        self.assertEqual("VALIDATION_ERROR", response["error"]["code"])


if __name__ == "__main__":
    unittest.main()
