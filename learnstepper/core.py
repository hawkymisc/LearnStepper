from __future__ import annotations

import hashlib
import json
import re
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from learnstepper.curricula import CurriculumImporter
from learnstepper.errors import ApplicationError, validation_error
from learnstepper.persistence import Database, DatabaseSession

JsonObject = dict[str, Any]
MAX_ACTIVE_OBJECTIVES_PER_PROJECT = 5


@dataclass(frozen=True, slots=True)
class AttainmentPolicy:
    """Explicit policy because the production rubric threshold is unresolved."""

    minimum_score: float

    def __post_init__(self) -> None:
        if not 0 <= self.minimum_score <= 1:
            raise ValueError("minimum_score must be between 0 and 1")


class ApplicationCore:
    """Framework-independent command/query core backed by a Database port."""

    def __init__(
        self,
        *,
        database: Database,
        curricula_dir: Path,
        attainment_policy: AttainmentPolicy,
        clock: Callable[[], datetime] | None = None,
        id_factory: Callable[[], str] | None = None,
    ) -> None:
        self._database = database
        self._curricula_dir = Path(curricula_dir)
        self._attainment_policy = attainment_policy
        self._clock = clock or (lambda: datetime.now(UTC))
        self._id_factory = id_factory or (lambda: str(uuid.uuid4()))

    def initialize(self) -> None:
        self._database.initialize()
        with self._database.transaction() as session:
            CurriculumImporter(self._curricula_dir, self._now()).import_all(session)

    def command(self, *, name: str, payload: JsonObject, request_id: str) -> JsonObject:
        if not isinstance(payload, dict):
            raise validation_error("Command payload must be an object")
        self._required_text(request_id, "request_id")
        handlers: dict[str, Callable[[DatabaseSession, JsonObject], JsonObject]] = {
            "profile.update": self._command_profile_update,
            "project.create": self._command_project_create,
            "project.update": self._command_project_update,
            "project.archive": self._command_project_archive,
            "project.restore": self._command_project_restore,
            "project.delete": self._command_project_delete,
            "plan.update": self._command_plan_update,
            "learningObjective.update": self._command_objective_update,
            "remediation.accept": self._command_remediation_accept,
            "remediation.complete": self._command_remediation_complete,
            "session.start": self._command_session_start,
            "session.complete": self._command_session_complete,
            "note.create": self._command_note_create,
            "note.update": self._command_note_update,
            "note.delete": self._command_note_delete,
            "bookmark.create": self._command_bookmark_create,
            "bookmark.delete": self._command_bookmark_delete,
            "assessment.submitAttempt": self._command_submit_attempt,
        }
        handler = handlers.get(name)
        if handler is None:
            raise ApplicationError("NOT_IMPLEMENTED", "Command is not implemented")
        payload_json = self._json(payload)
        payload_hash = hashlib.sha256(payload_json.encode("utf-8")).hexdigest()
        with self._database.transaction() as session:
            previous = session.fetchone(
                "SELECT command_name, payload_hash, result_json FROM idempotency_records WHERE request_id = ?",
                (request_id,),
            )
            if previous is not None:
                if previous["command_name"] != name or previous["payload_hash"] != payload_hash:
                    raise ApplicationError(
                        "IDEMPOTENCY_CONFLICT",
                        "The request ID was already used with different command data",
                        request_id=request_id,
                    )
                return cast(JsonObject, json.loads(str(previous["result_json"])))
            try:
                result = handler(session, payload)
            except ApplicationError as error:
                if error.request_id is None:
                    error.request_id = request_id
                raise
            session.execute(
                "INSERT INTO idempotency_records"
                "(request_id, command_name, payload_hash, result_json, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (request_id, name, payload_hash, self._json(result), self._now()),
            )
            return result

    def query(self, *, name: str, payload: JsonObject) -> JsonObject:
        if not isinstance(payload, dict):
            raise validation_error("Query payload must be an object")
        handlers: dict[str, Callable[[DatabaseSession, JsonObject], JsonObject]] = {
            "profile.get": self._query_profile_get,
            "curriculumProfile.list": self._query_curriculum_profile_list,
            "curriculumProfile.get": self._query_curriculum_profile_get,
            "curriculum.list": self._query_curriculum_list,
            "curriculum.get": self._query_curriculum_get,
            "curriculum.items": self._query_curriculum_items,
            "curriculum.objectives": self._query_curriculum_objectives,
            "source.get": self._query_source_get,
            "source.citations": self._query_source_citations,
            "project.list": self._query_project_list,
            "project.get": self._query_project_get,
            "plan.getCurrent": self._query_plan_current,
            "learningObjective.list": self._query_objective_list,
            "learningObjective.get": self._query_objective_get,
            "learningObjective.evidence.list": self._query_objective_evidence,
            "learningObjective.attainment.get": self._query_objective_attainment,
            "remediation.getActive": self._query_remediation_active,
            "session.get": self._query_session_get,
            "note.list": self._query_note_list,
            "bookmark.list": self._query_bookmark_list,
            "history.listSessions": self._query_history_list,
            "history.getSession": self._query_history_get,
            "progress.get": self._query_progress,
            "mastery.get": self._query_mastery,
            "curriculumProgress.get": self._query_curriculum_progress,
        }
        handler = handlers.get(name)
        if handler is None:
            raise ApplicationError("NOT_IMPLEMENTED", "Query is not implemented")
        with self._database.read() as session:
            return handler(session, payload)

    # Internal adapter seams. They accept already-generated/confirmed data but never
    # pretend that the deferred Codex provider itself has been implemented.
    def record_assessment(
        self,
        *,
        project_id: str,
        assessment_type: str,
        objective_version_ids: list[str],
        rubric_version: str,
        curriculum_item_ids: list[str],
        source_document_ids: list[str],
        lesson_id: str | None = None,
        difficulty: str | None = None,
        schema_version: str = "1.0",
    ) -> JsonObject:
        with self._database.transaction() as session:
            project = self._active_project(session, project_id)
            if assessment_type not in {"diagnostic", "practice", "lesson_check", "final_check"}:
                raise validation_error("Unknown assessment type")
            if not objective_version_ids:
                raise validation_error("At least one objective version is required")
            if lesson_id is not None:
                self._owned_entity(session, "lessons", lesson_id, project_id)
            self._validate_project_curriculum_items(session, project, curriculum_item_ids)
            self._validate_source_ids(session, source_document_ids)
            for version_id in objective_version_ids:
                version = self._objective_version(session, version_id)
                if version["project_id"] != project_id:
                    raise validation_error("Assessment objective belongs to another project")
            assessment_id = self._new_id()
            session.execute(
                "INSERT INTO assessments"
                "(id, project_id, lesson_id, type, difficulty, rubric_version, schema_version, "
                "curriculum_item_ids_json, source_document_ids_json, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    assessment_id,
                    project_id,
                    lesson_id,
                    assessment_type,
                    difficulty,
                    self._required_text(rubric_version, "rubric_version"),
                    self._required_text(schema_version, "schema_version"),
                    self._json(curriculum_item_ids),
                    self._json(source_document_ids),
                    self._now(),
                ),
            )
            for version_id in objective_version_ids:
                session.execute(
                    "INSERT INTO assessment_objectives(assessment_id, learning_objective_version_id) VALUES (?, ?)",
                    (assessment_id, version_id),
                )
            return self._assessment(session, assessment_id)

    def record_plan_progress(
        self,
        *,
        project_id: str,
        module_statuses: Mapping[str, str],
        lesson_statuses: Mapping[str, str],
    ) -> JsonObject:
        allowed_statuses = {"not_started", "learning", "needs_review", "mastered", "on_hold"}
        with self._database.transaction() as session:
            self._active_project(session, project_id)
            active_plan = session.fetchone(
                "SELECT id FROM learning_plans WHERE project_id = ? AND status = 'active'",
                (project_id,),
            )
            if active_plan is None:
                raise ApplicationError("NOT_FOUND", "Active learning plan not found")
            normalized_modules: dict[str, str] = {}
            normalized_lessons: dict[str, str] = {}
            for module_id, status in module_statuses.items():
                module = self._owned_entity(session, "plan_modules", module_id, project_id)
                if module["plan_id"] != active_plan["id"]:
                    raise validation_error("Module does not belong to the active plan")
                normalized_modules[module_id] = self._enum(status, "module status", allowed_statuses)
            for lesson_id, status in lesson_statuses.items():
                lesson = self._owned_entity(session, "lessons", lesson_id, project_id)
                if lesson["plan_id"] != active_plan["id"]:
                    raise validation_error("Lesson does not belong to the active plan")
                normalized_lessons[lesson_id] = self._enum(status, "lesson status", allowed_statuses)
            for module_id, status in normalized_modules.items():
                session.execute("UPDATE plan_modules SET status = ? WHERE id = ?", (status, module_id))
            for lesson_id, status in normalized_lessons.items():
                session.execute("UPDATE lessons SET status = ? WHERE id = ?", (status, lesson_id))
            return self._plan(session, str(active_plan["id"]))

    def record_confirmed_message(
        self,
        *,
        session_id: str,
        role: str,
        item_type: str,
        content: str,
        source_document_ids: list[str],
        codex_thread_id: str | None = None,
        codex_turn_id: str | None = None,
        codex_item_id: str | None = None,
    ) -> JsonObject:
        with self._database.transaction() as session:
            learning_session = self._session(session, session_id)
            if learning_session["status"] != "active":
                raise ApplicationError("INVALID_STATE_TRANSITION", "Session is not active")
            if role not in {"user", "assistant", "system"}:
                raise validation_error("Unknown message role")
            self._validate_source_ids(session, source_document_ids)
            sequence_row = session.fetchone(
                "SELECT COALESCE(MAX(sequence), 0) AS value FROM messages WHERE session_id = ?",
                (session_id,),
            )
            sequence = int(sequence_row["value"]) + 1 if sequence_row else 1
            message_id = self._new_id()
            session.execute(
                "INSERT INTO messages"
                "(id, session_id, codex_thread_id, codex_turn_id, codex_item_id, role, item_type, "
                "content, source_document_ids_json, sequence, status, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)",
                (
                    message_id,
                    session_id,
                    codex_thread_id,
                    codex_turn_id,
                    codex_item_id,
                    role,
                    self._required_text(item_type, "item_type"),
                    self._required_text(content, "content"),
                    self._json(source_document_ids),
                    sequence,
                    self._now(),
                ),
            )
            return self._message(session, message_id)

    def record_remediation_path(
        self,
        *,
        project_id: str,
        return_conditions: str,
        remediation_lesson_ids: list[str],
        origin_lesson_id: str | None = None,
        trigger_concept_id: str | None = None,
    ) -> JsonObject:
        with self._database.transaction() as session:
            self._active_project(session, project_id)
            if origin_lesson_id:
                self._owned_entity(session, "lessons", origin_lesson_id, project_id)
            if trigger_concept_id:
                self._owned_entity(session, "concepts", trigger_concept_id, project_id)
            for lesson_id in remediation_lesson_ids:
                self._owned_entity(session, "lessons", lesson_id, project_id)
            remediation_id = self._new_id()
            session.execute(
                "INSERT INTO remediation_paths"
                "(id, project_id, trigger_concept_id, origin_lesson_id, remediation_lesson_ids_json, "
                "return_conditions, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?)",
                (
                    remediation_id,
                    project_id,
                    trigger_concept_id,
                    origin_lesson_id,
                    self._json(remediation_lesson_ids),
                    self._required_text(return_conditions, "return_conditions"),
                    self._now(),
                ),
            )
            return self._remediation(session, remediation_id)

    def record_concept_mastery(
        self,
        *,
        project_id: str,
        concept_id: str,
        status: str,
        mastery_score: float,
        confidence: float,
        next_review_at: str | None = None,
    ) -> JsonObject:
        with self._database.transaction() as session:
            self._active_project(session, project_id)
            concept = self._owned_entity(session, "concepts", concept_id, project_id)
            profile = self._profile(session)
            status = self._enum(
                status,
                "status",
                {"not_started", "learning", "needs_review", "mastered", "on_hold"},
            )
            if isinstance(mastery_score, bool) or not isinstance(mastery_score, (int, float)):
                raise validation_error("mastery_score must be numeric")
            if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
                raise validation_error("confidence must be numeric")
            if not 0 <= mastery_score <= 1 or not 0 <= confidence <= 1:
                raise validation_error("mastery_score and confidence must be between 0 and 1")
            existing = session.fetchone(
                "SELECT id FROM concept_mastery WHERE local_profile_id = ? AND project_id = ? AND concept_id = ?",
                (profile["id"], project_id, concept["id"]),
            )
            values = (
                status,
                float(mastery_score),
                float(confidence),
                self._now(),
                self._optional_text(next_review_at),
            )
            if existing is None:
                mastery_id = self._new_id()
                session.execute(
                    "INSERT INTO concept_mastery"
                    "(id, local_profile_id, project_id, concept_id, status, mastery_score, confidence, "
                    "last_evaluated_at, next_review_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (mastery_id, profile["id"], project_id, concept["id"], *values),
                )
            else:
                mastery_id = str(existing["id"])
                session.execute(
                    "UPDATE concept_mastery SET status = ?, mastery_score = ?, confidence = ?, "
                    "last_evaluated_at = ?, next_review_at = ? WHERE id = ?",
                    (*values, mastery_id),
                )
            row = session.fetchone("SELECT * FROM concept_mastery WHERE id = ?", (mastery_id,))
            if row is None:
                raise ApplicationError("INTERNAL_ERROR", "Concept mastery persistence failed")
            return row

    # Profile
    def _command_profile_update(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(
            payload,
            required={"display_name", "locale", "timezone"},
            optional={"learning_preferences"},
        )
        display_name = self._required_text(payload["display_name"], "display_name")
        locale = self._required_text(payload["locale"], "locale")
        if not re.fullmatch(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*", locale):
            raise validation_error("locale must use a BCP-47-style identifier")
        timezone = self._required_text(payload["timezone"], "timezone")
        try:
            ZoneInfo(timezone)
        except ZoneInfoNotFoundError as error:
            raise validation_error("timezone must be a known IANA timezone") from error
        preferences = payload.get("learning_preferences", {})
        if not isinstance(preferences, dict):
            raise validation_error("learning_preferences must be an object")
        existing = session.fetchone("SELECT id, created_at FROM local_profiles WHERE singleton_key = 1")
        now = self._now()
        if existing is None:
            profile_id = self._new_id()
            session.execute(
                "INSERT INTO local_profiles"
                "(id, singleton_key, display_name, locale, timezone, learning_preferences_json, "
                "created_at, updated_at) "
                "VALUES (?, 1, ?, ?, ?, ?, ?, ?)",
                (profile_id, display_name, locale, timezone, self._json(preferences), now, now),
            )
        else:
            profile_id = str(existing["id"])
            session.execute(
                "UPDATE local_profiles SET display_name = ?, locale = ?, timezone = ?, "
                "learning_preferences_json = ?, updated_at = ? WHERE id = ?",
                (display_name, locale, timezone, self._json(preferences), now, profile_id),
            )
        return self._profile(session)

    def _query_profile_get(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required=set(), optional=set())
        return self._profile(session)

    # Curriculum/source queries
    def _query_curriculum_profile_list(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required=set(), optional=set())
        rows = session.fetchall("SELECT * FROM curriculum_profiles WHERE mvp_status = 'included' ORDER BY source_file")
        return {"items": [self._curriculum_profile_row(row) for row in rows]}

    def _query_curriculum_profile_get(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"id"}, optional=set())
        row = session.fetchone(
            "SELECT * FROM curriculum_profiles WHERE id = ? AND mvp_status = 'included'",
            (self._required_text(payload["id"], "id"),),
        )
        if row is None:
            raise ApplicationError("NOT_FOUND", "Curriculum profile not found")
        return self._curriculum_profile_row(row)

    def _query_curriculum_list(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"profile_id"}, optional=set())
        profile_id = self._required_text(payload["profile_id"], "profile_id")
        rows = session.fetchall(
            "SELECT c.* FROM curricula c JOIN curriculum_profiles p ON p.id = c.profile_id "
            "WHERE c.profile_id = ? AND p.mvp_status = 'included' AND c.status = 'active' ORDER BY c.official_name",
            (profile_id,),
        )
        return {"items": [self._curriculum_row(row) for row in rows]}

    def _query_curriculum_get(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"id"}, optional=set())
        row = session.fetchone(
            "SELECT c.* FROM curricula c JOIN curriculum_profiles p ON p.id = c.profile_id "
            "WHERE c.id = ? AND p.mvp_status = 'included' AND c.status = 'active'",
            (self._required_text(payload["id"], "id"),),
        )
        if row is None:
            raise ApplicationError("NOT_FOUND", "Curriculum not found")
        return self._curriculum_row(row)

    def _query_curriculum_items(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"curriculum_id"}, optional=set())
        curriculum_id = self._required_text(payload["curriculum_id"], "curriculum_id")
        self._included_curriculum(session, curriculum_id)
        rows = session.fetchall(
            "SELECT * FROM curriculum_items WHERE curriculum_id = ? AND is_active = 1 ORDER BY display_order, id",
            (curriculum_id,),
        )
        return {"items": [self._curriculum_item_row(row) for row in rows]}

    def _query_curriculum_objectives(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"curriculum_id"}, optional=set())
        curriculum_id = self._required_text(payload["curriculum_id"], "curriculum_id")
        self._included_curriculum(session, curriculum_id)
        rows = session.fetchall(
            "SELECT o.* FROM curriculum_objectives o JOIN curriculum_items i "
            "ON i.id = o.curriculum_item_id WHERE i.curriculum_id = ? AND i.is_active = 1 "
            "ORDER BY i.display_order, o.display_order",
            (curriculum_id,),
        )
        return {"items": rows}

    def _query_source_get(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"id"}, optional=set())
        row = session.fetchone(
            "SELECT * FROM source_documents WHERE id = ?",
            (self._required_text(payload["id"], "id"),),
        )
        if row is None:
            raise ApplicationError("NOT_FOUND", "Source document not found")
        return self._source_row(row)

    def _query_source_citations(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"source_document_id"}, optional=set())
        source_id = self._required_text(payload["source_document_id"], "source_document_id")
        self._source(session, source_id)
        rows = session.fetchall(
            "SELECT i.id AS curriculum_item_id, m.relationship, m.evidence_range, m.verification_status "
            "FROM curriculum_source_mappings m JOIN curriculum_items i ON i.id = m.curriculum_item_id "
            "WHERE m.source_document_id = ? AND i.is_active = 1 ORDER BY i.id",
            (source_id,),
        )
        return {"items": rows}

    # Projects
    def _command_project_create(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(
            payload,
            required={
                "mode",
                "title",
                "topic",
                "purpose",
                "curriculum_id",
                "current_level",
                "target_level",
                "target_date",
                "preferred_session_minutes",
                "constraints",
            },
            optional=set(),
        )
        profile = self._profile(session)
        mode = self._enum(payload["mode"], "mode", {"curriculum", "free_topic"})
        curriculum_id = payload["curriculum_id"]
        if mode == "curriculum":
            curriculum_id = self._required_text(curriculum_id, "curriculum_id")
            self._included_curriculum(session, curriculum_id)
        elif curriculum_id is not None:
            raise validation_error("free_topic projects cannot set curriculum_id")
        minutes = self._integer(payload["preferred_session_minutes"], "preferred_session_minutes")
        if not 1 <= minutes <= 1440:
            raise validation_error("preferred_session_minutes must be between 1 and 1440")
        constraints = self._constraints(payload["constraints"])
        project_id = self._new_id()
        now = self._now()
        session.execute(
            "INSERT INTO learning_projects"
            "(id, local_profile_id, mode, title, topic, purpose, curriculum_id, current_level, "
            "target_level, target_date, preferred_session_minutes, constraints_json, status, "
            "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)",
            (
                project_id,
                profile["id"],
                mode,
                self._required_text(payload["title"], "title"),
                self._required_text(payload["topic"], "topic"),
                self._required_text(payload["purpose"], "purpose"),
                curriculum_id,
                self._required_text(payload["current_level"], "current_level"),
                self._required_text(payload["target_level"], "target_level"),
                self._optional_text(payload["target_date"]),
                minutes,
                self._json(constraints),
                now,
                now,
            ),
        )
        return self._project(session, project_id)

    def _command_project_update(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(
            payload,
            required={"id"},
            optional={
                "title",
                "topic",
                "purpose",
                "current_level",
                "target_level",
                "target_date",
                "preferred_session_minutes",
                "constraints",
                "status",
            },
        )
        project = self._active_project(session, self._required_text(payload["id"], "id"))
        allowed_status = {"active": {"paused", "completed"}, "paused": {"active", "completed"}}
        updates: dict[str, Any] = {}
        for field in ("title", "topic", "purpose", "current_level", "target_level"):
            if field in payload:
                updates[field] = self._required_text(payload[field], field)
        if "target_date" in payload:
            updates["target_date"] = self._optional_text(payload["target_date"])
        if "preferred_session_minutes" in payload:
            minutes = self._integer(payload["preferred_session_minutes"], "preferred_session_minutes")
            if not 1 <= minutes <= 1440:
                raise validation_error("preferred_session_minutes must be between 1 and 1440")
            updates["preferred_session_minutes"] = minutes
        if "constraints" in payload:
            updates["constraints_json"] = self._json(self._constraints(payload["constraints"]))
        if "status" in payload:
            target = self._enum(payload["status"], "status", {"active", "paused", "completed"})
            if target != project["status"] and target not in allowed_status.get(project["status"], set()):
                raise ApplicationError("INVALID_STATE_TRANSITION", "Project status transition is not allowed")
            updates["status"] = target
        if updates:
            updates["updated_at"] = self._now()
            self._update_fields(session, "learning_projects", project["id"], updates)
        return self._project(session, project["id"])

    def _command_project_archive(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"id"}, optional=set())
        project = self._active_project(session, self._required_text(payload["id"], "id"))
        if project["status"] == "archived":
            raise ApplicationError("INVALID_STATE_TRANSITION", "Project is already archived")
        session.execute(
            "UPDATE learning_projects SET archived_from_status = status, status = 'archived', "
            "updated_at = ? WHERE id = ?",
            (self._now(), project["id"]),
        )
        return self._project(session, project["id"])

    def _command_project_restore(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"id"}, optional=set())
        project_id = self._required_text(payload["id"], "id")
        tombstone = session.fetchone(
            "SELECT project_id FROM deleted_project_tombstones WHERE project_id = ?", (project_id,)
        )
        if tombstone is not None:
            raise ApplicationError("INVALID_STATE_TRANSITION", "Deleted projects cannot be restored")
        project = self._project(session, project_id, include_deleted=True)
        if project["status"] != "archived":
            raise ApplicationError("INVALID_STATE_TRANSITION", "Only archived projects can be restored")
        restored_status = project.get("archived_from_status") or "active"
        session.execute(
            "UPDATE learning_projects SET status = ?, archived_from_status = NULL, updated_at = ? WHERE id = ?",
            (restored_status, self._now(), project_id),
        )
        return self._project(session, project_id)

    def _command_project_delete(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"id"}, optional=set())
        project = self._project(session, self._required_text(payload["id"], "id"), include_deleted=True)
        project_id = str(project["id"])
        entity_rows = session.fetchall(
            "SELECT id FROM plan_modules WHERE project_id = ? UNION "
            "SELECT id FROM lessons WHERE project_id = ? UNION "
            "SELECT id FROM concepts WHERE project_id = ?",
            (project_id, project_id, project_id),
        )
        for entity in entity_rows:
            session.execute("DELETE FROM plan_entity_curriculum_items WHERE entity_id = ?", (entity["id"],))
            session.execute("DELETE FROM plan_entity_sources WHERE entity_id = ?", (entity["id"],))
        session.execute(
            "INSERT INTO deleted_project_tombstones(project_id, local_profile_id, deleted_at) VALUES (?, ?, ?)",
            (project_id, project["local_profile_id"], self._now()),
        )
        session.execute("DELETE FROM learning_projects WHERE id = ?", (project_id,))
        return {"id": project_id, "deleted": True}

    def _query_project_list(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required=set(), optional={"include_archived"})
        include_archived = payload.get("include_archived", False)
        if not isinstance(include_archived, bool):
            raise validation_error("include_archived must be boolean")
        profile = self._profile(session)
        statuses = (
            ("active", "paused", "completed", "archived")
            if include_archived
            else (
                "active",
                "paused",
                "completed",
            )
        )
        placeholders = ",".join("?" for _ in statuses)
        rows = session.fetchall(
            f"SELECT * FROM learning_projects WHERE local_profile_id = ? "
            f"AND status IN ({placeholders}) ORDER BY updated_at DESC, id",
            (profile["id"], *statuses),
        )
        return {"items": [self._project_row(row) for row in rows]}

    def _query_project_get(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"id"}, optional=set())
        return self._project(session, self._required_text(payload["id"], "id"))

    # Plan and objectives
    def _command_plan_update(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(
            payload,
            required={"project_id", "generation_reason", "concepts", "modules"},
            optional={"generated_by_model", "prompt_version"},
        )
        project_id = self._required_text(payload["project_id"], "project_id")
        project = self._active_project(session, project_id)
        concepts = payload["concepts"]
        if not isinstance(concepts, list):
            raise validation_error("concepts must be an array")
        normalized_concepts: list[dict[str, Any]] = []
        concept_keys: set[str] = set()
        for concept in concepts:
            if not isinstance(concept, dict):
                raise validation_error("Each concept must be an object")
            self._exact_fields(
                concept,
                required={
                    "key",
                    "name",
                    "description",
                    "importance",
                    "curriculum_item_ids",
                    "source_document_ids",
                    "prerequisite_keys",
                },
                optional=set(),
            )
            concept_key = self._required_text(concept["key"], "concept.key")
            if concept_key in concept_keys:
                raise validation_error("Concept keys must be unique within a plan")
            concept_keys.add(concept_key)
            importance_value = concept["importance"]
            if isinstance(importance_value, bool) or not isinstance(importance_value, (int, float)):
                raise validation_error("concept.importance must be numeric")
            importance = float(importance_value)
            if not 0 <= importance <= 1:
                raise validation_error("concept.importance must be between 0 and 1")
            item_ids = self._string_list(concept["curriculum_item_ids"], "curriculum_item_ids")
            source_ids = self._string_list(concept["source_document_ids"], "source_document_ids")
            prerequisite_keys = self._string_list(concept["prerequisite_keys"], "prerequisite_keys")
            self._validate_project_curriculum_items(session, project, item_ids)
            self._validate_source_ids(session, source_ids)
            normalized_concepts.append(
                {
                    "key": concept_key,
                    "name": self._required_text(concept["name"], "concept.name"),
                    "description": self._required_text(concept["description"], "concept.description"),
                    "importance": importance,
                    "curriculum_item_ids": item_ids,
                    "source_document_ids": source_ids,
                    "prerequisite_keys": prerequisite_keys,
                }
            )
        for concept in normalized_concepts:
            unknown = set(concept["prerequisite_keys"]) - concept_keys
            if unknown:
                raise validation_error("Concept prerequisite is not present in the plan")
            if concept["key"] in concept["prerequisite_keys"]:
                raise validation_error("Concept cannot be its own prerequisite")
        self._assert_acyclic_concepts(normalized_concepts)
        modules = payload["modules"]
        if not isinstance(modules, list) or not modules:
            raise validation_error("modules must contain at least one module")
        normalized: list[dict[str, Any]] = []
        module_keys: set[str] = set()
        lesson_keys: set[str] = set()
        for module_order, module in enumerate(modules):
            if not isinstance(module, dict):
                raise validation_error("Each module must be an object")
            self._exact_fields(
                module,
                required={
                    "title",
                    "description",
                    "estimated_minutes",
                    "curriculum_item_ids",
                    "source_document_ids",
                    "lessons",
                },
                optional={"key", "prerequisite_keys"},
            )
            module_key = self._required_text(module.get("key", f"module-{module_order + 1}"), "module.key")
            if module_key in module_keys:
                raise validation_error("Module keys must be unique within a plan")
            module_keys.add(module_key)
            module_prerequisites = self._string_list(module.get("prerequisite_keys", []), "module.prerequisite_keys")
            item_ids = self._string_list(module["curriculum_item_ids"], "curriculum_item_ids")
            source_ids = self._string_list(module["source_document_ids"], "source_document_ids")
            self._validate_project_curriculum_items(session, project, item_ids)
            self._validate_source_ids(session, source_ids)
            lessons = module["lessons"]
            if not isinstance(lessons, list):
                raise validation_error("lessons must be an array")
            normalized_lessons: list[dict[str, Any]] = []
            for lesson_order, lesson in enumerate(lessons):
                if not isinstance(lesson, dict):
                    raise validation_error("Each lesson must be an object")
                self._exact_fields(
                    lesson,
                    required={
                        "title",
                        "description",
                        "estimated_minutes",
                        "curriculum_item_ids",
                        "source_document_ids",
                    },
                    optional={"key", "prerequisite_keys"},
                )
                lesson_key = self._required_text(
                    lesson.get("key", f"{module_key}-lesson-{lesson_order + 1}"), "lesson.key"
                )
                if lesson_key in lesson_keys:
                    raise validation_error("Lesson keys must be unique within a plan")
                lesson_keys.add(lesson_key)
                lesson_items = self._string_list(lesson["curriculum_item_ids"], "curriculum_item_ids")
                lesson_sources = self._string_list(lesson["source_document_ids"], "source_document_ids")
                self._validate_project_curriculum_items(session, project, lesson_items)
                self._validate_source_ids(session, lesson_sources)
                normalized_lessons.append(
                    {
                        "key": lesson_key,
                        "prerequisite_keys": self._string_list(
                            lesson.get("prerequisite_keys", []), "lesson.prerequisite_keys"
                        ),
                        "title": self._required_text(lesson["title"], "lesson.title"),
                        "description": self._required_text(lesson["description"], "lesson.description"),
                        "estimated_minutes": self._positive_integer(
                            lesson["estimated_minutes"], "lesson.estimated_minutes"
                        ),
                        "curriculum_item_ids": lesson_items,
                        "source_document_ids": lesson_sources,
                    }
                )
            normalized.append(
                {
                    "key": module_key,
                    "prerequisite_keys": module_prerequisites,
                    "title": self._required_text(module["title"], "module.title"),
                    "description": self._required_text(module["description"], "module.description"),
                    "estimated_minutes": self._positive_integer(
                        module["estimated_minutes"], "module.estimated_minutes"
                    ),
                    "curriculum_item_ids": item_ids,
                    "source_document_ids": source_ids,
                    "lessons": normalized_lessons,
                }
            )
        self._validate_keyed_graph(normalized, module_keys, "Module")
        all_lessons = [lesson for module in normalized for lesson in module["lessons"]]
        self._validate_keyed_graph(all_lessons, lesson_keys, "Lesson")
        version_row = session.fetchone(
            "SELECT COALESCE(MAX(version), 0) AS value FROM learning_plans WHERE project_id = ?",
            (project_id,),
        )
        version = int(version_row["value"]) + 1 if version_row else 1
        session.execute(
            "UPDATE learning_plans SET status = 'superseded' WHERE project_id = ? AND status = 'active'",
            (project_id,),
        )
        plan_id = self._new_id()
        curriculum_version = None
        if project["curriculum_id"]:
            curriculum_version = self._included_curriculum(session, project["curriculum_id"])["version"]
        session.execute(
            "INSERT INTO learning_plans"
            "(id, project_id, version, status, generation_reason, generated_by_model, prompt_version, "
            "curriculum_version, created_at) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)",
            (
                plan_id,
                project_id,
                version,
                self._required_text(payload["generation_reason"], "generation_reason"),
                self._optional_text(payload.get("generated_by_model")),
                self._optional_text(payload.get("prompt_version")),
                curriculum_version,
                self._now(),
            ),
        )
        concept_ids = {concept["key"]: self._new_id() for concept in normalized_concepts}
        for concept in normalized_concepts:
            concept_id = concept_ids[concept["key"]]
            session.execute(
                "INSERT INTO concepts(id, project_id, plan_id, concept_key, name, description, importance) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    concept_id,
                    project_id,
                    plan_id,
                    concept["key"],
                    concept["name"],
                    concept["description"],
                    concept["importance"],
                ),
            )
            self._store_entity_curriculum_items(session, "concept", concept_id, concept["curriculum_item_ids"])
            self._store_entity_sources(session, "concept", concept_id, concept["source_document_ids"])
        for concept in normalized_concepts:
            for prerequisite_key in concept["prerequisite_keys"]:
                session.execute(
                    "INSERT INTO concept_prerequisites(concept_id, prerequisite_concept_id) VALUES (?, ?)",
                    (concept_ids[concept["key"]], concept_ids[prerequisite_key]),
                )
        module_ids = {module["key"]: self._new_id() for module in normalized}
        lesson_ids = {lesson["key"]: self._new_id() for module in normalized for lesson in module["lessons"]}
        for module_order, module in enumerate(normalized):
            module_id = module_ids[module["key"]]
            session.execute(
                "INSERT INTO plan_modules"
                "(id, plan_id, project_id, module_key, title, description, estimated_minutes, display_order) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    module_id,
                    plan_id,
                    project_id,
                    module["key"],
                    module["title"],
                    module["description"],
                    module["estimated_minutes"],
                    module_order,
                ),
            )
            self._store_entity_curriculum_items(session, "module", module_id, module["curriculum_item_ids"])
            self._store_entity_sources(session, "module", module_id, module["source_document_ids"])
            for lesson_order, lesson in enumerate(module["lessons"]):
                lesson_id = lesson_ids[lesson["key"]]
                session.execute(
                    "INSERT INTO lessons"
                    "(id, plan_id, module_id, project_id, lesson_key, title, description, "
                    "estimated_minutes, display_order) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        lesson_id,
                        plan_id,
                        module_id,
                        project_id,
                        lesson["key"],
                        lesson["title"],
                        lesson["description"],
                        lesson["estimated_minutes"],
                        lesson_order,
                    ),
                )
                self._store_entity_curriculum_items(session, "lesson", lesson_id, lesson["curriculum_item_ids"])
                self._store_entity_sources(session, "lesson", lesson_id, lesson["source_document_ids"])
        for module in normalized:
            for prerequisite_key in module["prerequisite_keys"]:
                session.execute(
                    "INSERT INTO module_prerequisites(module_id, prerequisite_module_id) VALUES (?, ?)",
                    (module_ids[module["key"]], module_ids[prerequisite_key]),
                )
            for lesson in module["lessons"]:
                for prerequisite_key in lesson["prerequisite_keys"]:
                    session.execute(
                        "INSERT INTO lesson_prerequisites(lesson_id, prerequisite_lesson_id) VALUES (?, ?)",
                        (lesson_ids[lesson["key"]], lesson_ids[prerequisite_key]),
                    )
        return self._plan(session, plan_id)

    def _query_plan_current(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"project_id"}, optional=set())
        project_id = self._required_text(payload["project_id"], "project_id")
        self._project(session, project_id)
        row = session.fetchone(
            "SELECT id FROM learning_plans WHERE project_id = ? AND status = 'active'",
            (project_id,),
        )
        return {"plan": self._plan(session, row["id"]) if row else None}

    def _command_objective_update(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(
            payload,
            required={
                "project_id",
                "scope",
                "plan_id",
                "module_id",
                "lesson_id",
                "goal_type",
                "statement",
                "target",
                "conditions",
                "success_criteria",
                "evidence_method",
                "curriculum_item_ids",
                "curriculum_objective_ids",
                "source_document_ids",
            },
            optional={"objective_id", "display_order", "transformation_version"},
        )
        project_id = self._required_text(payload["project_id"], "project_id")
        project = self._active_project(session, project_id)
        scope = self._enum(payload["scope"], "scope", {"project", "module", "lesson"})
        goal_type = self._enum(payload["goal_type"], "goal_type", {"can_do", "know"})
        plan_id = self._optional_text(payload["plan_id"])
        module_id = self._optional_text(payload["module_id"])
        lesson_id = self._optional_text(payload["lesson_id"])
        self._validate_scope(session, project_id, scope, plan_id, module_id, lesson_id)
        statement = self._required_text(payload["statement"], "statement")
        target = self._required_text(payload["target"], "target")
        conditions = self._required_text(payload["conditions"], "conditions")
        success_criteria = self._required_text(payload["success_criteria"], "success_criteria")
        evidence_method = self._required_text(payload["evidence_method"], "evidence_method")
        self._validate_observable_objective(goal_type, statement, evidence_method)
        item_ids = self._string_list(payload["curriculum_item_ids"], "curriculum_item_ids")
        objective_ids = self._string_list(payload["curriculum_objective_ids"], "curriculum_objective_ids")
        source_ids = self._string_list(payload["source_document_ids"], "source_document_ids")
        self._validate_project_curriculum_items(session, project, item_ids)
        self._validate_project_curriculum_objectives(session, project, objective_ids)
        self._validate_source_ids(session, source_ids)
        now = self._now()
        objective_id_value = payload.get("objective_id")
        if objective_id_value is None:
            active_count = session.fetchone(
                "SELECT COUNT(*) AS value FROM learning_objectives "
                "WHERE project_id = ? AND lifecycle_status = 'active'",
                (project_id,),
            )
            if active_count is not None and int(active_count["value"]) >= MAX_ACTIVE_OBJECTIVES_PER_PROJECT:
                raise validation_error(
                    f"A project can have at most {MAX_ACTIVE_OBJECTIVES_PER_PROJECT} active learning objectives"
                )
            objective_id = self._new_id()
            version_number = 1
            session.execute(
                "INSERT INTO learning_objectives"
                "(id, project_id, lifecycle_status, created_at, updated_at) "
                "VALUES (?, ?, 'active', ?, ?)",
                (objective_id, project_id, now, now),
            )
        else:
            objective_id = self._required_text(objective_id_value, "objective_id")
            objective = self._objective(session, objective_id)
            if objective["project_id"] != project_id:
                raise validation_error("Objective belongs to another project")
            if objective["lifecycle_status"] == "invalidated":
                active_count = session.fetchone(
                    "SELECT COUNT(*) AS value FROM learning_objectives "
                    "WHERE project_id = ? AND lifecycle_status = 'active'",
                    (project_id,),
                )
                if (
                    active_count is not None
                    and int(active_count["value"]) >= MAX_ACTIVE_OBJECTIVES_PER_PROJECT
                ):
                    raise validation_error(
                        "An invalidated objective cannot be reactivated while the project already has "
                        f"{MAX_ACTIVE_OBJECTIVES_PER_PROJECT} active learning objectives"
                    )
            latest = session.fetchone(
                "SELECT MAX(version_number) AS value FROM learning_objective_versions WHERE learning_objective_id = ?",
                (objective_id,),
            )
            if latest is None or latest["value"] is None:
                raise ApplicationError("INTERNAL_ERROR", "Objective version history is missing")
            version_number = int(latest["value"]) + 1
            session.execute(
                "UPDATE objective_attainment SET status = 'invalidated', invalidated_at = ?, "
                "invalidation_reason = 'OBJECTIVE_REVISED' WHERE objective_id = ? AND status <> 'invalidated'",
                (now, objective_id),
            )
        version_id = self._new_id()
        display_order = self._integer(payload.get("display_order", 0), "display_order")
        session.execute(
            "INSERT INTO learning_objective_versions"
            "(id, learning_objective_id, project_id, version_number, plan_id, module_id, lesson_id, "
            "scope, goal_type, statement, target, conditions, success_criteria, evidence_method, "
            "curriculum_item_ids_json, curriculum_objective_ids_json, source_document_ids_json, "
            "display_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                version_id,
                objective_id,
                project_id,
                version_number,
                plan_id,
                module_id,
                lesson_id,
                scope,
                goal_type,
                statement,
                target,
                conditions,
                success_criteria,
                evidence_method,
                self._json(item_ids),
                self._json(objective_ids),
                self._json(source_ids),
                display_order,
                now,
            ),
        )
        session.execute(
            "UPDATE learning_objectives SET current_version_id = ?, lifecycle_status = 'active', "
            "updated_at = ? WHERE id = ?",
            (version_id, now, objective_id),
        )
        transformation_version = self._optional_text(payload.get("transformation_version")) or "manual-1"
        for curriculum_objective_id in objective_ids:
            session.execute(
                "INSERT INTO learning_objective_curriculum_mappings"
                "(learning_objective_version_id, curriculum_objective_id, transformation_version, "
                "verification_status, verified_at) VALUES (?, ?, ?, 'verified', ?)",
                (version_id, curriculum_objective_id, transformation_version, now),
            )
        return self._objective_detail(session, objective_id)

    def _query_objective_list(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"project_id"}, optional=set())
        project_id = self._required_text(payload["project_id"], "project_id")
        self._project(session, project_id)
        rows = session.fetchall(
            "SELECT id FROM learning_objectives WHERE project_id = ? AND lifecycle_status = 'active' "
            "ORDER BY created_at, id",
            (project_id,),
        )
        return {"items": [self._objective_detail(session, row["id"]) for row in rows]}

    def _query_objective_get(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"id"}, optional=set())
        return self._objective_detail(session, self._required_text(payload["id"], "id"))

    def _query_objective_evidence(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"id"}, optional=set())
        objective = self._objective(session, self._required_text(payload["id"], "id"))
        rows = session.fetchall(
            "SELECT * FROM objective_evidence WHERE objective_id = ? ORDER BY created_at, id",
            (objective["id"],),
        )
        return {"items": [self._evidence_row(row) for row in rows]}

    def _query_objective_attainment(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"id"}, optional=set())
        objective = self._objective(session, self._required_text(payload["id"], "id"))
        return self._attainment_for_current(session, objective)

    # Assessments/evidence
    def _command_submit_attempt(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(
            payload,
            required={
                "assessment_id",
                "answer",
                "score",
                "evaluation",
                "rubric",
                "hint_count",
                "grading_status",
                "evidence",
            },
            optional=set(),
        )
        assessment = self._assessment(session, self._required_text(payload["assessment_id"], "assessment_id"))
        project = self._active_project(session, assessment["project_id"])
        profile = self._profile(session)
        score_raw = payload["score"]
        if score_raw is not None and (isinstance(score_raw, bool) or not isinstance(score_raw, (int, float))):
            raise validation_error("score must be a number or null")
        score = float(score_raw) if score_raw is not None else None
        if score is not None and not 0 <= score <= 1:
            raise validation_error("score must be between 0 and 1")
        grading_status = self._enum(payload["grading_status"], "grading_status", {"graded", "ambiguous", "ungradable"})
        hint_count = self._integer(payload["hint_count"], "hint_count")
        if hint_count < 0:
            raise validation_error("hint_count must not be negative")
        evidence_payload = payload["evidence"]
        if not isinstance(evidence_payload, list) or not evidence_payload:
            raise validation_error("evidence must contain at least one entry")
        allowed_versions = set(assessment["objective_version_ids"])
        normalized: list[tuple[dict[str, Any], dict[str, Any], str, bool, str | None]] = []
        for evidence in evidence_payload:
            if not isinstance(evidence, dict):
                raise validation_error("Evidence must be an object")
            self._exact_fields(
                evidence,
                required={"objective_version_id", "evidence_type"},
                optional=set(),
            )
            version_id = self._required_text(evidence["objective_version_id"], "objective_version_id")
            if version_id not in allowed_versions:
                raise validation_error("Evidence objective version was not part of the assessment")
            version = self._objective_version(session, version_id)
            if version["project_id"] != project["id"]:
                raise validation_error("Evidence belongs to another project")
            evidence_type = self._enum(
                evidence["evidence_type"],
                "evidence_type",
                {"diagnostic", "practice", "lesson_check", "final_check", "self_assessment"},
            )
            if evidence_type != "self_assessment" and evidence_type != assessment["type"]:
                raise validation_error("Evidence type does not match assessment type")
            accepted = True
            rejection_reason: str | None = None
            if evidence_type == "self_assessment":
                accepted = False
                rejection_reason = "SELF_REPORT_ONLY"
            elif grading_status != "graded":
                accepted = False
                rejection_reason = "AMBIGUOUS_GRADING"
            elif score is None:
                accepted = False
                rejection_reason = "MISSING_SCORE"
            elif score < self._attainment_policy.minimum_score:
                accepted = False
                rejection_reason = "SUCCESS_CRITERIA_NOT_MET"
            normalized.append((evidence, version, evidence_type, accepted, rejection_reason))
        attempt_id = self._new_id()
        now = self._now()
        session.execute(
            "INSERT INTO assessment_attempts"
            "(id, assessment_id, local_profile_id, answer, score, evaluation, rubric, hint_count, "
            "grading_status, started_at, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                attempt_id,
                assessment["id"],
                profile["id"],
                self._required_text(payload["answer"], "answer"),
                score,
                self._required_text(payload["evaluation"], "evaluation"),
                self._required_text(payload["rubric"], "rubric"),
                hint_count,
                grading_status,
                now,
                now,
            ),
        )
        evidence_results: list[JsonObject] = []
        affected_objectives: set[str] = set()
        for _, version, evidence_type, accepted, rejection_reason in normalized:
            evidence_id = self._new_id()
            objective_id = str(version["learning_objective_id"])
            session.execute(
                "INSERT INTO objective_evidence"
                "(id, objective_id, learning_objective_version_id, evidence_type, assessment_attempt_id, "
                "result, score, success_criteria_snapshot, rubric_version, accepted_for_attainment, "
                "rejection_reason, verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    evidence_id,
                    objective_id,
                    version["id"],
                    evidence_type,
                    attempt_id,
                    payload["evaluation"],
                    score,
                    version["success_criteria"],
                    assessment["rubric_version"],
                    1 if accepted else 0,
                    rejection_reason,
                    now if accepted else None,
                    now,
                ),
            )
            row = session.fetchone("SELECT * FROM objective_evidence WHERE id = ?", (evidence_id,))
            if row is None:
                raise ApplicationError("INTERNAL_ERROR", "Evidence persistence failed")
            evidence_results.append(self._evidence_row(row))
            affected_objectives.add(objective_id)
        for objective_id in affected_objectives:
            self._recalculate_attainment(session, objective_id, profile["id"])
        return {
            "id": attempt_id,
            "assessment_id": assessment["id"],
            "project_id": project["id"],
            "score": score,
            "grading_status": grading_status,
            "evidence": evidence_results,
            "submitted_at": now,
        }

    # Remediation
    def _command_remediation_accept(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"id"}, optional=set())
        remediation = self._remediation(session, self._required_text(payload["id"], "id"))
        if remediation["status"] != "proposed":
            raise ApplicationError("INVALID_STATE_TRANSITION", "Remediation is not proposed")
        session.execute(
            "UPDATE remediation_paths SET status = 'active', started_at = ? WHERE id = ?",
            (self._now(), remediation["id"]),
        )
        return self._remediation(session, remediation["id"])

    def _command_remediation_complete(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"id"}, optional=set())
        remediation = self._remediation(session, self._required_text(payload["id"], "id"))
        if remediation["status"] != "active":
            raise ApplicationError("INVALID_STATE_TRANSITION", "Remediation is not active")
        session.execute(
            "UPDATE remediation_paths SET status = 'completed', completed_at = ? WHERE id = ?",
            (self._now(), remediation["id"]),
        )
        return self._remediation(session, remediation["id"])

    def _query_remediation_active(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"project_id"}, optional=set())
        project_id = self._required_text(payload["project_id"], "project_id")
        self._project(session, project_id)
        row = session.fetchone(
            "SELECT id FROM remediation_paths WHERE project_id = ? AND status = 'active' "
            "ORDER BY started_at DESC LIMIT 1",
            (project_id,),
        )
        return {"remediation": self._remediation(session, row["id"]) if row else None}

    # Sessions/history
    def _command_session_start(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"project_id", "lesson_id"}, optional=set())
        project_id = self._required_text(payload["project_id"], "project_id")
        self._active_project(session, project_id)
        lesson_id = self._optional_text(payload["lesson_id"])
        if lesson_id:
            self._owned_entity(session, "lessons", lesson_id, project_id)
        session_id = self._new_id()
        session.execute(
            "INSERT INTO learning_sessions(id, project_id, lesson_id, started_at, status) "
            "VALUES (?, ?, ?, ?, 'active')",
            (session_id, project_id, lesson_id, self._now()),
        )
        return self._session(session, session_id)

    def _command_session_complete(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"id", "summary", "next_action"}, optional=set())
        learning_session = self._session(session, self._required_text(payload["id"], "id"))
        if learning_session["status"] != "active":
            raise ApplicationError("INVALID_STATE_TRANSITION", "Session is not active")
        session.execute(
            "UPDATE learning_sessions SET status = 'completed', ended_at = ?, summary = ?, "
            "next_action = ?, active_thread_id = NULL WHERE id = ?",
            (
                self._now(),
                self._required_text(payload["summary"], "summary"),
                self._required_text(payload["next_action"], "next_action"),
                learning_session["id"],
            ),
        )
        return self._session(session, learning_session["id"])

    def _query_session_get(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"id"}, optional=set())
        return self._session(session, self._required_text(payload["id"], "id"))

    def _query_history_list(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"project_id"}, optional={"limit", "offset"})
        project_id = self._required_text(payload["project_id"], "project_id")
        self._project(session, project_id)
        limit = self._integer(payload.get("limit", 50), "limit")
        offset = self._integer(payload.get("offset", 0), "offset")
        if not 1 <= limit <= 200 or offset < 0:
            raise validation_error("Invalid pagination")
        rows = session.fetchall(
            "SELECT * FROM learning_sessions WHERE project_id = ? ORDER BY started_at DESC, id LIMIT ? OFFSET ?",
            (project_id, limit, offset),
        )
        return {"items": [self._session_row(row) for row in rows], "limit": limit, "offset": offset}

    def _query_history_get(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"id"}, optional=set())
        learning_session = self._session(session, self._required_text(payload["id"], "id"))
        rows = session.fetchall(
            "SELECT * FROM messages WHERE session_id = ? ORDER BY sequence",
            (learning_session["id"],),
        )
        return {**learning_session, "messages": [self._message_row(row) for row in rows]}

    # Notes/bookmarks
    def _command_note_create(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(
            payload,
            required={
                "project_id",
                "lesson_id",
                "concept_id",
                "content",
                "source_document_ids",
                "curriculum_item_ids",
            },
            optional=set(),
        )
        project_id = self._required_text(payload["project_id"], "project_id")
        project = self._active_project(session, project_id)
        lesson_id = self._optional_text(payload["lesson_id"])
        concept_id = self._optional_text(payload["concept_id"])
        if lesson_id:
            self._owned_entity(session, "lessons", lesson_id, project_id)
        if concept_id:
            self._owned_entity(session, "concepts", concept_id, project_id)
        source_ids = self._string_list(payload["source_document_ids"], "source_document_ids")
        item_ids = self._string_list(payload["curriculum_item_ids"], "curriculum_item_ids")
        self._validate_source_ids(session, source_ids)
        self._validate_project_curriculum_items(session, project, item_ids)
        profile = self._profile(session)
        note_id = self._new_id()
        now = self._now()
        session.execute(
            "INSERT INTO notes"
            "(id, local_profile_id, project_id, lesson_id, concept_id, content, source_document_ids_json, "
            "curriculum_item_ids_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                note_id,
                profile["id"],
                project_id,
                lesson_id,
                concept_id,
                self._required_text(payload["content"], "content"),
                self._json(source_ids),
                self._json(item_ids),
                now,
                now,
            ),
        )
        return self._note(session, note_id)

    def _command_note_update(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"id", "content"}, optional=set())
        note = self._note(session, self._required_text(payload["id"], "id"))
        session.execute(
            "UPDATE notes SET content = ?, updated_at = ? WHERE id = ?",
            (self._required_text(payload["content"], "content"), self._now(), note["id"]),
        )
        return self._note(session, note["id"])

    def _command_note_delete(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"id"}, optional=set())
        note = self._note(session, self._required_text(payload["id"], "id"))
        session.execute("DELETE FROM notes WHERE id = ?", (note["id"],))
        return {"id": note["id"], "deleted": True}

    def _query_note_list(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"project_id"}, optional=set())
        project_id = self._required_text(payload["project_id"], "project_id")
        self._project(session, project_id)
        rows = session.fetchall("SELECT * FROM notes WHERE project_id = ? ORDER BY updated_at DESC, id", (project_id,))
        return {"items": [self._note_row(row) for row in rows]}

    def _command_bookmark_create(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(
            payload,
            required={
                "project_id",
                "lesson_id",
                "concept_id",
                "message_id",
                "note",
                "source_document_ids",
                "curriculum_item_ids",
            },
            optional=set(),
        )
        project_id = self._required_text(payload["project_id"], "project_id")
        project = self._active_project(session, project_id)
        lesson_id = self._optional_text(payload["lesson_id"])
        concept_id = self._optional_text(payload["concept_id"])
        if lesson_id:
            self._owned_entity(session, "lessons", lesson_id, project_id)
        if concept_id:
            self._owned_entity(session, "concepts", concept_id, project_id)
        message = self._message(session, self._required_text(payload["message_id"], "message_id"))
        message_session = self._session(session, message["session_id"])
        if message_session["project_id"] != project_id:
            raise validation_error("Message belongs to another project")
        source_ids = self._string_list(payload["source_document_ids"], "source_document_ids")
        item_ids = self._string_list(payload["curriculum_item_ids"], "curriculum_item_ids")
        self._validate_source_ids(session, source_ids)
        self._validate_project_curriculum_items(session, project, item_ids)
        profile = self._profile(session)
        bookmark_id = self._new_id()
        session.execute(
            "INSERT INTO bookmarks"
            "(id, local_profile_id, project_id, lesson_id, concept_id, message_id, note, "
            "source_document_ids_json, curriculum_item_ids_json, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                bookmark_id,
                profile["id"],
                project_id,
                lesson_id,
                concept_id,
                message["id"],
                self._optional_text(payload["note"]),
                self._json(source_ids),
                self._json(item_ids),
                self._now(),
            ),
        )
        return self._bookmark(session, bookmark_id)

    def _command_bookmark_delete(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"id"}, optional=set())
        bookmark = self._bookmark(session, self._required_text(payload["id"], "id"))
        session.execute("DELETE FROM bookmarks WHERE id = ?", (bookmark["id"],))
        return {"id": bookmark["id"], "deleted": True}

    def _query_bookmark_list(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"project_id"}, optional=set())
        project_id = self._required_text(payload["project_id"], "project_id")
        self._project(session, project_id)
        rows = session.fetchall(
            "SELECT * FROM bookmarks WHERE project_id = ? ORDER BY created_at DESC, id",
            (project_id,),
        )
        return {"items": [self._bookmark_row(row) for row in rows]}

    # Progress queries
    def _query_progress(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"project_id"}, optional=set())
        project_id = self._required_text(payload["project_id"], "project_id")
        self._project(session, project_id)
        lesson_rows = session.fetchall(
            "SELECT l.status FROM lessons l JOIN learning_plans p ON p.id = l.plan_id "
            "WHERE l.project_id = ? AND p.status = 'active'",
            (project_id,),
        )
        total = len(lesson_rows)
        completed = sum(1 for row in lesson_rows if row["status"] == "mastered")
        objective_rows = session.fetchall(
            "SELECT o.id FROM learning_objectives o "
            "JOIN learning_objective_versions v ON v.id = o.current_version_id "
            "LEFT JOIN learning_plans p ON p.id = v.plan_id "
            "WHERE o.project_id = ? AND o.lifecycle_status = 'active' "
            "AND (v.plan_id IS NULL OR p.status = 'active')",
            (project_id,),
        )
        attainments = [
            self._attainment_for_current(session, self._objective(session, row["id"])) for row in objective_rows
        ]
        return {
            "project_id": project_id,
            "lesson_total": total,
            "lesson_completed": completed,
            "progress_rate": completed / total if total else 0.0,
            "objectives": attainments,
        }

    def _query_mastery(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"project_id"}, optional=set())
        project_id = self._required_text(payload["project_id"], "project_id")
        self._project(session, project_id)
        rows = session.fetchall(
            "SELECT cm.*, c.name, c.description FROM concept_mastery cm JOIN concepts c ON c.id = cm.concept_id "
            "JOIN learning_plans p ON p.id = c.plan_id "
            "WHERE cm.project_id = ? AND p.status = 'active' ORDER BY c.name",
            (project_id,),
        )
        return {"items": rows}

    def _query_curriculum_progress(self, session: DatabaseSession, payload: JsonObject) -> JsonObject:
        self._exact_fields(payload, required={"project_id"}, optional=set())
        project_id = self._required_text(payload["project_id"], "project_id")
        project = self._project(session, project_id)
        if project["mode"] != "curriculum":
            return {"project_id": project_id, "items": []}
        rows = session.fetchall(
            "SELECT DISTINCT pci.curriculum_item_id FROM plan_entity_curriculum_items pci "
            "JOIN plan_modules m ON (pci.entity_type = 'module' AND pci.entity_id = m.id) "
            "JOIN learning_plans p1 ON p1.id = m.plan_id "
            "WHERE m.project_id = ? AND p1.status = 'active' UNION "
            "SELECT DISTINCT pci.curriculum_item_id FROM plan_entity_curriculum_items pci "
            "JOIN lessons l ON (pci.entity_type = 'lesson' AND pci.entity_id = l.id) "
            "JOIN learning_plans p2 ON p2.id = l.plan_id "
            "WHERE l.project_id = ? AND p2.status = 'active' ORDER BY curriculum_item_id",
            (project_id, project_id),
        )
        return {
            "project_id": project_id,
            "items": [{"curriculum_item_id": row["curriculum_item_id"], "status": "planned"} for row in rows],
        }

    # Row loaders/serializers
    def _profile(self, session: DatabaseSession) -> JsonObject:
        row = session.fetchone("SELECT * FROM local_profiles WHERE singleton_key = 1")
        if row is None:
            raise ApplicationError("NOT_FOUND", "Local profile not found")
        preferences = self._load_json(row.pop("learning_preferences_json"))
        return {**row, "learning_preferences": preferences}

    def _curriculum_profile_row(self, row: JsonObject) -> JsonObject:
        metadata = self._load_json(row.pop("metadata_json"))
        return {**row, "metadata": metadata}

    def _curriculum_row(self, row: JsonObject) -> JsonObject:
        grade_or_level = self._load_json(row.pop("grade_or_level_json"))
        metadata = self._load_json(row.pop("metadata_json"))
        return {**row, "grade_or_level": grade_or_level, "metadata": metadata}

    def _curriculum_item_row(self, row: JsonObject) -> JsonObject:
        metadata = self._load_json(row.pop("metadata_json"))
        return {**row, "metadata": metadata}

    def _source_row(self, row: JsonObject) -> JsonObject:
        metadata = self._load_json(row.pop("metadata_json"))
        return {**row, "metadata": metadata}

    def _project(self, session: DatabaseSession, project_id: str, *, include_deleted: bool = False) -> JsonObject:
        row = session.fetchone("SELECT * FROM learning_projects WHERE id = ?", (project_id,))
        if row is None or (row["status"] == "deleted" and not include_deleted):
            raise ApplicationError("NOT_FOUND", "Learning project not found")
        return self._project_row(row)

    def _active_project(self, session: DatabaseSession, project_id: str) -> JsonObject:
        project = self._project(session, project_id, include_deleted=True)
        if project["status"] in {"archived", "deleted"}:
            raise ApplicationError("INVALID_STATE_TRANSITION", "Learning project is not active")
        return project

    def _project_row(self, row: JsonObject) -> JsonObject:
        constraints = self._load_json(row.pop("constraints_json"))
        return {**row, "constraints": constraints}

    def _plan(self, session: DatabaseSession, plan_id: str) -> JsonObject:
        row = session.fetchone("SELECT * FROM learning_plans WHERE id = ?", (plan_id,))
        if row is None:
            raise ApplicationError("NOT_FOUND", "Learning plan not found")
        concepts = session.fetchall("SELECT * FROM concepts WHERE plan_id = ? ORDER BY concept_key", (plan_id,))
        result_concepts: list[JsonObject] = []
        for concept in concepts:
            prerequisites = session.fetchall(
                "SELECT prerequisite_concept_id FROM concept_prerequisites WHERE concept_id = ? "
                "ORDER BY prerequisite_concept_id",
                (concept["id"],),
            )
            result_concepts.append(
                {
                    **concept,
                    "curriculum_item_ids": self._entity_curriculum_items(session, "concept", concept["id"]),
                    "source_document_ids": self._entity_sources(session, "concept", concept["id"]),
                    "prerequisite_concept_ids": [
                        prerequisite["prerequisite_concept_id"] for prerequisite in prerequisites
                    ],
                }
            )
        modules = session.fetchall("SELECT * FROM plan_modules WHERE plan_id = ? ORDER BY display_order", (plan_id,))
        result_modules: list[JsonObject] = []
        for module in modules:
            lessons = session.fetchall(
                "SELECT * FROM lessons WHERE module_id = ? ORDER BY display_order", (module["id"],)
            )
            result_lessons = []
            for lesson in lessons:
                lesson_prerequisites = session.fetchall(
                    "SELECT prerequisite_lesson_id FROM lesson_prerequisites WHERE lesson_id = ? "
                    "ORDER BY prerequisite_lesson_id",
                    (lesson["id"],),
                )
                result_lessons.append(
                    {
                        **lesson,
                        "key": lesson["lesson_key"],
                        "prerequisite_ids": [row["prerequisite_lesson_id"] for row in lesson_prerequisites],
                        "curriculum_item_ids": self._entity_curriculum_items(session, "lesson", lesson["id"]),
                        "source_document_ids": self._entity_sources(session, "lesson", lesson["id"]),
                    }
                )
            module_prerequisites = session.fetchall(
                "SELECT prerequisite_module_id FROM module_prerequisites WHERE module_id = ? "
                "ORDER BY prerequisite_module_id",
                (module["id"],),
            )
            result_modules.append(
                {
                    **module,
                    "key": module["module_key"],
                    "prerequisite_ids": [row["prerequisite_module_id"] for row in module_prerequisites],
                    "curriculum_item_ids": self._entity_curriculum_items(session, "module", module["id"]),
                    "source_document_ids": self._entity_sources(session, "module", module["id"]),
                    "lessons": result_lessons,
                }
            )
        objectives = session.fetchall(
            "SELECT o.id FROM learning_objectives o "
            "JOIN learning_objective_versions v ON v.id = o.current_version_id "
            "WHERE o.project_id = ? AND o.lifecycle_status = 'active' "
            "AND (v.plan_id IS NULL OR v.plan_id = ?) ORDER BY o.id",
            (row["project_id"], row["id"]),
        )
        return {
            **row,
            "concepts": result_concepts,
            "modules": result_modules,
            "objectives": [self._objective_detail(session, item["id"]) for item in objectives],
        }

    def _objective(self, session: DatabaseSession, objective_id: str) -> JsonObject:
        row = session.fetchone("SELECT * FROM learning_objectives WHERE id = ?", (objective_id,))
        if row is None:
            raise ApplicationError("NOT_FOUND", "Learning objective not found")
        return row

    def _objective_version(self, session: DatabaseSession, version_id: str) -> JsonObject:
        row = session.fetchone("SELECT * FROM learning_objective_versions WHERE id = ?", (version_id,))
        if row is None:
            raise ApplicationError("NOT_FOUND", "Learning objective version not found")
        return self._objective_version_row(row)

    def _objective_version_row(self, row: JsonObject) -> JsonObject:
        item_ids = self._load_json(row.pop("curriculum_item_ids_json"))
        objective_ids = self._load_json(row.pop("curriculum_objective_ids_json"))
        source_ids = self._load_json(row.pop("source_document_ids_json"))
        return {
            **row,
            "curriculum_item_ids": item_ids,
            "curriculum_objective_ids": objective_ids,
            "source_document_ids": source_ids,
        }

    def _objective_detail(self, session: DatabaseSession, objective_id: str) -> JsonObject:
        objective = self._objective(session, objective_id)
        rows = session.fetchall(
            "SELECT * FROM learning_objective_versions WHERE learning_objective_id = ? ORDER BY version_number",
            (objective_id,),
        )
        versions = [self._objective_version_row(row) for row in rows]
        current = next(version for version in versions if version["id"] == objective["current_version_id"])
        return {
            **objective,
            "current_version": current,
            "versions": versions,
            "attainment": self._attainment_for_current(session, objective),
        }

    def _assessment(self, session: DatabaseSession, assessment_id: str) -> JsonObject:
        row = session.fetchone("SELECT * FROM assessments WHERE id = ?", (assessment_id,))
        if row is None:
            raise ApplicationError("NOT_FOUND", "Assessment not found")
        objectives = session.fetchall(
            "SELECT learning_objective_version_id FROM assessment_objectives WHERE assessment_id = ? "
            "ORDER BY learning_objective_version_id",
            (assessment_id,),
        )
        curriculum_item_ids = self._load_json(row.pop("curriculum_item_ids_json"))
        source_document_ids = self._load_json(row.pop("source_document_ids_json"))
        return {
            **row,
            "objective_version_ids": [item["learning_objective_version_id"] for item in objectives],
            "curriculum_item_ids": curriculum_item_ids,
            "source_document_ids": source_document_ids,
        }

    def _evidence_row(self, row: JsonObject) -> JsonObject:
        return {**row, "accepted_for_attainment": bool(row["accepted_for_attainment"])}

    def _attainment_for_current(self, session: DatabaseSession, objective: JsonObject) -> JsonObject:
        profile = self._profile(session)
        version_id = objective["current_version_id"]
        row = session.fetchone(
            "SELECT * FROM objective_attainment WHERE local_profile_id = ? AND objective_id = ? "
            "AND learning_objective_version_id = ?",
            (profile["id"], objective["id"], version_id),
        )
        if row is None:
            return {
                "id": None,
                "local_profile_id": profile["id"],
                "project_id": objective["project_id"],
                "objective_id": objective["id"],
                "learning_objective_version_id": version_id,
                "status": "not_started",
                "evidence_ids": [],
                "evaluated_at": None,
                "invalidated_at": None,
                "invalidation_reason": None,
            }
        evidence_ids = self._load_json(row.pop("evidence_ids_json"))
        return {**row, "evidence_ids": evidence_ids}

    def _recalculate_attainment(self, session: DatabaseSession, objective_id: str, profile_id: str) -> None:
        objective = self._objective(session, objective_id)
        version_id = objective["current_version_id"]
        evidence = session.fetchall(
            "SELECT id, accepted_for_attainment FROM objective_evidence "
            "WHERE objective_id = ? AND learning_objective_version_id = ? ORDER BY created_at, id",
            (objective_id, version_id),
        )
        accepted_ids = [row["id"] for row in evidence if row["accepted_for_attainment"]]
        status = "achieved" if accepted_ids else ("in_progress" if evidence else "not_started")
        existing = session.fetchone(
            "SELECT id FROM objective_attainment WHERE local_profile_id = ? AND objective_id = ? "
            "AND learning_objective_version_id = ?",
            (profile_id, objective_id, version_id),
        )
        now = self._now()
        if existing is None:
            session.execute(
                "INSERT INTO objective_attainment"
                "(id, local_profile_id, project_id, objective_id, learning_objective_version_id, "
                "status, evidence_ids_json, evaluated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    self._new_id(),
                    profile_id,
                    objective["project_id"],
                    objective_id,
                    version_id,
                    status,
                    self._json(accepted_ids),
                    now,
                ),
            )
        else:
            session.execute(
                "UPDATE objective_attainment SET status = ?, evidence_ids_json = ?, evaluated_at = ?, "
                "invalidated_at = NULL, invalidation_reason = NULL WHERE id = ?",
                (status, self._json(accepted_ids), now, existing["id"]),
            )

    def _session(self, session: DatabaseSession, session_id: str) -> JsonObject:
        row = session.fetchone("SELECT * FROM learning_sessions WHERE id = ?", (session_id,))
        if row is None:
            raise ApplicationError("NOT_FOUND", "Learning session not found")
        project = self._project(session, row["project_id"], include_deleted=True)
        if project["status"] == "deleted":
            raise ApplicationError("NOT_FOUND", "Learning session not found")
        return self._session_row(row)

    @staticmethod
    def _session_row(row: JsonObject) -> JsonObject:
        return row

    def _message(self, session: DatabaseSession, message_id: str) -> JsonObject:
        row = session.fetchone("SELECT * FROM messages WHERE id = ?", (message_id,))
        if row is None:
            raise ApplicationError("NOT_FOUND", "Message not found")
        return self._message_row(row)

    def _message_row(self, row: JsonObject) -> JsonObject:
        source_ids = self._load_json(row.pop("source_document_ids_json"))
        return {**row, "source_document_ids": source_ids}

    def _note(self, session: DatabaseSession, note_id: str) -> JsonObject:
        row = session.fetchone("SELECT * FROM notes WHERE id = ?", (note_id,))
        if row is None:
            raise ApplicationError("NOT_FOUND", "Note not found")
        return self._note_row(row)

    def _note_row(self, row: JsonObject) -> JsonObject:
        source_ids = self._load_json(row.pop("source_document_ids_json"))
        item_ids = self._load_json(row.pop("curriculum_item_ids_json"))
        return {**row, "source_document_ids": source_ids, "curriculum_item_ids": item_ids}

    def _bookmark(self, session: DatabaseSession, bookmark_id: str) -> JsonObject:
        row = session.fetchone("SELECT * FROM bookmarks WHERE id = ?", (bookmark_id,))
        if row is None:
            raise ApplicationError("NOT_FOUND", "Bookmark not found")
        return self._bookmark_row(row)

    def _bookmark_row(self, row: JsonObject) -> JsonObject:
        source_ids = self._load_json(row.pop("source_document_ids_json"))
        item_ids = self._load_json(row.pop("curriculum_item_ids_json"))
        return {**row, "source_document_ids": source_ids, "curriculum_item_ids": item_ids}

    def _remediation(self, session: DatabaseSession, remediation_id: str) -> JsonObject:
        row = session.fetchone("SELECT * FROM remediation_paths WHERE id = ?", (remediation_id,))
        if row is None:
            raise ApplicationError("NOT_FOUND", "Remediation path not found")
        lesson_ids = self._load_json(row.pop("remediation_lesson_ids_json"))
        return {**row, "remediation_lesson_ids": lesson_ids}

    # Validation/helpers
    def _included_curriculum(self, session: DatabaseSession, curriculum_id: str) -> JsonObject:
        row = session.fetchone(
            "SELECT c.* FROM curricula c JOIN curriculum_profiles p ON p.id = c.profile_id "
            "WHERE c.id = ? AND p.mvp_status = 'included' AND c.status = 'active'",
            (curriculum_id,),
        )
        if row is None:
            raise ApplicationError("NOT_FOUND", "Included curriculum not found")
        return self._curriculum_row(row)

    @staticmethod
    def _source(session: DatabaseSession, source_id: str) -> JsonObject:
        row = session.fetchone("SELECT * FROM source_documents WHERE id = ? AND is_active = 1", (source_id,))
        if row is None:
            raise ApplicationError("NOT_FOUND", "Source document not found")
        return row

    def _validate_source_ids(self, session: DatabaseSession, source_ids: list[str]) -> None:
        for source_id in source_ids:
            self._source(session, source_id)

    def _validate_project_curriculum_items(
        self, session: DatabaseSession, project: JsonObject, item_ids: list[str]
    ) -> None:
        if not item_ids:
            return
        if project["mode"] != "curriculum":
            raise validation_error("Free-topic projects cannot claim curriculum mappings")
        curriculum = self._included_curriculum(session, project["curriculum_id"])
        for item_id in item_ids:
            row = session.fetchone("SELECT profile_id FROM curriculum_items WHERE id = ? AND is_active = 1", (item_id,))
            if row is None:
                raise validation_error("Unknown curriculum item")
            if row["profile_id"] != curriculum["profile_id"]:
                raise ApplicationError(
                    "CURRICULUM_JURISDICTION_MISMATCH",
                    "Curriculum item belongs to another education jurisdiction",
                )

    def _validate_project_curriculum_objectives(
        self, session: DatabaseSession, project: JsonObject, objective_ids: list[str]
    ) -> None:
        if not objective_ids:
            return
        if project["mode"] != "curriculum":
            raise validation_error("Free-topic projects cannot claim curriculum mappings")
        curriculum = self._included_curriculum(session, project["curriculum_id"])
        for objective_id in objective_ids:
            row = session.fetchone("SELECT profile_id FROM curriculum_objectives WHERE id = ?", (objective_id,))
            if row is None:
                raise validation_error("Unknown curriculum objective")
            if row["profile_id"] != curriculum["profile_id"]:
                raise ApplicationError(
                    "CURRICULUM_JURISDICTION_MISMATCH",
                    "Curriculum objective belongs to another education jurisdiction",
                )

    def _validate_scope(
        self,
        session: DatabaseSession,
        project_id: str,
        scope: str,
        plan_id: str | None,
        module_id: str | None,
        lesson_id: str | None,
    ) -> None:
        if scope == "project" and any((plan_id, module_id, lesson_id)):
            raise validation_error("Project objective cannot reference plan/module/lesson")
        if scope == "module" and (not plan_id or not module_id or lesson_id):
            raise validation_error("Module objective requires plan and module only")
        if scope == "lesson" and (not plan_id or not module_id or not lesson_id):
            raise validation_error("Lesson objective requires plan, module, and lesson")
        if plan_id:
            self._owned_entity(session, "learning_plans", plan_id, project_id)
        if module_id:
            module = self._owned_entity(session, "plan_modules", module_id, project_id)
            if module["plan_id"] != plan_id:
                raise validation_error("Module does not belong to plan")
        if lesson_id:
            lesson = self._owned_entity(session, "lessons", lesson_id, project_id)
            if lesson["plan_id"] != plan_id or lesson["module_id"] != module_id:
                raise validation_error("Lesson does not belong to plan and module")

    @staticmethod
    def _validate_observable_objective(goal_type: str, statement: str, evidence_method: str) -> None:
        unobservable = {"understand", "know", "理解する", "知る", "わかる"}
        normalized = statement.strip().lower().rstrip("。.")
        if normalized in unobservable:
            raise validation_error("Objective statement must describe observable evidence")
        if goal_type == "know":
            observable_terms = (
                "explain",
                "distinguish",
                "relate",
                "reason",
                "説明",
                "区別",
                "関連",
                "理由",
            )
            if not any(term in evidence_method.lower() for term in observable_terms):
                raise validation_error("know evidence must use an observable understanding method")

    @staticmethod
    def _assert_acyclic_concepts(concepts: list[dict[str, Any]]) -> None:
        ApplicationCore._assert_acyclic_graph(
            {str(concept["key"]): [str(key) for key in concept["prerequisite_keys"]] for concept in concepts},
            "Concept",
        )

    @staticmethod
    def _assert_acyclic_graph(graph: dict[str, list[str]], label: str) -> None:
        indegree = {key: len(prerequisites) for key, prerequisites in graph.items()}
        dependents: dict[str, list[str]] = {key: [] for key in graph}
        for key, prerequisites in graph.items():
            for prerequisite in prerequisites:
                dependents[prerequisite].append(key)
        ready = [key for key, degree in indegree.items() if degree == 0]
        visited = 0
        while ready:
            key = ready.pop()
            visited += 1
            for dependent in dependents[key]:
                indegree[dependent] -= 1
                if indegree[dependent] == 0:
                    ready.append(dependent)
        if visited != len(graph):
            raise validation_error(f"{label} prerequisites must be acyclic")

    @classmethod
    def _validate_keyed_graph(cls, entities: list[dict[str, Any]], keys: set[str], label: str) -> None:
        graph: dict[str, list[str]] = {}
        for entity in entities:
            key = str(entity["key"])
            prerequisites = [str(item) for item in entity["prerequisite_keys"]]
            if key in prerequisites:
                raise validation_error(f"{label} cannot be its own prerequisite")
            if set(prerequisites) - keys:
                raise validation_error(f"{label} prerequisite is not present in the plan")
            graph[key] = prerequisites
        cls._assert_acyclic_graph(graph, label)

    def _constraints(self, value: Any) -> JsonObject:
        if not isinstance(value, dict):
            raise validation_error("constraints must be an object")
        self._exact_fields(value, required={"prerequisites", "uses", "exclusions"}, optional=set())
        return {
            key: self._string_list(value[key], f"constraints.{key}") for key in ("prerequisites", "uses", "exclusions")
        }

    @staticmethod
    def _owned_entity(session: DatabaseSession, table: str, entity_id: str, project_id: str) -> JsonObject:
        allowed = {"learning_plans", "plan_modules", "lessons", "concepts"}
        if table not in allowed:
            raise ValueError("Unsupported ownership table")
        row = session.fetchone(f"SELECT * FROM {table} WHERE id = ?", (entity_id,))
        if row is None or row["project_id"] != project_id:
            raise validation_error(f"{table} entity does not belong to project")
        return row

    @staticmethod
    def _store_entity_curriculum_items(
        session: DatabaseSession, entity_type: str, entity_id: str, item_ids: list[str]
    ) -> None:
        for item_id in item_ids:
            session.execute(
                "INSERT INTO plan_entity_curriculum_items(entity_type, entity_id, curriculum_item_id) VALUES (?, ?, ?)",
                (entity_type, entity_id, item_id),
            )

    @staticmethod
    def _entity_curriculum_items(session: DatabaseSession, entity_type: str, entity_id: str) -> list[str]:
        rows = session.fetchall(
            "SELECT curriculum_item_id FROM plan_entity_curriculum_items "
            "WHERE entity_type = ? AND entity_id = ? ORDER BY curriculum_item_id",
            (entity_type, entity_id),
        )
        return [row["curriculum_item_id"] for row in rows]

    @staticmethod
    def _store_entity_sources(
        session: DatabaseSession, entity_type: str, entity_id: str, source_ids: list[str]
    ) -> None:
        for source_id in source_ids:
            session.execute(
                "INSERT INTO plan_entity_sources(entity_type, entity_id, source_document_id) VALUES (?, ?, ?)",
                (entity_type, entity_id, source_id),
            )

    @staticmethod
    def _entity_sources(session: DatabaseSession, entity_type: str, entity_id: str) -> list[str]:
        rows = session.fetchall(
            "SELECT source_document_id FROM plan_entity_sources "
            "WHERE entity_type = ? AND entity_id = ? ORDER BY source_document_id",
            (entity_type, entity_id),
        )
        return [row["source_document_id"] for row in rows]

    @staticmethod
    def _update_fields(session: DatabaseSession, table: str, entity_id: str, updates: Mapping[str, Any]) -> None:
        allowed_tables = {"learning_projects"}
        if table not in allowed_tables:
            raise ValueError("Unsupported update table")
        assignments = ", ".join(f"{field} = ?" for field in updates)
        session.execute(
            f"UPDATE {table} SET {assignments} WHERE id = ?",
            tuple(updates.values()) + (entity_id,),
        )

    @staticmethod
    def _exact_fields(payload: Mapping[str, Any], *, required: set[str], optional: set[str]) -> None:
        actual = set(payload)
        missing = required - actual
        unknown = actual - required - optional
        if missing or unknown:
            raise validation_error("Payload fields do not match the contract")

    @staticmethod
    def _required_text(value: Any, field: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise validation_error(f"{field} must be a nonblank string")
        if len(value) > 65_536:
            raise validation_error(f"{field} exceeds the maximum length")
        return value.strip()

    @staticmethod
    def _optional_text(value: Any) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise validation_error("Optional text value must be a string or null")
        text = value.strip()
        return text or None

    @staticmethod
    def _integer(value: Any, field: str) -> int:
        if isinstance(value, bool) or not isinstance(value, int):
            raise validation_error(f"{field} must be an integer")
        return int(value)

    def _positive_integer(self, value: Any, field: str) -> int:
        integer = self._integer(value, field)
        if integer <= 0:
            raise validation_error(f"{field} must be positive")
        return integer

    def _enum(self, value: Any, field: str, allowed: set[str]) -> str:
        text = self._required_text(value, field)
        if text not in allowed:
            raise validation_error(f"Unknown {field}")
        return text

    def _string_list(self, value: Any, field: str) -> list[str]:
        if not isinstance(value, list):
            raise validation_error(f"{field} must be an array")
        if len(value) > 1_000:
            raise validation_error(f"{field} exceeds the maximum item count")
        result = [self._required_text(item, field) for item in value]
        if len(result) != len(set(result)):
            raise validation_error(f"{field} must not contain duplicates")
        return result

    def _new_id(self) -> str:
        value = self._id_factory()
        return self._required_text(value, "generated_id")

    def _now(self) -> str:
        value = self._clock()
        if value.tzinfo is None:
            raise ValueError("clock must return a timezone-aware datetime")
        return value.astimezone(UTC).isoformat()

    @staticmethod
    def _json(value: Any) -> str:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    @staticmethod
    def _load_json(value: Any) -> Any:
        return json.loads(str(value))
