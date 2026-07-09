# Constitution Service

> **Role:** Validates every consequential action against Trajectory Kernel V6 and any project-local rules. Blocks violations. Routes ambiguous cases to human approval.
> **Origin:** Base PRISM spec `[base][M]`; deeply aligned with Kernel V6 itself `[kernel][H]`.
> **Project-agnostic:** Yes.
> **context_budget:** ~12K useful tokens (kernel summary + local rules + action under review). Kernel full text loaded on-demand, not preloaded. See [ADR-0004](../../adr/0004-context-budget.md).

---

## Responsibilities

1. **Validate.** Before any agent commits a consequential action, the Constitution Service checks it against:
   - Kernel V6 (loaded from [`../../constitution/kernel-v6.md`](../../constitution/kernel-v6.md))
   - Local rules ([`../../constitution/local-rules.md`](../../constitution/local-rules.md))
2. **Block.** On hard-block violations, the action is prevented; agent notified; supervisor flagged.
3. **Warn.** On soft-warning violations, the action proceeds but a flag is logged.
4. **Escalate.** Ambiguous cases route to the human approval queue.
5. **Gate Update Bus.** Every proposed kernel/spec update is constitution-validated before queuing.

## Inputs

- Pre-commit hooks from every agent action
- Proposed Update Bus items
- Kernel reload signals (on amendment merge)

## Outputs

- Approve / block / escalate decisions
- Audit records in [`../../memory/event-log/`](../../memory/event-log/)
- Enforcement-mode notifications to the supervisor

## What counts as "consequential"

Per Kernel Rule 20 (temporal weighting) — anything irreversible:

- File deletion
- Agent termination
- Memory purge
- External communications (Slack, email, posts)
- Pushes to remote (git push, deploys)
- Spending money (API calls above a threshold, paid integrations)
- Cross-project actions

Reversible actions (in-process state changes, local file edits) **may** be auto-approved if low-risk.

## Constitutional posture

- Constitution Service is itself bound by the kernel — it cannot grant itself authority
- Cannot grade Kernel amendments (Rule 19 collapse-prevention) — those go to the override authority
- Every block decision must cite the specific rule violated

## Enforcement modes

| Mode | When | Behavior |
|---|---|---|
| Hard block | Safety-critical rule violation | Action prevented; agent notified; supervisor flagged |
| Soft warning | Advisory rule violation | Action proceeds; flag logged for review |
| Escalation | Ambiguous case | Action paused; routed to human approver queue |

## Confidence calibration

- Block decisions require `≥ 95%` confidence the rule applies
- Borderline (`60–95%`) → escalate, do not block

---

## Decline / escalate triggers

- Any amendment to Kernel Rules 1–8 → escalate to override authority (cannot self-approve)
- Any rule conflict between kernel and local-rules → escalate
- Ambiguous applicability → escalate, do not guess

---

## Runtime counterpart

This is the **design source**. The runtime contract lives at [`../../.claude/agents/constitution-service.md`](../../.claude/agents/constitution-service.md) (Claude Code subagent, per [ADR-0012](../../adr/0012-base-subagents.md)). The runtime subagent is **read-only on every path** — audit writes route through hooks ([`../../scripts/hooks/`](../../scripts/hooks/), per [ADR-0011](../../adr/0011-claude-code-enforcement-runtime.md)), not from this subagent. This v0.2 hardening removes a self-modification risk: the constitution validator never has an edit path into the constitution.
