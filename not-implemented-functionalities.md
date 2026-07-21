# Not Implemented Functionalities

Status: Active hold register. This file distinguishes contradictions from unresolved decisions and provider-dependent work. An item remains here until implementation and verification evidence exist.

## 1. Document consistency result

No direct contradiction was found among the current requirements concerning the standalone topology, seven included curriculum profiles, exclusion of UAE, SQLite as the application-state source of truth, absence of an external REST API, or the `can_do`/`know` objective model.

Implementation is nevertheless blocked for the areas below because `09_ロードマップと未決事項.md` explicitly requires decisions before implementation, or because the required external contract and runtime are absent. These are not silently resolved by implementation assumptions.

## 2. Deferred original-product Must functionality

The table below tracks the broader product requirements. Items explicitly moved to Future Update by
`docs/HACKATHON_SUBMISSION_DESIGN.md` are not residual work for the focused hackathon MVP. Partial focused-MVP
safeguards remain documented here when the broader requirement still contains deferred behavior.

| ID | Requirement IDs / acceptance criteria | Functionality | Reason held | Decision or dependency needed |
|---|---|---|---|---|
| NIF-001 | FR-A01, FR-A02, FR-A06, FR-A08, FR-A09, AC-00 | Remaining authentication acceptance: visible logout, expired-session recovery, and distribution policy | External Codex CLI 0.144.5 discovery, sanitized status refresh, packaged first-response verification, restart reuse, and focused PO acceptance are complete. Device login remains CLI-owned; visible logout, expired-session walkthrough, and general-distribution policy remain unresolved | Roadmap 1, 7, 8; logout and expired-session product contracts plus general-distribution policy |
| NIF-002 | FR-A04, AC-07 | Complete profile and all-local-data deletion | Deletion spans SQLite, WAL, credentials, Codex state, snapshots, cache, logs, drafts, and temporary files; several owners/adapters do not yet exist | Target OS/data paths, retention policy, credential and Codex adapters |
| NIF-003 | FR-G03, FR-G08, FR-G09, AC-08, AC-11 | Grounding search, HTTPS retrieval, refresh, conflict classification, and hardened SSRF controls | Search/retrieval provider, allowed domains, limits, licensing, caching, and contradiction threshold are undecided | Roadmap 4–6 and 14; provider contract and security policy |
| NIF-004 | FR-D01–D04, FR-D06–D08 | AI diagnostic generation, skip workflow, concept inference, and plan feedback | Model, reasoning settings, prompt contract, rubric, diagnostic lifecycle, and grounding adapter are undecided | Roadmap 9, 14, 19; Codex adapter |
| NIF-005 | FR-P12, FR-L01, FR-L06, AC-01 | AI final-objective structuring, plan generation, and regeneration | Requires an approved model, objective-count policy, output schema limits, and evaluation criteria | Roadmap 9, 14, 19; Codex adapter |
| NIF-007 | FR-Q01–Q04, FR-Q08, FR-Q11, AC-04 | AI exercise generation and grading | Model, prompts, rubrics, ambiguity thresholds, and source-grounding policy are undecided | Roadmap 9, 14, 19; Codex adapter |
| NIF-008 | FR-M06, AC-05 | AI next-content and review recommendations | Recommendation policy and model behavior are unspecified | Explicit ranking policy and evaluation data |
| NIF-009 | FR-A04, FR-H05, AC-07 | Corresponding Codex-thread deletion | App Server deletion/archive contract and lifecycle reconciliation are not fixed | Bundled App Server version and deletion semantics |
| NIF-010 | AC-11, NFR security | Broader production OS sandbox enforcement and security-policy verification | The focused macOS arm64 boundary now disables shell, browser, Web search, code mode, approval prompts, plugins, and discovered MCP servers; it verifies the effective MCP surface after startup and fails closed. General-distribution OS sandboxing and an independently audited production policy remain unresolved | Roadmap 1, 2, 8 and 15; production signing/sandbox target and independent security audit |
| NIF-011 | NFR security | Code signing and secure update verification | Target OS, installer, signing identity, and update mechanism are undecided | Roadmap 1 and 2 |
| NIF-012 | FR-P10, FR-G01, AC-09 | Final acceptance curriculum combination per each of seven profiles | Representative source data exists, but final education stage, grade, subject, and version combination is explicitly undecided | Roadmap 3 product decision |
| NIF-013 | FR-G10, AC-08 | Production snapshot storage, refresh, and later-change detection | Redistribution rights, retention, and cache policy remain undecided | Roadmap 5 and 6 |
| NIF-014 | AC-10, roadmap item 19 | Production maximum objective count and subject/stage rubrics | The hackathon MVP maximum of five is enforced at new `learningObjective.update` creation and contract-tested; versioned subject/stage rubrics remain a Future Update | Future rubric policy |
| NIF-015 | NFR privacy | Encryption, backup, export, and retention behavior | These capabilities are outside the hackathon MVP and remain a Future Update | Roadmap 10 |
| NIF-016 | NFR safety | Minor-user and high-risk-topic restrictions | The per-launch, non-persistent adult self-attestation and pre-confirmation Host-I/O gate are implemented and tested. Medical/legal/financial wording is an approved scope acknowledgement without keyword rejection; broader minor-user and high-risk safety support remains a Future Update | Roadmap 11–12 |
| NIF-017 | NFR diagnostics | External quality telemetry and crash reporting | The hackathon MVP sends no external telemetry or crash reports and uses local diagnostics only; external reporting remains a Future Update | Roadmap 16 |
| NIF-018 | FR-G02, FR-G13, AC-08 | Curriculum objective originals, locators, and prerequisite corpus | Current structured YAML contains curriculum summaries and item hierarchies but no complete `CurriculumObjective` corpus or objective-level prerequisite data | Final acceptance corpus and source extraction rules |
| NIF-019 | FR-G12, AC-09 | Selection-basis city, population rank/value/date, and statistics source in structured data | The prose requirements contain selection rationale, but the repository YAML does not contain the complete machine-readable fields required for import | Approved structured metadata for all seven profiles |
| NIF-020 | FR-L03, AC-01 | Plan completeness gate requiring at least one objective for every lesson | The focused MVP enforces the five-objective maximum but treats draft/review/approval completeness transitions as a Future Update; activating an incomplete plan must not be guessed | Future plan lifecycle contract and completeness tests |
| NIF-021 | FR-M08, AC-05 | Verified curriculum-item attainment aggregation and complete recommendation flow | The core can report planned curriculum mappings, concept mastery, and objective attainment, but the rule for aggregating evidence into curriculum-item attainment is unspecified | Versioned aggregation policy and acceptance fixtures |
| NIF-022 | FR-C09, FR-C10, AC-02, AC-03, AC-06 | Markdown/table/math presentation, clipboard interaction, and complete end-to-end recovery UI | The production Electron Renderer and typed Codex gateway are connected. Rich-content rendering, clipboard behavior, and complete packaged recovery acceptance remain outside the focused MVP | Rich-content and recovery acceptance fixtures |
| NIF-023 | FR-C07, FR-C14, FR-C15, AC-02 | Automatic return-to-lesson suggestions, source-backed claims, and misconception detection | These behaviors require Grounding, diagnostic policy, and evaluated tutor prompts; transport success is not pedagogical evidence | NIF-003, NIF-004, prompt/evaluation policy |
| NIF-024 | FR-M12 | Recalculation after evidence, rubric, score, or grading-result mutation | Objective revision invalidation exists, but evidence/rubric mutation, deletion, and re-evaluation contracts are not implemented | Versioned evidence mutation policy and contract tests |
| NIF-025 | FR-C05, FR-C06 | Expanded quick-action catalog and explicit detour/return lifecycle | The MVP intentionally uses four versioned actions without a persistent detour state; additional actions and a detour lifecycle remain a Future Update | Future action catalog, detour state model, and behavioral tests |
| NIF-026 | AC-06 | App Server process supervision, automatic restart, reconnect, and post-crash reconciliation | Explicit reconciliation exists, but no production supervisor restarts a failed App Server process and restores subscriptions | Desktop process supervisor and restart acceptance fixtures |

