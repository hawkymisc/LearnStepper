from __future__ import annotations

import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from learnstepper.core import ApplicationCore, AttainmentPolicy
from learnstepper.errors import ApplicationError
from learnstepper.persistence import Database, SQLiteDatabase

ROOT = Path(__file__).resolve().parents[1]
CURRICULA_DIR = ROOT / "curricula" / "structured"
NOW = datetime(2026, 7, 18, 6, 0, tzinfo=UTC)


class BackendTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        self.database_path = Path(self.tempdir.name) / "learnstepper.sqlite3"
        self.database = SQLiteDatabase(self.database_path)
        self.core = ApplicationCore(
            database=self.database,
            curricula_dir=CURRICULA_DIR,
            attainment_policy=AttainmentPolicy(minimum_score=0.8),
            clock=lambda: NOW,
        )
        self.core.initialize()

    def command(self, name: str, payload: dict, request_id: str) -> dict:
        return self.core.command(name=name, payload=payload, request_id=request_id)

    def query(self, name: str, payload: dict | None = None) -> dict:
        return self.core.query(name=name, payload=payload or {})

    def assert_error(self, code: str, callback) -> ApplicationError:
        with self.assertRaises(ApplicationError) as raised:
            callback()
        self.assertEqual(code, raised.exception.code)
        return raised.exception

    def create_profile(self) -> dict:
        return self.command(
            "profile.update",
            {
                "display_name": "Learner",
                "locale": "ja-JP",
                "timezone": "Asia/Tokyo",
            },
            "profile-1",
        )

    def create_project(self, **overrides) -> dict:
        self.create_profile()
        request_id = overrides.pop("request_id", "project-1")
        payload = {
            "mode": "curriculum",
            "title": "New York mathematics",
            "topic": "Mathematics",
            "purpose": "Master grade-level mathematics",
            "curriculum_id": "us-ny:curriculum",
            "current_level": "beginner",
            "target_level": "intermediate",
            "target_date": "2026-12-31",
            "preferred_session_minutes": 30,
            "constraints": {
                "prerequisites": [],
                "uses": ["school"],
                "exclusions": [],
            },
        }
        payload.update(overrides)
        return self.command("project.create", payload, request_id)

    @staticmethod
    def revision_payload(project_id: str, objective: dict, **changes) -> dict:
        current = objective["current_version"]
        payload = {
            "project_id": project_id,
            "objective_id": objective["id"],
            "scope": current["scope"],
            "plan_id": current["plan_id"],
            "module_id": current["module_id"],
            "lesson_id": current["lesson_id"],
            "goal_type": current["goal_type"],
            "statement": current["statement"],
            "target": current["target"],
            "conditions": current["conditions"],
            "success_criteria": current["success_criteria"],
            "evidence_method": current["evidence_method"],
            "curriculum_item_ids": current["curriculum_item_ids"],
            "curriculum_objective_ids": current["curriculum_objective_ids"],
            "source_document_ids": current["source_document_ids"],
            "display_order": current["display_order"],
        }
        payload.update(changes)
        return payload

    def create_plan(self, project_id: str) -> dict:
        return self.command(
            "plan.update",
            {
                "project_id": project_id,
                "generation_reason": "manual",
                "concepts": [
                    {
                        "key": "counting",
                        "name": "Counting",
                        "description": "Counting and cardinality",
                        "importance": 1.0,
                        "curriculum_item_ids": ["us-ny:P-8/CC"],
                        "source_document_ids": ["ny-next-generation-math-2017"],
                        "prerequisite_keys": [],
                    }
                ],
                "modules": [
                    {
                        "title": "Numbers",
                        "description": "Number foundations",
                        "estimated_minutes": 60,
                        "curriculum_item_ids": ["us-ny:P-8"],
                        "source_document_ids": ["ny-next-generation-math-2017"],
                        "lessons": [
                            {
                                "title": "Counting",
                                "description": "Count and compare",
                                "estimated_minutes": 30,
                                "curriculum_item_ids": ["us-ny:P-8/CC"],
                                "source_document_ids": ["ny-next-generation-math-2017"],
                            }
                        ],
                    }
                ],
            },
            "plan-1",
        )

    def create_objective(
        self,
        project_id: str,
        *,
        plan_id: str | None = None,
        module_id: str | None = None,
        lesson_id: str | None = None,
        scope: str = "project",
        goal_type: str = "can_do",
        request_id: str = "objective-1",
    ) -> dict:
        return self.command(
            "learningObjective.update",
            {
                "project_id": project_id,
                "scope": scope,
                "plan_id": plan_id,
                "module_id": module_id,
                "lesson_id": lesson_id,
                "goal_type": goal_type,
                "statement": "Explain and solve a counting problem"
                if goal_type == "know"
                else "Solve a counting problem",
                "target": "Counting within 100",
                "conditions": "Given ten grade-level questions",
                "success_criteria": "At least eight correct answers",
                "evidence_method": "Explain the counting strategy and distinguish alternatives"
                if goal_type == "know"
                else "Submit answers to a scored practice assessment",
                "curriculum_item_ids": ["us-ny:P-8/CC"],
                "curriculum_objective_ids": [],
                "source_document_ids": ["ny-next-generation-math-2017"],
            },
            request_id,
        )


