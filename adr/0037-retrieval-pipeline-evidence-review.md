# ADR-0037: Retrieval pipeline evidence review and extensions

**Status:** Accepted
**Date:** 2026-06-01
**Author:** Builder (research arc) — approved by Nick
**Confidence:** [H]

## Context

ADR-0003 (accepted 2026-05-18) established the project-agnostic retrieval pipeline: hybrid BM25+embedding retrieve -> cross-encoder rerank -> assemble. It was authored during Phase 1 research based on evidence available at that time: Cormack et al. 2009 (RRF), Santhanam et al. 2022 (ColBERTv2), Chroma chunking evaluation 2024, Cuconasu et al. 2024 ("Power of Noise"), and Kusupati et al. 2022 (Matryoshka).

Per LR-05, every architectural decision is best-current-call until superseded by independent peer-reviewed evidence. The 2026-05-31 RAG research arc surveyed 30 sources (28 arxiv primary, 2 practitioner) across three tracks to determine whether ADR-0003's decisions still hold. Full synthesis: [`research/2026-05-31-rag-scale-synthesis.md`](../research/2026-05-31-rag-scale-synthesis.md).

Three questions drove the review:

1. Does GraphRAG (Edge et al. 2024) supersede flat-chunk hybrid retrieval?
2. Does ColBERTv2/PLAID supersede the bi-encoder + cross-encoder reranker pipeline?
3. Do iterative/agentic RAG patterns require a new constitutional constraint on token cost?

## Decision

**ADR-0003 is confirmed as best-current-call.** Its core pipeline (hybrid BM25+embedding + RRF + cross-encoder rerank) is validated by 6 independent peer-reviewed papers published after the original evidence basis. No superseding evidence was found.

**Four extensions are added** (none contradicts ADR-0003; all are additive):

### A. GraphRAG as optional L3 complement

GraphRAG (Edge et al. 2024) is a **complement** to ADR-0003's flat-chunk pipeline, not a replacement. It is warranted when a project's query patterns include multi-hop reasoning or global sensemaking.

**When to add it:** project discovery identifies multi-hop or corpus-global query patterns as primary use cases (legal analysis across document sets, knowledge base synthesis, cross-document reasoning).

**When NOT to add it:** single-hop fact retrieval, detail-oriented lookups, cost-constrained deployments. GraphRAG imposes ~45x token overhead in global mode and has a structural recall ceiling (~65–66% entity capture in KG construction).

**Architecture:** the hybrid selection-and-integration pattern — both flat-chunk and graph-based retrieval run, a query-type router selects or merges results. This is an extension of ADR-0003's pipeline, not a replacement of any stage.

### B. ColBERTv2+PLAID as alternative reranker

ADR-0003's cross-encoder default remains correct for the standard pipeline (reranking 15–30 candidates). ColBERTv2+PLAID in reranker mode is a documented alternative for projects with:

- **Larger candidate sets** (>30 candidates post-RRF fusion): ColBERT scales better than cross-encoders, which become prohibitive past ~50 candidates.
- **Stricter latency budgets** (<25ms reranking): ColBERT reranking runs at ~22.6ms vs cross-encoder's ~49.9ms, with 92% top-5 overlap.
- **Acceptable index tradeoffs:** ColBERT indexes are not incremental (full rebuild on document add) and larger (16–25 GiB compressed for MS MARCO scale).

Cross-encoders retain the precision advantage on small candidate sets (<10 documents). The choice is a documented project-level decision, not a Loom-level default change.

### C. Confidence-score gating before generation

Multiple sources converge on confidence gating as a hallucination defence:

- CRAG's 3-action confidence gate (Correct / Incorrect / Ambiguous) `[primary][H]`
- Self-RAG's reflection tokens for selective retrieval `[primary][H]`
- Practitioner pattern: weighted confidence score with hard threshold (refuse generation below threshold) `[practitioner][M]`

**Addition to ADR-0003's pipeline:** between the rerank and assemble stages, a confidence gate evaluates the top-ranked chunk set. If confidence falls below a project-configured threshold, the pipeline returns "insufficient information" rather than generating from low-quality context. The gate is the operational form of ADR-0003 finding #4 (Power of Noise: semantically-similar-but-irrelevant passages hurt accuracy more than random text).

**The threshold is project-specific** — not prescribed by Loom. The retrieval eval framework (ADR-0006) provides the measurement surface for calibrating it.

### D. Token-cost discipline for iterative patterns (LR-06)

Iterative RAG patterns (Self-RAG, IRCoT, LATS, agentic retrieval loops) exist on a 1x–658x token-cost spectrum. The typical production range is 2.5x–5.4x; tree-search patterns reach 10–20x; unbounded patterns can reach 658x. Quality plateaus past a small iteration cap.

**LR-06** (proposed alongside this ADR) establishes the discipline: every iterative LLM pattern must declare an exit condition, estimate a token bound, and emit actual cost to the event log. This constrains the cost curve without prescribing specific thresholds.

## Evidence basis

