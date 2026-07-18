from __future__ import annotations

import sqlite3
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
            connection.executescript(
                "BEGIN IMMEDIATE;\n"
                + SQLITE_SCHEMA
                + f"\nINSERT OR IGNORE INTO schema_migrations(version, applied_at) "
                f"VALUES ({SQLITE_SCHEMA_VERSION}, '{applied_at}');\nCOMMIT;"
            )
            connection.execute("PRAGMA journal_mode = WAL")
        except Exception:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise
        finally:
            connection.close()

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
            yield SQLiteSession(connection)
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