class PersistenceAbstractionTest(BackendTestCase):
    def test_sqlite_implements_database_port_and_schema_has_no_credentials(self) -> None:
        self.assertIsInstance(self.database, Database)
        table_names = self.database.inspect_table_names()
        self.assertIn("learning_projects", table_names)
        self.assertIn("learning_objective_versions", table_names)
        all_columns = {
            f"{table}.{column}" for table in table_names for column in self.database.inspect_column_names(table)
        }
        forbidden = ("access_token", "refresh_token", "api_key", "credential")
        self.assertFalse([column for column in all_columns if any(term in column for term in forbidden)])

    def test_state_survives_a_new_core_and_connection(self) -> None:
        self.create_profile()
        first = self.create_project()
        restarted = ApplicationCore(
            database=SQLiteDatabase(self.database_path),
            curricula_dir=CURRICULA_DIR,
            attainment_policy=AttainmentPolicy(minimum_score=0.8),
            clock=lambda: NOW,
        )
        restarted.initialize()
        self.assertEqual(first["id"], restarted.query(name="project.get", payload={"id": first["id"]})["id"])


class CurriculumContractTest(BackendTestCase):
    def test_import_exposes_exactly_seven_profiles_and_excludes_uae(self) -> None:
        profiles = self.query("curriculumProfile.list")["items"]
        self.assertEqual(
            {"jp-national", "us-dc", "us-ny", "us-ca", "de-be", "de-hh", "de-by"},
            {profile["id"] for profile in profiles},
        )
        dc = self.query("curriculumProfile.get", {"id": "us-dc"})
        self.assertEqual("federal_district", dc["jurisdiction_type"])
        self.assert_error("NOT_FOUND", lambda: self.query("curriculumProfile.get", {"id": "ae-national"}))

    def test_curriculum_hierarchy_and_source_provenance_are_queryable(self) -> None:
        curricula = self.query("curriculum.list", {"profile_id": "us-ny"})["items"]
        self.assertEqual(1, len(curricula))
        items = self.query("curriculum.items", {"curriculum_id": curricula[0]["id"]})["items"]
        counting = next(item for item in items if item["id"] == "us-ny:P-8/CC")
        self.assertEqual("us-ny:P-8", counting["parent_id"])
        source = self.query("source.get", {"id": "ny-next-generation-math-2017"})
        self.assertTrue(source["url"].startswith("https://"))
        self.assertEqual("official_primary", source["trust_level"])


