# Update Bus

> Semi-automatic update queue. Candidate updates flow in; human approval is required for every merge.

---

## Layout

```
update-bus/
├── inbox/      # Candidate updates pending review
└── archive/    # Resolved updates (approved + rejected, with reason)
```

## Flow

```
[External feed] | [project lesson] | [internal audit]
        ↓
    inbox/<id>.md
        ↓
  Critic review → reject? → archive/rejected/<id>.md (with reason)
        ↓ approve
  Human Replica preview → recommendation appended
        ↓
  User approval queue (in chat)
        ↓ approve
  ADR written → spec file(s) updated → archive/applied/<id>.md
        ↓ optional
  Propagation to other Loom projects (opt-in per project)
```

## Candidate file format

```markdown
---
id: <unique-id>
source: research-feed | project-lesson | internal-audit
proposed_by: <agent or human>
date: YYYY-MM-DD
affects: [list of files or layers]
risk: low | medium | high
collapse_risk: false  # true if the change would affect evaluation or governance
---

# <Short title>

## Proposed change
<one paragraph>

## Motivation
<why now, why this, what evidence>

## Affected files
- <path>
- <path>

## Critic review
<filled in by Critic>

## Human Replica recommendation
<filled in by Human Replica>

## User decision
<filled in by user; approve | reject | defer>
```

## Anti-collapse rules

Per [§B.8 of the spec](../spec/loom-spec-v0.1-full.md):

- Updates with `collapse_risk: true` cannot be auto-merged regardless of approvals
- A new eval may **only add alongside** existing evals, never replace
- Kernel Rule 1–8 amendments require explicit override-authority sign-off
- Kernel cannot grade itself — Constitution Service never approves its own kernel updates

## Schema (v0.2)

The markdown frontmatter shape above is formalized in [`schema.json`](./schema.json) (JSON Schema draft 2020-12), per [ADR-0016](../adr/0016-update-bus-stub.md). Required fields: `id`, `source`, `proposed_by`, `date`, `affects`, `risk`, `collapse_risk`. Optional sub-objects fill in as items move through the pipeline: `source_tier`, `critic_review`, `human_replica_recommendation`, `user_decision`.

## Receiver API (v0.2 stub)

v0.2 ships the **wire-up**, not live feed polling. The no-op tick lives at [`../scripts/update-bus-tick.sh`](../scripts/update-bus-tick.sh) and [`../scripts/update-bus-tick.ps1`](../scripts/update-bus-tick.ps1) (wrappers around [`../scripts/lib/update-bus-tick.mjs`](../scripts/lib/update-bus-tick.mjs)). It reports inbox/archive counts and validates `schema.json` parses.

Run it manually:

```bash
bash scripts/update-bus-tick.sh
# or
pwsh scripts/update-bus-tick.ps1
```

## v0.3 wire-up plan

When v0.3 implements the live receiver:

1. **Feed polling.** Configured RSS, arXiv RSS, GitHub release feeds are polled on a cron.
2. **Source-tier filter** (per [ADR-0007](../adr/0007-content-trust-boundary.md) + [ADR-0009](../adr/0009-research-standards.md)). Each candidate is tagged Tier 1 / 2 / 3 / Rejected; Rejected drops at the filter.
3. **Inbox write.** Admitted candidates become `inbox/<id>.md` files conforming to `schema.json`.
4. **Notification.** The Critic subagent ([`../.claude/agents/critic.md`](../.claude/agents/critic.md)) is invoked on the new inbox item.
5. **Pipeline** continues per [L7](../layers/L7-extension.md): Critic → Human Replica preview → user approval → ADR + spec update.

API contract that v0.3 will implement (printed by the v0.2 stub):

```
POST  /loom/update-bus/inbox            { source, proposed_by, affects, risk, collapse_risk, payload }
GET   /loom/update-bus/inbox            → [ {id, source_tier, critic_review, ...} ]
POST  /loom/update-bus/inbox/<id>/decision  { verdict, decided_by, note }
```
