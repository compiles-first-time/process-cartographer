# ADR-0005: LLM routing is effective-context-aware, not window-size-aware

**Status:** Accepted
**Date:** 2026-05-18
**Author:** Architect handoff (Phase 1 research) — approved by Nick
**Confidence:** [H]

## Context

The v0.1 L4 routing table sent long-context work to Gemini with the note *"degrades ~800K tokens `[transcript][H]`"*. The 800K figure came from a podcast — not a peer-reviewed source.

Phase 1 research:

- **NoLiMa (Modarressi et al., ICML 2025)** measures *effective* context length on lexical-overlap-free retrieval. Gemini 1.5 Pro's effective length lands near ~2K tokens, not 800K. A 200K-window model reliably retrieves only ~4K tokens on the hard task; a 2M-window model only ~2K. `[research-p1][H]`
- The failure mode of routing the hardest-context work to the largest-window model is **silent** — the model returns plausible-looking output that has degraded retrieval quality. No error fires.

The right reflex when context exceeds an effective budget is **retrieval** (ADR-0003), not selecting a bigger-window model.

## Decision

LLM routing is based on the **effective context budget** for the task (the agent's declared `context_budget:` per ADR-0004 plus a model-specific effective-length multiplier), not on the model's advertised window.

When a task's required context exceeds an effective budget for any reasonably-sized model:

- Route it through the L3 retrieval pipeline (chunk → retrieve → rerank → assemble, ADR-0003).
- Do **not** "solve" it by selecting a model with a bigger advertised window.

## Consequences

**Locks in:**
- Routing decisions reference an `effective-context` figure, not an advertised window.
- Oversized-context tasks become retrieval problems by default.

**Locks out:**
- The "just send everything to the 1M-window model" anti-pattern.
- The podcast-sourced 800K figure as load-bearing engineering input.

**Migration path if it fails:** the effective-length multipliers are model metadata; if a future model genuinely retains quality at long context, update the multipliers — the routing rule does not change.

## Alternatives considered

- **Route on advertised window** — rejected: NoLiMa shows this produces silent failure on hard retrieval.
- **Cap context centrally with no routing logic** — rejected: this throws away the ability of some models to handle moderately long context well.

## References

- [`../layers/L4-tooling.md`](../layers/L4-tooling.md) — LLM provider routing
- [`../spec/loom-spec-v0.1-full.md`](../spec/loom-spec-v0.1-full.md) §B.5
- ADR-0003 (retrieval pipeline) — what oversized-context tasks get routed *to*
- ADR-0004 (context budget) — what "effective" is measured against
- `[research-p1][H]` Phase 1 retrieval & context-engineering research synthesis
