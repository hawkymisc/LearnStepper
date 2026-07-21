# Backend Design

Status: Approved for the local core and Codex conversation gateway scope on 2026-07-19.

## 1. Requirement interpretation

The backend is the local, framework-independent portion of the standalone desktop application described by the requirements. It includes Application Core persistence and domain rules, but it is not an external application server and does not expose a REST API.

The observable success condition is that a caller can use typed local commands and queries to persist and recover the specified learning state, while invalid ownership, jurisdiction, objective, evidence, and state-transition requests are rejected atomically with the documented error codes.

Authoritative requirements:

- `ai-learning-app-requirements/03_機能要件.md`
- `ai-learning-app-requirements/04_LLM制御とCodex_App_Server連携.md`
- `ai-learning-app-requirements/05_システム構成とデータモデル.md`
- `ai-learning-app-requirements/06_API.md`
- `ai-learning-app-requirements/07_非機能要件.md`
- `ai-learning-app-requirements/08_品質評価・受入基準・リスク.md`
- `ai-learning-app-requirements/09_ロードマップと未決事項.md`

## 2. Classification and scope boundary

This is a design problem rather than a local implementation fix. It combines persistent state, state transitions, IPC contracts, asynchronous LLM and grounding I/O, security boundaries, and failure recovery.

The implemented boundary is:

```text
Desktop Renderer
       |
       | typed command/query/event contract
       v
Application Core
  |-- validation and ownership checks
  |-- idempotency and state transitions
  |-- learning domain services
  `-- Database port
       `-- SQLite adapter (MVP)
       |
       +-- Codex Gateway (injected stdio App Server adapter)
       +-- ports for Grounding Gateway (deferred adapter)
       `-- ports for credential storage (deferred adapter)
