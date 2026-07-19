# LearnStepper Frontend Implementation Plan

Status: **Approved for implementation**
Created: 2026-07-20
Approved: 2026-07-20 (`A`: contract-first Renderer direction)
Target branch: `feature/frontend-mvp`

## 1. Requirement interpretation

This work implements the concrete LearnStepper Renderer for the complete MVP screen inventory in
[`SCREEN_FLOW_DESIGN.md`](SCREEN_FLOW_DESIGN.md). The Renderer must use the Application Core as the
source of truth whenever a logical IPC operation is implemented. A screen may present a deferred
capability, but it must not simulate persistence, completion, grading, attainment, authentication,
grounding, or recovery that the backend does not currently guarantee.

The requested result is therefore not an extension of the current timer-driven prototype. It is a
contract-first Renderer with explicit capability and hold states.

## 2. Observable acceptance outcome

A PO can operate the Renderer from startup through project management, learning, progress, and
library flows and can always distinguish:

1. data confirmed by the Application Core;
2. transient user input or an operation awaiting confirmation;
3. a locally demonstrated interaction that is not persisted; and
4. a capability held for a product decision or missing provider.

The Renderer never displays an operation as saved, completed, attained, grounded, authenticated, or
deleted before the corresponding authoritative boundary confirms it.

## 3. Implementation boundary

### 3.1 Approved direction

Retain the existing Next.js/Vinext project and implement a typed host bridge at the Renderer boundary:

```text
React Renderer
  -> frontend command/query view models
  -> typed LearnStepper host bridge
  -> closed LocalIPC envelope
  -> Python Application Core / ConversationCoordinator
```

The host bridge is the only layer allowed to know how the desktop host transports an IPC envelope.
React components depend on typed frontend services, not on Python, SQLite, App Server protocol, D1,
or a network endpoint. The production desktop host remains a PO decision in
[`PO_HOLD_REGISTER.md`](PO_HOLD_REGISTER.md).

The `.openai/hosting.json` file remains unchanged with `d1: null` and `r2: null`. Sites/D1 must not
become an alternate source of truth for a standalone product whose requirements assign that role to
the local Application Core and SQLite database.

### 3.2 Runtime modes

| Mode | Purpose | Permitted claims |
|---|---|---|
| Connected | Desktop host bridge is present | May display successful behavior confirmed by LocalIPC |
| Preview | Host bridge is absent | May demonstrate layout and local input only; every non-persistent capability is labelled `プレビュー` |
| Partial capability | Core is readable but a provider is unavailable | Keeps local reads and supported writes available; disables only affected capability |
| Fatal local failure | Local DB/Core cannot be used | Shows recovery screen; does not relabel the failure as offline |

Browser storage may retain non-authoritative presentation preferences and an explicitly labelled
unsaved draft. It must not become the source of truth for projects, plans, progress, objectives,
history, notes, bookmarks, assessment evidence, or attainment.

## 4. Responsibility split

| Responsibility | Owner | Update trigger |
|---|---|---|
| Input capture and client validation | Feature form/view model | Keystroke, selection, submit attempt |
| Durable project and profile state | Application Core | Successful LocalIPC command/query response |
| Selected context | Renderer root state | User project/session/lesson selection, validated restore |
| Conversation stream | Conversation view model | Typed Renderer events and reconciliation result |
| Confirmed conversation history | Application Core | Completed item and paginated history query |
| Progress and attainment | Application Core | `progress.get`, `mastery.get`, objective attainment queries |
| Capability availability | Capability model | Startup probe, network/auth/App Server/Core state change |
| Deferred behavior | Hold registry | Product decision or dependency is resolved and verified |
| Rendering | Screen/region component | Relevant view-model state changes only |

## 5. Root state and update clocks

The Renderer keeps these identities separate:

- `selectedProjectId`
- `activeSessionId`
- `currentLessonId`
- `activeThreadId`
- `activeTurnId`
- `lastEventSequence`

The persistent learning-session state and transient generation state are different state machines.
A timer may control presentation only; it cannot mark a turn or item complete.

```text
Session: starting -> active -> interrupted/reconciling -> active -> completed
Turn UI: idle -> submitting -> streaming -> interrupting -> interrupted/completed/failed
Command: idle -> submitting -> succeeded/failed
```

