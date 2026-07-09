# ADR-0016: Update Bus v0.2 stub — schema + no-op tick

**Status:** Accepted
**Date:** 2026-05-18
**Author:** Architect handoff — Loom v0.2 enforcement runtime — approved by Nick
**Confidence:** [H]

> **Update (2026-07-07 audit):** The "v0.3 ships the full implementation" forward-reference is only **partially** realized: [ADR-0041](./0041-update-bus-observatory-integration.md) added inbox parsing + decision write-back via the Observatory, but live feed-polling + the source-tier filter remain unimplemented.

## Context

The v0.1 spec describes the Update Bus (§B.8 / L7) as the living-software mechanism: external research feeds, project lessons-learned, and internal pattern audits flow into an inbox, the Critic reviews, the Human Replica previews, the user approves, and accepted items become ADRs + spec updates.

In v0.1 the bus was *folders with no implementation*. v0.2 is not the right time to ship the full implementation (that's v0.3 on the roadmap), but shipping nothing leaves the schema undefined — v0.3 would have to design from scratch.

## Decision

v0.2 ships the **stub layer**: the schema and the wire-up point, no live feed polling.

1. **`update-bus/schema.json`** — JSON Schema (draft 2020-12) formalizing the v0.1 markdown frontmatter into a strict schema. Fields: `id`, `source`, `proposed_by`, `date`, `source_tier`, `affects`, `risk`, `collapse_risk`, plus optional `critic_review`, `human_replica_recommendation`, `user_decision` sub-objects that get populated as items move through the pipeline.

2. **`scripts/update-bus-tick.{sh,ps1}`** + **`scripts/lib/update-bus-tick.mjs`** — the no-op tick. Reports inbox/archive counts, validates `schema.json` parses, prints the v0.3 receiver API contract (POST `/inbox`, GET `/inbox`, POST `/inbox/<id>/decision`).

3. **`update-bus/README.md`** is amended with a "Receiver API (v0.2 stub)" section and a "v0.3 wire-up plan" section, so anyone landing on the page in v0.3 knows the contract they're implementing against.

The tick script is exec'd by a v0.3 cron / scheduled task; in v0.2 a human invokes it to confirm the wire-up.

## Consequences

**Locks in:**
- The shape of an Update Bus inbox item. v0.3 implementers don't have to redesign the schema.
- The receiver API contract.
- A clean upgrade path: v0.3 replaces the no-op tick body with feed polling + tier filter + inbox writes; the surrounding wrapper scripts stay.

**Locks out:**
- Loose / inconsistent inbox item shapes from project to project.
- v0.3 implementers re-discovering "wait, what fields does an item need?" — that's now in `schema.json`.

**Migration path if it fails:** the schema can evolve through normal ADR amendments. The tick script is no-op, so removing it is harmless.

## Alternatives considered

- **Ship a minimal real implementation that polls one feed.** Rejected: the source-tier filter (per ADR-0007 / ADR-0009) is the load-bearing safety mechanism, and implementing it correctly requires more than the v0.2 budget. Better to design the schema once and implement against it.
- **Skip the schema; let v0.3 design it.** Rejected: defers a decision we can make now, and risks v0.3 designing under time pressure.
- **Use YAML for the schema (for consistency with `tools/mcp-servers/config.yaml`).** Rejected: JSON Schema is the standard for "structured schema definition"; YAML schema definitions are awkward. The inbox items themselves remain markdown-with-frontmatter (per v0.1) but the v0.3 receiver will validate frontmatter against `schema.json`.
- **Ship a real-time receiver as part of v0.2.** Rejected: requires a long-running process or webhook handler. v0.2's scope is "additions to a template," not "stand up a service."

## References

- [`../update-bus/schema.json`](../update-bus/schema.json) — JSON Schema for inbox items
- [`../update-bus/README.md`](../update-bus/README.md) — Receiver API + v0.3 plan
- [`../scripts/lib/update-bus-tick.mjs`](../scripts/lib/update-bus-tick.mjs) — no-op tick
- ADR-0007 (trust boundary) and ADR-0009 (source tiers) — the safety mechanisms the v0.3 implementation enforces
- v0.1 spec §B.8 — Update Bus design
- L7-extension.md — pipeline diagram (Critic / Human Replica / user)
