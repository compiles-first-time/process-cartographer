# ADR-0029: HR work-graph — JSON-canonical + markdown-mirrored

**Status:** Accepted
**Date:** 2026-05-20
**Author:** Architect handoff (v1.0 PR-R) — approved by Nick
**Confidence:** [H]

## Context

v0.5 produced `discovery/requirements.md` + `discovery/risk-register.md` + `discovery/open-questions.md`. But those artifacts are static text — nothing in Loom consumes them programmatically. v1.0 finding (D) wants HR to **consume `requirements.md` → emit a DAG of work items into `orchestration/task-ledger.md`** so specialists can be dispatched per work item.

Per v0.4-plan disagreement #4: **JSON-canonical + markdown-mirrored**. Markdown tables don't render DAGs cleanly past ~20 nodes. JSON is the source of truth for the work graph; the markdown ledger is the human view, regenerated each time.

## Decision

### A. `scripts/lib/hr-work-graph.mjs`

Reads:
- `discovery/requirements.md` — functional requirements + NFR pillars
- `discovery/risk-register.md` — risks to tag work items
- `agents/specialists/_registry/manifest.yaml` — registry for specialist inference

Writes:
- `orchestration/work-graph.json` — canonical machine-readable graph
- `orchestration/task-ledger.md` — human-readable markdown mirror, regenerated

### B. Work-item generation rules (v1.0 MVP)

| Source row | Produces work item |
|---|---|
| FR-NN row in `requirements.md` | `WI-FR-NN` (kind: `functional`) |
| NFR pillar row in `requirements.md` | `WI-NFR-<slug>` (kind: `nfr`) |
| RISK-NN row in `risk-register.md` | Tags applicable work items (`wi.risks: [...]`); does NOT produce its own work item — risks attach to the work the risk threatens |

### C. Specialist assignment

For each work item, the generator runs the title + notes through the same intent-classifier patterns the v0.4 registry uses (from `manifest.yaml`). Matches populate `assigned_specialists`. NFR pillars use a small built-in category → specialist map (security → auth+oauth+secrets; observability → monitoring + error-tracking; etc.) and filter against the registry to only assign instantiated specialists.

### D. JSON schema (v1.0 MVP)

```json
{
  "version": "1.0",
  "generated_at": "<iso>",
  "source": { "requirements": "...", "risk_register": "..." },
  "work_items": [
    {
      "id": "WI-FR-01",
      "kind": "functional | nfr",
      "source": "discovery/requirements.md#FR-01",
      "title": "...",
      "actor": "...",
      "trigger": "...",
      "outcome": "...",
      "status": "pending | dispatched | completed | reviewed",
      "assigned_specialists": ["oauth", "auth"],
      "depends_on": [],
      "risks": ["RISK-01"]
    }
  ],
  "edges": []
}
```

### E. Idempotency

The generator regenerates both files on each run. The markdown ledger has a `## Manual edits` section near the bottom; content **below** the auto-generated section is preserved by the user's convention (the script doesn't enforce it for v1.0 MVP — future revision can parse + preserve).

Dependency edges are not auto-inferred in v1.0. **In the v1.0 MVP the generator OVERWRITES `work-graph.json` on each run** — hand-added `depends_on` arrays do NOT survive a regenerate. Merge-on-regenerate (reading the existing JSON and preserving user-added edges) is deferred to v1.0.1, once real projects show which edges are reliably inferable vs. require human judgment.

### F. Proposes, never applies

HR generates the graph. The user reviews it. The user (or a follow-up dispatch session) sends each `WI-NN` to its assigned specialists. The generator doesn't dispatch.

## Evidence basis

- **Primary evidence:** v1.0 finding (D) — "HR consumes `discovery/requirements.md` and emits a DAG of work items into `orchestration/task-ledger.md`." `[user-direction][H]`
- **Corroborating sources:**
  - Magentic-One (Fourney et al. 2024, arXiv:2411.04413) — two-ledger pattern for multi-agent supervision. `[primary][H]`
  - L5 spec — Task Ledger + Progress Ledger as the canonical orchestration pair. `[base][H]`
- **Synthesizer reasoning:** the JSON+markdown split was the v0.4-plan disagreement #4 resolution. Markdown tables become illegible past ~20 nodes; JSON handles the structure; markdown handles the readability. `[synth][M]`
- **What would change this call:**
  - Real projects show the graph generally has < 10 nodes and pure markdown is fine — JSON adds unnecessary tooling. Would revert to markdown-only.
  - Real projects show HR needs to consume more than requirements + risks (e.g., the lessons-learned signatures); generator schema expands.

## Consequences

**Locks in:**
- v1.0 Loom projects have a generated work graph from their discovery artifacts.
- Specialists are assigned automatically (where the registry trigger-patterns match).
- Risks are linked to the work they threaten.

**Locks out:**
- Hand-rolling the task ledger without referencing discovery — possible, but the generator overwrites on re-run.
- DAGs that don't fit the kind/source/status model — extensible via JSON additions but the markdown mirror must follow.

**Migration path if it fails:** the markdown ledger is human-readable on its own; the JSON is the same data structured. Removing either is non-breaking for the other (until v1.0.1's edge inference, which needs JSON).

## Alternatives considered

- **Markdown-only.** Rejected per v0.4-plan disagreement #4 — doesn't scale past ~20 nodes.
- **JSON-only.** Rejected — humans need to read this; markdown table is the right human view.
- **Auto-infer dependency edges from FR / NFR content.** Considered. Deferred to v1.0.1 — needs real-project signal to know which edges are reliably inferable.
- **Use a graph library (graphlib, etc.).** Rejected — no external deps constraint; the v1.0 MVP is flat work items + risks tagging; edges are user-added.
- **Generate one work item per RISK row in addition to FR rows.** Rejected — risks attach to the *work they threaten*, not standalone. A risk's mitigation is part of the work item's definition-of-done.

## Affects / Affected by

**This ADR affects** *(downstream)*:

- `scripts/lib/hr-work-graph.mjs` — implementation
- `scripts/hr-work-graph.{sh,ps1}` — wrappers
- `orchestration/work-graph.json` *(generated at bootstrap/runtime — absent in a template repo; gitignored if user prefers, or committed if they want history)*
- `orchestration/task-ledger.md` — markdown mirror, regenerated
- `adr/0030-specialist-lifecycle.md` *(planned, PR-S)* — specialists consume `work-graph.json` to know what to spawn

**This ADR is affected by** *(upstream)*:

- `adr/0025-discovery-scaffolding.md` — `requirements.md` source format
- `adr/0023-specialist-registry.md` — registry for specialist inference
- `adr/0022-xlsx-docs-convention.md` — `risk-register.md` format
- `layers/L5-orchestration.md` — Task Ledger + Progress Ledger conceptual model
- `agents/specialists/_registry/manifest.yaml` — trigger patterns this generator consumes
- `adr/0053-agent-reputation-and-dispatch.md` — ADR-0053; agent reputation signals inform how work items are assigned / dispatched to specialists

## References

- v1.0 finding (D) — HR consumes requirements.md → DAG
- v0.4-plan disagreement #4 — JSON-canonical + markdown-mirrored
- Magentic-One (Fourney et al. 2024) — two-ledger pattern
- L5 spec — Task Ledger + Progress Ledger