Immediate user feedback occurs before external I/O: a submitted input is shown as pending and remains
editable/retryable on failure. Durable badges and progress changes occur only after authoritative
confirmation.

## 6. Capability separation

The top-level capability model must not collapse the following states into one online/offline flag:

- local Core/database availability;
- network availability;
- ChatGPT authentication availability and status;
- Codex App Server availability;
- Grounding/search availability;
- curriculum/source cache availability;
- conversation reconciliation state.

Saved projects, plans, progress, history, notes, bookmarks, and cached sources remain readable when
the network or App Server is unavailable and the local Core remains healthy.

## 7. Screen delivery and backend mapping

| Screens | Connected operations | Deferred behavior shown without false success |
|---|---|---|
| S00-S02 startup/profile/auth | `profile.get`, `profile.update` | ChatGPT login lifecycle and full deletion |
| S03 dashboard | `project.list`, `project.get`, history/progress reads | AI next recommendation |
| S04 project setup | curriculum profile/list queries, `project.create` | Final seven-profile acceptance combinations |
| S05 objectives/sources | objective/source/citation queries | Grounding search/retrieve and AI objective generation |
| S06 diagnosis | none until diagnostic adapter exists | Generation, submission, inference, skip lifecycle |
| S07 plan | `plan.getCurrent`; edit only where current contract is valid | AI generation, regeneration, draft/approval completeness gate |
| S08 lesson | session/conversation commands, queries, events | Unevaluated pedagogical claims and missing quick actions |
| S09/S10F assessment | submitted attempts only for existing backend assessments | Assessment generation, AI grading, final-check generation |
| S09R remediation | `remediation.getActive/accept/complete` | Proposal generation and rejection policy |
| S10 progress | progress/mastery/objective/curriculum progress reads | Recommendations, streaks, verified curriculum attainment aggregation |
| S11 sources | source and citation queries | New retrieval, refresh, conflict classification |
| S12 library | history/note/bookmark commands and queries | AI notes and export/provenance navigation |
| S13 project settings | project update/archive/restore/delete | Codex-thread deletion guarantee |
| S14 application settings | profile update and capability diagnostics | Auth lifecycle, all-local-data deletion, telemetry choices |

## 8. IPC and error behavior

- Queries use exactly `{type, name, payload}`.
- Commands use exactly `{type, name, request_id, payload}`.
- A retried command reuses the same request ID only when its command name and canonical payload are
  unchanged. Changed input receives a new request ID.
- Double submission is disabled while the same operation is pending.
- Unknown response fields are tolerated only at the transport decoder boundary when backward
  compatibility is explicitly intended; request payloads remain closed and exact.
- User-safe error views distinguish at least `VALIDATION_ERROR`, `NOT_FOUND`,
  `INVALID_STATE_TRANSITION`, `IDEMPOTENCY_CONFLICT`, `AUTH_REQUIRED`, `OFFLINE`,
  `APP_SERVER_UNAVAILABLE`, `RECONCILIATION_CONFLICT`, `RESPONSE_TOO_LARGE`, `NOT_IMPLEMENTED`, and
  a generic internal failure.
- Tokens, raw App Server logs, payload dumps, and internal exception text are never rendered.

## 9. Component structure

The current monolithic prototype will be replaced by these boundaries after approval:

```text
app/
  frontend/
    bridge/          host bridge, envelope codecs, event subscription
    contracts/       IPC request/response and capability types
    state/           boot, selection, command, session, and turn view models
    shell/           navigation, capability banner, project context
    features/
      startup/
      profile/
      projects/
      setup/
      objectives/
      plan/
      lesson/
      assessment/
      remediation/
      progress/
      sources/
      library/
      settings/
    shared/          dialog, form, status, empty/error/loading primitives
```

Components receive view data and actions. They do not construct raw IPC envelopes or synthesize
domain status.

## 10. Blocking factors and unchanged assumptions

### Blocking factors isolated behind holds

- concrete desktop framework and host bridge transport;
- provider-dependent authentication, Grounding, diagnostics, plans, assessment generation/grading,
  recommendations, and process supervision;
- product policies listed in the PO hold register.

These do not block implementation of the Renderer structure, exact IPC client, implemented Core
flows, capability states, or held-function presentation.

### Assumptions that remain unchanged

