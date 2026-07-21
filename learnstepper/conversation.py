from __future__ import annotations

import hashlib
import json
import uuid
from collections import deque
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Lock
from typing import Any, Protocol, cast

from learnstepper.errors import ApplicationError, validation_error
from learnstepper.events import RendererEventBroker
from learnstepper.persistence import Database, DatabaseSession

JsonObject = dict[str, Any]


class CodexGateway(Protocol):
    def request(self, method: str, params: JsonObject | None = None) -> JsonObject: ...

    def close(self) -> None: ...


@dataclass(frozen=True, slots=True)
class ConversationConfig:
    model: str | None = None
    reasoning_effort: str | None = None
    working_directory: str | None = None

    def __post_init__(self) -> None:
        for value, field in (
            (self.model, "model"),
            (self.reasoning_effort, "reasoning_effort"),
            (self.working_directory, "working_directory"),
        ):
            if value is not None and (not isinstance(value, str) or not value.strip()):
                raise ValueError(f"{field} must be nonblank when specified")


class ConversationCoordinator:
    """Coordinates durable intent, transaction-free provider I/O, and result application."""

    COMMANDS = {
        "session.start",
        "session.resume",
        "thread.fork",
        "thread.activate",
        "message.send",
        "turn.steer",
        "turn.interrupt",
        "conversation.reconcile",
        "session.complete",
    }
    QUERIES = {"conversation.events", "session.get", "history.getSession"}
    QUICK_ACTIONS = {
        "explain_simply.v1": "Explain the current point more simply without changing the learning goal.",
        "give_example.v1": "Give one concrete example for the current point.",
        "check_understanding.v1": "Ask one short question to check my understanding.",
        "return_to_lesson.v1": "Return to the current lesson objective and briefly reconnect this discussion to it.",
    }

    def __init__(
        self,
        *,
        database: Database,
        gateway: CodexGateway,
        events: RendererEventBroker,
        config: ConversationConfig,
        clock: Callable[[], datetime] | None = None,
        id_factory: Callable[[], str] | None = None,
    ) -> None:
        self._database = database
        self._gateway = gateway
        self._events = events
        self._config = config
        self._clock = clock or (lambda: datetime.now(UTC))
        self._id_factory = id_factory or (lambda: str(uuid.uuid4()))
        self._notification_lock = Lock()
        self._buffered_notifications: deque[tuple[str, JsonObject]] = deque(maxlen=1_000)
        set_handler = getattr(gateway, "set_notification_handler", None)
        if callable(set_handler):
            set_handler(self.handle_notification)

    @classmethod
    def handles_command(cls, name: str) -> bool:
        return name in cls.COMMANDS

    @classmethod
    def handles_query(cls, name: str) -> bool:
        return name in cls.QUERIES

    def command(self, *, name: str, payload: JsonObject, request_id: str) -> JsonObject:
        handlers: dict[str, Callable[[JsonObject, str], JsonObject]] = {
            "session.start": self._start_session,
            "session.resume": self._resume_session,
            "thread.fork": self._fork_thread,
            "thread.activate": self._activate_thread,
            "message.send": self._send_message,
            "turn.steer": self._steer_turn,
            "turn.interrupt": self._interrupt_turn,
            "conversation.reconcile": self._reconcile,
            "session.complete": self._complete_session,
        }
        handler = handlers.get(name)
        if handler is None:
            raise ApplicationError("NOT_IMPLEMENTED", "Conversation command is not implemented")
        self._text(request_id, "request_id")
        return handler(payload, request_id)

    def query(self, *, name: str, payload: JsonObject) -> JsonObject:
        if name == "conversation.events":
            self._exact(payload, required={"after_sequence"}, optional={"limit"})
            sequence = payload["after_sequence"]
            if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 0:
                raise validation_error("after_sequence must be a nonnegative integer")
            limit = payload.get("limit", 100)
            if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 200:
                raise validation_error("limit must be an integer between 1 and 200")
            return {"items": self._events.after(sequence, limit=limit)}
        if name == "session.get":
            self._exact(payload, required={"id"})
            return self.get_session(self._text(payload["id"], "id"))
        if name == "history.getSession":
            self._exact(payload, required={"id"}, optional={"after_sequence", "limit"})
            session_id = self._text(payload["id"], "id")
            after_sequence = payload.get("after_sequence", 0)
            limit = payload.get("limit", 100)
            if isinstance(after_sequence, bool) or not isinstance(after_sequence, int) or after_sequence < 0:
                raise validation_error("after_sequence must be a nonnegative integer")
            if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 200:
                raise validation_error("limit must be an integer between 1 and 200")
            with self._database.read() as db:
                self._session(db, session_id)
                rows = db.fetchall(
                    "SELECT * FROM messages WHERE session_id = ? AND sequence > ? ORDER BY sequence LIMIT ?",
                    (session_id, after_sequence, limit + 1),
                )
            page = rows[:limit]
            return {
                "session_id": session_id,
                "items": [self._message_row(row) for row in page],
                "has_more": len(rows) > limit,
                "next_after_sequence": int(page[-1]["sequence"]) if page else after_sequence,
            }
        raise ApplicationError("NOT_IMPLEMENTED", "Conversation query is not implemented")

    def get_session(self, session_id: str) -> JsonObject:
        with self._database.read() as session:
            return self._session_detail(session, self._session(session, session_id))

    def _start_session(self, payload: JsonObject, request_id: str) -> JsonObject:
        self._exact(payload, required={"project_id", "lesson_id"})
        project_id = self._text(payload["project_id"], "project_id")
        lesson_id = self._optional_text(payload["lesson_id"], "lesson_id")
        previous = self._previous_operation(request_id, "session.start", payload)
        if previous is not None:
            return previous
        self._require_account()
        session_id, thread_id, operation_id = self._new_id(), self._new_id(), self._new_id()
        now = self._now()
        with self._database.transaction() as db:
            project = db.fetchone("SELECT id, status FROM learning_projects WHERE id = ?", (project_id,))
            if project is None:
                raise ApplicationError("NOT_FOUND", "Learning project not found")
            if project["status"] in {"archived", "deleted"}:
                raise ApplicationError("INVALID_STATE_TRANSITION", "Learning project is not active")
            if lesson_id is not None:
                lesson = db.fetchone("SELECT project_id FROM lessons WHERE id = ?", (lesson_id,))
                if lesson is None or lesson["project_id"] != project_id:
                    raise validation_error("lesson_id does not belong to project")
            db.execute(
                "INSERT INTO learning_sessions"
                "(id, project_id, lesson_id, started_at, status) VALUES (?, ?, ?, ?, 'starting')",
                (session_id, project_id, lesson_id, now),
            )
            db.execute(
                "INSERT INTO codex_threads"
                "(id, session_id, project_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
                (thread_id, session_id, project_id, now),
            )
            self._insert_operation(db, operation_id, request_id, "session.start", payload, "session_start", session_id)
        params = self._thread_configuration()
        try:
            response = self._operation_request(operation_id, "thread/start", params)
            remote_id = self._remote_id(response, "thread")
            with self._database.transaction() as db:
                db.execute(
                    "UPDATE codex_threads SET codex_thread_id = ?, status = 'active' "
                    "WHERE id = ? AND status = 'pending'",
                    (remote_id, thread_id),
                )
                db.execute(
                    "UPDATE learning_sessions SET active_thread_id = ?, status = 'active' WHERE id = ?",
                    (thread_id, session_id),
                )
                result = self._session_detail(db, self._session(db, session_id))
                self._complete_operation(db, operation_id, result)
        except Exception as error:
            self._fail_operation(operation_id, session_id, thread_id, error)
            raise
        self._events.publish(
            "thread.started", request_id=request_id, project_id=project_id, session_id=session_id, thread_id=thread_id
        )
        return result

    def _resume_session(self, payload: JsonObject, request_id: str) -> JsonObject:
        self._exact(payload, required={"session_id", "thread_id"})
        session_id = self._text(payload["session_id"], "session_id")
        thread_id = self._text(payload["thread_id"], "thread_id")
        previous = self._previous_operation(request_id, "session.resume", payload)
        if previous is not None:
            return previous
        self._require_account()
        operation_id = self._new_id()
        with self._database.transaction() as db:
            learning_session = self._session(db, session_id)
            thread = self._thread(db, thread_id, session_id)
            if learning_session["status"] == "completed":
                raise ApplicationError("INVALID_STATE_TRANSITION", "Completed sessions cannot be resumed")
            if not thread["codex_thread_id"]:
                raise ApplicationError("CONFLICT", "Thread has no Codex identity")
            self._insert_operation(db, operation_id, request_id, "session.resume", payload, "session_resume", thread_id)
        response = self._operation_request(
            operation_id, "thread/resume", {"threadId": thread["codex_thread_id"], **self._thread_configuration()}
        )
        if self._remote_id(response, "thread") != thread["codex_thread_id"]:
            self._fail_operation(
                operation_id,
                session_id,
                thread_id,
                ApplicationError("RECONCILIATION_CONFLICT", "Thread identity changed"),
            )
            raise ApplicationError("RECONCILIATION_CONFLICT", "Thread identity changed")
        with self._database.transaction() as db:
            now = self._now()
            db.execute("UPDATE codex_threads SET last_resumed_at = ? WHERE id = ?", (now, thread_id))
            db.execute(
                "UPDATE learning_sessions SET active_thread_id = ?, last_resumed_at = ?, "
                "status = 'active' WHERE id = ?",
                (thread_id, now, session_id),
            )
            db.execute("UPDATE codex_threads SET status = 'inactive' WHERE session_id = ?", (session_id,))
            db.execute("UPDATE codex_threads SET status = 'active' WHERE id = ?", (thread_id,))
            result = self._session_detail(db, self._session(db, session_id))
            self._complete_operation(db, operation_id, result)
        return result

    def _send_message(self, payload: JsonObject, request_id: str) -> JsonObject:
        self._exact(payload, required={"session_id", "text"}, optional={"thread_id"})
        session_id = self._text(payload["session_id"], "session_id")
        text = self._text(payload["text"], "text")
        previous = self._previous_operation(request_id, "message.send", payload)
        if previous is not None:
            return previous
        self._require_account()
        turn_id, operation_id = self._new_id(), self._new_id()
        with self._database.transaction() as db:
            learning_session = self._session(db, session_id)
            if learning_session["status"] == "completed":
                raise ApplicationError("INVALID_STATE_TRANSITION", "Completed sessions cannot start turns")
            thread_id = (
                self._optional_text(payload.get("thread_id"), "thread_id") or learning_session["active_thread_id"]
            )
            if not thread_id:
                raise ApplicationError("CONFLICT", "Session has no active thread")
            thread = self._thread(db, str(thread_id), session_id)
            if thread["status"] != "active" or not thread["codex_thread_id"]:
                raise ApplicationError("INVALID_STATE_TRANSITION", "Thread is not active")
            running = db.fetchone(
                "SELECT id FROM codex_turns WHERE project_id = ? AND status IN ('pending', 'in_progress') LIMIT 1",
                (learning_session["project_id"],),
            )
            if running is not None:
                raise ApplicationError("INVALID_STATE_TRANSITION", "Project already has an active turn")
            db.execute(
                "INSERT INTO codex_turns"
                "(id, thread_id, session_id, project_id, request_id, input_text, status, started_at) "
                "VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
                (turn_id, thread_id, session_id, learning_session["project_id"], request_id, text, self._now()),
            )
            self._insert_operation(db, operation_id, request_id, "message.send", payload, "turn_start", turn_id)
        params: JsonObject = {
            "threadId": thread["codex_thread_id"],
            "input": [{"type": "text", "text": text}],
            "clientUserMessageId": request_id,
            "approvalPolicy": "never",
            "sandboxPolicy": {"type": "readOnly", "networkAccess": False},
        }
        if self._config.working_directory is not None:
            params["cwd"] = self._config.working_directory
        if self._config.model is not None:
            params["model"] = self._config.model
        if self._config.reasoning_effort is not None:
            params["effort"] = self._config.reasoning_effort
        try:
            response = self._operation_request(operation_id, "turn/start", params)
            remote_turn_id = self._remote_id(response, "turn")
            with self._database.transaction() as db:
                db.execute(
                    "UPDATE codex_turns SET codex_turn_id = ?, status = 'in_progress' WHERE id = ?",
                    (remote_turn_id, turn_id),
                )
                result = {
                    "session_id": session_id,
                    "thread_id": thread_id,
                    "turn_id": turn_id,
                    "codex_turn_id": remote_turn_id,
                    "status": "in_progress",
                }
                self._complete_operation(db, operation_id, result)
            self._drain_notifications(str(thread["codex_thread_id"]), remote_turn_id)
        except Exception as error:
            with self._database.transaction() as db:
                operation = db.fetchone("SELECT state FROM codex_operations WHERE id = ?", (operation_id,))
                if operation is None or operation["state"] != "uncertain":
                    db.execute(
                        "UPDATE codex_turns SET status = 'failed', completed_at = ? WHERE id = ?",
                        (self._now(), turn_id),
                    )
                self._mark_operation_failed(db, operation_id, error)
            raise
        self._events.publish(
            "turn.started",
            request_id=request_id,
            project_id=learning_session["project_id"],
            session_id=session_id,
            thread_id=thread_id,
            turn_id=turn_id,
        )
        return result

    def _steer_turn(self, payload: JsonObject, request_id: str) -> JsonObject:
        self._exact(payload, required={"session_id", "turn_id", "action_id"})
        session_id = self._text(payload["session_id"], "session_id")
        turn_id = self._text(payload["turn_id"], "turn_id")
        action_id = self._text(payload["action_id"], "action_id")
        instruction = self.QUICK_ACTIONS.get(action_id)
        if instruction is None:
            raise validation_error("Unknown versioned quick action")
        previous = self._previous_operation(request_id, "turn.steer", payload)
        if previous is not None:
            return previous
        self._require_account()
        operation_id = self._new_id()
        with self._database.transaction() as db:
            turn = db.fetchone("SELECT * FROM codex_turns WHERE id = ? AND session_id = ?", (turn_id, session_id))
            if turn is None:
                raise ApplicationError("NOT_FOUND", "Turn not found")
            if turn["status"] != "in_progress" or not turn["codex_turn_id"]:
                raise ApplicationError("INVALID_STATE_TRANSITION", "Turn is not accepting steering")
            thread = self._thread(db, turn["thread_id"], session_id)
            self._insert_operation(db, operation_id, request_id, "turn.steer", payload, "turn_steer", turn_id)
        self._operation_request(
            operation_id,
            "turn/steer",
            {
                "threadId": thread["codex_thread_id"],
                "expectedTurnId": turn["codex_turn_id"],
                "input": [{"type": "text", "text": instruction}],
                "clientUserMessageId": request_id,
            },
        )
        result = {
            "session_id": session_id,
            "thread_id": thread["id"],
            "turn_id": turn_id,
            "action_id": action_id,
            "accepted": True,
        }
        with self._database.transaction() as db:
            self._complete_operation(db, operation_id, result)
        return result

    def _interrupt_turn(self, payload: JsonObject, request_id: str) -> JsonObject:
        self._exact(payload, required={"session_id", "turn_id"})
        session_id = self._text(payload["session_id"], "session_id")
        turn_id = self._text(payload["turn_id"], "turn_id")
        previous = self._previous_operation(request_id, "turn.interrupt", payload)
        if previous is not None:
            return previous
        operation_id = self._new_id()
        with self._database.transaction() as db:
            turn = db.fetchone("SELECT * FROM codex_turns WHERE id = ? AND session_id = ?", (turn_id, session_id))
            if turn is None:
                raise ApplicationError("NOT_FOUND", "Turn not found")
            if turn["status"] != "in_progress" or not turn["codex_turn_id"]:
                raise ApplicationError("INVALID_STATE_TRANSITION", "Turn is not in progress")
            thread = self._thread(db, turn["thread_id"], session_id)
            self._insert_operation(db, operation_id, request_id, "turn.interrupt", payload, "turn_interrupt", turn_id)
        self._operation_request(
            operation_id, "turn/interrupt", {"threadId": thread["codex_thread_id"], "turnId": turn["codex_turn_id"]}
        )
        with self._database.transaction() as db:
            db.execute(
                "UPDATE codex_turns SET status = 'interrupted', completed_at = ? WHERE id = ?", (self._now(), turn_id)
            )
            db.execute("UPDATE learning_sessions SET status = 'interrupted' WHERE id = ?", (session_id,))
            result = {"session_id": session_id, "thread_id": thread["id"], "turn_id": turn_id, "status": "interrupted"}
            self._complete_operation(db, operation_id, result)
        self._events.publish(
            "turn.completed",
            request_id=request_id,
            session_id=session_id,
            thread_id=thread["id"],
            turn_id=turn_id,
            payload={"status": "interrupted"},
        )
        return result

    def _complete_session(self, payload: JsonObject, request_id: str) -> JsonObject:
        self._exact(payload, required={"id", "summary", "next_action"})
        session_id = self._text(payload["id"], "id")
        summary = self._text(payload["summary"], "summary")
        next_action = self._text(payload["next_action"], "next_action")
        previous = self._previous_operation(request_id, "session.complete", payload)
        if previous is not None:
            return previous
        operation_id = self._new_id()
        with self._database.transaction() as db:
            learning_session = self._session(db, session_id)
            if learning_session["status"] not in {"active", "interrupted"}:
                raise ApplicationError("INVALID_STATE_TRANSITION", "Session cannot be completed")
            running = db.fetchone(
                "SELECT id FROM codex_turns WHERE project_id = ? AND status IN ('pending', 'in_progress') LIMIT 1",
                (learning_session["project_id"],),
            )
            if running is not None:
                raise ApplicationError("INVALID_STATE_TRANSITION", "Session has an active turn")
            self._insert_operation(
                db, operation_id, request_id, "session.complete", payload, "session_complete", session_id
            )
            db.execute(
                "UPDATE learning_sessions SET status = 'completed', ended_at = ?, summary = ?, "
                "next_action = ?, active_thread_id = NULL WHERE id = ?",
                (self._now(), summary, next_action, session_id),
            )
            db.execute("UPDATE codex_threads SET status = 'inactive' WHERE session_id = ?", (session_id,))
            result = self._session_detail(db, self._session(db, session_id))
            self._complete_operation(db, operation_id, result)
        return result

    def _fork_thread(self, payload: JsonObject, request_id: str) -> JsonObject:
        self._exact(payload, required={"session_id", "source_thread_id", "through_item_id"})
        session_id = self._text(payload["session_id"], "session_id")
        source_id = self._text(payload["source_thread_id"], "source_thread_id")
        item_id = self._text(payload["through_item_id"], "through_item_id")
        previous = self._previous_operation(request_id, "thread.fork", payload)
        if previous is not None:
            return previous
        self._require_account()
        child_id, operation_id = self._new_id(), self._new_id()
        with self._database.transaction() as db:
            learning_session = self._session(db, session_id)
            if learning_session["status"] not in {"active", "interrupted"}:
                raise ApplicationError("INVALID_STATE_TRANSITION", "Session cannot be forked")
            source = self._thread(db, source_id, session_id)
            logical_items = self._logical_items(db, source, set())
            try:
                anchor_index = next(index for index, item in enumerate(logical_items) if item["id"] == item_id)
            except StopIteration as error:
                raise validation_error("Fork anchor must be a completed item visible in the source thread") from error
            prefix = logical_items[: anchor_index + 1]
            raw_items = [self._to_raw_response_item(item) for item in prefix]
            history_hash = hashlib.sha256(self._json(prefix).encode()).hexdigest()
            now = self._now()
            db.execute(
                "INSERT INTO codex_threads"
                "(id, session_id, project_id, parent_thread_id, forked_from_item_id, fork_mode, status, created_at) "
                "VALUES (?, ?, ?, ?, ?, 'history_reconstruction', 'pending', ?)",
                (child_id, session_id, learning_session["project_id"], source_id, item_id, now),
            )
            db.execute(
                "INSERT INTO codex_thread_forks"
                "(child_thread_id, parent_thread_id, through_item_id, history_hash, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (child_id, source_id, item_id, history_hash, now),
            )
            self._insert_operation(db, operation_id, request_id, "thread.fork", payload, "thread_fork", child_id)
        try:
            response = self._operation_request(operation_id, "thread/start", self._thread_configuration())
            remote_id = self._remote_id(response, "thread")
            with self._database.transaction() as db:
                db.execute(
                    "UPDATE codex_threads SET codex_thread_id = ? WHERE id = ? AND status = 'pending'",
                    (remote_id, child_id),
                )
            self._operation_request(operation_id, "thread/inject_items", {"threadId": remote_id, "items": raw_items})
            with self._database.transaction() as db:
                db.execute(
                    "UPDATE codex_threads SET status = 'inactive' WHERE session_id = ? AND status = 'active'",
                    (session_id,),
                )
                db.execute("UPDATE codex_threads SET status = 'active' WHERE id = ?", (child_id,))
                db.execute(
                    "UPDATE learning_sessions SET active_thread_id = ?, status = 'active' WHERE id = ?",
                    (child_id, session_id),
                )
                result = self._thread(db, child_id, session_id)
                self._complete_operation(db, operation_id, result)
        except Exception as error:
            with self._database.transaction() as db:
                db.execute("UPDATE codex_threads SET status = 'failed' WHERE id = ?", (child_id,))
                self._mark_operation_failed(db, operation_id, error)
            raise
        self._events.publish(
            "thread.started",
            request_id=request_id,
            project_id=learning_session["project_id"],
            session_id=session_id,
            thread_id=child_id,
            payload={"forked_from_item_id": item_id},
        )
        return result

    def _activate_thread(self, payload: JsonObject, request_id: str) -> JsonObject:
        self._exact(payload, required={"session_id", "thread_id"})
        session_id = self._text(payload["session_id"], "session_id")
        thread_id = self._text(payload["thread_id"], "thread_id")
        previous = self._previous_operation(request_id, "thread.activate", payload)
        if previous is not None:
            return previous
        operation_id = self._new_id()
        with self._database.transaction() as db:
            learning_session = self._session(db, session_id)
            if learning_session["status"] not in {"active", "interrupted"}:
                raise ApplicationError("INVALID_STATE_TRANSITION", "Session cannot activate a thread")
            thread = self._thread(db, thread_id, session_id)
            if thread["status"] not in {"active", "inactive"} or not thread["codex_thread_id"]:
                raise ApplicationError("INVALID_STATE_TRANSITION", "Thread cannot be activated")
            self._insert_operation(
                db, operation_id, request_id, "thread.activate", payload, "thread_activate", thread_id
            )
            db.execute("UPDATE codex_threads SET status = 'inactive' WHERE session_id = ?", (session_id,))
            db.execute("UPDATE codex_threads SET status = 'active' WHERE id = ?", (thread_id,))
            db.execute("UPDATE learning_sessions SET active_thread_id = ? WHERE id = ?", (thread_id, session_id))
            result = self._session_detail(db, self._session(db, session_id))
            self._complete_operation(db, operation_id, result)
            return result

    def _reconcile(self, payload: JsonObject, request_id: str) -> JsonObject:
        self._exact(payload, required={"session_id", "thread_id"})
        session_id = self._text(payload["session_id"], "session_id")
        thread_id = self._text(payload["thread_id"], "thread_id")
        previous = self._previous_operation(request_id, "conversation.reconcile", payload)
        if previous is not None:
            return previous
        self._require_account()
        operation_id = self._new_id()
        with self._database.transaction() as db:
            learning_session = self._session(db, session_id)
            if learning_session["status"] == "completed":
                raise ApplicationError("INVALID_STATE_TRANSITION", "Completed sessions cannot be reconciled")
            thread = self._thread(db, thread_id, session_id)
            if not thread["codex_thread_id"]:
                raise ApplicationError("CONFLICT", "Thread has no Codex identity")
            self._insert_operation(
                db, operation_id, request_id, "conversation.reconcile", payload, "reconcile", thread_id
            )
            db.execute("UPDATE learning_sessions SET status = 'reconciling' WHERE id = ?", (session_id,))
            db.execute(
                "UPDATE codex_operations SET state = 'inflight', updated_at = ? WHERE id = ?",
                (self._now(), operation_id),
            )
        try:
            remote = self._gateway.request(
                "thread/read", {"threadId": thread["codex_thread_id"], "includeTurns": True, "itemsView": "full"}
            )
        except Exception as error:
            with self._database.transaction() as db:
                code = error.code if isinstance(error, ApplicationError) else "INTERNAL_ERROR"
                db.execute(
                    "UPDATE codex_operations SET state = 'uncertain', error_code = ?, updated_at = ? WHERE id = ?",
                    (code, self._now(), operation_id),
                )
            raise
        remote_thread = remote.get("thread")
        if not isinstance(remote_thread, dict) or remote_thread.get("id") != thread["codex_thread_id"]:
            self._fail_operation(
                operation_id,
                session_id,
                thread_id,
                ApplicationError("RECONCILIATION_CONFLICT", "Thread identity mismatch"),
            )
            raise ApplicationError("RECONCILIATION_CONFLICT", "Thread identity mismatch")
        raw_turns = remote_thread.get("turns")
        if not isinstance(raw_turns, list):
            invalid_collection = ApplicationError("RECONCILIATION_CONFLICT", "Invalid remote turn collection")
            with self._database.transaction() as db:
                db.execute("UPDATE learning_sessions SET status = 'failed' WHERE id = ?", (session_id,))
                self._mark_operation_failed(db, operation_id, invalid_collection)
            raise invalid_collection
        status_map = {
            "inProgress": "in_progress",
            "completed": "completed",
            "interrupted": "interrupted",
            "failed": "failed",
        }
        parsed_turns: list[tuple[str, str, list[JsonObject]]] = []
        remote_item_ids: list[str] = []
        seen_turns: set[str] = set()
        seen_items: set[str] = set()
        try:
            for raw_turn in raw_turns:
                if not isinstance(raw_turn, dict):
                    raise ApplicationError("RECONCILIATION_CONFLICT", "Invalid remote turn")
                remote_turn_id = self._text(raw_turn.get("id"), "remote turn id")
                raw_status = raw_turn.get("status")
                remote_status = status_map.get(raw_status) if isinstance(raw_status, str) else None
                raw_items = raw_turn.get("items")
                if remote_turn_id in seen_turns or remote_status is None or not isinstance(raw_items, list):
                    raise ApplicationError("RECONCILIATION_CONFLICT", "Invalid remote turn")
                seen_turns.add(remote_turn_id)
                parsed_items: list[JsonObject] = []
                for raw_item in raw_items:
                    if not isinstance(raw_item, dict):
                        raise ApplicationError("RECONCILIATION_CONFLICT", "Invalid remote item")
                    remote_item_id = self._text(raw_item.get("id"), "remote item id")
                    if remote_item_id in seen_items:
                        raise ApplicationError("RECONCILIATION_CONFLICT", "Duplicate remote item identity")
                    seen_items.add(remote_item_id)
                    item_type = self._text(raw_item.get("type"), "remote item type")
                    role_value = raw_item.get("role")
                    role = (
                        role_value
                        if role_value in {"user", "assistant", "system"}
                        else "assistant"
                        if item_type == "agentMessage"
                        else "user"
                        if item_type == "userMessage"
                        else "system"
                    )
                    parsed_items.append(
                        {
                            "id": remote_item_id,
                            "role": role,
                            "item_type": item_type,
                            "content": self._remote_content(raw_item),
                        }
                    )
                    remote_item_ids.append(remote_item_id)
                parsed_turns.append((remote_turn_id, remote_status, parsed_items))
        except Exception as error:
            with self._database.transaction() as db:
                db.execute("UPDATE learning_sessions SET status = 'failed' WHERE id = ?", (session_id,))
                self._mark_operation_failed(db, operation_id, error)
            raise
        imported = 0
        try:
            with self._database.transaction() as db:
                known_turn_rows = db.fetchall(
                    "SELECT codex_turn_id FROM codex_turns WHERE thread_id = ? AND codex_turn_id IS NOT NULL",
                    (thread_id,),
                )
                known_remote_turn_ids = {str(row["codex_turn_id"]) for row in known_turn_rows}
                unknown_remote_turns = [
                    (remote_turn_id, remote_status)
                    for remote_turn_id, remote_status, _ in parsed_turns
                    if remote_turn_id not in known_remote_turn_ids
                ]
                uncertain_pending = db.fetchall(
                    "SELECT u.id FROM codex_turns u JOIN codex_operations o "
                    "ON o.entity_id = u.id AND o.kind = 'turn_start' "
                    "WHERE u.thread_id = ? AND u.codex_turn_id IS NULL AND u.status = 'pending' "
                    "AND o.state = 'uncertain'",
                    (thread_id,),
                )
                if uncertain_pending:
                    if len(uncertain_pending) != 1 or len(unknown_remote_turns) > 1:
                        raise ApplicationError(
                            "RECONCILIATION_CONFLICT", "Uncertain turn cannot be matched unambiguously"
                        )
                    pending_turn_id = uncertain_pending[0]["id"]
                    if unknown_remote_turns:
                        recovered_remote_id, recovered_status = unknown_remote_turns[0]
                        db.execute(
                            "UPDATE codex_turns SET codex_turn_id = ?, status = ?, completed_at = ? WHERE id = ?",
                            (
                                recovered_remote_id,
                                recovered_status,
                                self._now() if recovered_status != "in_progress" else None,
                                pending_turn_id,
                            ),
                        )
                    else:
                        db.execute(
                            "UPDATE codex_turns SET status = 'failed', completed_at = ? WHERE id = ?",
                            (self._now(), pending_turn_id),
                        )
                        db.execute(
                            "UPDATE codex_operations SET state = 'failed', error_code = 'REMOTE_TURN_NOT_FOUND', "
                            "updated_at = ? WHERE entity_id = ? AND kind = 'turn_start' AND state = 'uncertain'",
                            (self._now(), pending_turn_id),
                        )
                local_items = db.fetchall(
                    "SELECT * FROM messages WHERE thread_id = ? AND codex_item_id IS NOT NULL "
                    "ORDER BY COALESCE(provider_order, sequence), sequence",
                    (thread_id,),
                )
                remote_positions = {remote_id: index for index, remote_id in enumerate(remote_item_ids)}
                try:
                    local_positions = [remote_positions[str(item["codex_item_id"])] for item in local_items]
                except KeyError as error:
                    raise ApplicationError(
                        "RECONCILIATION_CONFLICT", "Confirmed local item is absent from provider history"
                    ) from error
                if local_positions != sorted(local_positions) or len(local_positions) != len(set(local_positions)):
                    raise ApplicationError("RECONCILIATION_CONFLICT", "Provider item order differs")

                local_turn_ids: dict[str, str] = {}
                for remote_turn_id, remote_status, _ in parsed_turns:
                    turn = db.fetchone(
                        "SELECT * FROM codex_turns WHERE thread_id = ? AND codex_turn_id = ?",
                        (thread_id, remote_turn_id),
                    )
                    if turn is None:
                        local_turn_id = self._new_id()
                        db.execute(
                            "INSERT INTO codex_turns"
                            "(id, thread_id, session_id, project_id, codex_turn_id, input_text, "
                            "status, started_at, completed_at) "
                            "VALUES (?, ?, ?, ?, ?, '', ?, ?, ?)",
                            (
                                local_turn_id,
                                thread_id,
                                session_id,
                                thread["project_id"],
                                remote_turn_id,
                                remote_status,
                                self._now(),
                                self._now() if remote_status != "in_progress" else None,
                            ),
                        )
                    else:
                        local_turn_id = turn["id"]
                        local_status = str(turn["status"])
                        if local_status in {"pending", "in_progress"}:
                            db.execute(
                                "UPDATE codex_turns SET status = ?, completed_at = ? WHERE id = ?",
                                (
                                    remote_status,
                                    self._now() if remote_status != "in_progress" else None,
                                    local_turn_id,
                                ),
                            )
                        elif local_status != remote_status:
                            raise ApplicationError("RECONCILIATION_CONFLICT", "Confirmed turn status differs")
                    local_turn_ids[remote_turn_id] = local_turn_id

                flattened = [(remote_turn_id, item) for remote_turn_id, _, items in parsed_turns for item in items]
                for remote_index, (remote_turn_id, remote_item) in enumerate(flattened):
                    remote_item_id = str(remote_item["id"])
                    role = str(remote_item["role"])
                    item_type = str(remote_item["item_type"])
                    content = str(remote_item["content"])
                    local_turn_id = local_turn_ids[remote_turn_id]
                    existing = db.fetchone(
                        "SELECT * FROM messages WHERE thread_id = ? AND codex_item_id = ?",
                        (thread_id, remote_item_id),
                    )
                    if existing is not None:
                        if (
                            existing["role"],
                            existing["item_type"],
                            existing["content"],
                            existing["turn_id"],
                        ) != (role, item_type, content, local_turn_id):
                            raise ApplicationError("RECONCILIATION_CONFLICT", "Confirmed item content differs")
                        db.execute(
                            "UPDATE messages SET provider_order = ? WHERE id = ?",
                            (remote_index + 1, existing["id"]),
                        )
                        continue
                    sequence_row = db.fetchone(
                        "SELECT COALESCE(MAX(sequence), 0) AS value FROM messages WHERE session_id = ?",
                        (session_id,),
                    )
                    sequence = int(sequence_row["value"]) + 1 if sequence_row else 1
                    db.execute(
                        "INSERT INTO messages"
                        "(id, session_id, thread_id, turn_id, codex_thread_id, codex_turn_id, "
                        "codex_item_id, role, item_type, content, source_document_ids_json, "
                        "sequence, provider_order, status, created_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 'completed', ?)",
                        (
                            self._new_id(),
                            session_id,
                            thread_id,
                            local_turn_id,
                            thread["codex_thread_id"],
                            remote_turn_id,
                            remote_item_id,
                            role,
                            item_type,
                            content,
                            sequence,
                            remote_index + 1,
                            self._now(),
                        ),
                    )
                    imported += 1
                result = {"session_id": session_id, "thread_id": thread_id, "imported_items": imported}
                db.execute("UPDATE learning_sessions SET status = 'active' WHERE id = ?", (session_id,))
                self._complete_operation(db, operation_id, result)
        except Exception as error:
            with self._database.transaction() as db:
                db.execute("UPDATE learning_sessions SET status = 'failed' WHERE id = ?", (session_id,))
                self._mark_operation_failed(db, operation_id, error)
            raise
        return result

    def handle_notification(self, method: str, params: JsonObject) -> None:
        try:
            self._handle_notification(method, params)
        except ApplicationError as error:
            if error.code != "PROVIDER_EVENT_UNBOUND" or method not in {
                "item/agentMessage/delta",
                "item/completed",
                "turn/completed",
            }:
                raise
            with self._notification_lock:
                self._buffered_notifications.append((method, dict(params)))

    def _drain_notifications(self, remote_thread_id: str, remote_turn_id: str) -> None:
        selected: list[tuple[str, JsonObject]] = []
        with self._notification_lock:
            retained: deque[tuple[str, JsonObject]] = deque(maxlen=self._buffered_notifications.maxlen)
            while self._buffered_notifications:
                method, params = self._buffered_notifications.popleft()
                notification_turn_id = params.get("turnId")
                if method == "turn/completed" and isinstance(params.get("turn"), dict):
                    notification_turn_id = params["turn"].get("id")
                if params.get("threadId") == remote_thread_id and notification_turn_id == remote_turn_id:
                    selected.append((method, params))
                else:
                    retained.append((method, params))
            self._buffered_notifications = retained
        for method, params in selected:
            self._handle_notification(method, params)

    def _handle_notification(self, method: str, params: JsonObject) -> None:
        """Validate and translate supported App Server notifications.

        Deltas are transient events. Only a complete item payload is inserted into canonical history.
        """
        if method == "item/agentMessage/delta":
            self._exact(params, required={"threadId", "turnId", "itemId", "delta"})
            delta = self._text(params["delta"], "delta")
            with self._database.read() as db:
                context = self._remote_context(db, params["threadId"], params["turnId"])
                self._require_live_notification_context(context)
            self._events.publish(
                "item.agentMessageDelta",
                project_id=context["project_id"],
                session_id=context["session_id"],
                thread_id=context["thread_id"],
                turn_id=context["turn_id"],
                item_id=self._text(params["itemId"], "itemId"),
                payload={"delta": delta},
            )
            return
        if method == "item/completed":
            self._exact(params, required={"threadId", "turnId", "item", "completedAtMs"})
            item = params["item"]
            if not isinstance(item, dict):
                raise validation_error("Completed item must be an object")
            remote_item_id = self._text(item.get("id"), "item.id")
            item_type = self._text(item.get("type"), "item.type")
            role = "assistant" if item_type == "agentMessage" else "user" if item_type == "userMessage" else "system"
            content = self._remote_content(item)
            with self._database.transaction() as db:
                context = self._remote_context(db, params["threadId"], params["turnId"])
                self._require_live_notification_context(context)
                existing = db.fetchone(
                    "SELECT role, item_type, content FROM messages WHERE thread_id = ? AND codex_item_id = ?",
                    (context["thread_id"], remote_item_id),
                )
                if existing is not None:
                    if (existing["role"], existing["item_type"], existing["content"]) != (
                        role,
                        item_type,
                        content,
                    ):
                        raise ApplicationError("RECONCILIATION_CONFLICT", "Completed item content differs")
                    return
                sequence_row = db.fetchone(
                    "SELECT COALESCE(MAX(sequence), 0) AS value FROM messages WHERE session_id = ?",
                    (context["session_id"],),
                )
                sequence = int(sequence_row["value"]) + 1 if sequence_row else 1
                provider_order_row = db.fetchone(
                    "SELECT COALESCE(MAX(provider_order), 0) AS value FROM messages WHERE thread_id = ?",
                    (context["thread_id"],),
                )
                provider_order = int(provider_order_row["value"]) + 1 if provider_order_row else 1
                local_item_id = self._new_id()
                db.execute(
                    "INSERT INTO messages"
                    "(id, session_id, thread_id, turn_id, codex_thread_id, codex_turn_id, "
                    "codex_item_id, role, item_type, content, source_document_ids_json, sequence, provider_order, "
                    "status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 'completed', ?)",
                    (
                        local_item_id,
                        context["session_id"],
                        context["thread_id"],
                        context["turn_id"],
                        params["threadId"],
                        params["turnId"],
                        remote_item_id,
                        role,
                        item_type,
                        content,
                        sequence,
                        provider_order,
                        self._now(),
                    ),
                )
            self._events.publish(
                "item.completed",
                project_id=context["project_id"],
                session_id=context["session_id"],
                thread_id=context["thread_id"],
                turn_id=context["turn_id"],
                item_id=local_item_id,
                payload={"codex_item_id": remote_item_id, "item_type": item_type, "content": content},
            )
            return
        if method == "turn/completed":
            self._exact(params, required={"threadId", "turn"})
            turn = params["turn"]
            if not isinstance(turn, dict):
                raise validation_error("Completed turn must be an object")
            remote_turn_id = self._text(turn.get("id"), "turn.id")
            status = turn.get("status")
            if status not in {"completed", "interrupted", "failed"}:
                raise validation_error("Completed turn has an invalid status")
            with self._database.transaction() as db:
                context = self._remote_context(db, params["threadId"], remote_turn_id)
                if context["turn_status"] in {"completed", "interrupted", "failed"}:
                    if context["turn_status"] == status:
                        return
                    raise ApplicationError("RECONCILIATION_CONFLICT", "Confirmed turn status differs")
                if context["session_status"] == "completed":
                    raise ApplicationError("RECONCILIATION_CONFLICT", "Late provider turn was quarantined")
                db.execute(
                    "UPDATE codex_turns SET status = ?, completed_at = ? WHERE id = ?",
                    (status, self._now(), context["turn_id"]),
                )
                if status == "interrupted":
                    db.execute(
                        "UPDATE learning_sessions SET status = 'interrupted' WHERE id = ?",
                        (context["session_id"],),
                    )
            self._events.publish(
                "turn.completed",
                project_id=context["project_id"],
                session_id=context["session_id"],
                thread_id=context["thread_id"],
                turn_id=context["turn_id"],
                payload={"status": status},
            )
            return
        if method in {"warning", "error"}:
            self._events.publish(method, payload={"provider_event": True})

    @staticmethod
    def _remote_context(db: DatabaseSession, remote_thread_id: Any, remote_turn_id: Any) -> JsonObject:
        if not isinstance(remote_thread_id, str) or not isinstance(remote_turn_id, str):
            raise validation_error("Provider identifiers must be strings")
        row = db.fetchone(
            "SELECT t.id AS thread_id, t.session_id, t.project_id, u.id AS turn_id, "
            "u.status AS turn_status, s.status AS session_status "
            "FROM codex_threads t JOIN codex_turns u ON u.thread_id = t.id "
            "JOIN learning_sessions s ON s.id = t.session_id "
            "WHERE t.codex_thread_id = ? AND u.codex_turn_id = ?",
            (remote_thread_id, remote_turn_id),
        )
        if row is None:
            raise ApplicationError("PROVIDER_EVENT_UNBOUND", "Provider event is awaiting local ownership binding")
        return row

    @staticmethod
    def _require_live_notification_context(context: JsonObject) -> None:
        if context["session_status"] == "completed" or context["turn_status"] not in {"pending", "in_progress"}:
            raise ApplicationError("RECONCILIATION_CONFLICT", "Late provider item was quarantined")

    def record_turn_for_test(self, session_id: str, thread_id: str, codex_turn_id: str, input_text: str) -> JsonObject:
        with self._database.transaction() as db:
            learning_session = self._session(db, session_id)
            self._thread(db, thread_id, session_id)
            turn_id = self._new_id()
            db.execute(
                "INSERT INTO codex_turns"
                "(id, thread_id, session_id, project_id, codex_turn_id, input_text, "
                "status, started_at, completed_at) "
                "VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?)",
                (
                    turn_id,
                    thread_id,
                    session_id,
                    learning_session["project_id"],
                    codex_turn_id,
                    input_text,
                    self._now(),
                    self._now(),
                ),
            )
            return cast(JsonObject, db.fetchone("SELECT * FROM codex_turns WHERE id = ?", (turn_id,)))

    def record_completed_item_for_test(
        self,
        turn_id: str,
        codex_item_id: str,
        role: str,
        content: str,
        item_type: str = "agentMessage",
    ) -> JsonObject:
        with self._database.transaction() as db:
            turn = db.fetchone("SELECT * FROM codex_turns WHERE id = ?", (turn_id,))
            if turn is None:
                raise ApplicationError("NOT_FOUND", "Turn not found")
            thread = self._thread(db, turn["thread_id"], turn["session_id"])
            sequence_row = db.fetchone(
                "SELECT COALESCE(MAX(sequence), 0) AS value FROM messages WHERE session_id = ?", (turn["session_id"],)
            )
            sequence = int(sequence_row["value"]) + 1 if sequence_row else 1
            provider_order_row = db.fetchone(
                "SELECT COALESCE(MAX(provider_order), 0) AS value FROM messages WHERE thread_id = ?",
                (turn["thread_id"],),
            )
            provider_order = int(provider_order_row["value"]) + 1 if provider_order_row else 1
            item_id = self._new_id()
            db.execute(
                "INSERT INTO messages"
                "(id, session_id, thread_id, turn_id, codex_thread_id, codex_turn_id, "
                "codex_item_id, role, item_type, content, source_document_ids_json, sequence, provider_order, "
                "status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 'completed', ?)",
                (
                    item_id,
                    turn["session_id"],
                    turn["thread_id"],
                    turn_id,
                    thread["codex_thread_id"],
                    turn["codex_turn_id"],
                    codex_item_id,
                    role,
                    item_type,
                    content,
                    sequence,
                    provider_order,
                    self._now(),
                ),
            )
            return cast(JsonObject, db.fetchone("SELECT * FROM messages WHERE id = ?", (item_id,)))

    def _session_detail(self, db: DatabaseSession, row: JsonObject) -> JsonObject:
        threads = db.fetchall("SELECT * FROM codex_threads WHERE session_id = ? ORDER BY created_at, id", (row["id"],))
        details = [self._thread_detail(db, thread) for thread in threads]
        active = next((thread for thread in details if thread["id"] == row.get("active_thread_id")), None)
        messages = db.fetchall("SELECT * FROM messages WHERE session_id = ? ORDER BY sequence", (row["id"],))
        return {
            **row,
            "threads": details,
            "active_thread": active,
            "messages": [self._message_row(message) for message in messages],
        }

    def _thread_detail(self, db: DatabaseSession, thread: JsonObject) -> JsonObject:
        turns = db.fetchall("SELECT * FROM codex_turns WHERE thread_id = ? ORDER BY started_at, id", (thread["id"],))
        detailed_turns = []
        for turn in turns:
            items = db.fetchall(
                "SELECT * FROM messages WHERE turn_id = ? ORDER BY COALESCE(provider_order, sequence), sequence",
                (turn["id"],),
            )
            detailed_turns.append({**turn, "items": [self._message_row(item) for item in items]})
        return {**thread, "turns": detailed_turns, "logical_items": self._logical_items(db, thread, set())}

    def _logical_items(self, db: DatabaseSession, thread: JsonObject, visited: set[str]) -> list[JsonObject]:
        thread_id = str(thread["id"])
        if thread_id in visited:
            raise ApplicationError("RECONCILIATION_CONFLICT", "Thread fork graph contains a cycle")
        visited = {*visited, thread_id}
        inherited: list[JsonObject] = []
        parent_id = thread.get("parent_thread_id")
        anchor_id = thread.get("forked_from_item_id")
        if parent_id and anchor_id:
            parent = db.fetchone("SELECT * FROM codex_threads WHERE id = ?", (parent_id,))
            if parent is None:
                raise ApplicationError("RECONCILIATION_CONFLICT", "Fork ancestry is incomplete")
            parent_items = self._logical_items(db, parent, visited)
            try:
                anchor_index = next(index for index, item in enumerate(parent_items) if item["id"] == anchor_id)
            except StopIteration as error:
                raise ApplicationError("RECONCILIATION_CONFLICT", "Fork ancestry is incomplete") from error
            inherited = [
                {**item, "inherited": True, "origin_item_id": item["id"]} for item in parent_items[: anchor_index + 1]
            ]
        own = [
            {**self._message_row(item), "inherited": False, "origin_item_id": None}
            for item in db.fetchall(
                "SELECT * FROM messages WHERE thread_id = ? ORDER BY COALESCE(provider_order, sequence), sequence",
                (thread_id,),
            )
        ]
        return [*inherited, *own]

    @staticmethod
    def _message_row(row: JsonObject) -> JsonObject:
        result = dict(row)
        result["source_document_ids"] = json.loads(str(result.pop("source_document_ids_json")))
        result["forkable"] = result.get("status") == "completed" and (
            (result.get("role"), result.get("item_type")) in {("assistant", "agentMessage"), ("user", "userMessage")}
        )
        return result

    @staticmethod
    def _session(db: DatabaseSession, session_id: str) -> JsonObject:
        row = db.fetchone("SELECT * FROM learning_sessions WHERE id = ?", (session_id,))
        if row is None:
            raise ApplicationError("NOT_FOUND", "Learning session not found")
        return row

    @staticmethod
    def _thread(db: DatabaseSession, thread_id: str, session_id: str) -> JsonObject:
        row = db.fetchone("SELECT * FROM codex_threads WHERE id = ? AND session_id = ?", (thread_id, session_id))
        if row is None:
            raise ApplicationError("NOT_FOUND", "Codex thread not found")
        return row

    def _require_account(self) -> None:
        response = self._gateway.request("account/read", {})
        account = response.get("account")
        plan_types = {
            "free",
            "go",
            "plus",
            "pro",
            "prolite",
            "team",
            "self_serve_business_usage_based",
            "business",
            "enterprise_cbp_usage_based",
            "enterprise",
            "edu",
            "unknown",
        }
        valid_response = set(response) == {"account", "requiresOpenaiAuth"} and isinstance(
            response.get("requiresOpenaiAuth"), bool
        )
        valid_account = (
            isinstance(account, dict)
            and set(account) == {"type", "email", "planType"}
            and account.get("type") == "chatgpt"
            and (account.get("email") is None or isinstance(account.get("email"), str))
            and account.get("planType") in plan_types
        )
        if not valid_response or not valid_account:
            raise ApplicationError("AUTH_REQUIRED", "ChatGPT authentication is required")

    def _thread_configuration(self) -> JsonObject:
        result: JsonObject = {"approvalPolicy": "never", "sandbox": "read-only"}
        if self._config.working_directory is not None:
            result["cwd"] = self._config.working_directory
        if self._config.model is not None:
            result["model"] = self._config.model
        return result

    @staticmethod
    def _remote_id(response: JsonObject, entity: str) -> str:
        value = response.get(entity)
        if not isinstance(value, dict) or not isinstance(value.get("id"), str) or not value["id"]:
            raise ApplicationError("APP_SERVER_UNAVAILABLE", f"App Server did not return a {entity} ID")
        return str(value["id"])

    @staticmethod
    def _remote_content(item: JsonObject) -> str:
        for key in ("text", "content"):
            value = item.get(key)
            if isinstance(value, str):
                return value
            if isinstance(value, list):
                texts = [
                    part.get("text") for part in value if isinstance(part, dict) and isinstance(part.get("text"), str)
                ]
                if texts:
                    return "".join(cast(list[str], texts))
        return ""

    @staticmethod
    def _to_raw_response_item(item: JsonObject) -> JsonObject:
        role = str(item["role"])
        item_type = str(item["item_type"])
        supported = (role == "assistant" and item_type == "agentMessage") or (
            role == "user" and item_type == "userMessage"
        )
        if not supported:
            raise validation_error("Fork history contains an item that cannot be reconstructed losslessly")
        content_type = "output_text" if role == "assistant" else "input_text"
        content: JsonObject = {"type": content_type, "text": str(item["content"])}
        if content_type == "output_text":
            content["annotations"] = []
        return {"type": "message", "role": role, "content": [content]}

    def _previous_operation(self, request_id: str, name: str, payload: JsonObject) -> JsonObject | None:
        with self._database.read() as db:
            row = db.fetchone("SELECT * FROM codex_operations WHERE request_id = ?", (request_id,))
        if row is None:
            return None
        if row["command_name"] != name or row["payload_hash"] != self._payload_hash(payload):
            raise ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was reused with different command data")
        if row["state"] == "succeeded" and row["result_json"]:
            return cast(JsonObject, json.loads(str(row["result_json"])))
        raise ApplicationError("CONFLICT", "Previous provider operation has not completed", retryable=True)

    def _insert_operation(
        self,
        db: DatabaseSession,
        operation_id: str,
        request_id: str,
        command_name: str,
        payload: JsonObject,
        kind: str,
        entity_id: str,
    ) -> None:
        now = self._now()
        db.execute(
            "INSERT INTO codex_operations"
            "(id, request_id, command_name, payload_hash, kind, entity_id, state, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
            (operation_id, request_id, command_name, self._payload_hash(payload), kind, entity_id, now, now),
        )

    def _complete_operation(self, db: DatabaseSession, operation_id: str, result: JsonObject) -> None:
        db.execute(
            "UPDATE codex_operations SET state = 'succeeded', result_json = ?, updated_at = ? WHERE id = ?",
            (self._json(result), self._now(), operation_id),
        )

    def _operation_request(self, operation_id: str, method: str, params: JsonObject) -> JsonObject:
        with self._database.transaction() as db:
            db.execute(
                "UPDATE codex_operations SET state = 'inflight', updated_at = ? WHERE id = ? AND state = 'pending'",
                (self._now(), operation_id),
            )
        try:
            return self._gateway.request(method, params)
        except Exception as error:
            code = error.code if isinstance(error, ApplicationError) else "INTERNAL_ERROR"
            with self._database.transaction() as db:
                db.execute(
                    "UPDATE codex_operations SET state = 'uncertain', error_code = ?, updated_at = ? WHERE id = ?",
                    (code, self._now(), operation_id),
                )
            raise

    def _mark_operation_failed(self, db: DatabaseSession, operation_id: str, error: Exception) -> None:
        code = error.code if isinstance(error, ApplicationError) else "INTERNAL_ERROR"
        db.execute(
            "UPDATE codex_operations SET state = 'failed', error_code = ?, updated_at = ? "
            "WHERE id = ? AND state != 'uncertain'",
            (code, self._now(), operation_id),
        )

    def _fail_operation(self, operation_id: str, session_id: str, thread_id: str, error: Exception) -> None:
        with self._database.transaction() as db:
            db.execute("UPDATE codex_threads SET status = 'failed' WHERE id = ?", (thread_id,))
            db.execute("UPDATE learning_sessions SET status = 'failed' WHERE id = ?", (session_id,))
            self._mark_operation_failed(db, operation_id, error)

    def _new_id(self) -> str:
        return self._text(self._id_factory(), "generated id")

    def _now(self) -> str:
        value = self._clock()
        if value.tzinfo is None:
            raise ValueError("clock must be timezone-aware")
        return value.astimezone(UTC).isoformat()

    @staticmethod
    def _payload_hash(payload: JsonObject) -> str:
        return hashlib.sha256(ConversationCoordinator._json(payload).encode()).hexdigest()

    @staticmethod
    def _json(value: Any) -> str:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    @staticmethod
    def _exact(payload: Mapping[str, Any], *, required: set[str], optional: set[str] | None = None) -> None:
        optional = optional or set()
        missing = required - set(payload)
        unknown = set(payload) - required - optional
        if missing or unknown:
            raise validation_error("Payload fields do not match the contract")

    @staticmethod
    def _text(value: Any, field: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise validation_error(f"{field} must be a nonblank string")
        if len(value) > 65_536:
            raise validation_error(f"{field} exceeds the maximum length")
        return value.strip()

    @classmethod
    def _optional_text(cls, value: Any, field: str) -> str | None:
        if value is None:
            return None
        return cls._text(value, field)
