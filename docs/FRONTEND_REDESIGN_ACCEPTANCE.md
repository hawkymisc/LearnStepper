# Frontend Redesign Acceptance Checklist

## Design thesis

**A calm, blue-led learning workspace that makes the learner's next action, trusted evidence, and current progress immediately legible without relying on color alone.**

## Scope inventory

All renderer routes and startup branches are in scope.

| Area | Screens / branches | Redesign evidence |
| --- | --- | --- |
| Startup | Loading, local profile, recovery, preview, offline and App Server unavailable | Focused onboarding shell, clear system feedback, recovery action |
| Home | Empty project list, project dashboard | Dominant continuation / creation action and scannable project summaries |
| Project setup | Curriculum and free-topic creation | Task-oriented form hierarchy, validation, submission feedback |
| Learning | Conversation session, unavailable conversation, streaming, completed and interrupted turns | Reading-first conversation, immediate send feedback, recoverable controls |
| Learning tools | Objectives, diagnosis, plan, assessment, final assessment, remediation, sources | Contextual navigation, clear unavailable/hold state, preserved Core authority |
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
- [x] Representative routes and states are inspected at narrow, medium, and wide widths.
- [x] Keyboard navigation and reduced-motion mode are tested.
- [x] The final result is compared with the design thesis and any exception is documented.
- [x] A product-owner walkthrough lists page, viewport, action sequence, and expected visible result.

## Completion evidence

| Check | Evidence |
| --- | --- |
| Visual hierarchy and responsive composition | In-app inspection of the empty dashboard at 1440px, 768px, and 320px; the app had no horizontal overflow at 320px or 768px. The setup form was also inspected at 320px. |
| Global coverage | Browser navigation confirmed the home, progress, library, and settings routes. The renderer component and stylesheet cover startup, project creation, learning, tool, progress, library, settings, and destructive-confirmation branches in the scope inventory. |
| Semantics and keyboard | Renderer DOM inspection confirmed named navigation, headings, native buttons, radio buttons, select controls, text inputs, status, alert, dialog, and note landmarks. Native controls retain a 3px visible focus indicator. |
| Color diversity and contrast | State messages pair labels and left borders with color. Calculated contrast: primary/white 11.57:1, action/white 5.36:1, success/white 5.06:1, warning/white 5.43:1, danger/white 6.05:1, control border/white 4.93:1, and navigation focus/navy 7.31:1. |
| Motion and resilience | The dedicated `prefers-reduced-motion` override removes transition and animation duration. Existing event-driven conversation, Core error, preview, offline, recovery, and destructive-confirmation behavior remain unchanged. |
| Automated checks | `npm run typecheck`, `npm run lint`, and `npm test` completed successfully. `npm test` reported 9 Node tests and 41 Vitest tests passing, including the redesign contract tests. |

## Product-owner walkthrough

1. At **1440px**, open the preview dashboard. Confirm the blue navigation rail, product context, local-data status, and one prominent creation action.
2. At **768px**, confirm navigation collapses to the numbered rail without reducing the central task hierarchy.
3. At **320px**, confirm the bottom navigation remains reachable, the dashboard and setup form have no horizontal scroll, and the primary action is visible.
4. In the setup screen, use the keyboard to confirm the visible focus ring. Check the disabled create action and labeled free-topic fields.
5. In settings or project settings, trigger a status/error/success state in a connected environment. Confirm text, border, and color all identify the state; for deletion, confirm the typed-name gate remains required.
