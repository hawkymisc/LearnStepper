---
name: modern-frontend-design
description: Design, implement, or review polished frontend interfaces with strong information hierarchy, purposeful visual language, responsive composition, complete interaction states, accessibility, and performance. Use when creating or refining websites, web apps, landing pages, dashboards, design systems, React/Vue/Svelte components, HTML/CSS layouts, or when a user asks to make a frontend look modern, premium, clean, distinctive, usable, or production-ready.
---

# Modern Frontend Design

Treat modernity as coherence, not decoration. Build interfaces that make the product's purpose obvious, guide attention deliberately, respond cleanly across devices, and feel complete in every state.

## Workflow

1. Inspect the repository, product context, existing design system, target users, and primary task. Preserve established conventions unless the request explicitly calls for a new direction.
2. Classify the work as a new design, an extension, or a redesign. For UX timing, state transitions, asynchronous behavior, or broad visual changes, state the intended observable behavior and obtain design confirmation before implementation.
3. Write a one-sentence design thesis covering audience, mood, and defining visual idea. Avoid vague goals such as "make it modern."
4. Define the page hierarchy before styling: primary action, key content, supporting content, navigation, and system feedback.
5. Establish a small token system for typography, color, spacing, radii, borders, shadows, and motion. Reuse tokens instead of accumulating one-off values.
6. Implement the structural shell and real content first. Add visual refinement after the hierarchy works without decoration.
7. Design responsive behavior by content priority rather than by shrinking the desktop layout. Specify what reflows, collapses, scrolls, becomes sticky, or disappears.
8. Implement all relevant states: default, hover, focus-visible, active, disabled, loading, empty, error, success, offline, and reduced-motion.
9. Verify the result with the checklist in [review-checklist.md](references/review-checklist.md). Report concrete observations, remaining compromises, and the user-visible review target.

## Design Standard

Apply the principles in [design-principles.md](references/design-principles.md). Use them as decision criteria, not as a fixed visual style.

Prioritize, in order:

1. Product comprehension and task completion.
2. Information hierarchy and interaction clarity.
3. Accessibility and responsive behavior.
4. Visual character and brand expression.
5. Decorative novelty.

## Required Behaviors

- Make the first viewport explain what the product is, what matters now, and what the user can do next.
- Surface missing brand, audience, content, platform, and interaction constraints. Label any provisional direction as an assumption instead of presenting it as an established design decision.
- Use typography, spacing, alignment, and contrast as the primary hierarchy tools.
- Give each visual treatment a job. Remove decoration that does not aid hierarchy, feedback, identity, or delight.
- Keep component boundaries meaningful. Do not turn every section into a rounded card.
- Use familiar controls for familiar actions. Make unusual interactions visibly learnable.
- Preserve visible keyboard focus, semantic structure, readable contrast, and comfortable target sizes.
- Keep motion short and causal. Animate changes of state or spatial relationship; honor `prefers-reduced-motion`.
- Treat loading, empty, error, and success states as first-class screens, not afterthoughts.
- Prefer local assets, existing dependencies, and the project's component system. Add packages only when their value exceeds their cost.
- Maintain performance discipline: reserve media dimensions, avoid layout shift, limit heavy effects, and keep the main interaction path responsive.

## Avoid Generated-UI Defaults

- Do not default to gradient-filled hero sections, glassmorphism, neon glows, excessive shadows, or floating blobs.
- Do not use generic headline-plus-three-cards composition unless the content genuinely has that structure.
- Do not nest cards inside cards or wrap every label in a pill.
- Do not use oversized marketing copy to compensate for weak product hierarchy.
- Do not place instructional prose in the interface when labels, affordances, or layout can communicate the same thing.
- Do not invent statistics, testimonials, activity, notifications, or other fake product data without explicit permission.
- Do not sacrifice usability to visual minimalism. Hidden controls and low-contrast text are not sophistication.

## Review Output

When reviewing an existing frontend, rank findings by user impact:

1. Blocking: prevents comprehension, access, or task completion.
2. Structural: weak hierarchy, navigation, responsive behavior, or state handling.
3. Refinement: typography, spacing, color, motion, or visual consistency.

Tie each finding to visible evidence and a specific remedy. Distinguish intentional style choices from usability defects.
