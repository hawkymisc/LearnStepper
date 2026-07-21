# LearnStepper Judges' Guide

Target platform: macOS arm64
Test artifact: `LearnStepper-mac-arm64.dmg`
Expected evaluation time: 4–6 minutes
Rebuild required: No

## Test without rebuilding

1. Install Codex CLI 0.144.5 and run `codex login --device-auth` in Terminal.
2. Confirm that `codex --version` reports `codex-cli 0.144.5`.
3. Download `LearnStepper-mac-arm64.dmg` from the release link supplied in the Devpost submission.
4. Verify the published SHA-256 against `LearnStepper-mac-arm64.dmg.sha256`.
5. Open the DMG and drag LearnStepper into Applications.
6. Because this Build Week artifact is ad-hoc signed rather than Developer ID notarized, use **Control-click → Open**
   on the first launch if macOS Gatekeeper displays a warning.
7. Confirm that the first screen is the adult self-attestation gate.
8. Confirm eligibility. The app then starts its bundled local service and external Codex 0.144.5 App Server.
9. Create a local profile or use the existing local profile.
10. If the login banner remains, select **ログイン状態を再確認**.
11. Create a free-topic project, start a learning session, and ask one question.
12. Open progress or history, quit LearnStepper, reopen it, confirm eligibility again, and verify that the project and
    confirmed history remain available.

The app does not require a system Python, `uv`, or Node.js. AI tutoring requires external Codex CLI 0.144.5,
a network connection, and a ChatGPT account. Local project data remains available when the CLI or AI connection is absent.

## Suggested evaluation topic

- Topic: `一次方程式` — linear equations
- Goal: `一次方程式の変形を例を使って説明できる`
- First question: `2x + 5 = 17 を、途中式と考え方を含めて説明してください。`
- Follow-up action: **例を見せて**

## Expected observable behavior

- No sidecar, database, Codex, or account read starts before eligibility confirmation.
- LearnStepper never opens a login URL; **ログイン状態を再確認** only reads external CLI account state.
- A question appears immediately as pending before provider I/O completes.
- Confirmed tutor output becomes part of local history.
- Project, objective, and confirmed history survive an application restart.
- The learning and source views state that no new Web retrieval occurs.
- Diagnosis, exercises, final assessment, and remediation do not appear in the focused submission navigation.

## Privacy and capability boundaries

- ChatGPT credentials are managed by the external Codex CLI, not LearnStepper's SQLite database.
- Renderer IPC never receives access tokens, refresh tokens, raw account payloads, or arbitrary login URLs.
- External telemetry, Web search, new retrieval, and learner-code execution are disabled.
- The Build Week submission is limited to adult learners and excludes medical, legal, and financial learning topics.

## Source verification path

For reviewers who prefer source validation, the repository includes exact development commands in `README.md`,
requirements traceability in `docs/requirements-traceability.yaml`, focused-MVP evidence in
`docs/FOCUSED_MVP_COMPLETION_AUDIT.md`, and Build Week chronology in
`docs/submission/BUILD_WEEK_EVIDENCE.md`.

Known release limitation: Developer ID signing and notarization are not configured. The final binary is ad-hoc deep
signed and has been locally verified. This limitation is disclosed rather than hidden.
