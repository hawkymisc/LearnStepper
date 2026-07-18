# LearnStepper Application Core

This repository contains the framework-independent local backend for the LearnStepper standalone
desktop application. SQLite is the MVP persistence adapter. The Application Core communicates through
a closed logical IPC contract and does not expose a REST server.

## Implemented scope

- one local learning profile without credential/token columns;
- import and query of the seven included education jurisdictions;
- free-topic and curriculum project lifecycle with idempotent commands;
- versioned plans, modules, lessons, concepts, prerequisite graphs, and source provenance;
- append-only `can_do` / `know` objectives;
- assessments, evidence validation, self-report exclusion, and core-calculated attainment;
- mastery, progress, remediation, confirmed history, notes, and bookmarks;
- atomic jurisdiction and ownership validation;
- hard deletion of project-owned data with a minimal deletion tombstone;
- SQLite behind runtime-checkable storage protocols for future DuckDB support.

The complete hold register is [not-implemented-functionalities.md](not-implemented-functionalities.md).
Must/AC classification is in
[requirements-traceability.yaml](docs/requirements-traceability.yaml).

## Development

```bash
uv run python -m unittest discover -s tests -v
uv run --extra dev ruff check learnstepper tests
uv run --extra dev mypy learnstepper
uv run --extra dev coverage run -m unittest discover -s tests
uv run --extra dev coverage report -m
```

The minimum supported Python version is 3.11. Dependencies and tool versions are locked by `uv.lock`.

## Storage portability

Application code depends on `Database` and `DatabaseSession`, not `sqlite3`. The SQLite adapter owns
PRAGMAs, connection setup, row conversion, and SQLite DDL. Application-generated UUIDs avoid reliance
on SQLite auto-increment behavior. DuckDB is not presented as implemented; adding it requires a
DuckDB-specific adapter, migrations, and the same persistence contract tests.