- standalone desktop is the production topology;
- SQLite/Application Core is the learning-state source of truth;
- no external REST server is introduced;
- MVP exposes exactly seven included education jurisdictions and excludes UAE;
- Codex tools remain empty and approvals default-deny;
- ChatGPT logout, project deletion, and all-local-data deletion remain different operations;
- deployment/publishing is not performed without a separate irreversible-operation approval.

## 11. Trade-offs

| Decision | Benefit | Cost |
|---|---|---|
| Typed bridge before desktop host selection | UI and backend contract can be completed and tested now | One small host adapter remains after framework selection |
| Explicit preview/hold states | Prevents false product claims and preserves requirement truth | Some end-to-end journeys intentionally stop at held steps |
| Feature modules instead of one prototype component | Isolates state clocks and enables focused tests | Larger initial refactor |
| Core-authoritative progress and history | Correct restart and evidence semantics | UI cannot optimistically claim completion |
| No D1/browser product persistence | Preserves standalone topology and single source of truth | Hosted preview cannot act as production persistence |

## 12. TDD and verification plan

After PO approval, tests are added before implementation for:

1. exact command/query envelope and project payload construction for both modes;
2. request-ID reuse, changed-payload behavior, and double-submit prevention;
3. boot branching: missing profile, empty projects, ready, local failure;
4. seven-profile query rendering and UAE exclusion;
5. project lifecycle and per-project selection isolation;
6. capability-specific degradation and offline local operations;
7. event-driven conversation completion, interruption, failure, replay, and reconciliation conflict;
8. objective version/evidence/attainment presentation;
9. `planned` curriculum state never rendered as attained;
10. history, note, and bookmark ownership/error flows;
11. project deletion versus held all-local-data deletion;
12. keyboard, focus, dialog, screen-reader, reduced-motion, and responsive behavior;
13. no hard-coded success, attainment, source-verification, or generated-provider claims;
14. build, lint, typecheck, existing Python suite, and traceability validation.

Visual PO acceptance uses the six review questions already defined in `SCREEN_FLOW_DESIGN.md` and
the frontend-specific decision list in `PO_HOLD_REGISTER.md`.

## 13. Approval record

The PO approved direction A on 2026-07-20. Production and test implementation may proceed using the
contract-first Renderer boundary in this document. This approval does not select the production
desktop framework or resolve the product decisions in `PO_HOLD_REGISTER.md`. Any change to the
topology, persistence authority, or deferred-function policy requires revising this document before
implementation.

## 14. Implementation status

Updated: 2026-07-20

| Status | Delivery | Evidence |
|---|---|---|
| ✅ | Exact query/command envelopes, stable request IDs, safe error mapping | `app/frontend/bridge/ipc-client.ts`, `tests/frontend-contracts.test.tsx` |
| ✅ | Startup, profile, empty, ready, preview, and local-failure branches | `app/frontend/learnstepper-app.tsx`, `tests/frontend-renderer.test.tsx` |
| ✅ | Seven backend curriculum profiles, curriculum-ID selection, exact project payload | `app/frontend/features/setup/project-payload.ts`, renderer tests |
| ✅ | Project list, selection, update, lifecycle, archive/restore, scoped irreversible deletion | renderer lifecycle tests |
| ✅ | Core-authoritative plan, objective, evidence, attainment, progress, mastery, and curriculum reads | `app/frontend/services/project-data.ts` |
| ✅ | Typed event-driven session start/resume/send/steer/interrupt/fork/complete and bookmarking | conversation panel and event tests |
| ✅ | Existing source/citation reads; note CRUD; bookmark create/list/delete; history detail | project-data service and library renderer |
| ✅ | S00-S14 screen inventory, responsive shell, contextual held-function screens | Renderer and `app/globals.css` |
| ✅ | Capability-specific degradation; local reads remain available offline | capability state tests |
| ✅ | Build, SSR, lint, typecheck, JavaScript/TypeScript tests, Python regression suite | local verification on 2026-07-20 |
| ⚠️ | Production desktop host, authentication, provider-dependent generation/grading, Grounding refresh, full deletion | Intentionally held in `PO_HOLD_REGISTER.md` and the NIF registry |

The implementation is complete for the approved contract-first boundary. The hosted route is a
non-persistent preview. Production packaging and provider-dependent end-to-end acceptance remain
blocked by explicit PO decisions rather than being simulated in the Renderer.
