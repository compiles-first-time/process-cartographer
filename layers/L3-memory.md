# L3 — Memory Architecture

> **Canonical source:** §B.4 of [`../spec/loom-spec-v0.1-full.md`](../spec/loom-spec-v0.1-full.md).
> **Key correction vs. base PRISM doc:** Event sourcing is the *audit log*, NOT the *state primitive*. Production agent memory (Mem0, Zep, LangMem) converges on vector DBs + temporal KGs.

---

## Five memory subsystems

| # | Subsystem | Location | Backing tech | Status |
|---|---|---|---|---|
| 1 | Markdown self-knowledge | [`../memory/self-knowledge.md`](../memory/self-knowledge.md) + per-agent `SKILL.md` | Filesystem + git | active |
| 2 | Vector semantic index | [`../memory/vector-index/`](../memory/vector-index/) | ChromaDB (local) or pgvector | not yet initialized |
| 3 | Temporal knowledge graph | [`../memory/knowledge-graph/`](../memory/knowledge-graph/) | Zep-style temporal KG (defer to v2 if not needed) | optional |
| 4 | Episodic event log | [`../memory/event-log/`](../memory/event-log/) | Append-only JSONL (or Nostr if multi-party) | active — audit trail per Kernel Rule 22 |
| 5 | Procedural skill library | [`../memory/skills/`](../memory/skills/) | Voyager-style markdown + manifest | active |

## Memory tier selection

> **Added 2026-06-15.** Grounded in: CoALA cognitive architectures (Sumers et al. 2023, arXiv:2309.02427, ACM Computing Surveys 2024 `[primary][H]`); MemGPT (Packer et al. 2023, arXiv:2310.08560 `[primary][H]`); LLM autonomous agents survey (Wang et al. 2024, arXiv:2308.11432 `[primary][H]`). Full analysis: [`../lessons-learned/2026-06-15-agent-memory-tier-selection.md`](../lessons-learned/2026-06-15-agent-memory-tier-selection.md).

The stateless-session-with-file-write pattern (each agent reads files, does work, writes back) is valid for coordination and audit but insufficient for tasks requiring cross-session learning. The deciding criterion is **session horizon**.

| Tier | Pattern | When sufficient | When NOT sufficient |
|---|---|---|---|
| **Tier A — Coordination** | Stateless: read files → work → write files. Next session picks up from files. | Audit trail, handoff, agent coordination, placeholder tracking, short-horizon tasks. | Tasks requiring comparison or learning from outcomes across multiple prior sessions. |
| **Tier B — Episodic** | Structured retrieval over prior session records: vector index → semantic search → context assembly. | Long-horizon tasks with outcome feedback: trading cycles, eval evolution, incremental research. | Pure coordination tasks — adds retrieval overhead for no gain. |

**Decision rule:** if a task re-invokes across sessions and must reason about prior *outcomes* (not just prior *state*), it requires Tier B. Knowing *what happened* → Tier A. Reasoning about *what worked* → Tier B.