class ProfileAndProjectContractTest(BackendTestCase):
    def test_profile_update_rejects_unknown_fields_and_tokens(self) -> None:
        self.assert_error(
            "VALIDATION_ERROR",
            lambda: self.command(
                "profile.update",
                {
                    "display_name": "Learner",
                    "locale": "ja-JP",
                    "timezone": "Asia/Tokyo",
                    "access_token": "must-not-be-stored",
                },
                "bad-profile",
            ),
        )

    def test_project_create_is_idempotent_and_request_reuse_is_rejected(self) -> None:
        self.create_profile()
        payload = {
            "mode": "free_topic",
            "title": "Statistics",
            "topic": "Statistics",
            "purpose": "Understand confidence intervals",
            "curriculum_id": None,
            "current_level": "beginner",
            "target_level": "intermediate",
            "target_date": None,
            "preferred_session_minutes": 25,
            "constraints": {"prerequisites": [], "uses": [], "exclusions": []},
        }
        first = self.command("project.create", payload, "same-request")
        second = self.command("project.create", payload, "same-request")
        self.assertEqual(first, second)
        changed = dict(payload, title="Different")
        self.assert_error(
            "IDEMPOTENCY_CONFLICT",
            lambda: self.command("project.create", changed, "same-request"),
        )
        self.assertEqual(1, len(self.query("project.list")["items"]))

    def test_project_lifecycle_separates_archive_restore_and_delete(self) -> None:
        project = self.create_project()
        plan = self.create_plan(project["id"])
        self.create_objective(
            project["id"],
            plan_id=plan["id"],
            module_id=plan["modules"][0]["id"],
            lesson_id=plan["modules"][0]["lessons"][0]["id"],
            scope="lesson",
        )
        archived = self.command("project.archive", {"id": project["id"]}, "archive-1")
        self.assertEqual("archived", archived["status"])
        self.assertEqual([], self.query("project.list")["items"])
        restored = self.command("project.restore", {"id": project["id"]}, "restore-1")
        self.assertEqual("active", restored["status"])
        self.command("project.delete", {"id": project["id"]}, "delete-1")
        self.assert_error("NOT_FOUND", lambda: self.query("project.get", {"id": project["id"]}))
        self.assert_error(
            "INVALID_STATE_TRANSITION",
            lambda: self.command("project.restore", {"id": project["id"]}, "restore-2"),
        )
        with self.database.read() as session:
            self.assertIsNone(session.fetchone("SELECT id FROM learning_projects WHERE id = ?", (project["id"],)))
            tombstone = session.fetchone(
                "SELECT project_id, deleted_at FROM deleted_project_tombstones WHERE project_id = ?",
                (project["id"],),
            )
            self.assertIsNotNone(tombstone)
            self.assertIsNone(session.fetchone("SELECT id FROM learning_plans WHERE project_id = ?", (project["id"],)))
            self.assertIsNone(
                session.fetchone("SELECT id FROM learning_objectives WHERE project_id = ?", (project["id"],))
            )


