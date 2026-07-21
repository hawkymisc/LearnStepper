# OpenAI Build Week Evidence

Submission period: July 13, 2026 09:00 PDT through July 21, 2026 17:00 PDT.
Repository creation and implementation dates: July 18–21, 2026.
Evidence forms: dated commit history, tests, design decisions, visual captures, and packaged-artifact verification.

## Pre-existing work

No implementation repository history predates the Build Week submission period. The earliest repository commits are
dated July 18, 2026. Some product requirements and learning-domain concepts existed as planning material; the
application core, Renderer, desktop host, Codex integration, tests, and standalone package were built during the
submission period.

## Dated commit history

| Local date | Commit | Build Week contribution |
|---|---|---|
| 2026-07-18 | `25b8bd2` | Defined the standalone, grounded learning MVP |
| 2026-07-18 | `3f3ac80` | Implemented the SQLite application core |
| 2026-07-18 | `301b784` | Added the persistent learning-session prototype |
| 2026-07-19 | `71f11a0` | Hardened reviewed conversation contracts |
| 2026-07-20 | `367e3c0` | Implemented the contract-first Renderer |
| 2026-07-20 | `cee2e86` | Redesigned the focused learning workspace |
| 2026-07-21 | `8504d89` | Packaged the standalone desktop app |
| 2026-07-21 | `354d578` | Hardened the desktop authentication lifecycle |

The final submission branch adds eligibility-before-initialization, objective-limit enforcement, project-switch
ownership isolation, packaged runtime verification, focused visual evidence, and the submission package itself.

## Codex and GPT-5.6 collaboration record

GPT-5.6 through Codex was used to:

- translate requirements into executable Node, React, and Python contracts before implementation;
- develop the local persistence model and conversation lifecycle;
- inspect and implement the Codex App Server stdio/JSONL protocol boundary;
- design failure-closed external authentication-state handling and token non-disclosure;
- reconcile Renderer payloads with the production Python core;
- review responsive, keyboard, zoom, reduced-motion, loading, error, and stale-response states;
- build and verify external Codex discovery and the bundled Python sidecar packaging pipeline;
- maintain requirement traceability, rejected alternatives, and evidence-backed scope decisions.

The product owner decided the target audience, local-first privacy stance, focused submission surface, authentication
approach, platform scope, and acceptance criteria. Codex accelerated implementation, testing, analysis, and
documentation within those decisions.

The `/feedback` Session ID supplied for the thread containing the majority of core functionality is
`019f73ce-4667-7e90-aa14-4a4aa88d7e6a`. It was supplied by the project owner rather than inferred from repository
metadata.

## Verification evidence

- Automated suites: 51 Node tests, 74 React/Vitest tests, and 101 Python tests; 226/226 passed on July 22, 2026 JST.
- Static gates: production build, ESLint, TypeScript, scoped Ruff, and strict mypy passed.
- Artifact: `release/LearnStepper-mac-arm64.dmg`.
- Final external-CLI artifact size: 214,957,076 bytes.
- Final external-CLI artifact SHA-256: `02cd11562acffbdb779e1c5b74769ed414405a9eb5fbc6b0d8b0c5b4b1d1b2a9`.
- Distribution identity: the verified DMG is Git LFS-tracked. The Pages workflow pins every action to a commit SHA,
  checks this committed DMG against its committed checksum, and publishes the same bytes without rebuilding.
- Artifact integrity: `hdiutil verify` reported VALID; the mounted application passed deep ad-hoc signature
  verification; `Resources/bin/learnstepper-sidecar` is executable and `Resources/bin/codex` is absent.
- Runtime smoke test: bundled Renderer and Python sidecar launch without system `uv` or Python; AI availability
  is resolved through external Codex CLI 0.144.5 and local data remains available when it is missing.
- Durable visual evidence: 32 captures covering desktop, 768px, 320px, 200% zoom, reduced motion, keyboard focus,
  eligibility loading/error, deletion confirmation, project-switch loading, authenticated external-CLI state,
  a real AI response after MCP isolation, and restart persistence of both the session and authentication state. The
  final wide and 320px captures also prove automatic resume/reconciliation, a second confirmed AI response, and the
  truthful Library/upload-unavailable notice. The final DMG SHA above was also launched with an isolated profile and
  captured without bypassing or automating adult self-attestation: [final eligibility launch](../evidence/final-dmg-eligibility-1440x900.png).

## Honest submission boundary

The submission does not claim completed curriculum generation, diagnosis, exercises, final assessment, remediation,
Web grounding, learner-code execution, telemetry, export, backup, all-local-data deletion, Windows/Linux support, or
Developer ID notarization. These items remain documented Future Updates.