> **Required v0.4+ per [LR-05](../constitution/local-rules.md#lr-05).**

- **Primary evidence:**
  - Edge et al. 2024 (arxiv 2404.16130): GraphRAG 72–83% comprehensiveness on global queries; scoped to global sensemaking `[primary][H]`
  - arxiv 2502.11371v2: GraphRAG vs flat RAG benchmark; 65–66% KG entity recall; +6.4pp hybrid improvement `[primary][H]`
  - arxiv 2604.09666: +27.23 EM multi-hop, +0.47 single-hop; agentic search narrows gap 32.3% `[primary][H]`
  - arxiv 2506.05690v3: 45x token overhead; task-complexity crossover `[primary][H]`
  - arxiv 2604.01733v1: Hybrid RRF + cross-encoder: Recall@5=0.816; BM25 outperforms dense on structured docs; CRAG marginal (+1.4pp) `[primary][H]`
  - Santhanam et al. 2022 (arxiv 2112.01488): ColBERTv2 MRR@10=39.7%; 6–10x compression `[primary][H]`
  - Santhanam et al. 2022 (arxiv 2205.09707): PLAID 7x GPU / 45x CPU speedup `[primary][H]`
  - Yan et al. 2024 (arxiv 2401.15884): CRAG single-pass, 2.6% overhead `[primary][H]`
  - arxiv 2602.05728v1: CompactRAG cost comparison; IRCoT=5.37x overhead `[primary][H]`
  - Zhou et al. 2023 (arxiv 2310.04406v3): LATS O(k*n) cost model `[primary][H]`
  - McCleary & Ghawaly 2026 (arxiv 2603.08877): accuracy plateau past small cap `[primary][H]`
  - arxiv 2601.10955: 658x worst-case token inflation `[primary][H]`
- **Corroborating sources:** arxiv 2507.03226v3 (enterprise GraphRAG+RRF); arxiv 2310.11511 (Self-RAG); arxiv 2511.05385v1 (TeaRAG 59–61% token reduction). All `[primary][H]`.
- **Practitioner corroboration:** Vishal Mysore 2026 (Medium); Sease 2025 (ColBERT deployment); Pinecone 2025 (reranker comparison). All `[practitioner][M]`.
- **What would change this call:**
  - §A: GraphRAG achieving >90% retrieval recall AND comparable cost to flat-chunk hybrid on single-hop queries
  - §B: Official ColBERT v3 closing precision gap on small candidate sets; or incremental PLAID indexing
  - §C: Peer-reviewed evidence that confidence gating degrades quality (unlikely but would change the threshold recommendation)
  - §D: Evidence that unbounded iterative retrieval consistently improves quality past the 5x cost point without plateau

## Consequences

**Locks in:**
- ADR-0003's pipeline is now validated by multi-source evidence, not just Phase 1 research
- GraphRAG is positioned as optional complement, preventing premature adoption as replacement
- Token-cost discipline is constitutionalized (LR-06), applying to all future loop patterns, not just retrieval

**Locks out:**
- Adopting GraphRAG as the default retrieval pipeline (evidence clearly shows it's worse for single-hop)
- Ignoring token cost in iterative patterns (LR-06 makes exit conditions mandatory)
- Deploying iterative RAG without cost observability

**Migration path:** Each extension (A–D) is independently adoptable. A project can add GraphRAG (A) without changing its reranker (B). Confidence gating (C) slots into the existing pipeline between rerank and assemble. LR-06 (D) applies to all new patterns regardless of retrieval architecture.

## Alternatives considered

- **Supersede ADR-0003 entirely with a new pipeline** — rejected: the evidence confirms ADR-0003, not contradicts it. Supersedence would create unnecessary migration churn.
- **Add GraphRAG as a Loom default** — rejected: 45x token overhead and 65–66% entity recall ceiling make it unsuitable as a default. It's a project-level addition.
- **Replace cross-encoder with ColBERT as default reranker** — rejected: cross-encoder precision advantage on small candidate sets (ADR-0003's use case) is well-documented. ColBERT is an alternative, not a replacement.
- **Defer LR-06 until more cost data** — rejected: the 658x worst case and accuracy-plateau evidence are sufficient to justify the discipline rule now. Hardening to enforcement can wait.

## Affects / Affected by

**This ADR affects:**

- [`layers/L3-memory.md`](../layers/L3-memory.md) — retrieval pipeline section (add GraphRAG complement, confidence gate, ColBERT option)
- [`adr/0003-retrieval-pipeline.md`](./0003-retrieval-pipeline.md) — evidence basis update (this ADR extends, does not supersede)
- [`adr/0006-retrieval-evaluation.md`](./0006-retrieval-evaluation.md) — eval framework must cover confidence-gate calibration
- [`constitution/local-rules.md`](../constitution/local-rules.md) — LR-06 addition
- Future ADRs introducing iterative retrieval patterns — must include Cost model section per LR-06

**This ADR is affected by:**

- [`constitution/kernel-v6.md`](../constitution/kernel-v6.md) — Rule 22 (epistemic transparency: cost observability)
- [`constitution/local-rules.md`](../constitution/local-rules.md) — LR-05 (best-current-call discipline: this review is LR-05 in action)
- [`adr/0003-retrieval-pipeline.md`](./0003-retrieval-pipeline.md) — the decision being reviewed
- [`adr/0004-context-budget.md`](./0004-context-budget.md) — context budget constrains GraphRAG's token overhead
- [`adr/0009-research-standards.md`](./0009-research-standards.md) — source tiering applied to all evidence

## References

- [`research/2026-05-31-rag-scale-synthesis.md`](../research/2026-05-31-rag-scale-synthesis.md) — full research synthesis (30 sources, 15 primary cited)
- [ADR-0003](./0003-retrieval-pipeline.md) — the decision under review
- [LR-06](../constitution/local-rules.md#lr-06) — token-cost discipline (proposed alongside this ADR)
- Edge et al. 2024, arxiv 2404.16130 `[primary][H]`
- Santhanam et al. 2022, arxiv 2112.01488 `[primary][H]`
- Yan et al. 2024, arxiv 2401.15884 `[primary][H]`
