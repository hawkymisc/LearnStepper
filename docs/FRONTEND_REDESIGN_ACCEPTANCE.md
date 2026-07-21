# Frontend Redesign Acceptance Checklist

## Design thesis

**A calm, blue-led learning workspace that makes the learner's next action, trusted evidence, and current progress immediately legible without relying on color alone.**

## Focused-MVP scope inventory

All renderer routes and startup branches are in scope.

| Area | Screens / branches | Redesign evidence |
| --- | --- | --- |
| Startup | Adult eligibility, loading, local profile, recovery, preview, offline and App Server unavailable | Focused onboarding shell, clear system feedback, recovery action |
| Home | Empty project list, project dashboard | Dominant continuation / creation action and scannable project summaries |
| Project setup | Free-topic creation | Task-oriented form hierarchy, validation, submission feedback |
| Learning | Conversation session, unavailable conversation, streaming, completed and interrupted turns | Reading-first conversation, immediate send feedback, recoverable controls |
| Learning tools | Objectives, saved plan, and saved sources | Contextual navigation and preserved Core authority; diagnosis, assessment, and remediation are absent |
| Supporting views | Progress, library, settings, project settings | Consistent page hierarchy and focused primary tasks |

## System decisions

- **Palette:** navy `#0B3A67` primary, blue `#146EB4` action/focus, pale blue `#E7F2FA` selected/info, teal `#007C78` success, amber `#9A5B00` warning, plum `#A63D63` error, with neutral ink/surfaces.
- **Color-diversity rule:** statuses always pair a text label and an icon/border treatment with color. Blue and teal are not used as the sole distinction between semantic states.
- **Contrast target:** normal text and controls meet WCAG AA (4.5:1); large text meets 3:1; focus rings retain 3:1 contrast against adjacent surfaces.
- **Tokens:** one typography scale, 4px spacing scale, four radii, two elevations, semantic colors, and short transform/opacity-only motion.
- **Responsive model:** desktop supports a persistent navigation rail; medium widths collapse supporting panels; narrow widths retain one primary task column and expose navigation/context through accessible controls rather than horizontal compression.

## Modern Frontend Design completion checklist

### Product and hierarchy

- [x] A first-time user identifies the product, context, and next action within seconds on every primary screen.
- [x] Each screen has one dominant focal element while supporting information remains reachable.
- [x] Content order follows the learner task flow.
- [x] Labels are concrete and action-oriented.

### Visual system

- [x] Typography, color, space, radius, border, elevation, and motion use the documented token system.
- [x] Layout remains understandable without decorative effects.
- [x] Cards, pills, shadows, and gradients have structural or state meaning only.
- [x] The visual language is recognizably a focused learning workspace, not a generic dashboard.

### Interaction and states

- [x] Relevant default, hover, focus-visible, active, disabled, loading, empty, error, success, and offline states are implemented.
- [x] Input receives immediate local feedback before Core/App Server I/O completes.
- [x] Destructive actions are visually differentiated and protected where present.
- [x] Error recovery preserves learner context and states the next available action.

### Responsive behavior

- [x] The application operates at 320px without unintended horizontal scrolling.
- [x] Representative screens are checked at 320px, 768px, and 1440px.
- [x] Layout recomposes by priority instead of merely shrinking.
- [x] Sticky navigation, overlays, virtual keyboard behavior, and safe areas are accounted for.

### Accessibility

- [x] Landmarks, headings, controls, lists, forms, and feedback use semantic HTML.
- [x] Every control is keyboard reachable with a visible focus indicator.
- [x] Text, controls, and state indicators meet the stated contrast target.
- [x] Labels, errors, target sizes, non-color state cues, and reduced motion are covered.
- [x] Functionality remains usable at 200% zoom.

### Performance and resilience

- [x] No redesigned view introduces layout shift from media or asynchronous feedback.
- [x] Effects, fonts, and scripts remain proportionate to their value.
- [x] The primary path remains responsive during background work.
- [x] Slow or failed requests retain intelligible, actionable feedback.

