# ADR-NNNN: <Title>

**Status:** Proposed | Accepted | Superseded by ADR-XXXX
**Date:** YYYY-MM-DD
**Author:** <agent or human>
**Confidence:** [H] | [M] | [L] | [S]

## Context

<What problem are we solving? What forced the decision? What constraints are in play?>

## Decision

<What we decided. Stated as a positive assertion, not a question.>

## Evidence basis

> **Required v0.4+ per [LR-05](../constitution/local-rules.md#lr-05).** Every decision is a best-current-call until superseded by independent peer-reviewed evidence that contradicts the basis cited here.

- **Primary evidence:** <peer-reviewed citation / official docs / measured benchmark>. Provenance tag(s): `[source][confidence]`.
- **Corroborating sources** *(independent — checked at the publisher level, not just URL)*: <list ≥ 1 for `[H]`; can be empty for `[M]` or below>.
- **Synthesizer reasoning** *(only if no primary evidence available)*: <one paragraph; tag the decision `[synth][S]`>.
- **What would change this call:** <concrete signal that would justify a superseding ADR — e.g., "a peer-reviewed paper measuring X with N≥1000 finds the opposite," or "an audit reveals the assumed property doesn't hold in production">.

## Cost model

> **Required per [LR-06](../constitution/local-rules.md#lr-06) when this ADR introduces an iterative LLM pattern (retrieval loop, multi-agent fan-out, tree search, self-reflective chain).** Omit this section if the ADR does not introduce a loop pattern.

- **Which LLM calls are iterative:** <describe the loop>
- **Exit condition:** <iteration cap / convergence criterion / budget ceiling>
- **Estimated token bound (typical):** <N tokens per invocation under normal conditions>
- **Estimated token bound (worst case):** <N tokens if exit condition is the only brake>
- **Cost multiplier vs single-pass baseline:** <Nx — e.g., "~3x single-pass RAG">

## Consequences

<What this locks in. What this locks out. Migration path if it fails. Anything new that becomes possible / impossible.>

## Alternatives considered

<List of options weighed, with one-line reasons for rejection.>

## Affects / Affected by

> **Required v0.4+ per [ADR-0022](./0022-xlsx-docs-convention.md).** Bidirectional dependency tracking so a future change here surfaces every artifact that needs to update with it. `loom doctor` verifies the links are bidirectional.

**This ADR affects** *(downstream — when this ADR changes, these must be reviewed)*:

- `layers/<L*>.md` — <which section>
- `scripts/<file>` — <what behavior depends on this>
- `adr/<NNNN>` — <which subsequent ADR builds on this>

**This ADR is affected by** *(upstream — these define constraints on this decision)*:

- `constitution/kernel-v6.md` — <which Rule>
- `constitution/local-rules.md` — <which LR>
- `adr/<NNNN>` — <which prior ADR this extends or specializes>

## References

<Links to spec sections, prior ADRs, external evidence. Provenance tags `[source][confidence]`.>
