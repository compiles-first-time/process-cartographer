# Critic checklist — Accessibility

> Used by the Critic subagent when reviewing discovery artifacts. Per [ADR-0026](../../../adr/0026-discovery-gate.md).

## Standard

- [ ] Target standard declared (WCAG 2.2 AA recommended; EAA / Section 508 / ADA may also apply)
- [ ] Conformance level (A / AA / AAA) chosen per regulatory regime

## Perceivable

- [ ] Color contrast meets AA (4.5:1 text; 3:1 large text)
- [ ] Alt text strategy for images / icons
- [ ] Captions / transcripts for video + audio
- [ ] No information conveyed by color alone

## Operable

- [ ] Full keyboard navigation (tab order, focus visible, no keyboard traps)
- [ ] Skip-to-content link
- [ ] Touch target size ≥ 44×44 CSS pixels (WCAG 2.5.5)
- [ ] Time limits adjustable or absent
- [ ] Motion-reducing media query (prefers-reduced-motion)

## Understandable

- [ ] Language declared on root element (lang attribute)
- [ ] Form labels associated programmatically
- [ ] Error messages identify the field + how to fix
- [ ] Consistent navigation across pages

## Robust

- [ ] Valid HTML (passes parser)
- [ ] ARIA used only where native semantics are insufficient
- [ ] Tested with at least one screen reader (NVDA / VoiceOver / JAWS)

## Process

- [ ] Automated accessibility testing in CI (axe-core, pa11y, lighthouse)
- [ ] Manual keyboard + screen-reader testing before release
- [ ] Accessibility statement published

## References

- WCAG 2.2 — `[institutional][H]`
- EAA (European Accessibility Act, 2025) — `[institutional][H]`
- Section 508 — US federal accessibility requirements — `[institutional][H]`