class PlanAndObjectiveContractTest(BackendTestCase):
    def test_plan_rejects_cross_jurisdiction_items_without_partial_save(self) -> None:
        project = self.create_project()
        self.assert_error(
            "CURRICULUM_JURISDICTION_MISMATCH",
            lambda: self.command(
                "plan.update",
                {
                    "project_id": project["id"],
                    "generation_reason": "manual",
                    "concepts": [],
                    "modules": [
                        {
                            "title": "Mixed",
                            "description": "Invalid mixed plan",
                            "estimated_minutes": 30,
                            "curriculum_item_ids": ["us-ca:CC-DATA"],
                            "source_document_ids": [],
                            "lessons": [],
                        }
                    ],
                },
                "mixed-plan",
            ),
        )
        self.assertIsNone(self.query("plan.getCurrent", {"project_id": project["id"]})["plan"])

    def test_plan_and_lesson_keep_primary_source_provenance(self) -> None:
        project = self.create_project()
        plan = self.create_plan(project["id"])
        self.assertEqual(["ny-next-generation-math-2017"], plan["modules"][0]["source_document_ids"])
        self.assertEqual(
            ["ny-next-generation-math-2017"],
            plan["modules"][0]["lessons"][0]["source_document_ids"],
        )
        self.assertEqual("Counting", plan["concepts"][0]["name"])
        self.assertEqual(["us-ny:P-8/CC"], plan["concepts"][0]["curriculum_item_ids"])

    def test_unknown_concept_prerequisite_rolls_back_plan(self) -> None:
        project = self.create_project()
        self.assert_error(
            "VALIDATION_ERROR",
            lambda: self.command(
                "plan.update",
                {
                    "project_id": project["id"],
                    "generation_reason": "manual",
                    "concepts": [
                        {
                            "key": "advanced",
                            "name": "Advanced",
                            "description": "Advanced concept",
                            "importance": 0.5,
                            "curriculum_item_ids": ["us-ny:P-8/CC"],
                            "source_document_ids": ["ny-next-generation-math-2017"],
                            "prerequisite_keys": ["missing"],
                        }
                    ],
                    "modules": [],
                },
                "invalid-concepts",
            ),
        )
        self.assertIsNone(self.query("plan.getCurrent", {"project_id": project["id"]})["plan"])

    def test_objective_scope_goal_type_and_nonblank_fields_are_validated(self) -> None:
        project = self.create_project()
        plan = self.create_plan(project["id"])
        module = plan["modules"][0]
        lesson = module["lessons"][0]
        valid = self.create_objective(
            project["id"],
            plan_id=plan["id"],
            module_id=module["id"],
            lesson_id=lesson["id"],
            scope="lesson",
            goal_type="know",
        )
        self.assertEqual("know", valid["current_version"]["goal_type"])
        self.assert_error(
            "VALIDATION_ERROR",
            lambda: self.create_objective(
                project["id"],
                plan_id=plan["id"],
                module_id=module["id"],
                lesson_id=lesson["id"],
                scope="module",
                request_id="bad-scope",
            ),
        )
        payload = dict(valid["current_version"])
        payload.pop("id")
        payload.pop("version_number")
        payload["project_id"] = project["id"]
        payload["objective_id"] = valid["id"]
        payload["statement"] = "   "
        self.assert_error(
            "VALIDATION_ERROR",
            lambda: self.command("learningObjective.update", payload, "blank-objective"),
        )

    def test_objective_updates_append_a_version_and_invalidate_old_attainment(self) -> None:
        project = self.create_project()
        objective = self.create_objective(project["id"])
        payload = self.revision_payload(project["id"], objective, success_criteria="At least nine correct answers")
        updated = self.command("learningObjective.update", payload, "objective-update")
        self.assertEqual(2, updated["current_version"]["version_number"])
        fetched = self.query("learningObjective.get", {"id": objective["id"]})
        self.assertEqual(2, len(fetched["versions"]))
        self.assertEqual("At least eight correct answers", fetched["versions"][0]["success_criteria"])
        self.assertEqual("not_started", fetched["attainment"]["status"])


