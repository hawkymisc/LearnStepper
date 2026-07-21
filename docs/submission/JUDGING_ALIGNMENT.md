# Judging Alignment

The submission should be read as one claim: **LearnStepper turns an AI conversation into durable, learner-owned
progress without pretending that chat alone proves learning.**

## 1. Technical implementation

**Judge-facing claim:** This is a working desktop product with explicit process boundaries, durable local state, and
a real Codex App Server integration.

- React/Vinext owns the learning interface.
- Electron exposes a narrow allow-listed bridge and delays local initialization until adult self-attestation.
- Python owns SQLite persistence and typed learning contracts.
- External Codex CLI 0.144.5 owns authentication and the App Server runtime; tokens never enter Renderer state or
  LearnStepper's database.
- Confirmed conversation items and learning records survive application restarts.

Best proof: the installable macOS arm64 build, restart-persistence gallery image, repository contracts, and dated
Build Week history.

## 2. Design

**Judge-facing claim:** The interface makes one learning action obvious while keeping system state understandable.

- A calm, focused workspace replaces a feature-heavy dashboard.
- Local-data availability and AI availability are communicated separately.
- Loading, error, missing-CLI, unsupported-CLI, narrow-screen, keyboard, zoom, and reduced-motion states were treated
  as product states rather than afterthoughts.
- Incomplete curriculum, diagnosis, exercise, and assessment surfaces are hidden instead of shown as dead controls.

Best proof: the primary workspace cover, responsive evidence, visible focus evidence, and the no-misleading-features
scope statement.

## 3. Impact

**Judge-facing claim:** Learners need continuity and trustworthy progress, not another disposable answer stream.

- Objectives, confirmed history, notes, bookmarks, and progress stay tied to a project.
- Evidence-backed attainment excludes unsupported self-report from core completion.
- Local-first records reduce dependence on a new cloud account and keep the learning history under learner control.
- The focused version supports adult free-topic learning while clearly excluding high-stakes medical, legal, and
  financial learning topics.

Best proof: progress and objectives gallery images, restart persistence, and the judge's five-minute evaluation path.

## 4. Quality of the idea

**Judge-facing claim:** LearnStepper is not "chat with a different frame"; it is a stateful learning layer around a
capable coding and reasoning agent.

The core idea combines three properties that are usually separated: a live AI tutor, durable local learning state,
and progress constrained by observable evidence. Codex makes the tutoring loop possible, while the product model
keeps that loop inspectable and resumable.

Best proof: the Project → LearningSession → CodexThread → Turn → Item model and the deliberate distinction between
conversation, objectives, evidence, and attainment.

## Claims intentionally excluded

Do not claim personalized curriculum generation, completed diagnosis or assessment, Web-grounded answers, learner
code execution, cloud sync, telemetry analytics, Windows/Linux distribution, or notarization. Honest scope improves
all four judging dimensions because every visible claim can be demonstrated.
