from __future__ import annotations

from collections.abc import Mapping, Sequence
from contextlib import AbstractContextManager
from typing import Any, Protocol, runtime_checkable

Parameters = Sequence[Any] | Mapping[str, Any]
Row = dict[str, Any]


@runtime_checkable
class DatabaseSession(Protocol):
    """SQL execution boundary shared by SQLite and future DuckDB adapters."""

    def execute(self, statement: str, parameters: Parameters = ()) -> None: ...

    def executemany(self, statement: str, rows: Sequence[Parameters]) -> None: ...

    def fetchone(self, statement: str, parameters: Parameters = ()) -> Row | None: ...

    def fetchall(self, statement: str, parameters: Parameters = ()) -> list[Row]: ...


@runtime_checkable
class Database(Protocol):
    """Storage port. SQL dialect and connection details stay in an adapter."""

    def initialize(self) -> None: ...

    def transaction(self) -> AbstractContextManager[DatabaseSession]: ...

    def read(self) -> AbstractContextManager[DatabaseSession]: ...

    def inspect_table_names(self) -> set[str]: ...

    def inspect_column_names(self, table: str) -> set[str]: ...
