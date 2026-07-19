from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from learnstepper.persistence import SQLiteDatabase

V1_CONVERSATION_SCHEMA = """
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE local_profiles(
    id TEXT PRIMARY KEY,
    singleton_key INTEGER NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    locale TEXT NOT NULL,
    timezone TEXT NOT NULL,
    learning_preferences_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE learning_projects(
    id TEXT PRIMARY KEY,
    local_profile_id TEXT NOT NULL REFERENCES local_profiles(id),
    mode TEXT NOT NULL,
    title TEXT NOT NULL,
    topic TEXT NOT NULL,
    purpose TEXT NOT NULL,
    curriculum_id TEXT,
    current_level TEXT NOT NULL,
    target_level TEXT NOT NULL,
    target_date TEXT,
    preferred_session_minutes INTEGER NOT NULL,
    constraints_json TEXT NOT NULL,
    status TEXT NOT NULL,
    archived_from_status TEXT,
    codex_thread_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE TABLE learning_sessions(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES learning_projects(id) ON DELETE CASCADE,
    lesson_id TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL,
    summary TEXT,
    next_action TEXT,
    active_turn_id TEXT
);
CREATE TABLE messages(
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
    codex_thread_id TEXT,
    codex_turn_id TEXT,
    codex_item_id TEXT,
    role TEXT NOT NULL,
    item_type TEXT NOT NULL,
    content TEXT NOT NULL,
    source_document_ids_json TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(session_id, sequence)
);
CREATE TABLE notes(
    id TEXT PRIMARY KEY,
    local_profile_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    lesson_id TEXT,
    concept_id TEXT,
    content TEXT NOT NULL,
    source_document_ids_json TEXT NOT NULL,
    curriculum_item_ids_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE bookmarks(
    id TEXT PRIMARY KEY,
    local_profile_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    lesson_id TEXT,
    concept_id TEXT,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    note TEXT,
    source_document_ids_json TEXT NOT NULL,
    curriculum_item_ids_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""


class V1MigrationContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        self.path = Path(self.tempdir.name) / "legacy.sqlite3"

    def create_v1_database(
        self,
        *,
        duplicate_remote_thread: bool = False,
        ambiguous_project_thread_owner: bool = False,
    ) -> None:
        connection = sqlite3.connect(self.path)
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(V1_CONVERSATION_SCHEMA)
        connection.execute("INSERT INTO schema_migrations VALUES (1, 'v1')")
        connection.execute(
            "INSERT INTO local_profiles"
            "(id, singleton_key, display_name, locale, timezone, created_at, updated_at) "
            "VALUES ('profile', 1, 'Learner', 'ja-JP', 'UTC', 't0', 't0')"
        )
        connection.execute(
            "INSERT INTO learning_projects"
            "(id, local_profile_id, mode, title, topic, purpose, current_level, target_level, "
            "preferred_session_minutes, constraints_json, status, codex_thread_id, created_at, updated_at) "
            "VALUES ('project', 'profile', 'free_topic', 'Title', 'Topic', 'Learn', 'new', 'advanced', "
            "30, '{}', 'active', 'remote-thread-project', 't0', 't0')"
        )
        session_ids = (
            ("session-a", "session-b") if duplicate_remote_thread or ambiguous_project_thread_owner else ("session-a",)
        )
        for index, session_id in enumerate(session_ids):
            connection.execute(
                "INSERT INTO learning_sessions(id, project_id, started_at, status) VALUES (?, 'project', ?, 'active')",
                (session_id, f"t{index + 1}"),
            )
            if ambiguous_project_thread_owner:
                continue
            connection.execute(
                "INSERT INTO messages"
                "(id, session_id, codex_thread_id, codex_turn_id, codex_item_id, role, item_type, content, "
                "source_document_ids_json, sequence, status, created_at) "
                "VALUES (?, ?, 'remote-thread-project', ?, ?, 'assistant', 'agentMessage', ?, '[]', 1, "
                "'completed', ?)",
                (
                    f"message-{index}",
                    session_id,
                    f"remote-turn-{index}",
                    f"remote-item-{index}",
                    f"answer-{index}",
                    f"t{index + 1}",
                ),
            )
        connection.commit()
        connection.close()

    def test_v1_conversation_rows_are_backfilled_into_owned_thread_turn_item_hierarchy(self) -> None:
        self.create_v1_database()

        SQLiteDatabase(self.path).initialize()

        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        session = connection.execute("SELECT active_thread_id FROM learning_sessions WHERE id = 'session-a'").fetchone()
        thread = connection.execute("SELECT * FROM codex_threads WHERE session_id = 'session-a'").fetchone()
        turn = connection.execute("SELECT * FROM codex_turns WHERE session_id = 'session-a'").fetchone()
        message = connection.execute("SELECT thread_id, turn_id FROM messages WHERE id = 'message-0'").fetchone()
        self.assertIsNotNone(thread)
        self.assertIsNotNone(turn)
        self.assertEqual("remote-thread-project", thread["codex_thread_id"])
        self.assertEqual(thread["id"], session["active_thread_id"])
        self.assertEqual((thread["id"], turn["id"]), (message["thread_id"], message["turn_id"]))
        self.assertEqual([], connection.execute("PRAGMA foreign_key_check").fetchall())
        self.assertEqual(
            [1, 2],
            [row[0] for row in connection.execute("SELECT version FROM schema_migrations ORDER BY version")],
        )
        connection.close()

    def test_v1_duplicate_remote_thread_ownership_aborts_v2_migration(self) -> None:
        self.create_v1_database(duplicate_remote_thread=True)

        with self.assertRaisesRegex(RuntimeError, "multiple learning sessions"):
            SQLiteDatabase(self.path).initialize()

        connection = sqlite3.connect(self.path)
        versions = connection.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
        self.assertEqual([(1,)], versions)
        self.assertEqual(0, connection.execute("SELECT COUNT(*) FROM codex_threads").fetchone()[0])
        connection.close()

    def test_v1_ambiguous_project_thread_owner_aborts_v2_migration(self) -> None:
        self.create_v1_database(ambiguous_project_thread_owner=True)

        with self.assertRaisesRegex(RuntimeError, "cannot be assigned to one learning session"):
            SQLiteDatabase(self.path).initialize()

        connection = sqlite3.connect(self.path)
        versions = connection.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
        self.assertEqual([(1,)], versions)
        self.assertEqual(0, connection.execute("SELECT COUNT(*) FROM codex_threads").fetchone()[0])
        connection.close()


if __name__ == "__main__":
    unittest.main()