**CoALA taxonomy alignment** (Sumers et al. 2024): four memory components for language agents — working (in-context), episodic (past session records), semantic (general facts), procedural (skills). Loom currently covers working (context assembly per [L5](./L5-orchestration.md#context-engineering)), Tier A episodic (JSONL event log), and procedural (skill library). Semantic and Tier B episodic are the gap for long-horizon tasks.

**Sovereign Forge implication:** the trading cycle is long-horizon. Add Tier B (vector store over `memory/trade-log/`) after the first 5 live cycles when enough history exists for retrieval to be meaningful. See [Open work](#open-work-for-this-layer).

## Retrieval pipeline

> **Canonical default per [ADR-0003](../adr/0003-retrieval-pipeline.md).** "Retrieve from the vector index" is not a design; this is. Every project gets this pipeline by default.

| Stage | What happens | Why this, not the alternative |
|---|---|---|
| **Retrieve** | Hybrid: dense vector search + sparse BM25, fused via Reciprocal Rank Fusion `[research-p1][H]` | Pure vector search is not the production default; hybrid + RRF (Cormack et al., SIGIR 2009) beats either alone |
| **Rerank** | Cross-encoder reranker over the top-k fused candidates `[research-p1][H]` | Single highest-impact component in benchmarks (Santhanam et al., ColBERTv2, NAACL 2022). A stronger semantic retriever is **not** strictly better — semantically-similar-but-irrelevant passages hurt accuracy more than random text (Cuconasu et al., SIGIR 2024, "Power of Noise"). The reranker is the mitigation |
| **Assemble** | Highest-ranked items at the **start and end** of context, never buried in the middle; result must fit the requesting agent's [context budget](./L2-agents.md#context-budget) | Lost-in-the-middle is a positional U-shape at any context length, not a 32K cliff. See [ADR-0004](../adr/0004-context-budget.md) for the budget |

**Non-negotiables:**

- **Dense retrieval is not deployed without a reranker.** The distractor caveat above is the reason.
- **Chunking:** recursive split, target **200–400 tokens**, small overlap. Do not adopt the common ~800-token default. `[research-p1][H]` Chroma chunking evaluation, 2024 — chunk *size* dominates chunk *strategy*.
- **Embedding model:** commit to **one** embedding model per project; changing it forces a full re-embed of the corpus. Prefer a Matryoshka-trained model for dimension flexibility without re-embed `[research-p1][H]` (Kusupati et al., NeurIPS 2022).

### Confidence gate (between rerank and assemble)

> **Added per [ADR-0037](../adr/0037-retrieval-pipeline-evidence-review.md) §C.** Multiple peer-reviewed sources converge: CRAG's 3-action confidence gate (Yan et al. 2024 `[primary][H]`), Self-RAG's reflection tokens (Asai et al. 2023 `[primary][H]`), practitioner corroboration `[practitioner][M]`.

After reranking and before assembly, evaluate the top-ranked chunk set's confidence. If confidence falls **below a project-configured threshold**, the pipeline returns "insufficient information in the knowledge base" rather than generating from low-quality context. A confident wrong answer is worse than an honest "I don't know."

**The threshold is project-specific** — not prescribed by Loom. Calibrate it using the retrieval eval framework ([ADR-0006](../adr/0006-retrieval-evaluation.md)). Start with a reasonable default (e.g., 0.6–0.7 on normalized retrieval score) and tune against your golden set.

This gate operationalizes ADR-0003's finding #4 (Power of Noise): the reranker mitigates bad retrievals, but the confidence gate **refuses to generate** when even the reranked set is insufficient.

### Reranker alternatives

> **Added per [ADR-0037](../adr/0037-retrieval-pipeline-evidence-review.md) §B.**

ADR-0003's **cross-encoder reranker** remains the default for standard pipelines (reranking 15–30 candidates). One documented alternative exists:

| Reranker | Best for | Latency | Precision trade-off | Source |
|---|---|---|---|---|
| **Cross-encoder** (default) | Small candidate sets (15–30) | ~50ms/query | Highest precision at top-k | `[research-p1][H]` |
| **ColBERTv2+PLAID** (alternative) | Large candidate sets (>30) or tight latency budgets (<25ms) | ~23ms/query | 92% top-5 overlap with cross-encoder; index not incremental | Santhanam et al. 2022 `[primary][H]` |

Choose at bootstrap; record the choice in an ADR. The cross-encoder is the safe default. ColBERT-as-reranker is justified when the project demonstrates a need for larger candidate sets or sub-25ms reranking.

### GraphRAG: when to add it (and when not to)

> **Added per [ADR-0037](../adr/0037-retrieval-pipeline-evidence-review.md) §A.** GraphRAG (Edge et al. 2024 `[primary][H]`) is a **complement** to the flat-chunk pipeline above, not a replacement.

**Add GraphRAG when discovery identifies these query patterns:**

- Multi-hop reasoning across documents (legal analysis, cross-reference queries)
- Global sensemaking ("summarize the themes across these 500 documents")
- Corpus-level synthesis where no single chunk contains the answer

**Do NOT add GraphRAG when:**

- Queries are primarily single-hop fact retrieval (GraphRAG adds +0.47 EM vs +27.23 on multi-hop `[primary][H]`)
- Detail-oriented lookups dominate (GraphRAG scores 21pp below flat RAG on detail queries `[primary][H]`)
- Token cost is constrained (GraphRAG global mode: ~45x overhead vs basic RAG `[primary][H]`)
- The corpus is small enough that flat-chunk retrieval already achieves high recall

**Architecture when added:** run both flat-chunk and graph-based retrieval, use a query-type router to select or merge results. The graph pipeline extends the existing pipeline; it does not replace the retrieve -> rerank -> assemble stages. Knowledge graph construction is lossy (~65–66% entity recall `[primary][H]`), so flat retrieval remains the recall backstop.

**Cost model:** GraphRAG's index-time cost is dominated by LLM-based entity extraction. Budget this at discovery time. Query-time cost varies: local mode is comparable to flat retrieval; global mode can reach 45x. Per [LR-06](../constitution/local-rules.md#lr-06), any iterative retrieval loop within the graph pipeline must declare its exit condition.

### Iterative retrieval patterns: cost-aware design

> **Added per [ADR-0037](../adr/0037-retrieval-pipeline-evidence-review.md) §D and [LR-06](../constitution/local-rules.md#lr-06).**

If the project adopts an iterative retrieval pattern (Self-RAG, CRAG, agentic retrieval loops), the following cost guidance applies — drawn from the 2026-05-31 research arc surveying 15 peer-reviewed sources:

| Pattern | Typical cost multiplier | Exit condition | When justified |
|---|---|---|---|
| Single-pass RAG (ADR-0003 default) | 1x | N/A | Always the starting point |
| CRAG (single confidence gate) | ~1.03x | 3-action confidence check | When retrieval quality is variable; low overhead |
| CompactRAG (fixed 2-call) | ~0.7x (optimized) | Fixed 2 LLM calls | Multi-hop with strict cost ceiling |
| Self-RAG (selective retrieval) | 3–5x | Reflection token gating | When retrieval is expensive and often unnecessary |
| IRCoT (iterative chain-of-thought) | ~5.4x | Hop limit | Complex multi-hop; budget-sensitive |
| LATS (tree search) | 10–20x | Trajectory budget k | Research/exploration; NOT production default |

**Quality plateaus past a small iteration cap** (McCleary & Ghawaly 2026 `[primary][H]`). Additional iterations beyond the plateau burn tokens for zero quality gain. Per LR-06: declare the exit condition in the ADR, estimate the token bound, emit actual cost to the event log.

**Prefer CRAG or CompactRAG over Self-RAG/IRCoT/LATS** unless the project demonstrates multi-hop queries where single-pass retrieval fails. CRAG adds 2.6% overhead for meaningful quality improvement on poor-retrieval queries; Self-RAG adds 3–5x. The burden of proof is on the more expensive pattern.

## Trust boundary

> **Canonical default per [ADR-0007](../adr/0007-content-trust-boundary.md).**

Retrieved or externally-ingested content (web search, tool output, third-party feeds) is **untrusted** until validated. Content entering the vector index or knowledge graph from external sources is **quarantined / flagged** until it passes the validation gate; tier metadata is recorded with each record. Memory poisoning is a real, cheap attack — `[research-p1][H]` PoisonedRAG (Zou et al., USENIX Security 2025) reached ~90% attack success by injecting ~5 malicious documents into a million-document store. The Update Bus source-tiering filter ([L7](./L7-extension.md#source-tiering)) is the project-wide implementation.

## Persistence guarantees

| Data | Durability | Backup | RPO |
|---|---|---|---|
| Markdown files | Local + git | Git push | 1 hour |
| Vector index | Rebuildable from source | Nightly export | 24 hours |
| Episodic log | Local + (optional) Supabase | Continuous append | 5 minutes |
| Knowledge graph | Rebuildable from event log | Nightly snapshot | 24 hours |
| Skill library | Local + git | Git push | 1 hour |

## The event log is bounded, not infinite

`[LLM-A][H]` (aerospace analogy): FDRs use a circular buffer with 25-hour retention. Loom event logs should rotate. See §H Q7 for retention policy (default: 90 days hot then compress).

## Known gaps (carry-overs from spec §H)

- Q4 — markdown write conflicts: default to file-per-agent partitioning
- Q5 — vector index refresh: default to hybrid (incremental + nightly compaction)
- Q6 — cross-project memory: default to opt-in "share" flag per lesson
- Q7 — eviction: 90-day hot, then archive/compress

---

## Open work for this layer

- [ ] Initialize ChromaDB (or chosen vector store) at first use
- [ ] Decide whether this project needs the KG at all
- [ ] Set up event-log rotation
- [ ] Stand up hybrid retrieval (dense + BM25 + RRF) per [ADR-0003](../adr/0003-retrieval-pipeline.md)
- [ ] Wire a cross-encoder reranker over the top-k fused candidates (or ColBERTv2+PLAID if justified per [ADR-0037](../adr/0037-retrieval-pipeline-evidence-review.md) §B)
- [ ] Implement confidence gate between rerank and assemble per [ADR-0037](../adr/0037-retrieval-pipeline-evidence-review.md) §C
- [ ] Configure recursive chunker at 200–400 tokens (not 800)
- [ ] Commit to one embedding model and record the choice in an ADR; prefer a Matryoshka-capable model
- [ ] Implement the trust-boundary quarantine for externally-ingested content per [ADR-0007](../adr/0007-content-trust-boundary.md)
- [ ] At discovery: evaluate whether project query patterns warrant GraphRAG complement per [ADR-0037](../adr/0037-retrieval-pipeline-evidence-review.md) §A
- [ ] If iterative retrieval adopted: declare exit condition + cost model per [LR-06](../constitution/local-rules.md#lr-06)
- [ ] After 5+ Sovereign Forge trading cycles: stand up Tier B episodic memory (vector store over `memory/trade-log/`) — see [Memory tier selection](#memory-tier-selection) and [`lessons-learned/2026-06-15-agent-memory-tier-selection.md`](../lessons-learned/2026-06-15-agent-memory-tier-selection.md)