class AssessmentAndAttainmentContractTest(BackendTestCase):
    def test_self_assessment_is_saved_but_cannot_achieve_an_objective(self) -> None:
        project = self.create_project()
        objective = self.create_objective(project["id"])
        version_id = objective["current_version"]["id"]
        assessment = self.core.record_assessment(
            project_id=project["id"],
            assessment_type="practice",
            objective_version_ids=[version_id],
            rubric_version="rubric-1",
            curriculum_item_ids=["us-ny:P-8/CC"],
            source_document_ids=["ny-next-generation-math-2017"],
        )
        result = self.command(
            "assessment.submitAttempt",
            {
                "assessment_id": assessment["id"],
                "answer": "I understand it",
                "score": 1.0,
                "evaluation": "Self assessment",
                "rubric": "Self report",
                "hint_count": 0,
                "grading_status": "graded",
                "evidence": [{"objective_version_id": version_id, "evidence_type": "self_assessment"}],
            },
            "self-attempt",
        )
        self.assertFalse(result["evidence"][0]["accepted_for_attainment"])
        self.assertEqual("SELF_REPORT_ONLY", result["evidence"][0]["rejection_reason"])
        attainment = self.query("learningObjective.attainment.get", {"id": objective["id"]})
        self.assertNotEqual("achieved", attainment["status"])

    def test_verified_scored_evidence_achieves_current_version_only(self) -> None:
        project = self.create_project()
        objective = self.create_objective(project["id"])
        version_id = objective["current_version"]["id"]
        assessment = self.core.record_assessment(
            project_id=project["id"],
            assessment_type="practice",
            objective_version_ids=[version_id],
            rubric_version="rubric-1",
            curriculum_item_ids=["us-ny:P-8/CC"],
            source_document_ids=["ny-next-generation-math-2017"],
        )
        self.assertEqual(["us-ny:P-8/CC"], assessment["curriculum_item_ids"])
        self.assertEqual(["ny-next-generation-math-2017"], assessment["source_document_ids"])
        self.command(
            "assessment.submitAttempt",
            {
                "assessment_id": assessment["id"],
                "answer": "42",
                "score": 0.9,
                "evaluation": "Meets the rubric",
                "rubric": "Eight of ten correct",
                "hint_count": 0,
                "grading_status": "graded",
                "evidence": [{"objective_version_id": version_id, "evidence_type": "practice"}],
            },
            "scored-attempt",
        )
        attainment = self.query("learningObjective.attainment.get", {"id": objective["id"]})
        self.assertEqual("achieved", attainment["status"])
        self.assertEqual(version_id, attainment["learning_objective_version_id"])

        current_objective = self.query("learningObjective.get", {"id": objective["id"]})
        payload = self.revision_payload(project["id"], current_objective, conditions="Given a new set of questions")
        updated = self.command("learningObjective.update", payload, "revise-after-evidence")
        self.assertEqual(
            "not_started",
            self.query("learningObjective.attainment.get", {"id": objective["id"]})["status"],
        )
        self.assert_error(
            "VALIDATION_ERROR",
            lambda: self.command(
                "assessment.submitAttempt",
                {
                    "assessment_id": assessment["id"],
                    "answer": "new answer",
                    "score": 1.0,
                    "evaluation": "wrong version",
                    "rubric": "rubric-1",
                    "hint_count": 0,
                    "grading_status": "graded",
                    "evidence": [
                        {
                            "objective_version_id": updated["current_version"]["id"],
                            "evidence_type": "practice",
                        }
                    ],
                },
                "wrong-version-attempt",
            ),
        )

    def test_invalid_evidence_batch_rolls_back_the_whole_attempt(self) -> None:
        project = self.create_project()
        objective = self.create_objective(project["id"])
        version_id = objective["current_version"]["id"]
        assessment = self.core.record_assessment(
            project_id=project["id"],
            assessment_type="practice",
            objective_version_ids=[version_id],
            rubric_version="rubric-1",
            curriculum_item_ids=["us-ny:P-8/CC"],
            source_document_ids=["ny-next-generation-math-2017"],
        )
        self.assert_error(
            "VALIDATION_ERROR",
            lambda: self.command(
                "assessment.submitAttempt",
                {
                    "assessment_id": assessment["id"],
                    "answer": "answer",
                    "score": 1.0,
                    "evaluation": "mixed evidence batch",
                    "rubric": "rubric-1",
                    "hint_count": 0,
                    "grading_status": "graded",
                    "evidence": [
                        {"objective_version_id": version_id, "evidence_type": "practice"},
                        {"objective_version_id": "unknown-version", "evidence_type": "practice"},
                    ],
                },
                "invalid-batch",
            ),
        )
        with self.database.read() as session:
            self.assertEqual(0, session.fetchone("SELECT COUNT(*) AS count FROM assessment_attempts")["count"])
            self.assertEqual(0, session.fetchone("SELECT COUNT(*) AS count FROM objective_evidence")["count"])


class RemediationContractTest(BackendTestCase):
    def test_remediation_has_explicit_proposed_active_completed_transitions(self) -> None:
        project = self.create_project()
        plan = self.create_plan(project["id"])
        lesson_id = plan["modules"][0]["lessons"][0]["id"]
        remediation = self.core.record_remediation_path(
            project_id=project["id"],
            origin_lesson_id=lesson_id,
            remediation_lesson_ids=[lesson_id],
            return_conditions="Complete the counting check",
        )
        self.assertEqual("proposed", remediation["status"])
        accepted = self.command("remediation.accept", {"id": remediation["id"]}, "remediation-1")
        self.assertEqual("active", accepted["status"])
        active = self.query("remediation.getActive", {"project_id": project["id"]})
        self.assertEqual(remediation["id"], active["remediation"]["id"])
        completed = self.command("remediation.complete", {"id": remediation["id"]}, "remediation-2")
        self.assertEqual("completed", completed["status"])
        self.assertIsNone(self.query("remediation.getActive", {"project_id": project["id"]})["remediation"])


