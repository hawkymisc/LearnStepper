from __future__ import annotations

import hashlib
import os
import sys
import tempfile
import threading
import time
import unittest
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from learnstepper.codex import StdioCodexGateway
from learnstepper.conversation import ConversationConfig, ConversationCoordinator
from learnstepper.core import ApplicationCore, AttainmentPolicy
from learnstepper.errors import ApplicationError
from learnstepper.events import RendererEventBroker
from learnstepper.ipc import LocalIPC
from learnstepper.persistence import SQLiteDatabase

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 7, 19, 1, 0, tzinfo=UTC)


def rid(label: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"learnstepper-conversation:{label}"))


class FakeGateway:
    def __init__(self, *, authenticated: bool = True) -> None:
        self.authenticated = authenticated
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.start_counter = 0
        self.fail_on: set[str] = set()
        self.read_result: dict[str, Any] = {"thread": {"id": "remote-thread-1", "turns": []}}
        self.notification_handler: Any | None = None
        self.notify_before_turn_response = False

    def set_notification_handler(self, handler: Any) -> None:
        self.notification_handler = handler

    def request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        body = params or {}
        self.calls.append((method, body))
        if method in self.fail_on:
            raise ApplicationError("APP_SERVER_UNAVAILABLE", "simulated provider failure", retryable=True)
        if method == "account/read":
            return {
                "account": {"type": "chatgpt", "email": "learner@example.test", "planType": "plus"}
                if self.authenticated
                else None,
                "requiresOpenaiAuth": True,
            }
        if method == "thread/start":
            self.start_counter += 1
            return {"thread": {"id": f"remote-thread-{self.start_counter}", "turns": []}}
        if method == "thread/resume":
            return {"thread": {"id": body["threadId"], "turns": []}}
        if method == "turn/start":
            remote_turn_id = f"remote-turn-{len(self.calls)}"
            if self.notify_before_turn_response and self.notification_handler is not None:
                self.notification_handler(
                    "item/completed",
                    {
                        "threadId": body["threadId"],
                        "turnId": remote_turn_id,
                        "completedAtMs": 1,
                        "item": {"id": "early-item", "type": "agentMessage", "text": "early"},
                    },
                )
            return {"turn": {"id": remote_turn_id, "items": [], "status": "inProgress"}}
        if method == "thread/read":
            return self.read_result
        return {}

    def close(self) -> None:
        return None


class ConversationContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        self.database = SQLiteDatabase(Path(self.tempdir.name) / "conversation.sqlite3")
        self.core = ApplicationCore(
            database=self.database,
            curricula_dir=ROOT / "curricula" / "structured",
            attainment_policy=AttainmentPolicy(minimum_score=0.8),
            clock=lambda: NOW,
        )
        self.core.initialize()
        self.core.command(
            name="profile.update",
            payload={"display_name": "Learner", "locale": "ja-JP", "timezone": "Asia/Tokyo"},
            request_id="profile",
        )
        self.project = self.core.command(
            name="project.create",
            payload={
                "mode": "free_topic",
                "title": "Topic",
                "topic": "Topic",
                "purpose": "Learn",
                "curriculum_id": None,
                "current_level": "beginner",
                "target_level": "advanced",
                "target_date": None,
                "preferred_session_minutes": 30,
                "constraints": {"prerequisites": [], "uses": [], "exclusions": []},
            },
            request_id="project",
        )
        self.gateway = FakeGateway()
        self.events = RendererEventBroker(clock=lambda: NOW)
        self.conversation = ConversationCoordinator(
            database=self.database,
            gateway=self.gateway,
            events=self.events,
            config=ConversationConfig(),
            clock=lambda: NOW,
        )
        self.ipc = LocalIPC(self.core, conversation=self.conversation)

    def command(self, name: str, payload: dict[str, Any], request_id: str) -> dict[str, Any]:
        result = self.ipc.handle({"type": "command", "name": name, "request_id": rid(request_id), "payload": payload})
        if not result["ok"]:
            raise ApplicationError(**result["error"])
        return result["data"]

    def test_start_send_resume_preserve_project_session_and_thread_hierarchy(self) -> None:
        started = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start")
        first_thread = started["active_thread"]
        sent = self.command("message.send", {"session_id": started["id"], "text": "Explain it"}, "send")
        self.assertEqual((started["id"], first_thread["id"]), (sent["session_id"], sent["thread_id"]))

        resumed = self.command(
            "session.resume", {"session_id": started["id"], "thread_id": first_thread["id"]}, "resume"
        )
        self.assertEqual(started["id"], resumed["id"])
        self.assertEqual(first_thread["id"], resumed["active_thread"]["id"])
        self.assertEqual(first_thread["codex_thread_id"], resumed["active_thread"]["codex_thread_id"])
        with self.database.read() as db:
            self.assertEqual(1, db.fetchone("SELECT COUNT(*) AS n FROM learning_sessions")["n"])
            self.assertEqual(1, db.fetchone("SELECT COUNT(*) AS n FROM codex_threads")["n"])

        another = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start-2")
        self.assertNotEqual(started["id"], another["id"])
        with self.database.read() as db:
            self.assertEqual(2, db.fetchone("SELECT COUNT(*) AS n FROM learning_sessions")["n"])

    def test_restart_recreates_coordinator_and_resumes_same_session_and_thread(self) -> None:
        started = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start")
        thread = started["active_thread"]
        turn = self.conversation.record_turn_for_test(started["id"], thread["id"], "remote-turn-1", "question")
        self.conversation.record_completed_item_for_test(turn["id"], "remote-item-1", "assistant", "persisted answer")

        restarted_database = SQLiteDatabase(Path(self.tempdir.name) / "conversation.sqlite3")
        restarted_gateway = FakeGateway()
        restarted_gateway.read_result = {
            "thread": {
                "id": thread["codex_thread_id"],
                "turns": [
                    {
                        "id": "remote-turn-1",
                        "status": "completed",
                        "items": [
                            {
                                "id": "remote-item-1",
                                "type": "agentMessage",
                                "text": "persisted answer",
                            }
                        ],
                    }
                ],
            }
        }
        restarted = ConversationCoordinator(
            database=restarted_database,
            gateway=restarted_gateway,
            events=RendererEventBroker(clock=lambda: NOW),
            config=ConversationConfig(),
            clock=lambda: NOW,
        )
        restarted_ipc = LocalIPC(self.core, conversation=restarted)
        response = restarted_ipc.handle(
            {
                "type": "command",
                "name": "session.resume",
                "request_id": rid("restart-resume"),
                "payload": {"session_id": started["id"], "thread_id": thread["id"]},
            }
        )

        self.assertTrue(response["ok"], response)
        resumed = response["data"]
        self.assertEqual(started["id"], resumed["id"])
        self.assertEqual(thread["id"], resumed["active_thread"]["id"])
        self.assertEqual(thread["codex_thread_id"], resumed["active_thread"]["codex_thread_id"])
        self.assertEqual(
            "persisted answer",
            resumed["active_thread"]["turns"][0]["items"][0]["content"],
        )

    def test_item_fork_reconstructs_exact_prefix_and_activates_child(self) -> None:
        started = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start")
        thread = started["active_thread"]
        turn = self.conversation.record_turn_for_test(started["id"], thread["id"], "remote-turn-1", "question")
        first = self.conversation.record_completed_item_for_test(turn["id"], "remote-item-1", "assistant", "one")
        second = self.conversation.record_completed_item_for_test(turn["id"], "remote-item-2", "assistant", "two")
        self.conversation.record_completed_item_for_test(turn["id"], "remote-item-3", "assistant", "three")

        forked = self.command(
            "thread.fork",
            {"session_id": started["id"], "source_thread_id": thread["id"], "through_item_id": second["id"]},
            "fork",
        )
        self.assertEqual(started["id"], forked["session_id"])
        self.assertEqual("history_reconstruction", forked["fork_mode"])
        self.assertEqual(forked["id"], self.conversation.get_session(started["id"])["active_thread"]["id"])
        inject = next(params for method, params in self.gateway.calls if method == "thread/inject_items")
        self.assertEqual(["one", "two"], [item["content"][0]["text"] for item in inject["items"]])
        self.assertNotEqual(first["id"], forked["forked_from_item_id"])
        snapshot = self.ipc.handle({"type": "query", "name": "session.get", "payload": {"id": started["id"]}})["data"]
        child = next(item for item in snapshot["threads"] if item["id"] == forked["id"])
        self.assertEqual(["one", "two"], [item["content"] for item in child["logical_items"]])
        self.assertTrue(all(item["inherited"] for item in child["logical_items"]))
        nested = self.command(
            "thread.fork",
            {"session_id": started["id"], "source_thread_id": child["id"], "through_item_id": first["id"]},
            "nested-fork",
        )
        nested_snapshot = self.conversation.get_session(started["id"])
        nested_thread = next(item for item in nested_snapshot["threads"] if item["id"] == nested["id"])
        self.assertEqual(["one"], [item["content"] for item in nested_thread["logical_items"]])
        inject_calls = [params for method, params in self.gateway.calls if method == "thread/inject_items"]
        self.assertEqual(["one"], [item["content"][0]["text"] for item in inject_calls[-1]["items"]])
        reactivated = self.command(
            "thread.activate", {"session_id": started["id"], "thread_id": thread["id"]}, "reactivate-parent"
        )
        self.assertEqual(thread["id"], reactivated["active_thread"]["id"])

    def test_failed_item_fork_keeps_parent_active_and_records_remote_child_for_recovery(self) -> None:
        started = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start")
        parent = started["active_thread"]
        turn = self.conversation.record_turn_for_test(started["id"], parent["id"], "remote-turn", "q")
        anchor = self.conversation.record_completed_item_for_test(turn["id"], "remote-item", "assistant", "a")
        self.gateway.fail_on.add("thread/inject_items")
        failed = self.ipc.handle(
            {
                "type": "command",
                "name": "thread.fork",
                "request_id": rid("failed-fork"),
                "payload": {
                    "session_id": started["id"],
                    "source_thread_id": parent["id"],
                    "through_item_id": anchor["id"],
                },
            }
        )
        self.assertEqual("APP_SERVER_UNAVAILABLE", failed["error"]["code"])
        snapshot = self.conversation.get_session(started["id"])
        self.assertEqual(parent["id"], snapshot["active_thread"]["id"])
        child = next(thread for thread in snapshot["threads"] if thread["id"] != parent["id"])
        self.assertEqual("failed", child["status"])
        self.assertIsNotNone(child["codex_thread_id"])

    def test_item_fork_rejects_lossy_prefix_before_creating_a_remote_thread(self) -> None:
        started = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start")
        parent = started["active_thread"]
        turn = self.conversation.record_turn_for_test(started["id"], parent["id"], "remote-turn", "q")
        reasoning = self.conversation.record_completed_item_for_test(
            turn["id"], "remote-reasoning", "system", "hidden reasoning", item_type="reasoning"
        )
        response = self.ipc.handle(
            {
                "type": "command",
                "name": "thread.fork",
                "request_id": rid("lossy-fork"),
                "payload": {
                    "session_id": started["id"],
                    "source_thread_id": parent["id"],
                    "through_item_id": reasoning["id"],
                },
            }
        )
        self.assertEqual("VALIDATION_ERROR", response["error"]["code"])
        self.assertEqual(1, self.gateway.start_counter)
        snapshot = self.conversation.get_session(started["id"])
        self.assertEqual(1, len(snapshot["threads"]))
        self.assertFalse(snapshot["threads"][0]["turns"][0]["items"][0]["forkable"])

    def test_interrupt_and_complete_preserve_input_and_close_active_thread(self) -> None:
        started = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start")
        sent = self.command("message.send", {"session_id": started["id"], "text": "unfinished"}, "send")
        interrupted = self.command(
            "turn.interrupt", {"session_id": started["id"], "turn_id": sent["turn_id"]}, "interrupt"
        )
        self.assertEqual("interrupted", interrupted["status"])
        completed = self.command(
            "session.complete",
            {"id": started["id"], "summary": "Summary", "next_action": "Next"},
            "complete",
        )
        self.assertEqual("completed", completed["status"])
        self.assertIsNone(completed["active_thread"])
        self.assertEqual("unfinished", completed["threads"][0]["turns"][0]["input_text"])
        self.assertEqual("inactive", completed["threads"][0]["status"])

    def test_explicit_model_and_effort_are_sent_only_to_supported_methods(self) -> None:
        gateway = FakeGateway()
        coordinator = ConversationCoordinator(
            database=self.database,
            gateway=gateway,
            events=RendererEventBroker(clock=lambda: NOW),
            config=ConversationConfig(model="gpt-test", reasoning_effort="high"),
            clock=lambda: NOW,
        )
        ipc = LocalIPC(self.core, conversation=coordinator)
        started = ipc.handle(
            {
                "type": "command",
                "name": "session.start",
                "request_id": rid("configured-start"),
                "payload": {"project_id": self.project["id"], "lesson_id": None},
            }
        )["data"]
        ipc.handle(
            {
                "type": "command",
                "name": "message.send",
                "request_id": rid("configured-send"),
                "payload": {"session_id": started["id"], "text": "q"},
            }
        )
        start_params = next(params for method, params in gateway.calls if method == "thread/start")
        turn_params = next(params for method, params in gateway.calls if method == "turn/start")
        self.assertEqual("gpt-test", start_params["model"])
        self.assertNotIn("effort", start_params)
        self.assertEqual(("gpt-test", "high"), (turn_params["model"], turn_params["effort"]))

    def test_reconciliation_imports_missing_completed_items_and_rejects_divergence(self) -> None:
        started = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start")
        thread = started["active_thread"]
        self.gateway.read_result = {
            "thread": {
                "id": thread["codex_thread_id"],
                "turns": [
                    {
                        "id": "remote-turn-1",
                        "status": "completed",
                        "items": [
                            {"id": "remote-item-1", "type": "agentMessage", "role": "assistant", "text": "answer"}
                        ],
                    }
                ],
            }
        }
        result = self.command("conversation.reconcile", {"session_id": started["id"], "thread_id": thread["id"]}, "r1")
        self.assertEqual(1, result["imported_items"])
        self.gateway.read_result["thread"]["turns"][0]["items"][0]["text"] = "different"
        response = self.ipc.handle(
            {
                "type": "command",
                "name": "conversation.reconcile",
                "request_id": rid("r2"),
                "payload": {"session_id": started["id"], "thread_id": thread["id"]},
            }
        )
        self.assertFalse(response["ok"])
        self.assertEqual("RECONCILIATION_CONFLICT", response["error"]["code"])
        self.assertEqual(
            "answer", self.conversation.get_session(started["id"])["threads"][0]["turns"][0]["items"][0]["content"]
        )

    def test_auth_failure_blocks_codex_only_but_local_queries_still_work(self) -> None:
        self.gateway.authenticated = False
        denied = self.ipc.handle(
            {
                "type": "command",
                "name": "session.start",
                "request_id": rid("denied"),
                "payload": {"project_id": self.project["id"], "lesson_id": None},
            }
        )
        self.assertEqual("AUTH_REQUIRED", denied["error"]["code"])
        local = self.ipc.handle({"type": "query", "name": "project.get", "payload": {"id": self.project["id"]}})
        self.assertTrue(local["ok"])

    def test_omitted_model_configuration_is_not_sent_and_events_are_typed(self) -> None:
        started = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start")
        params = next(params for method, params in self.gateway.calls if method == "thread/start")
        self.assertNotIn("model", params)
        self.assertNotIn("effort", params)
        events = self.ipc.handle({"type": "query", "name": "conversation.events", "payload": {"after_sequence": 0}})
        self.assertTrue(events["ok"])
        self.assertEqual("thread.started", events["data"]["items"][0]["name"])
        self.assertEqual(started["id"], events["data"]["items"][0]["session_id"])

    def test_deltas_are_transient_completed_items_are_durable_and_quick_actions_are_versioned(self) -> None:
        started = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start")
        sent = self.command("message.send", {"session_id": started["id"], "text": "Question"}, "send")
        remote_thread_id = started["active_thread"]["codex_thread_id"]
        self.conversation.handle_notification(
            "item/agentMessage/delta",
            {
                "threadId": remote_thread_id,
                "turnId": sent["codex_turn_id"],
                "itemId": "remote-item",
                "delta": "partial",
            },
        )
        with self.database.read() as db:
            self.assertEqual(0, db.fetchone("SELECT COUNT(*) AS n FROM messages")["n"])
        self.conversation.handle_notification(
            "item/completed",
            {
                "threadId": remote_thread_id,
                "turnId": sent["codex_turn_id"],
                "completedAtMs": 1,
                "item": {"id": "remote-item", "type": "agentMessage", "text": "complete"},
            },
        )
        self.assertEqual(
            "complete", self.conversation.get_session(started["id"])["threads"][0]["turns"][0]["items"][0]["content"]
        )
        steered = self.command(
            "turn.steer",
            {"session_id": started["id"], "turn_id": sent["turn_id"], "action_id": "give_example.v1"},
            "steer",
        )
        self.assertEqual("give_example.v1", steered["action_id"])
        steer_params = next(params for method, params in self.gateway.calls if method == "turn/steer")
        self.assertEqual(sent["codex_turn_id"], steer_params["expectedTurnId"])
        self.conversation.handle_notification(
            "turn/completed",
            {
                "threadId": remote_thread_id,
                "turn": {"id": sent["codex_turn_id"], "status": "completed", "items": []},
            },
        )
        turn = self.conversation.get_session(started["id"])["threads"][0]["turns"][0]
        self.assertEqual("completed", turn["status"])
        denied = self.ipc.handle(
            {
                "type": "command",
                "name": "turn.steer",
                "request_id": rid("bad-steer"),
                "payload": {"session_id": started["id"], "turn_id": sent["turn_id"], "action_id": "raw-text"},
            }
        )
        self.assertEqual("VALIDATION_ERROR", denied["error"]["code"])

    def test_notification_before_turn_response_is_buffered_until_remote_identity_is_bound(self) -> None:
        started = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start")
        self.gateway.notify_before_turn_response = True
        sent = self.command("message.send", {"session_id": started["id"], "text": "Question"}, "send")
        turn = self.conversation.get_session(started["id"])["threads"][0]["turns"][0]
        self.assertEqual(sent["codex_turn_id"], turn["codex_turn_id"])
        self.assertEqual(["early"], [item["content"] for item in turn["items"]])

    def test_event_replay_is_paginated(self) -> None:
        for index in range(3):
            self.events.publish("warning", payload={"index": index})
        first = self.conversation.query(name="conversation.events", payload={"after_sequence": 0, "limit": 2})
        self.assertEqual([1, 2], [item["sequence"] for item in first["items"]])
        second = self.conversation.query(name="conversation.events", payload={"after_sequence": 2, "limit": 2})
        self.assertEqual([3], [item["sequence"] for item in second["items"]])

    def test_confirmed_history_is_paginated_by_stable_sequence(self) -> None:
        started = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start")
        thread = started["active_thread"]
        turn = self.conversation.record_turn_for_test(started["id"], thread["id"], "remote-turn", "q")
        for index in range(3):
            self.conversation.record_completed_item_for_test(
                turn["id"], f"remote-item-{index}", "assistant", f"item-{index}"
            )
        first = self.conversation.query(
            name="history.getSession", payload={"id": started["id"], "after_sequence": 0, "limit": 2}
        )
        self.assertTrue(first["has_more"])
        self.assertEqual(["item-0", "item-1"], [item["content"] for item in first["items"]])
        second = self.conversation.query(
            name="history.getSession",
            payload={"id": started["id"], "after_sequence": first["next_after_sequence"], "limit": 2},
        )
        self.assertFalse(second["has_more"])
        self.assertEqual(["item-2"], [item["content"] for item in second["items"]])

    def test_provider_failure_moves_operation_out_of_pending_state(self) -> None:
        started = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start")
        self.gateway.fail_on.add("thread/resume")
        response = self.ipc.handle(
            {
                "type": "command",
                "name": "session.resume",
                "request_id": rid("failed-resume"),
                "payload": {"session_id": started["id"], "thread_id": started["active_thread"]["id"]},
            }
        )
        self.assertEqual("APP_SERVER_UNAVAILABLE", response["error"]["code"])
        with self.database.read() as db:
            operation = db.fetchone(
                "SELECT state, error_code FROM codex_operations WHERE request_id = ?", (rid("failed-resume"),)
            )
        self.assertEqual({"state": "uncertain", "error_code": "APP_SERVER_UNAVAILABLE"}, operation)

    def test_uncertain_turn_start_keeps_the_project_reservation(self) -> None:
        first = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start-1")
        second = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start-2")
        self.gateway.fail_on.add("turn/start")
        failed = self.ipc.handle(
            {
                "type": "command",
                "name": "message.send",
                "request_id": rid("uncertain-send"),
                "payload": {"session_id": first["id"], "text": "first"},
            }
        )
        self.assertEqual("APP_SERVER_UNAVAILABLE", failed["error"]["code"])
        self.gateway.fail_on.remove("turn/start")
        blocked = self.ipc.handle(
            {
                "type": "command",
                "name": "message.send",
                "request_id": rid("blocked-after-uncertain"),
                "payload": {"session_id": second["id"], "text": "second"},
            }
        )
        self.assertEqual("INVALID_STATE_TRANSITION", blocked["error"]["code"])
        with self.database.read() as db:
            turn = db.fetchone("SELECT status FROM codex_turns WHERE request_id = ?", (rid("uncertain-send"),))
        self.assertEqual("pending", turn["status"])
        remote_thread_id = first["active_thread"]["codex_thread_id"]
        self.gateway.read_result = {
            "thread": {
                "id": remote_thread_id,
                "turns": [{"id": "recovered-turn", "status": "inProgress", "items": []}],
            }
        }
        self.command(
            "conversation.reconcile",
            {"session_id": first["id"], "thread_id": first["active_thread"]["id"]},
            "recover-uncertain",
        )
        recovered = self.conversation.get_session(first["id"])["threads"][0]["turns"][0]
        self.assertEqual(("recovered-turn", "in_progress"), (recovered["codex_turn_id"], recovered["status"]))
        self.conversation.handle_notification(
            "turn/completed",
            {
                "threadId": remote_thread_id,
                "turn": {"id": "recovered-turn", "status": "completed", "items": []},
            },
        )
        self.gateway.read_result["thread"]["turns"][0]["status"] = "completed"
        self.gateway.fail_on.add("turn/start")
        self.ipc.handle(
            {
                "type": "command",
                "name": "message.send",
                "request_id": rid("uncertain-absent"),
                "payload": {"session_id": first["id"], "text": "absent"},
            }
        )
        self.gateway.fail_on.remove("turn/start")
        self.command(
            "conversation.reconcile",
            {"session_id": first["id"], "thread_id": first["active_thread"]["id"]},
            "release-absent",
        )
        sent = self.command("message.send", {"session_id": second["id"], "text": "now allowed"}, "send-after-release")
        self.assertEqual("in_progress", sent["status"])

    def test_session_completion_and_fork_respect_terminal_and_running_turn_boundaries(self) -> None:
        started = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start")
        thread = started["active_thread"]
        sent = self.command("message.send", {"session_id": started["id"], "text": "q"}, "send")
        blocked = self.ipc.handle(
            {
                "type": "command",
                "name": "session.complete",
                "request_id": rid("complete-running"),
                "payload": {"id": started["id"], "summary": "s", "next_action": "n"},
            }
        )
        self.assertEqual("INVALID_STATE_TRANSITION", blocked["error"]["code"])
        self.conversation.handle_notification(
            "turn/completed",
            {
                "threadId": thread["codex_thread_id"],
                "turn": {"id": sent["codex_turn_id"], "status": "completed", "items": []},
            },
        )
        anchor = self.conversation.record_completed_item_for_test(
            sent["turn_id"], "remote-anchor", "assistant", "answer"
        )
        completed = self.command(
            "session.complete", {"id": started["id"], "summary": "s", "next_action": "n"}, "complete"
        )
        self.assertEqual("completed", completed["status"])
        forked = self.ipc.handle(
            {
                "type": "command",
                "name": "thread.fork",
                "request_id": rid("fork-completed"),
                "payload": {
                    "session_id": started["id"],
                    "source_thread_id": thread["id"],
                    "through_item_id": anchor["id"],
                },
            }
        )
        self.assertEqual("INVALID_STATE_TRANSITION", forked["error"]["code"])
        self.assertEqual("completed", self.conversation.get_session(started["id"])["status"])
        for name in ("thread.activate", "conversation.reconcile"):
            payload = (
                {"session_id": started["id"], "thread_id": thread["id"]}
                if name == "thread.activate"
                else {"session_id": started["id"], "thread_id": thread["id"]}
            )
            rejected = self.ipc.handle(
                {
                    "type": "command",
                    "name": name,
                    "request_id": rid(f"{name}-completed"),
                    "payload": payload,
                }
            )
            self.assertEqual("INVALID_STATE_TRANSITION", rejected["error"]["code"])
        with self.assertRaises(ApplicationError) as late:
            self.conversation.handle_notification(
                "item/completed",
                {
                    "threadId": thread["codex_thread_id"],
                    "turnId": sent["codex_turn_id"],
                    "completedAtMs": 2,
                    "item": {"id": "late-item", "type": "agentMessage", "text": "late"},
                },
            )
        self.assertEqual("RECONCILIATION_CONFLICT", late.exception.code)

    def test_project_allows_only_one_provider_turn_across_sessions_and_threads(self) -> None:
        first = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start-1")
        second = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start-2")
        self.command("message.send", {"session_id": first["id"], "text": "first"}, "send-1")
        complete_other = self.ipc.handle(
            {
                "type": "command",
                "name": "session.complete",
                "request_id": rid("complete-other"),
                "payload": {"id": second["id"], "summary": "s", "next_action": "n"},
            }
        )
        self.assertEqual("INVALID_STATE_TRANSITION", complete_other["error"]["code"])
        blocked = self.ipc.handle(
            {
                "type": "command",
                "name": "message.send",
                "request_id": rid("send-2"),
                "payload": {"session_id": second["id"], "text": "second"},
            }
        )
        self.assertEqual("INVALID_STATE_TRANSITION", blocked["error"]["code"])
        self.assertEqual(1, sum(method == "turn/start" for method, _ in self.gateway.calls))

    def test_auth_gate_accepts_only_the_pinned_chatgpt_account_shape(self) -> None:
        original = self.gateway.request
        malformed = [
            {"account": {}, "requiresOpenaiAuth": True},
            {"account": {"type": "apiKey"}, "requiresOpenaiAuth": True},
            {"account": {"type": "unknown"}, "requiresOpenaiAuth": True},
            {
                "account": {
                    "type": "chatgpt",
                    "email": None,
                    "planType": "plus",
                    "accessToken": "secret-canary",
                },
                "requiresOpenaiAuth": True,
            },
            {"account": None, "requiresOpenaiAuth": True},
        ]
        for index, account_response in enumerate(malformed):
            with self.subTest(index=index):
                self.gateway.request = lambda method, params=None, value=account_response: value  # type: ignore[method-assign]
                response = self.ipc.handle(
                    {
                        "type": "command",
                        "name": "session.start",
                        "request_id": rid(f"bad-auth-{index}"),
                        "payload": {"project_id": self.project["id"], "lesson_id": None},
                    }
                )
                self.assertEqual("AUTH_REQUIRED", response["error"]["code"])
                self.assertNotIn("secret-canary", str(response))
        self.gateway.request = original  # type: ignore[method-assign]

    def test_reconciliation_inserts_head_and_middle_items_in_provider_order(self) -> None:
        started = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start")
        thread = started["active_thread"]
        turn = self.conversation.record_turn_for_test(started["id"], thread["id"], "remote-turn", "q")
        tail = self.conversation.record_completed_item_for_test(turn["id"], "remote-item-3", "assistant", "three")
        self.gateway.read_result = {
            "thread": {
                "id": thread["codex_thread_id"],
                "turns": [
                    {
                        "id": "remote-turn",
                        "status": "completed",
                        "items": [
                            {"id": "remote-item-1", "type": "agentMessage", "text": "one"},
                            {"id": "remote-item-2", "type": "agentMessage", "text": "two"},
                            {"id": "remote-item-3", "type": "agentMessage", "text": "three"},
                        ],
                    }
                ],
            }
        }
        before = self.conversation.query(
            name="history.getSession", payload={"id": started["id"], "after_sequence": 0, "limit": 1}
        )
        self.assertEqual(["three"], [item["content"] for item in before["items"]])
        result = self.command(
            "conversation.reconcile", {"session_id": started["id"], "thread_id": thread["id"]}, "reconcile"
        )
        self.assertEqual(2, result["imported_items"])
        after = self.conversation.query(
            name="history.getSession",
            payload={"id": started["id"], "after_sequence": before["next_after_sequence"], "limit": 10},
        )
        self.assertEqual(["one", "two"], [item["content"] for item in after["items"]])
        items = self.conversation.get_session(started["id"])["threads"][0]["turns"][0]["items"]
        self.assertEqual(["one", "two", "three"], [item["content"] for item in items])
        self.command(
            "thread.fork",
            {"session_id": started["id"], "source_thread_id": thread["id"], "through_item_id": tail["id"]},
            "fork-after-reconcile",
        )
        injected = [params for method, params in self.gateway.calls if method == "thread/inject_items"][-1]
        self.assertEqual(["one", "two", "three"], [item["content"][0]["text"] for item in injected["items"]])

    def test_reconciliation_preserves_in_progress_turn_state_and_rejects_reorder(self) -> None:
        started = self.command("session.start", {"project_id": self.project["id"], "lesson_id": None}, "start")
        thread = started["active_thread"]
        existing = self.conversation.record_turn_for_test(started["id"], thread["id"], "existing-turn", "q")
        self.conversation.record_completed_item_for_test(existing["id"], "item-2", "assistant", "two")
        self.conversation.record_completed_item_for_test(existing["id"], "item-1", "assistant", "one")
        self.gateway.read_result = {
            "thread": {
                "id": thread["codex_thread_id"],
                "turns": [
                    {
                        "id": "existing-turn",
                        "status": "completed",
                        "items": [
                            {"id": "item-1", "type": "agentMessage", "text": "one"},
                            {"id": "item-2", "type": "agentMessage", "text": "two"},
                        ],
                    },
                    {"id": "running-turn", "status": "inProgress", "items": []},
                ],
            }
        }
        response = self.ipc.handle(
            {
                "type": "command",
                "name": "conversation.reconcile",
                "request_id": rid("reorder"),
                "payload": {"session_id": started["id"], "thread_id": thread["id"]},
            }
        )
        self.assertEqual("RECONCILIATION_CONFLICT", response["error"]["code"])
        with self.database.transaction() as db:
            db.execute("DELETE FROM messages WHERE thread_id = ?", (thread["id"],))
        result = self.command(
            "conversation.reconcile",
            {"session_id": started["id"], "thread_id": thread["id"]},
            "running-status",
        )
        self.assertEqual(2, result["imported_items"])
        running = next(
            turn
            for turn in self.conversation.get_session(started["id"])["threads"][0]["turns"]
            if turn["codex_turn_id"] == "running-turn"
        )
        self.assertEqual("in_progress", running["status"])