## 3. Deferred Should and Could functionality

| ID | Requirement IDs | Functionality | Reason held |
|---|---|---|---|
| NIF-101 | FR-A05 | Detailed explanation preferences | Should priority; can be added after the core profile contract is approved |
| NIF-102 | FR-P08 | Project duplication | Could priority |
| NIF-103 | FR-G10 | Automated source change detection | Depends on NIF-003 and NIF-013 |
| NIF-104 | FR-D05 | Manual diagnostic-result correction | Should priority and diagnostic model deferred |
| NIF-105 | FR-L07, FR-L08 | Plan diff and out-of-plan lessons | Should priority |
| NIF-106 | FR-C08 | Response regeneration | Should priority and Codex integration deferred |
| NIF-107 | FR-Q06, FR-Q07 | Adaptive difficulty and error-based review generation | Should priority and recommendation policy undecided |
| NIF-108 | FR-M07 | Learning time, count, and streak analytics | Should priority |
| NIF-109 | FR-N04–N06 | AI note generation, Markdown export, and provenance navigation | Should priority; AI portion depends on Codex integration |

## 4. Interface-level hold list

The following logical IPC operations from `06_API.md` must not report successful production behavior until their dependencies are resolved:

```text
auth.logout
profile.deleteLearningData
profile.deleteAllLocalData
source.search
source.retrieve
source.refresh
diagnostic.start
diagnostic.submitAnswers
diagnostic.get
plan.generate
plan.regenerate
assessment.generate
reviewRecommendations.get
```

An adapter stub that returns `NOT_IMPLEMENTED` is not completion evidence and does not remove an item from this file.

## 5. Resolved implementation holds

NIF-006 was resolved on 2026-07-19 for FR-C01–C04 and the transport portions of AC-02, AC-03, and
AC-06. Evidence includes the injected App Server stdio/JSONL gateway, Project→LearningSession→Thread
→Turn→Item persistence, exact Item-boundary history reconstruction, child activation, streaming event
contract, interruption, same-ID resume, and conflict-safe reconciliation. Presentation and pedagogical
behavior formerly grouped into NIF-006 were split into NIF-022, NIF-023, NIF-025, and NIF-026 so
transport tests cannot falsely claim product-level completion.

## 6. Removal rule

An item may be removed only when:

1. the referenced product decision or external contract is recorded;
2. implementation exists without contradicting another requirements document;
3. requirement-level tests and relevant acceptance tests pass;
4. the traceability table points to code and verification evidence; and
5. review findings are resolved.
