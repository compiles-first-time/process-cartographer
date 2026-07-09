# ADR-0004: Context budget — per-agent declared, orchestrator-enforced

**Status:** Accepted
**Date:** 2026-05-18
**Author:** Architect handoff (Phase 1 research) — approved by Nick
**Confidence:** [H]

## Context

Loom v0.1 operationalized context discipline **only** as file size caps in L1 (≤10KB CLAUDE.md, ≤5KB AGENTS.md, etc.). There was no per-agent context budget, no just-in-time retrieval policy, no compaction discipline. "Context engineering" — deciding what goes *in* an agent's context vs. what is *fetched* on demand — is the discipline this framework most needs and did not name.

Phase 1 research evidence:

- **Effective context length runs 1–2 orders of magnitude below the advertised window.** NoLiMa (Modarressi et al., ICML 2025) found a 200K-window model retained reliable retrieval to only ~4K tokens on lexical-overlap-free tasks; a 2M-window model to ~2K. `[research-p1][H]`
- The binding constraint on quality is **allocation**, not window size. Anthropic's "Effective context engineering for AI agents" (2025) names just-in-time retrieval, compaction, and structured note-taking as the core techniques. `[research-p1][H]`

Combined with ADR-0003: retrieval and assembly must produce a set that **fits the requesting agent's budget**, not a set that fits the model's advertised window.

## Decision

Every agent **declares a context budget** in its `SKILL.md`. The orchestrator (the L5 supervisor) **enforces** that budget at dispatch time. Retrieval (ADR-0003) and assembly respect it.

- `SKILL.md` gets a `context_budget:` field — a target maximum of *useful* tokens, distinct from the model's advertised window.
- The supervisor (a) **assembles each agent's context just-in-time** rather than preloading; (b) **enforces the declared budget** before dispatch; (c) **triggers compaction** for long-running tasks, hooked into the existing "closing the books" checkpoint pattern in L5.
- The L3 retrieval pipeline returns a set that fits the requesting agent's budget — overflow is the retriever's problem, not the agent's.

## Consequences

**Locks in:**
- Every agent has a numeric budget, visible in its `SKILL.md`. Budgets are a first-class architectural property.
- Just-in-time context assembly is the default; "preload everything" is now an anti-pattern.
- Long-running tasks must compact; "closing the books" is now the compaction trigger.

**Locks out:**
- Silent context bloat as the model's window grows.
- "Solve it by switching to a bigger-window model" — addressed directly in ADR-0005.

**Migration path if it fails:** budgets are advisory metadata; if enforcement proves too rigid for a domain, relax the supervisor check before changing the spec.

## Alternatives considered

- **Rely on the model's window** — rejected: NoLiMa shows effective length is 1–2 orders of magnitude below the advertised window. Window size is not the binding constraint.
- **Single global budget** — rejected: different agents (e.g., a Critic vs. a long-task specialist) have legitimately different needs.
- **Implicit, undocumented budgets** — rejected: this is exactly the status quo that produced the gap.

## References

- [`../layers/L2-agents.md`](../layers/L2-agents.md) — Context budget section
- [`../layers/L5-orchestration.md`](../layers/L5-orchestration.md) — Context engineering section
- [`../layers/L3-memory.md`](../layers/L3-memory.md) — retrieval must respect the budget
- [`../spec/loom-spec-v0.1-full.md`](../spec/loom-spec-v0.1-full.md) §B.3 and §B.6
- ADR-0003 — retrieval pipeline pairs with this
- ADR-0005 — routing must be budget-aware, not window-aware
- `[research-p1][H]` Phase 1 retrieval & context-engineering research synthesis
