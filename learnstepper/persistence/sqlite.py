from __future__ import annotations

import sqlite3
import uuid
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from learnstepper.persistence.contracts import DatabaseSession, Parameters, Row
from learnstepper.persistence.schema import SQLITE_SCHEMA, SQLITE_SCHEMA_VERSION


class SQLiteSession(DatabaseSession):
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection

    def execute(self, statement: str, parameters: Parameters = ()) -> None:
        self._connection.execute(statement, parameters)

    def executemany(self, statement: str, rows: Sequence[Parameters]) -> None:
        self._connection.executemany(statement, rows)

    def fetchone(self, statement: str, parameters: Parameters = ()) -> Row | None:
        row = self._connection.execute(statement, parameters).fetchone()
        return dict(row) if row is not None else None

    def fetchall(self, statement: str, parameters: Parameters = ()) -> list[Row]:
        return [dict(row) for row in self._connection.execute(statement, parameters).fetchall()]


class SQLiteDatabase:
    """SQLite adapter. The Application Core depends only on the Database protocol."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5.0, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = self._connect()
        try:
            applied_at = datetime.now(UTC).isoformat().replace("'", "''")
            connection.executescript("BEGIN IMMEDIATE;\n" + SQLITE_SCHEMA + "\nCOMMIT;")
            connection.execute("BEGIN IMMEDIATE")
            try:
                self._ensure_v2_columns(connection)
                already_v2 = connection.execute(
                    "SELECT 1 FROM schema_migrations WHERE version = ?",
                    (SQLITE_SCHEMA_VERSION,),
                ).fetchone()
                if already_v2 is None:
                    self._backfill_v1_conversations(connection)
                    self._validate_conversation_integrity(connection)
                connection.execute(
                    "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
                    (SQLITE_SCHEMA_VERSION, applied_at),
                )
                connection.execute("COMMIT")
            except Exception:
                if connection.in_transaction:
                    connection.execute("ROLLBACK")
                raise
            connection.execute("PRAGMA journal_mode = WAL")
        except Exception:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise
        finally:
            connection.close()

    @staticmethod
    def _ensure_v2_columns(connection: sqlite3.Connection) -> None:
        """Add nullable v2 columns to databases created by the PR's v1 schema.

        New normalized tables are created by ``SQLITE_SCHEMA``. Nullable legacy-table additions are
        deliberately additive so bookmarks and confirmed message IDs remain stable.
        """
        additions = {
            "plan_modules": {"module_key": "TEXT"},
            "lessons": {"lesson_key": "TEXT"},
            "learning_sessions": {"active_thread_id": "TEXT", "last_resumed_at": "TEXT"},
            "messages": {
                "thread_id": "TEXT REFERENCES codex_threads(id) ON DELETE CASCADE",
                "turn_id": "TEXT REFERENCES codex_turns(id) ON DELETE CASCADE",
                "provider_order": "INTEGER",
            },
            "curriculum_items": {"is_active": "INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))"},
            "source_documents": {"is_active": "INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))"},
        }
        for table, columns in additions.items():
            existing = {str(row[1]) for row in connection.execute(f'PRAGMA table_info("{table}")')}
            for column, definition in columns.items():
                if column not in existing:
                    connection.execute(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {definition}')

    @staticmethod
    def _synthetic_id(kind: str, *parts: object) -> str:
        identity = ":".join(str(part) for part in parts)
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"learnstepper:v1:{kind}:{identity}"))

    @classmethod
    def _backfill_v1_conversations(cls, connection: sqlite3.Connection) -> None:
        """Normalize confirmed v1 message history without inventing remote ownership.

        Remote thread IDs are globally owned by exactly one learning session. Rows without remote
        IDs receive deterministic local Thread/Turn IDs so migration is retry-safe.
        """
        duplicate_thread = connection.execute(
            """
            SELECT codex_thread_id
            FROM messages
            WHERE codex_thread_id IS NOT NULL
            GROUP BY codex_thread_id
            HAVING COUNT(DISTINCT session_id) > 1
            LIMIT 1
            """
        ).fetchone()
        if duplicate_thread is not None:
            raise RuntimeError(f"legacy Codex thread {duplicate_thread[0]!r} belongs to multiple learning sessions")

        project_columns = {str(row[1]) for row in connection.execute('PRAGMA table_info("learning_projects")')}
        has_project_remote_thread = "codex_thread_id" in project_columns
        if has_project_remote_thread:
            ambiguous_project_thread = connection.execute(
                """
                SELECT p.id, p.codex_thread_id
                FROM learning_projects p
                WHERE p.codex_thread_id IS NOT NULL
                  AND (
                      SELECT COUNT(*)
                      FROM learning_sessions s
                      WHERE s.project_id = p.id
                  ) > 1
                  AND NOT EXISTS (
                      SELECT 1
                      FROM learning_sessions s
                      JOIN messages m ON m.session_id = s.id
                      WHERE s.project_id = p.id
                        AND m.codex_thread_id = p.codex_thread_id
                  )
                LIMIT 1
                """
            ).fetchone()
            if ambiguous_project_thread is not None:
                raise RuntimeError(
                    f"legacy Codex thread {ambiguous_project_thread['codex_thread_id']!r} "
                    "cannot be assigned to one learning session"
                )
        sessions = connection.execute(
            "SELECT id, project_id, status, started_at, ended_at FROM learning_sessions ORDER BY started_at, id"
        ).fetchall()

        for session in sessions:
            session_id = str(session["id"])
            project_id = str(session["project_id"])
            messages = connection.execute(
                """
                SELECT id, codex_thread_id, codex_turn_id, codex_item_id, role, content,
                       sequence, status, created_at
                FROM messages
                WHERE session_id = ?
                ORDER BY sequence, id
                """,
                (session_id,),
            ).fetchall()
            remote_thread_ids: list[str | None] = list(
                dict.fromkeys(
                    str(message["codex_thread_id"]) for message in messages if message["codex_thread_id"] is not None
                )
            )
            if has_project_remote_thread:
                project_session_count = connection.execute(
                    "SELECT COUNT(*) FROM learning_sessions WHERE project_id = ?", (project_id,)
                ).fetchone()[0]
                project_remote = connection.execute(
                    "SELECT codex_thread_id FROM learning_projects WHERE id = ?", (project_id,)
                ).fetchone()[0]
                if (
                    project_remote is not None
                    and project_session_count == 1
                    and str(project_remote) not in remote_thread_ids
                ):
                    remote_thread_ids.append(str(project_remote))
            if not remote_thread_ids:
                remote_thread_ids.append(None)

            selected_remote = next(
                (
                    str(message["codex_thread_id"])
                    for message in reversed(messages)
                    if message["codex_thread_id"] is not None
                ),
                remote_thread_ids[0],
            )
            thread_ids: dict[str | None, str] = {}
            for remote_thread_id in remote_thread_ids:
                thread_id = cls._synthetic_id("thread", session_id, remote_thread_id or "local")
                thread_ids[remote_thread_id] = thread_id
                thread_status = (
                    "active"
                    if remote_thread_id == selected_remote
                    and session["status"] in ("starting", "active", "reconciling")
                    else "inactive"
                )
                connection.execute(
                    """
                    INSERT INTO codex_threads(
                        id, session_id, project_id, codex_thread_id, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        thread_id,
                        session_id,
                        project_id,
                        remote_thread_id,
                        thread_status,
                        session["started_at"],
                    ),
                )

            default_thread_id = thread_ids[selected_remote]
            grouped_messages: dict[tuple[str, str], list[sqlite3.Row]] = {}
            for message in messages:
                remote_thread = (
                    str(message["codex_thread_id"]) if message["codex_thread_id"] is not None else selected_remote
                )
                thread_id = thread_ids.get(remote_thread, default_thread_id)
                remote_turn = (
                    str(message["codex_turn_id"])
                    if message["codex_turn_id"] is not None
                    else f"local-item:{message['id']}"
                )
                grouped_messages.setdefault((thread_id, remote_turn), []).append(message)

            seen_remote_items: set[tuple[str, str]] = set()
            for (thread_id, turn_key), turn_messages in grouped_messages.items():
                remote_turn_id = None if turn_key.startswith("local-item:") else turn_key
                turn_id = cls._synthetic_id("turn", thread_id, turn_key)
                statuses = {str(message["status"]) for message in turn_messages}
                turn_status = (
                    "failed" if "failed" in statuses else "interrupted" if "interrupted" in statuses else "completed"
                )
                input_text = next(
                    (str(message["content"]) for message in turn_messages if message["role"] == "user"),
                    "",
                )
                connection.execute(
                    """
                    INSERT INTO codex_turns(
                        id, thread_id, session_id, project_id, codex_turn_id, input_text,
                        status, started_at, completed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        turn_id,
                        thread_id,
                        session_id,
                        project_id,
                        remote_turn_id,
                        input_text,
                        turn_status,
                        turn_messages[0]["created_at"],
                        turn_messages[-1]["created_at"],
                    ),
                )
                for message in turn_messages:
                    remote_item = message["codex_item_id"]
                    if remote_item is not None:
                        ownership = (thread_id, str(remote_item))
                        if ownership in seen_remote_items:
                            raise RuntimeError(f"legacy Codex item {remote_item!r} is duplicated within one thread")
                        seen_remote_items.add(ownership)
                    connection.execute(
                        "UPDATE messages SET thread_id = ?, turn_id = ? WHERE id = ?",
                        (thread_id, turn_id, message["id"]),
                    )

            active_thread_id = (
                default_thread_id if session["status"] in ("starting", "active", "reconciling", "interrupted") else None
            )
            connection.execute(
                "UPDATE learning_sessions SET active_thread_id = ? WHERE id = ?",
                (active_thread_id, session_id),
            )

        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_thread_codex_item_v2
            ON messages(thread_id, codex_item_id)
            WHERE thread_id IS NOT NULL AND codex_item_id IS NOT NULL
            """
        )

    @staticmethod
    def _validate_conversation_integrity(connection: sqlite3.Connection) -> None:
        ownership_error = connection.execute(
            """
            SELECT 1
            FROM messages m
            LEFT JOIN codex_threads th ON th.id = m.thread_id
            LEFT JOIN codex_turns tu ON tu.id = m.turn_id
            WHERE th.id IS NULL OR tu.id IS NULL
               OR m.session_id <> th.session_id
               OR m.session_id <> tu.session_id
               OR tu.thread_id <> th.id
               OR tu.project_id <> th.project_id
            LIMIT 1
            """
        ).fetchone()
        if ownership_error is not None:
            raise RuntimeError("v1 conversation migration produced inconsistent ownership")
        hierarchy_error = connection.execute(
            """
            SELECT 1
            FROM codex_threads th
            LEFT JOIN learning_sessions s ON s.id = th.session_id
            WHERE s.id IS NULL OR th.project_id <> s.project_id
            UNION ALL
            SELECT 1
            FROM codex_turns tu
            LEFT JOIN codex_threads th ON th.id = tu.thread_id
            WHERE th.id IS NULL
               OR tu.session_id <> th.session_id
               OR tu.project_id <> th.project_id
            LIMIT 1
            """
        ).fetchone()
        if hierarchy_error is not None:
            raise RuntimeError("v1 conversation migration produced an inconsistent hierarchy")
        dangling_active_thread = connection.execute(
            """
            SELECT 1
            FROM learning_sessions s
            LEFT JOIN codex_threads th ON th.id = s.active_thread_id
            WHERE s.active_thread_id IS NOT NULL
              AND (th.id IS NULL OR th.session_id <> s.id OR th.project_id <> s.project_id)
            LIMIT 1
            """
        ).fetchone()
        if dangling_active_thread is not None:
            raise RuntimeError("v1 conversation migration produced an invalid active thread")
        foreign_key_error = connection.execute("PRAGMA foreign_key_check").fetchone()
        if foreign_key_error is not None:
            raise RuntimeError(f"v1 conversation migration violated a foreign key: {tuple(foreign_key_error)!r}")

    @contextmanager
    def transaction(self) -> Iterator[DatabaseSession]:
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            yield SQLiteSession(connection)
            connection.execute("COMMIT")
        except Exception:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise
        finally:
            connection.close()

    @contextmanager
    def read(self) -> Iterator[DatabaseSession]:
        connection = self._connect()
        try:
            connection.execute("BEGIN")
            yield SQLiteSession(connection)
            connection.execute("COMMIT")
        except Exception:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise
        finally:
            connection.close()

    def inspect_table_names(self) -> set[str]:
        with self.read() as session:
            rows = session.fetchall("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        return {str(row["name"]) for row in rows}

    def inspect_column_names(self, table: str) -> set[str]:
        if table not in self.inspect_table_names():
            return set()
        connection = self._connect()
        try:
            rows = connection.execute(f'PRAGMA table_info("{table}")').fetchall()
            return {str(row["name"]) for row in rows}
        finally:
            connection.close()
