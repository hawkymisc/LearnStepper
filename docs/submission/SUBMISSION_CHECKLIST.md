# OpenAI Build Week Submission Checklist

Deadline: July 21, 2026 at 17:00 PDT / July 22, 2026 at 09:00 JST.
Repository push, PR, normal merge, and a new `v0.1.0` tag are authorized by the PO. Devpost submission,
video publication, judge-account access changes, and other account actions remain blocked until separate PO approval.
Do not submit before PO approval.

Video workstream: separate session. This checklist tracks only the required handoff from that session: a public
YouTube URL, audible narration, and a runtime below three minutes.

## Local package

- [x] Education category selected in the draft.
- [x] English project description covers features and functionality.
- [x] README contains setup, judge quick start, Codex collaboration, GPT-5.6 usage, and key decisions.
- [x] Build Week evidence distinguishes pre-existing work from submission-period implementation.
- [x] Judges' guide provides a macOS arm64 path without rebuilding and discloses the external Codex prerequisite.
- [x] Devpost cover image and gallery selection are prepared.
- [ ] Receive the final public YouTube URL from the separate video session.
- [ ] PO reviews the exact submission text, static assets, and final video URL.

## Required user/account values

- [x] Record `/feedback` Session ID `019f73ce-4667-7e90-aa14-4a4aa88d7e6a`.
- [x] Paste the Session ID into `DEVPOST_SUBMISSION.md`.
- [ ] Paste the Session ID into the authenticated Devpost form.
- [ ] Confirm the entrant name, team members, and country eligibility in Devpost.

## GitHub checkpoint

Recommended path: keep the repository private and grant read access to both judge accounts.

- [ ] Commit the reviewed submission branch with the required Codex footer.
- [ ] Push the branch and merge the reviewed changes before the deadline.
- [ ] Share the private repository with `testing@devpost.com`.
- [ ] Share the private repository with `build-week-event@openai.com`.
- [ ] Confirm each invitation or access grant is visible in repository settings.
- [x] Rebuild the external-CLI DMG and record its exact byte size, SHA-256, `hdiutil verify`, and deep-signature result.
- [ ] Attach or link the final `LearnStepper-mac-arm64.dmg` and SHA-256 file.

Alternative: making the repository public is not part of the default plan. Public visibility is difficult to reverse
fully because forks, caches, and archives may persist. Use it only after a separate secrets, history, identity, and
license audit plus explicit PO approval.

## YouTube checkpoint

- [ ] The separate video session uploads only after PO approval.
- [ ] Confirm visibility is public; unlisted does not satisfy the explicit public requirement.
- [ ] Confirm audio, captions, and runtime below 3:00.
- [ ] Paste the public YouTube URL into Devpost and `DEVPOST_SUBMISSION.md`.

## Devpost final review

- [ ] Working-project link or test build is accessible free of charge through the judging period.
- [ ] Repository URL opens for both judge accounts.
- [ ] Description, category, video URL, repository URL, and /feedback Session ID are populated.
- [ ] No private identifiers, login URLs, tokens, account email, or unrelated desktop content are visible.
- [ ] Submit only after the PO confirms the exact preview.
- [ ] Save a timestamped screenshot of the submitted confirmation before the deadline.
