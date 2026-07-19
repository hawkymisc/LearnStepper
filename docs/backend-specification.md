# Backend Specification

Status: Implemented for the local core and approved conversation-gateway scope.

## 1. Package surface

Package: `learnstepper`.

```text
learnstepper/
  core.py         command/query handlers, domain rules, adapter seams
  conversation.py session/thread/turn coordination outside database transactions
  codex/          gateway protocol and injected stdio/JSONL adapter
  events.py       bounded typed Renderer event broker
  ipc.py          closed command/query envelopes and safe error responses
  errors.py       stable application error contract
  persistence/   Database protocols, SQLite adapter, migrations
  curricula/     structured curriculum importer
```

No module may import a concrete desktop renderer or create a network server.

## 2. Common command contract

Commands use an envelope with exactly these fields:

```json
{
  "type": "command",
  "name": "project.create",
  "request_id": "UUID",
  "payload": {}
}
```

Queries omit `request_id` and use `type: query`. `LocalIPC` returns `{ok: true, data}` or
`{ok: false, error}`. No external network listener is created.

- Unknown envelope and payload fields are rejected.
- `request_id` is mandatory for mutating operations.
- A repeated request with the same name and canonical payload returns the stored result.
- Reusing the same request ID with another name or payload returns `IDEMPOTENCY_CONFLICT`.
- Success and failure envelopes never contain authentication tokens or raw App Server logs.

## 3. Initial implemented logical interface

The local core covers the following interfaces from `06_API.md` where behavior is fully specified without an external provider:

```text
QUERY   profile.get
COMMAND profile.update

QUERY   curriculumProfile.list
QUERY   curriculumProfile.get
QUERY   curriculum.list
QUERY   curriculum.get
QUERY   curriculum.items
QUERY   curriculum.objectives
QUERY   source.get
QUERY   source.citations

COMMAND project.create
QUERY   project.list
QUERY   project.get
COMMAND project.update
COMMAND project.archive
COMMAND project.restore
COMMAND project.delete

QUERY   plan.getCurrent
COMMAND plan.update
QUERY   learningObjective.list
QUERY   learningObjective.get
COMMAND learningObjective.update
QUERY   learningObjective.evidence.list
QUERY   learningObjective.attainment.get
QUERY   remediation.getActive
COMMAND remediation.accept
COMMAND remediation.complete

COMMAND session.start
COMMAND session.resume
QUERY   session.get
COMMAND thread.fork
COMMAND thread.activate
COMMAND message.send
COMMAND turn.steer
COMMAND turn.interrupt
COMMAND conversation.reconcile
QUERY   conversation.events
COMMAND session.complete

COMMAND note.create
QUERY   note.list
COMMAND note.update
COMMAND note.delete
COMMAND bookmark.create
QUERY   bookmark.list
COMMAND bookmark.delete
QUERY   history.listSessions
QUERY   history.getSession

COMMAND assessment.submitAttempt
QUERY   progress.get
QUERY   mastery.get
QUERY   curriculumProgress.get
```

`conversation.events` and `history.getSession` are sequence-cursor queries with a required or defaulted
`limit` of at most 200. IPC responses larger than 1 MiB fail with `RESPONSE_TOO_LARGE` rather than being
materialized across the desktop boundary. Conversation items expose `forkable`; only completed user and
agent message items are losslessly reconstructable by the pinned 0.144.5 history-injection contract.

Provider-dependent commands remain listed in `not-implemented-functionalities.md`.

## 4. Validation invariants

### 4.1 Profile

- Exactly one local profile exists per database.
- Display name is nonblank.
- Locale is a nonblank BCP-47-style identifier.
- Timezone is a nonblank IANA timezone present on the host.
- No token or credential column exists in the application database schema.

### 4.2 Curriculum

- MVP list returns exactly `jp-national`, `us-dc`, `us-ny`, `us-ca`, `de-be`, `de-hh`, and `de-by`.
- `ae-national` may remain in source fixtures but is never returned as an included MVP profile.
- Curriculum item codes are unique within a curriculum.
- A parent and prerequisite item must belong to the same curriculum profile.
- Source URLs are HTTPS and their stored provenance is never synthesized by an LLM response.

### 4.3 Project

- `mode` is `curriculum` or `free_topic`.
- Curriculum mode requires a valid included curriculum.
- Free-topic mode must not claim curriculum conformance without explicit mappings.
- Title, purpose, current level, target level, and session duration are validated before persistence.
- Archive, restore, complete, pause, and delete are distinct operations or states.
- Deleted projects do not appear in normal project or history queries.