class MasteryContractTest(BackendTestCase):
    def test_confirmed_concept_mastery_is_persisted_and_queryable(self) -> None:
        project = self.create_project()
        plan = self.create_plan(project["id"])
        concept_id = plan["concepts"][0]["id"]
        result = self.core.record_concept_mastery(
            project_id=project["id"],
            concept_id=concept_id,
            status="needs_review",
            mastery_score=0.45,
            confidence=0.8,
            next_review_at="2026-07-25T06:00:00+00:00",
        )
        self.assertEqual("needs_review", result["status"])
        mastery = self.query("mastery.get", {"project_id": project["id"]})["items"]
        self.assertEqual(1, len(mastery))
        self.assertEqual(0.45, mastery[0]["mastery_score"])

    def test_module_and_lesson_progress_are_updated_atomically(self) -> None:
        project = self.create_project()
        plan = self.create_plan(project["id"])
        module_id = plan["modules"][0]["id"]
        lesson_id = plan["modules"][0]["lessons"][0]["id"]
        result = self.core.record_plan_progress(
            project_id=project["id"],
            module_statuses={module_id: "learning"},
            lesson_statuses={lesson_id: "mastered"},
        )
        self.assertEqual("learning", result["modules"][0]["status"])
        self.assertEqual("mastered", result["modules"][0]["lessons"][0]["status"])
        progress = self.query("progress.get", {"project_id": project["id"]})
        self.assertEqual(1.0, progress["progress_rate"])


class SessionNotesAndHistoryContractTest(BackendTestCase):
    def test_confirmed_history_notes_and_bookmarks_survive_restart(self) -> None:
        project = self.create_project()
        session = self.command("session.start", {"project_id": project["id"], "lesson_id": None}, "session-1")
        self.core.record_confirmed_message(
            session_id=session["id"],
            role="assistant",
            item_type="agent_message",
            content="Confirmed answer",
            source_document_ids=["ny-next-generation-math-2017"],
        )
        self.command(
            "session.complete",
            {"id": session["id"], "summary": "Summary", "next_action": "Continue"},
            "session-complete",
        )
        note = self.command(
            "note.create",
            {
                "project_id": project["id"],
                "lesson_id": None,
                "concept_id": None,
                "content": "My note",
                "source_document_ids": ["ny-next-generation-math-2017"],
                "curriculum_item_ids": ["us-ny:P-8/CC"],
            },
            "note-1",
        )
        message_id = self.query("history.getSession", {"id": session["id"]})["messages"][0]["id"]
        bookmark = self.command(
            "bookmark.create",
            {
                "project_id": project["id"],
                "lesson_id": None,
                "concept_id": None,
                "message_id": message_id,
                "note": "Remember this",
                "source_document_ids": ["ny-next-generation-math-2017"],
                "curriculum_item_ids": ["us-ny:P-8/CC"],
            },
            "bookmark-1",
        )
        self.assertEqual(note["id"], self.query("note.list", {"project_id": project["id"]})["items"][0]["id"])
        self.assertEqual(
            bookmark["id"],
            self.query("bookmark.list", {"project_id": project["id"]})["items"][0]["id"],
        )
        history = self.query("history.getSession", {"id": session["id"]})
        self.assertEqual("Confirmed answer", history["messages"][0]["content"])
        self.assertEqual("completed", history["status"])

    def test_cross_project_note_relationship_is_rejected(self) -> None:
        first = self.create_project()
        second = self.create_project(title="Second", request_id="project-2")
        plan = self.create_plan(first["id"])
        lesson_id = plan["modules"][0]["lessons"][0]["id"]
        self.assert_error(
            "VALIDATION_ERROR",
            lambda: self.command(
                "note.create",
                {
                    "project_id": second["id"],
                    "lesson_id": lesson_id,
                    "concept_id": None,
                    "content": "Cross-project note",
                    "source_document_ids": [],
                    "curriculum_item_ids": [],
                },
                "cross-note",
            ),
        )


if __name__ == "__main__":
    unittest.main()
