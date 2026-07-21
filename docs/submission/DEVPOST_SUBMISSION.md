# LearnStepper — Devpost Submission Draft

Status: ready for PO review; the public video and final artifact URLs remain intentionally blank.

Project title: LearnStepper
Tagline: A local-first AI tutor that remembers how you learn, one verified step at a time.
Category: Education
Built with: GPT-5.6, Codex, Codex App Server, React, Electron, Python, SQLite
Repository URL: https://github.com/hawkymisc/LearnStepper
Demo video URL: [ADD PUBLIC YOUTUBE URL AFTER PO APPROVAL]
/feedback Session ID: 019f73ce-4667-7e90-aa14-4a4aa88d7e6a

## One-line pitch

LearnStepper is a focused desktop learning companion that combines a live Codex-powered tutor with local,
persistent learning objectives, evidence, history, and progress.

## Inspiration

AI chat can explain almost anything, but a chat window does not automatically become a learning system. Learners
lose the thread when sessions end, progress is often self-reported, and useful explanations disappear inside a long
conversation. LearnStepper started from a simple question: what if an AI tutor remembered the learner's confirmed
work without turning their education history into another cloud account?

## What it does

LearnStepper turns an open-ended topic into a persistent learning workspace. An adult learner can create a topic,
connect a ChatGPT account through an externally authenticated official Codex CLI, start a guided conversation, and return to
the same project after restarting the desktop app. The product keeps confirmed conversation history, saved learning
objectives, a read-only actionable plan, evidence-backed progress, notes, and bookmarks in a local SQLite database.

The difference from a disposable AI chat is continuity with accountability. A learner can see what they intended to
learn, what evidence actually supports progress, and what remains incomplete. The record stays on the learner's own
device, while live tutoring is available only when the learner chooses to connect through Codex.

The focused Build Week version deliberately does less, more honestly. It does not claim Web grounding when no Web
retrieval occurred, does not execute learner code, does not send telemetry, and hides incomplete curriculum,
diagnosis, exercise, and final-assessment flows. Authentication tokens never enter the Renderer or LearnStepper
database; the external Codex CLI owns them in its configured credential store.

## How we built it

The desktop product has three explicit boundaries:

1. A React/Vinext Renderer owns the focused learning experience and immediate interaction feedback.
2. An Electron host exposes a narrow, allow-listed IPC surface and starts local services only after eligibility
   confirmation.
3. A framework-independent Python application core owns SQLite persistence, learning contracts, and a typed
   stdio/JSONL gateway to an external, version-pinned Codex App Server.

The packaged macOS arm64 DMG includes the Renderer and a self-contained Python sidecar. It requires external
Codex CLI 0.144.5 for AI tutoring, while a missing or mismatched CLI leaves local data available with actionable
guidance. The project is validated across Node, React, and Python, plus
build, lint, type, package, checksum, signature, responsive, keyboard, zoom, and reduced-motion checks.

## How Codex and GPT-5.6 were used

GPT-5.6 through Codex was the development partner across the Build Week window. It helped translate product
requirements into testable contracts, implement the persistence and conversation models, reconcile the
React/Electron/Python boundaries, inspect the Codex App Server protocol, generate failure-path tests, review UI
states, and automate standalone packaging verification.

The project owner retained the consequential decisions: local-first storage, official ChatGPT authentication,
adult-only focused scope, no misleading feature claims, no Web retrieval, no learner-code execution, and the rule
that observable evidence must exist before a capability appears in the submission UI. Codex accelerated the path
from those decisions to a tested implementation; it did not replace product judgment.

The repository was created and meaningfully built during the July 13–21, 2026 submission period. Dated commits,
test evidence, packaging checks, and the exact Build Week change narrative are documented in the repository.

## Challenges we ran into

The hardest problem was not generating a tutor reply. It was making AI conversation behave like durable product
state. Streaming items, interruption, restart recovery, thread identity, local confirmation, and stale responses all
cross process boundaries. We solved this with typed events, explicit ownership, idempotent commands, confirmed-item
persistence, and conflict-safe reconciliation.

Desktop packaging was the second challenge. A judge should not need a system Python or `uv`; the build bundles a
PyInstaller sidecar. Codex remains an explicit prerequisite because LearnStepper is an App Server client and the
ChatGPT desktop app does not expose its private embedded runtime as a supported third-party endpoint.

The final challenge was scope. A broad education design existed, but several advanced paths were not end-to-end.
We removed those surfaces from the submission rather than presenting disabled controls or simulated completion.

## Accomplishments that we're proud of

- A runnable local-first desktop product, not only a browser mockup.
- Official external Codex CLI device login without exposing tokens to the app UI or database.
- Persistent Project → LearningSession → CodexThread → Turn → Item history with restart resume.
- Evidence-backed progress that excludes unsupported self-report from core attainment.
- An installable macOS arm64 DMG with a pinned external CLI contract, checksum, and deep-signature verification.
- 226 passing automated tests and durable visual evidence at desktop, tablet, mobile, 200% zoom, keyboard focus,
  and reduced motion.

## What we learned

AI education quality depends as much on state boundaries and truthful feedback as it does on model capability.
Keeping learning history local changes the architecture: authentication, tutor execution, user records, and UI state
must be separated deliberately. We also learned that hiding an unverified capability produces a more coherent
product than preserving an impressive-looking but incomplete screen.

## What's next for LearnStepper

The next release will add generated, reviewable learning plans; curriculum alignment; diagnostic and formative
assessment; evidence-grounded retrieval; export and backup; full local-data deletion semantics; Developer ID
notarization; and Windows/Linux distribution. These remain explicit Future Updates until their complete contracts
and observable behavior are verified.

## Testing notes

The submitted platform is macOS arm64. Judges can use the provided DMG without rebuilding. The first launch shows
adult self-attestation, followed by local profile and external Codex status. Install and authenticate Codex CLI
0.144.5 first; local project data remains available without it. Exact steps are in `docs/submission/JUDGES_GUIDE.md`.

## Links prepared for the final form

- Repository: `https://github.com/hawkymisc/LearnStepper`
- Judge guide: `docs/submission/JUDGES_GUIDE.md`
- Build Week provenance: `docs/submission/BUILD_WEEK_EVIDENCE.md`
- Demo video: `[ADD PUBLIC YOUTUBE URL AFTER PO APPROVAL]`
- Codex feedback: `019f73ce-4667-7e90-aa14-4a4aa88d7e6a`