### Verification evidence required before completion

- [x] Formatter/lint, typecheck, unit tests, and production build pass.
- [x] Representative focused-MVP routes and states have durable captures at narrow, medium, and wide widths.
- [x] Keyboard navigation, 200% zoom, and reduced-motion mode are rerun against the final packaged build.
- [x] The final result is compared with the design thesis after the approved boundary choices are implemented.
- [x] A product-owner walkthrough lists page, viewport, action sequence, and expected visible result.

## Completion evidence

| Check | Evidence |
| --- | --- |
| Durable visual evidence | Thirty-two PNG files under `docs/evidence/` retain the fourteen focused routes/states plus final packaged-app login, project creation at 1440/768/320, 200% zoom, reduced motion, keyboard focus, restart persistence, a fresh AI response after MCP isolation, automatic resume/reconciliation at 1440×928 and 320×900, and the exact final DMG eligibility launch at 1440×900. |
| Project isolation | `project-switch-b-loading-1440x900.png` shows the B shell with independent loading copy and no A plan/objective data. `project-switch-b-settled-1440x900.png` shows only B-owned plan and objective content. DOM assertions also rejected stale A text in both states. |
| Semantics and keyboard | Renderer DOM inspection confirmed named navigation, headings, native buttons, radio buttons, select controls, text inputs, status, alert, dialog, and note landmarks. A real CDP Tab event in the packaged app moved focus to the Home button and produced a `3px solid` visible focus indicator, retained in `installed-keyboard-focus-1440x900.png`. |
| Color diversity and contrast | State messages pair labels and left borders with color. Calculated contrast: primary/white 11.57:1, action/white 5.36:1, success/white 5.06:1, warning/white 5.43:1, danger/white 6.05:1, control border/white 4.93:1, and navigation focus/navy 7.31:1. |
| Motion and resilience | The dedicated `prefers-reduced-motion` override removes practical transition and animation duration. The packaged-app run reported `prefers-reduced-motion: reduce` active and a button transition duration of `0.00001s`; evidence is retained in `installed-project-created-reduced-motion-1440x900.png`. Existing event-driven conversation, Core error, preview, offline, recovery, and destructive-confirmation behavior remain unchanged. |
| Automated checks | On 2026-07-22 JST, production build, ESLint, TypeScript, 52 Node tests, 74 Vitest tests, 101 Python unittest tests, scoped Ruff, and mypy completed successfully. Total primary automated tests: 227/227. The boundary test submits the frontend-generated project payload to the production Python Core, and the release-workflow test requires an external Codex CLI 0.144.5 while proving the DMG does not embed Codex. Reconnect tests require disabled input until resume and reconciliation finish, restoration of an in-progress turn, refreshed workspace state after navigation, truthful loading during feature refresh, complete session-list and history-detail pagination, unique provider-history alias matching, retained local history on failure, Renderer-side omission of provider-internal reasoning, and fail-closed multi-page MCP status verification. |

## Product-owner walkthrough

1. At **1440×900** and **320×900**, relaunch and capture the adult eligibility screen. Confirm the acknowledgement and exclusion copy, then continue.
2. At **1440px**, capture the connected dashboard. Confirm the blue navigation rail, product context, local-data status, and one prominent creation action.
3. At **768px** and **320px**, capture the dashboard and setup form. Confirm navigation recomposition and no horizontal scroll.
4. Capture connected learning, objectives/sources, plan, progress, history, notes, bookmarks, settings, and project settings at representative widths.
5. In the setup screen, use the keyboard to confirm the visible focus ring. Check the disabled create action and labeled free-topic fields.
6. Capture loading, empty, success, offline, provider-unavailable, error, and destructive-confirmation states. For deletion, confirm the typed-name gate and focus return.
7. Repeat keyboard navigation, 200% zoom, and reduced-motion verification against the final build. Completed against the packaged app; the retained captures and CDP observations are listed above.