### 4.4 Learning objective

- Each logical objective has one or more append-only versions and exactly one current version.
- `goal_type` is exactly `can_do` or `know`.
- `statement`, `target`, `conditions`, `success_criteria`, and `evidence_method` are nonblank.
- A project-scope objective has no plan, module, or lesson ID.
- A module-scope objective has plan and module IDs but no lesson ID.
- A lesson-scope objective has plan, module, and lesson IDs.
- All referenced objects belong to the same project.
- Curriculum mappings stay within the project's curriculum profile.
- An update creates version `n + 1`; it never updates version `n` in place.

### 4.5 Plan and concept graph

- Plan updates contain at least one module and may contain versioned project concepts.
- Modules, lessons, and concepts keep stable keys, curriculum-item, and source-document mappings.
- Modules and lessons may declare same-plan prerequisite keys.
- Concept keys are unique within a plan.
- Module, lesson, and concept prerequisite keys must resolve within the same plan and form acyclic graphs.
- Graph validation is iterative and subject to IPC collection limits.
- Module, lesson, and concept progress updates validate ownership inside one transaction.

### 4.6 Assessment and attainment

- Assessment type is `diagnostic`, `practice`, `lesson_check`, or `final_check`.
- Evidence type matches the assessment type, except `self_assessment`, which is explicitly stored as non-attaining evidence.
- An attempt and objective must belong to the same local profile and project.
- Evidence can refer only to objective versions included when the assessment was created.
- Ambiguous, missing, deleted, mismatched, or self-report-only evidence is not accepted for attainment.
- Only the Application Core writes `ObjectiveAttainment`.
- Updating an objective invalidates attainment for the previous current version; it does not migrate old evidence to the new version.
- The production attainment score threshold is injected as `AttainmentPolicy`; no undocumented
  product default is embedded in the core.

## 5. State transitions

### Project

```text
active -> paused -> active
active -> completed
paused -> completed
active|paused|completed -> archived -> restored previous state
active|paused|completed|archived -> deleted (hard-delete owned rows, retain minimal tombstone)
deleted tombstone -> no transition
```

### Session

```text
starting -> active -> interrupted -> active
active|interrupted|failed -> reconciling -> active
active|interrupted -> completed
completed -> no transition
```

One session may contain multiple Codex threads and has one active thread. Exact item forks reconstruct
confirmed history through the selected completed item, then activate the child after provider success.

### Remediation path

```text
proposed -> active -> completed
completed -> no transition
```

Any unlisted transition returns `INVALID_STATE_TRANSITION` and leaves the database unchanged.

## 6. Transaction rules

- Foreign keys are enabled on every connection.
- Migrations are atomic and recorded by version.
- A command opens at most one write transaction.
- Ownership and jurisdiction checks occur inside the same transaction as writes.
- External I/O never occurs inside a transaction.
- Conversation operations validate locally, call the gateway, then persist in separate phases.
- On validation or persistence failure, no partial records remain.
- Connection setup enables WAL only when supported and configures a bounded busy timeout.

`Database` and `DatabaseSession` are runtime-checkable protocols. The SQLite adapter implements them.
A future DuckDB adapter supplies DuckDB-specific migrations and row mapping while retaining the core
contract. Portability is verified only when the DuckDB adapter has its own contract-test run.

## 7. Time, IDs, and deterministic tests

The application layer receives clock and ID-generator ports. Production uses UTC timestamps and UUIDs. Tests use fixed clocks and deterministic IDs. Stored timestamps use RFC 3339 UTC strings.

## 8. Data deletion boundary

This implementation deletes a project and its application-DB-owned descendants transactionally,
then retains only project ID, local profile ID, and deletion time in a tombstone. It cannot claim full
compliance with profile or all-local-data deletion until credential, Codex-state, cache, log, draft,
temporary-file, and snapshot adapters exist. Those operations remain deferred rather than reporting
false success.

## 9. Acceptance evidence

Every implemented requirement group must have:

- success-path contract evidence;
- rejection, ownership, and state-transition evidence for the invariants exercised by that group;
- restart persistence evidence;
- an entry in the requirements traceability table created during implementation.

The implemented backend portions of AC-09 and AC-10 receive dedicated SQLite contract tests because
they define the highest-risk cross-entity invariants. The complete acceptance criteria remain deferred
in the traceability file until their explicitly listed product decisions and external adapters exist.
