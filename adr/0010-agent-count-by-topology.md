# ADR-0010: `loom init` agent-count guidance is driven by task topology, not governance need

**Status:** Accepted
**Date:** 2026-05-18
**Author:** Architect handoff (Phase 1 research) — approved by Nick
**Confidence:** [M]

## Context

`layers/L2-agents.md` and spec §E.2 framed the minimal-3 vs. full-6 choice around **governance need** — full-6 for projects with strong governance needs, minimal-3 for everything else.

Phase 1 research re-centers the axis on **task topology**:

- **Parallelizable, breadth-first work** (research, multi-source gathering, "explore N branches in parallel") benefits from multiple agents.
- **Sequential, deep work** (most coding, single linear refactors) is often better single-threaded — the coordination overhead exceeds the parallelism benefit.

The headline multi-agent result — Anthropic's reported +90.2% on the multi-agent research task (June 2025) — has **no equal-token-budget control**. The multi-agent advantage may be partly explained by simply having more tokens, not by having more agents. Cognition's "Don't Build Multi-Agents" (2025) argues the opposite case for deep-narrow tasks. `[research-p1][M]`

Governance need still matters — but it is orthogonal to task topology and is already addressed by the Critic + Constitution Service being present in both `full-6` and `minimal-3` modes.

## Decision

`loom init` agent-set guidance is reframed around task topology:

- **`full-6`** is recommended when the project's work is **breadth-first / parallelizable** (heavy research workload, multi-source aggregation, exploring many branches).
- **`minimal-3`** is recommended when the project's work is **depth-first / sequential** (most coding work, single linear product builds).

The headline multi-agent result must be cited with the **equal-budget caveat** (no equal-token-budget control was run; multi-agent advantage is softer than it looks).

## Consequences

**Locks in:**
- `loom init` prompt copy and L2 guidance frame agent-count selection by task topology.
- The +90.2% claim, where cited, carries the equal-budget caveat.

**Locks out:**
- The "pick full-6 because you care about governance" framing, which conflated two axes.

**Migration path if it fails:** a project that started `minimal-3` can grow into `full-6` by re-enabling the optional agent directories (HR-Agent, EAC, Human-Replica). The decision is reversible.

## Alternatives considered

- **Keep the governance-need framing** — rejected: it conflates two orthogonal axes (governance need and task topology).
- **Always default to full-6** — rejected: O(N²) coordination overhead and Cognition's depth-task evidence both push back.
- **Always default to minimal-3** — rejected: parallelizable workloads genuinely benefit from the full set.

## References

- [`../layers/L2-agents.md`](../layers/L2-agents.md) — Choosing a smaller set
- [`../spec/loom-spec-v0.1-full.md`](../spec/loom-spec-v0.1-full.md) §E.2
- `[research-p1][M]` Phase 1 retrieval & context-engineering research synthesis (Anthropic +90.2% claim; Cognition "Don't Build Multi-Agents" 2025)
