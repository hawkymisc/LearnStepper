# Judge FAQ

## How is this different from using ChatGPT or Codex directly?

LearnStepper adds a durable learning model around the conversation. Objectives, confirmed history, notes,
bookmarks, evidence, and progress remain attached to a local project and return after restart. A chat answer alone
does not count as evidence of attainment.

## What role does GPT-5.6 play?

GPT-5.6 is the live tutor model used through the Codex App Server boundary. The model explains, gives examples,
checks understanding, and continues the learning conversation. LearnStepper owns the surrounding learning state and
decides what is persisted as confirmed product data.

## How was Codex used to build the project?

Codex converted requirements into executable contracts, implemented and reconciled the React/Electron/Python
boundaries, inspected the App Server protocol, generated failure-path tests, reviewed interface states, and helped
prepare packaging and evidence. The product owner retained scope, privacy, audience, and release decisions.

## Why is an external Codex CLI required?

LearnStepper is an App Server client. It uses the official external CLI's supported login and credential ownership
instead of copying credentials, embedding another application's private runtime, or implementing custom OAuth.
Version 0.144.5 is required so the validated protocol contract remains exact.

## What works without Codex or a network connection?

The local profile, projects, objectives, saved history, notes, bookmarks, and progress remain available. Only the
live tutor is unavailable.

## Where is learner data stored?

Learning records are stored locally in SQLite under the application's macOS data directory. LearnStepper does not
store ChatGPT access or refresh tokens in SQLite, Renderer storage, or IPC responses.

## What was built during Build Week?

The implementation repository begins within the July 13–21, 2026 submission window. The application core,
Renderer, Electron host, Codex integration, persistence model, tests, and desktop packaging were implemented during
that period. Earlier material was limited to product planning and learning-domain concepts.

## What is deliberately not included?

Curriculum generation, diagnosis, exercises, final assessment, remediation, Web retrieval, learner-code execution,
telemetry, export, backup, all-local-data deletion, notarization, and Windows/Linux builds remain Future Updates.

## Can judges run it without rebuilding?

Yes, on macOS arm64. Install and authenticate Codex CLI 0.144.5, then use the supplied DMG. The app itself does not
require system Python, `uv`, or Node.js.
