# ADR-0007: Retrieved and external content is untrusted until validated

**Status:** Accepted
**Date:** 2026-05-18
**Author:** Architect handoff (Phase 1 research) — approved by Nick
**Confidence:** [H]

## Context

Nothing in v0.1 L3 or L7 treated retrieved or external content as untrusted. The memory layer ingests web-search results; the Update Bus ingests external research feeds. Both paths bypass the lessons-learned "compilation gate" that the v0.1 spec correctly designed for human-authored lessons.

The user has explicitly deferred *agent-sovereignty* security (§E.6 of the spec). That is an **access-control** axis. **Data-integrity** security is a *different* axis and is **not** deferred.

Phase 1 research:

- **PoisonedRAG (Zou et al., USENIX Security 2025):** ~90% attack success by injecting ~5 malicious documents into a million-document vector store. `[research-p1][H]`
- **MEXTRA (Wang et al., ACL 2025):** ~25% of a memory store extractable via black-box queries. `[research-p1][H]`
- **OWASP LLM Top 10 (2025):** codifies this as **LLM08 — Vector & Embedding Weaknesses**. `[research-p1][H]`

The fix is policy-level (declare untrusted-by-default) plus mechanism-level (a validation gate before write).

## Decision

Retrieved and external content is **untrusted** until validated. It must not be written to memory, nor acted on as instruction, without passing a validation gate.

Concrete implementations:

- **`constitution/local-rules.md`** — a project-agnostic default rule states the policy in load-bearing language so every project inherits it.
- **L3 (memory)** — content entering the vector index or knowledge graph from external sources is quarantined / flagged until validated; tier metadata is recorded with each record.
- **L7 (Update Bus)** — incoming feeds pass a **source-tiering filter** (see ADR-0009 for the tier definitions) **before** the Critic review step.

## Consequences

**Locks in:**
- Every project carries the trust-boundary policy at the constitutional layer.
- Vector-index and KG ingestion paths must implement quarantine.
- The Update Bus has a tier filter as an explicit pipeline stage.

**Locks out:**
- The "scrape and embed" anti-pattern.
- The implicit assumption that a search-engine result is a citable claim.

**Migration path if it fails:** the constitutional rule is the load-bearing piece; the L3 and L7 mechanisms can be tightened or relaxed without changing the rule.

## Alternatives considered

- **Treat all retrieved content as trusted, log only** — rejected: PoisonedRAG / MEXTRA evidence makes this indefensible.
- **Quarantine without a constitutional rule** — rejected: the project-local mechanism would drift; the rule belongs at L0/local-rules level so Constitution Service can enforce it.
- **Block external ingest entirely** — rejected: too restrictive; defeats the purpose of the Update Bus and the EAC's research role.

## References

- [`../constitution/local-rules.md`](../constitution/local-rules.md) — LR-01
- [`../layers/L3-memory.md`](../layers/L3-memory.md) — Trust boundary
- [`../layers/L7-extension.md`](../layers/L7-extension.md) — source-tiering filter
- [`../spec/loom-spec-v0.1-full.md`](../spec/loom-spec-v0.1-full.md) §B.4 and §B.8
- ADR-0009 — defines the source tiers used by the filter
- `[research-p1][H]` Phase 1 retrieval & context-engineering research synthesis