```

The core must not import a desktop framework, open a network listener, access an OS credential store directly, or depend on a live Codex process. External integrations are represented by explicit ports only after their contracts are decided.

## 3. Technology decision

Language: Python 3.11 or newer.

Reasons:

1. The repository already uses Python tests and PyYAML for curriculum fixtures.
2. Python's standard `sqlite3` library supports a dependency-light transactional core.
3. The framework-independent package is embedded by the macOS development host through an Electron preload Bridge and a Python JSONL sidecar. This adapter does not leak desktop imports into the Core.

This is a reversible repository-local storage decision. The focused MVP host is Electron on macOS arm64. Packaging is a
DMG with a bundled Python sidecar and a required external Codex CLI 0.144.5; the artifact uses verified ad-hoc deep signing.
Developer ID signing, notarization, and automatic updates remain Future Updates.
SQLite is the MVP adapter. `Database` and `DatabaseSession` protocols isolate connection,
transaction, row mapping, and inspection behavior so a future DuckDB adapter can reuse the
Application Core. IDs are generated in the application as UUID strings; domain code does not
depend on SQLite row IDs. SQLite PRAGMAs and DDL remain inside `learnstepper.persistence`.

## 4. Responsibility boundaries

### 4.1 Application Core

- Validates all command input and rejects unknown fields.
- Enforces object ownership and allowed state transitions.
- Executes each command in one database-port transaction.
- Maintains request-ID idempotency for commands that can duplicate work.
- Produces application error envelopes without exposing internal exceptions or secrets.
- Is the only component allowed to calculate objective attainment.

### 4.2 Curriculum service

- Imports included curriculum profiles from `curricula/structured/*.yaml`.
- Excludes records whose `mvp_scope.status` is not `included` from MVP queries.
- Preserves jurisdiction type, authority, source metadata, and the available item hierarchy.
- Rejects cross-profile relationships with `CURRICULUM_JURISDICTION_MISMATCH`.

### 4.3 Learning project and plan service

- Persists free-topic and curriculum projects.
- Enforces project lifecycle transitions separately from deletion.
- Persists structured plans, modules, lessons, acyclic concept prerequisites, source mappings,
  progress states, and remediation paths.
- Does not generate plans itself until an LLM adapter and model contract are approved.

### 4.4 Objective and assessment service

- Stores objective definitions as append-only versions.
- Enforces `project`, `module`, and `lesson` scope/reference combinations.
- Accepts exactly one `goal_type`: `can_do` or `know`.
- Requires nonblank statement, target, conditions, success criteria, and evidence method.
- Preserves assessments against the immutable objective version used to create them.
- Rejects evidence for another project, learner, objective, or objective version.
- Stores self-assessment but never accepts it alone as attainment evidence.
- Invalidates the previous attainment result when an objective definition or governing evidence changes.

### 4.5 Session, conversation, history, notes, and bookmarks

- Persists confirmed session and message history independently of Codex-native history.
- Separates streaming deltas from confirmed `item.completed` content.
- Preserves unfinished input on interruption or failure.
- Models Project 1-* LearningSession 1-* CodexThread 1-* CodexTurn 1-* confirmed item.
- Resumes the same thread without changing the LearningSession ID.
- Reconstructs item-boundary forks from confirmed history and activates the child thread.
- Reconciles by Codex IDs and rejects divergent content without overwriting it.
- Enforces ownership for notes and bookmarks and removes deleted references from normal queries.

Detailed use cases and state transitions are specified in `docs/conversation-data-design.md`.

## 5. Update triggers

| Area | Trigger | Transactional result |
|---|---|---|
| Curriculum | initial import or explicit refresh | replace one source revision only after full validation |
| Project | create/update/archive/restore/delete command | validate transition and update all affected local records atomically |
| Objective | create/update command | append version, move current pointer, invalidate prior attainment |
| Assessment | attempt submission | persist attempt, evaluate evidence eligibility, recalculate attainment |
| Session | start/resume/complete/interruption | persist session, active thread, turn state, and confirmed items |
| Fork | completed item selected | rebuild history through the item and activate the child |
| Reconciliation | startup/resume | import missing completed items or fail on divergent content |
| Idempotency | duplicate request ID | return stored result or current operation without repeating side effects |

## 6. Blocking and asynchronous factors

Local database work remains synchronous and short. Codex, network retrieval, browser authentication,
and OS credential operations must run outside a database transaction. Their completion is applied
through a new command carrying the original request ID. No remote or process I/O is allowed while
holding a write transaction.

## 7. Error contract

Every expected failure is converted to:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "User-safe message",
  "retryable": false,
  "retry_at": null,
  "request_id": "optional request identifier",
  "details": {}
}
```

Initial stable codes:

- `VALIDATION_ERROR`
- `NOT_FOUND`
- `CONFLICT`
- `INVALID_STATE_TRANSITION`
- `CURRICULUM_JURISDICTION_MISMATCH`
- `IDEMPOTENCY_CONFLICT`
- `OFFLINE`
- `APP_SERVER_UNAVAILABLE`
- `AUTH_REQUIRED`
- `RECONCILIATION_CONFLICT`
- `INTERNAL_ERROR`

Internal exceptions retain their cause in logs but are not returned verbatim to the caller.

## 8. Trade-offs

- A framework-independent core adds adapter work later but prevents unresolved desktop-framework choices from leaking into the domain model.
- Normalized SQLite tables require more migrations than serialized JSON, but they make ownership constraints, provenance, version history, and atomic validation testable.
- Codex provider availability is separate from gateway correctness. Fake-server tests prove the pinned
  stdio contract but are not presented as live-account or Renderer acceptance evidence.
- Objective maximum count and subject-specific rubric thresholds cannot be hard-coded because requirement item 19 explicitly leaves them undecided. The core can accept a required policy object, while production defaults remain blocked.

## 9. Verification result

Automated evidence covers validators, implemented state transitions, SQLite transactions, foreign keys,
append-only objective versions, project deletion, restart recovery, closed IPC envelopes,
jurisdiction isolation, provenance, concept graphs, assessment evidence, and attainment invalidation.
Must requirements and acceptance criteria are classified exactly once by
`docs/requirements-traceability.yaml` and checked by an automated test.

Ruff, strict mypy, the full unittest suite, and coverage are the required local verification commands.

## 10. Alternatives considered

### External REST backend

Rejected. `06_API.md` explicitly states that the MVP has no externally published REST API.

### Desktop-framework-first implementation

Deferred. The framework and target OS are explicitly undecided in roadmap items 1 and 2.

### Codex integration using inferred or floating contracts

Rejected. The implemented gateway is pinned to the committed App Server 0.144.5 generated schema and
uses injected model settings. ChatGPT login, distribution, OS sandboxing, and Grounding remain separate
holds rather than being guessed by the conversation transport.

### Application Core coupled directly to SQLite

Rejected. SQLite remains the MVP implementation, while the storage protocols and application-owned
UUIDs preserve a practical path to DuckDB. A DuckDB adapter will still require its own migration DDL
and compatibility tests; portability is not claimed without those tests.
