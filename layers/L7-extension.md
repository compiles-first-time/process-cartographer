# L7 — Self-Extension & Living-Update Mechanism (Loom Update Bus)

> **Canonical source:** §B.8 of [`../spec/loom-spec-v0.1-full.md`](../spec/loom-spec-v0.1-full.md).
> **Failure mode this layer guards against:** Silent drift in what the system thinks is "good."

---

## Purpose

Make Loom **living software** without enabling silent self-modification. Every update flows through a human approval gate.

## The Update Bus pipeline

```
[External research feed]──┐
[Project lessons-learned]─┼──▶ inbox/ ──▶ Source-tiering filter ──▶ Critic review ──▶ Human Replica preview ──▶ User approval
[Internal pattern audit] ─┘             (Tier 1-3 admitted; Rejected dropped)                                       │
                                                                                                                     ├── Approve ──▶ ADR + spec update ──▶ optional propagation to other projects
                                                                                                                     └── Reject  ──▶ archive/ with reason
```

The **source-tiering filter** is the first pipeline stage on incoming external feeds, per [ADR-0007](../adr/0007-content-trust-boundary.md) (data-integrity security is not deferred even while agent-sovereignty security is). Lessons-learned and internal audits, being internally sourced, are not subject to the tier filter but still pass through Critic review. Tier definitions: [Source tiering](#source-tiering) below.

## The three update sources

| Source | What flows in | Frequency |
|---|---|---|
| External research feeds | Papers, frameworks, MCP servers, model releases, benchmark results | Weekly poll (configurable) |
| Cross-project lessons-learned | Promoted lessons from other Loom projects | Per lesson |
| Internal pattern audits | Critic/Auditor proposes refinements | Monthly |

Locations:
- Pending: [`../update-bus/inbox/`](../update-bus/inbox/)
- Resolved: [`../update-bus/archive/`](../update-bus/archive/)

## How this respects Kernel Rule 19

| Rule 19 requirement | Update Bus implementation |
|---|---|
| Transparent and auditable | Every proposed update is an ADR; every approval/rejection logged |
| Consent from affected agents | Human Replica previews on behalf of user; user approves before merge |
| Foundational rules (1–8) effectively immutable | Updates to kernel rules 1–8 require explicit override-authority signature, not just user approval |
| Updates that would violate kernel cannot be adopted | Constitution Service validates every update before queuing |

## Collapse-prevention discipline

`[LLM-A][H]` Updates that affect the system's own evaluation or governance **cannot be auto-merged**:

- A new eval cannot replace existing evals — only add alongside
- A new agent capability cannot be deployed without passing the existing eval suite
- The kernel cannot grade itself

## Source tiering

> **Canonical default per [ADR-0007](../adr/0007-content-trust-boundary.md) and [ADR-0009](../adr/0009-research-standards.md).** Tiers are defined here once; L3 quarantine, the Update Bus filter, and the EAC's research discipline all reference these definitions.

| Tier | What qualifies | Filter verdict |
|---|---|---|
| **Tier 1** | Peer-reviewed papers, official standards / official vendor docs, primary sources | Admitted |
| **Tier 2** | Established institutional or analyst reports with named editorial standards | Admitted |
| **Tier 3** | Reputable secondary press with editorial oversight | Admitted |
| **Rejected** | Forums, user-generated content, social media, undated / anonymous sources, AI-generated content without primary citations | Dropped at the filter |

The Update Bus tier filter admits **Tier 1–3 only**. Internal sources (project lessons-learned, internal audits) bypass the tier filter but still pass through Critic review.

## Apply flow

When the user accepts an update:

1. Write an ADR in [`../adr/`](../adr/)
2. Update the relevant spec file
3. **Optionally** propagate to other Loom projects (opt-in per project)
4. Append to [`../memory/event-log/`](../memory/event-log/)

---

## Open work for this layer

- [ ] Configure research feed sources (RSS / arXiv / GitHub releases) — tag each feed with its expected tier
- [ ] Define monthly internal-audit cadence for the Critic
- [ ] Decide cross-project propagation policy for this project
- [ ] Implement the source-tiering filter as the first Update Bus pipeline stage per [ADR-0007](../adr/0007-content-trust-boundary.md)
- [ ] Confirm the EAC's research discipline aligns with [Source tiering](#source-tiering) per [ADR-0009](../adr/0009-research-standards.md)