class StdioGatewayContractTest(unittest.TestCase):
    def test_committed_protocol_fixture_is_pinned_and_covers_used_methods(self) -> None:
        fixture = ROOT / "contracts" / "codex-app-server" / "0.144.5" / "codex_app_server_protocol.v2.schemas.json"
        raw = fixture.read_bytes()
        self.assertEqual(
            "275a7469440f01b41056c96faa01db9c24871cadad173064897a99f19dfe0aaa", hashlib.sha256(raw).hexdigest()
        )
        text = raw.decode("utf-8")
        for method in (
            "account/read",
            "thread/start",
            "thread/resume",
            "thread/read",
            "thread/inject_items",
            "turn/start",
            "turn/steer",
            "turn/interrupt",
            "item/agentMessage/delta",
            "item/completed",
            "turn/completed",
        ):
            self.assertIn(method, text)

    def test_injected_jsonl_server_initializes_and_uses_typed_requests(self) -> None:
        gateway = StdioCodexGateway(
            [sys.executable, str(ROOT / "tests" / "fixtures" / "fake_codex_app_server.py")], timeout_seconds=2
        )
        self.addCleanup(gateway.close)
        account = gateway.request("account/read")
        self.assertEqual("chatgpt", account["account"]["type"])
        started = gateway.request("thread/start", {})
        self.assertEqual("remote-thread-started", started["thread"]["id"])

    def test_invalid_json_unexpected_ids_and_partial_lines_fail_closed(self) -> None:
        fixture = str(ROOT / "tests" / "fixtures" / "fake_codex_app_server.py")
        for mode in ("invalid-json", "wrong-id", "partial-timeout"):
            with self.subTest(mode=mode), self.assertRaises(ApplicationError) as raised:
                StdioCodexGateway([sys.executable, fixture, mode], timeout_seconds=0.05)
            self.assertEqual("APP_SERVER_UNAVAILABLE", raised.exception.code)

    def test_notifications_are_dispatched_while_waiting_for_the_matching_response(self) -> None:
        notifications: list[tuple[str, dict[str, Any]]] = []
        gateway = StdioCodexGateway(
            [sys.executable, str(ROOT / "tests" / "fixtures" / "fake_codex_app_server.py"), "notification"],
            timeout_seconds=2,
            notification_handler=lambda method, params: notifications.append((method, params)),
        )
        self.addCleanup(gateway.close)
        gateway.request("account/read")
        self.assertEqual("warning", notifications[0][0])

    def test_notifications_are_dispatched_after_response_without_another_request(self) -> None:
        notifications: list[tuple[str, dict[str, Any]]] = []
        gateway = StdioCodexGateway(
            [sys.executable, str(ROOT / "tests" / "fixtures" / "fake_codex_app_server.py"), "delayed-notification"],
            timeout_seconds=2,
            notification_handler=lambda method, params: notifications.append((method, params)),
        )
        self.addCleanup(gateway.close)
        gateway.request("account/read")
        deadline = time.monotonic() + 1
        while not notifications and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual("warning", notifications[0][0])

    def test_notification_flood_fails_closed_without_blocking_the_reader(self) -> None:
        gate = threading.Event()
        gateway = StdioCodexGateway(
            [
                sys.executable,
                str(ROOT / "tests" / "fixtures" / "fake_codex_app_server.py"),
                "notification-flood",
            ],
            timeout_seconds=2,
            notification_handler=lambda method, params: gate.wait(1),
        )
        self.addCleanup(gateway.close)
        gateway.request("account/read")
        deadline = time.monotonic() + 1
        while gateway._process.poll() is None and time.monotonic() < deadline:  # noqa: SLF001 - contract probe
            time.sleep(0.01)
        with self.assertRaises(ApplicationError) as raised:
            gateway.request("test/cwd")
        self.assertEqual("APP_SERVER_UNAVAILABLE", raised.exception.code)
        gate.set()

    def test_child_environment_is_allowlisted_and_version_match_is_exact(self) -> None:
        fixture = str(ROOT / "tests" / "fixtures" / "fake_codex_app_server.py")
        previous = os.environ.get("LEARNSTEPPER_SECRET_CANARY")
        os.environ["LEARNSTEPPER_SECRET_CANARY"] = "must-not-leak"
        try:
            gateway = StdioCodexGateway([sys.executable, fixture], timeout_seconds=2)
            self.addCleanup(gateway.close)
            self.assertIsNone(gateway.request("test/environment")["value"])
            self.assertNotEqual(os.getcwd(), gateway.request("test/cwd")["value"])
            with self.assertRaises(ApplicationError):
                StdioCodexGateway([sys.executable, fixture], timeout_seconds=2, expected_version="0.144")
        finally:
            if previous is None:
                os.environ.pop("LEARNSTEPPER_SECRET_CANARY", None)
            else:
                os.environ["LEARNSTEPPER_SECRET_CANARY"] = previous


if __name__ == "__main__":
    unittest.main()
