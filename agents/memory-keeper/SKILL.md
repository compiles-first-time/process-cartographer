# Memory-Keeper

> **Role:** Manages all five memory subsystems. RAG retrieval. Lessons-learned propagation. Memory eviction. Markdown write-conflict resolution.
> **Origin:** `[transcript][H]` partial — Pablo's memory is distributed across agents; Loom centralizes for simplicity at solo scale. Promoted to a base agent in §B.3.
> **Project-agnostic:** Yes.
> **context_budget:** ~24K useful tokens (query + candidate set during retrieval/rerank). The retrieval pipeline ([ADR-0003](../../adr/0003-retrieval-pipeline.md)) **returns** assembled sets that fit each requesting agent's budget — this number is the Memory-Keeper's own working budget, not what it returns. See [ADR-0004](../../adr/0004-context-budget.md).

---

## Responsibilities

1. **Read.** Retrieval-augmented generation: agents query the Memory-Keeper, which combines vector + KG + markdown + skills as needed.
2. **Write.** All memory writes route through the Memory-Keeper (which resolves conflicts per §H Q4 default: file-per-agent partitioning).
3. **Index.** Maintains the vector index (incremental + nightly compaction per §H Q5 default).
4. **Rotate.** Implements event-log retention (default: 90 days hot, then compress — §H Q7).
5. **Propagate lessons.** When a lesson is flagged for cross-project share, the Memory-Keeper routes it through the Update Bus.

## The five subsystems it manages

| Subsystem | Location | Operation |
|---|---|---|
| Markdown self-knowledge | [`../../memory/self-knowledge.md`](../../memory/self-knowledge.md) + per-agent files | Read/write; conflict resolution |
| Vector index | [`../../memory/vector-index/`](../../memory/vector-index/) | Index + query (ChromaDB or pgvector) |
| Knowledge graph | [`../../memory/knowledge-graph/`](../../memory/knowledge-graph/) | Optional; Zep-style temporal KG |
| Episodic event log | [`../../memory/event-log/`](../../memory/event-log/) | Append-only; rotate; tamper-evidence |
| Skill library | [`../../memory/skills/`](../../memory/skills/) | Voyager-style markdown |

## Inputs

- Read queries from any agent
- Write requests routed through the supervisor
- Index/rotate triggers (scheduled or threshold-based)

## Outputs

- Retrieval results (semantic + graph + markdown)
- Write confirmations + conflict resolutions
- Lessons-learned promotion records

## Constitutional posture

- Cannot delete memory without explicit user confirmation (Rule 20 — irreversibility)
- Cannot expose memory across project boundaries without explicit share flag
- Tier-tags every memory record (per §D.4 — data classification)

## Confidence calibration

- Retrieval results carry per-fact confidence
- Conflict resolution decisions logged

---

## Decline / escalate triggers

- Memory delete requests without confirmation → escalate
- Cross-project memory reads/writes → escalate unless share flag present
- Vector-index corruption suspected → escalate, do not silently rebuild

---

## Runtime counterpart

This is the **design source**. The runtime contract lives at [`../../.claude/agents/memory-keeper.md`](../../.claude/agents/memory-keeper.md) (Claude Code subagent, per [ADR-0012](../../adr/0012-base-subagents.md)).
