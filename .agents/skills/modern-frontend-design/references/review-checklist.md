# Frontend Review Checklist

## Product and hierarchy

- Can a first-time user identify the product, current context, and primary action within seconds?
- Is one element clearly dominant without making supporting information hard to find?
- Does the content order match the user's task rather than the DOM author's convenience?
- Are labels concrete and action-oriented?

## Visual system

- Do typography, color, spacing, radii, borders, shadows, and motion use a small coherent token set?
- Does the layout work without relying on decorative effects?
- Are cards, pills, gradients, and shadows used only where they communicate structure or state?
- Is the interface recognizably suited to this product rather than a generic template?

## Interaction and states

- Are hover, focus-visible, active, disabled, loading, empty, error, success, and offline states covered where relevant?
- Does user input receive immediate local feedback before slow I/O completes?
- Are destructive actions differentiated and protected appropriately?
- Can users recover from errors without losing their work or place?

## Responsive behavior

- Does the layout remain usable at 320px without unintended horizontal scrolling?
- Are intermediate widths tested, not only mobile and desktop extremes?
- Does content recompose by priority rather than merely shrink?
- Are sticky elements, overlays, virtual keyboards, and safe areas accounted for?

## Accessibility

- Is semantic HTML used for landmarks, headings, controls, lists, and tables?
- Is every interaction keyboard reachable with a visible focus indicator?
- Do text, controls, and state indicators meet appropriate contrast requirements?
- Are labels, error associations, alt text, target sizes, and reduced motion handled?
- Does zooming to 200% preserve content and operation?

## Performance and resilience

- Are media dimensions reserved to avoid layout shift?
- Are fonts, images, effects, and third-party scripts proportionate to their value?
- Does the primary interaction remain responsive during loading or background work?
- Does the interface degrade intelligibly on slow networks and failed requests?

## Final verification

- Run the project's formatter, type checks, unit tests, and production build when available.
- Inspect representative routes and states at narrow, medium, and wide widths.
- Test keyboard navigation and reduced-motion mode.
- Compare the result against the design thesis and report any deliberate exceptions.
- Provide a concrete product-owner review path: page, viewport, action sequence, and expected visible result.
