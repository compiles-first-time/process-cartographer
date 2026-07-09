# Lesson: Agent memory architecture — stateless file-store is insufficient for long-horizon tasks

**Date:** 2026-06-15
**Source:** Literature validation arc (CoALA arXiv:2309.02427; MemGPT arXiv:2310.08560; Wang et al. arXiv:2308.11432)
**Tags:** `[memory-architecture]`, `[sovereign-forge]`, `[l3]`
**Confidence:** [M] — no controlled head-to-head experiment exists; evidence is from system papers and surveys

## Finding

The stateless-session-with-file-write pattern (each agent reads files, does work, writes back) is valid for **coordination and audit** but insufficient for **tasks requiring cross-session learning**.

The CoALA taxonomy (Sumers et al. 2024, ACM Computing Surveys) identifies four memory components for language agents:
- **Working memory** — current in-context information
- **Episodic memory** — records of past sessions and their outcomes
- **Semantic memory** — general facts and knowledge (what is true)
- **Procedural memory** — skills and how-to knowledge

A pure file-store pattern covers working memory (via file reads at session start) and Tier A episodic memory (event log). It does NOT provide structured retrieval over past outcomes — which is what long-horizon tasks (trading cycles, incremental research) need.

MemGPT (Packer et al. 2023) showed that naive stateless operation loses cross-session context essential for long-horizon tasks. Wang et al. (2024) survey confirms: agents relying solely on external storage without structured retrieval exhibit recall failures on tasks requiring cross-session reasoning.

## Loom implication — two tiers

| Tier | Pattern | When sufficient |
|---|---|---|
| Tier A — Coordination | Stateless: read files → work → write files | Audit, handoff, coordination, short-horizon tasks |
| Tier B — Episodic | Vector store over prior session records + semantic retrieval | Long-horizon tasks needing to learn from prior outcomes |

**Decision rule:** if the task reasons about *what worked* across prior sessions (not just *what happened*), it needs Tier B.

Current Loom status: Tier A only. Tier B is planned but not initialized. The vector index slot in L3 (`memory/vector-index/`) is the intended home.

## Sovereign Forge implication

The SF trading cycle is long-horizon by definition — it needs to reason about prior trade outcomes, market regimes, and strategy performance. After 5+ live cycles:

1. Stand up a vector store over `memory/trade-log/`
2. At each session start, retrieve semantically similar prior cycles (same market regime, similar signal pattern)
3. Assemble this as part of the agent's working context for that cycle

This is Tier B episodic memory applied to trading. Do not build before the data exists — an empty vector store adds overhead for no value.

## Caveat

There is no peer-reviewed controlled experiment comparing stateless vs. stateful agent architectures on a controlled long-horizon task. The design-pattern guidance is from survey papers and system papers (MemGPT, CoALA), not RCTs. The evidence base is `[M]` not `[H]`. This conclusion is directionally well-supported but not proven.

## Sources

- Sumers et al. (2024). "Cognitive Architectures for Language Agents (CoALA)." arXiv:2309.02427. *ACM Computing Surveys*.
- Packer et al. (2023). "MemGPT: Towards LLMs as Operating Systems." arXiv:2310.08560.
- Wang et al. (2024). "A Survey on Large Language Model based Autonomous Agents." arXiv:2308.11432. *Frontiers of Computer Science*.
