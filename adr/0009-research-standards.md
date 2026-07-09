# ADR-0009: Research standards — Update Bus tiering + EAC absorbs research discipline

**Status:** Accepted
**Date:** 2026-05-18
**Author:** Architect handoff (Phase 1 research) — approved by Nick
**Confidence:** [M]

## Context

Two gaps in v0.1:

- `agents/eac/SKILL.md` researches domains "by trial and error" with no source-quality standard.
- `layers/L7-extension.md` ingests "external research feeds" with no tiering.

The user owns a separate `research-advisor` skill that already encodes source tiering and anti-hallucination discipline. Loom did not reference it. The Phase 1 research itself relied on source-quality discrimination to discount low-rigor claims; Loom should bake that discipline in.

## Decision

1. The Update Bus applies a **source-tier filter** to incoming research, as the first pipeline stage (per ADR-0007).
2. The EAC **absorbs research standards** as part of its existing role — rather than introducing a 7th base agent (e.g., a dedicated `Researcher`).

The source tiers are defined **once**, in [`../layers/L7-extension.md`](../layers/L7-extension.md) under "Source tiering":

- **Tier 1** — peer-reviewed papers, official standards / official vendor docs, primary sources.
- **Tier 2** — established institutional / analyst reports with named editorial standards.
- **Tier 3** — reputable secondary press with editorial oversight.
- **Rejected** — forums, user-generated content, social media, undated / anonymous sources, AI-generated content without primary citations.

The Update Bus filter admits Tier 1–3 only. The EAC's research discipline references the same tiers.

## Consequences

**Locks in:**
- One canonical tier vocabulary used by both L7 (Update Bus filter) and L2 (EAC research discipline) and L3 (memory quarantine — ADR-0007).
- The EAC is now expected to discriminate sources, cross-validate load-bearing claims against ≥2 independent sources, and report confidence with "what would raise this to 95%?".

**Locks out:**
- The EAC citing forum content as load-bearing input.
- Research feeds being trusted by virtue of being subscribed-to.

**Migration path if it fails (i.e., research load grows):** introduce a dedicated `Researcher` base agent as a 7th member of the base set. That is recorded here as the documented alternative; the v0.1 decision is to fold the duty into the EAC.

## Alternatives considered

- **Dedicated `Researcher` base agent** — rejected for v1: keeps base set at six per L2 preference for the smallest agent set; reopen if research load grows.
- **Tier the Update Bus only, leave EAC unchanged** — rejected: the EAC is itself a research path into the project's memory, so without internal discipline the bus filter alone is insufficient.
- **Reference the user's external `research-advisor` skill directly** — partially adopted: the standards described here align with that skill, but Loom owns the standards in-tree so projects do not depend on an external skill being available.

## References

- [`../layers/L7-extension.md`](../layers/L7-extension.md) — Source tiering subsection (canonical tier definitions)
- [`../agents/eac/SKILL.md`](../agents/eac/SKILL.md) — Research standards section
- [`../spec/loom-spec-v0.1-full.md`](../spec/loom-spec-v0.1-full.md) §B.5 (EAC) and §B.8 (Update Bus)
- ADR-0007 — trust boundary (this ADR defines the tiers the boundary uses)
- `[research-p1][M]` Phase 1 retrieval & context-engineering research synthesis
