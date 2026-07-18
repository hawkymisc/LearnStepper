from __future__ import annotations

import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from learnstepper.core import ApplicationCore, AttainmentPolicy
from learnstepper.ipc import LocalIPC
from learnstepper.persistence import SQLiteDatabase

ROOT = Path(__file__).resolve().parents[1]


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
        self.ipc = LocalIPC(core)

    def test_command_and_query_use_closed_envelopes(self) -> None:
        command = self.ipc.handle(
            {
                "type": "command",
                "name": "profile.update",
                "request_id": "ipc-profile",
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
                "request_id": "ipc-secret",
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
        self.assertEqual("ipc-secret", response["error"]["request_id"])
        self.assertNotIn(secret, str(response))


if __name__ == "__main__":
    unittest.main()
