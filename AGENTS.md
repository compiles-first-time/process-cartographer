# AGENTS.md — Agent Roster Quick Reference

> **Project:** `loom-template`
> **Agent set:** `full-6` *(or `minimal-3`; see §E.2 of the spec)*
> **Hard cap:** ~5 KB. Detail goes in each agent's `agents/<name>/SKILL.md`.

---

## Supervisor

**Pattern:** Magentic-One (two-ledger).
**Role:** Routes work; never executes directly. Owns the Task Ledger and Progress Ledger.
**Ledgers:** [`orchestration/task-ledger.md`](./orchestration/task-ledger.md), [`orchestration/progress-ledger.md`](./orchestration/progress-ledger.md).

---

## Base agents (the warp — present in every Loom project)

> **Design source ⇄ runtime contract (v0.2):** Each base agent has a **design** file at `agents/<name>/SKILL.md` (full rationale, kernel posture, alternatives) and a **runtime** file at `.claude/agents/<name>.md` (Claude Code subagent — tools, prompt, decline triggers). Per [ADR-0012](./adr/0012-base-subagents.md).

| Agent | Design | Runtime |
|---|---|---|
| **HR-Agent** | [`agents/hr/`](./agents/hr/) | [`.claude/agents/hr.md`](./.claude/agents/hr.md) |
| **Expert Agent Creator (EAC)** | [`agents/eac/`](./agents/eac/) | [`.claude/agents/eac.md`](./.claude/agents/eac.md) |
| **Human Replica** | [`agents/human-replica/`](./agents/human-replica/) | [`.claude/agents/human-replica.md`](./.claude/agents/human-replica.md) |
| **Critic / Auditor** | [`agents/critic/`](./agents/critic/) | [`.claude/agents/critic.md`](./.claude/agents/critic.md) — **read-only** |
| **Memory-Keeper** | [`agents/memory-keeper/`](./agents/memory-keeper/) | [`.claude/agents/memory-keeper.md`](./.claude/agents/memory-keeper.md) |
| **Constitution Service** | [`agents/constitution-service/`](./agents/constitution-service/) | [`.claude/agents/constitution-service.md`](./.claude/agents/constitution-service.md) — **read-only** |

For the **minimal-3** mode (per §E.2): HR-Agent + Critic + Memory-Keeper. Trim the others if your project doesn't need them.

---

## Specialist agents (the weft — created on demand)

Specialists live under [`agents/specialists/<name>/`](./agents/specialists/) and are spawned by the EAC for single tasks, then **terminated at end of project lifecycle**. Their lessons-learned persist in [`lessons-learned/`](./lessons-learned/).

| Specialist | Domain | Runtime |
|---|---|---|
| [`uipath-xaml`](./agents/specialists/uipath-xaml/SKILL.md) | Static parsing of UiPath REFramework `.xaml` → IR graph (namespaces, StateMachine, InvokeWorkflowFile spine, target classification). Loom's first non-web specialist. | [`.claude/agents/uipath-xaml.md`](./.claude/agents/uipath-xaml.md) (`claude-sonnet-5`) |

---

## Communication patterns

- **In-process** (v1 default) — agents share the supervisor's memory space; routing is direct.
- **A2A / ACP** — defer to v2 (multi-process or multi-machine; see [L4 spec](./layers/L4-tooling.md)).
- **No direct agent-to-agent across project boundaries.** Cross-project communication goes through the Human Replica.

---

## Lifecycle

| Phase | What happens |
|---|---|
| **Spawn** | HR-Agent registers; SKILL.md / role file written; Constitution Service registers the new agent |
| **Run** | Agent executes within a bounded session; emits Rule-22 trace records on every action |
| **Reconcile** | At end of session, agent writes its updates to markdown self-knowledge + episodic event log |
| **Retire** | HR-Agent removes from roster; lessons-learned promoted; agent directory archived |

> **Reputation-aware dispatch:** per [ADR-0053](./adr/0053-agent-reputation-and-dispatch.md), the supervisor weights specialist selection and retire / re-spawn calls by each agent's recorded reputation (verifier pass-rate, task outcomes).

---

*Detail per agent lives in `agents/<name>/SKILL.md`. This file is the index.*
