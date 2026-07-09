# ADR-0012: Six base subagents at `.claude/agents/*.md`

**Status:** Accepted
**Date:** 2026-05-18
**Author:** Architect handoff — Loom v0.2 enforcement runtime — approved by Nick
**Confidence:** [H]

## Context

Per the real-session findings that motivated v0.2: the six base agents existed only as `agents/<name>/SKILL.md` design docs. None were Claude Code subagents. The Critic never reviewed any ADR; the Constitution Service never checked any action against Kernel V6.

ADR-0011 (PR-1 / A) introduced the enforcement runtime (hooks + JSONL). This ADR (PR-2 / B) gives that runtime real agents to talk to.

## Decision

Ship six Claude Code subagents at `.claude/agents/{hr,eac,human-replica,critic,memory-keeper,constitution-service}.md`. Each has:

- `name` matching its directory in `agents/`
- A `description` that triggers proactive routing (no need for the user to explicitly invoke them)
- A `tools` allowlist scoped to its role
- A system prompt derived from the corresponding `agents/<name>/SKILL.md` but **tightened** for runtime use (concise, decision-focused, with explicit decline triggers and the Claim convention)

The `agents/<name>/SKILL.md` files remain the **design source** (full rationale, alternatives, kernel posture). The `.claude/agents/<name>.md` files are the **runtime contract**. They cross-link so a human reading either knows where the other lives.

### Tool allowlists per role

Claude Code's subagent `tools` frontmatter takes tool names only — it doesn't support path scoping. Path scoping is enforced **in the system prompt** ("you may write only to X and Y").

| Agent | tools: | Path scope (enforced in prompt) |
|---|---|---|
| HR | Read, Glob, Grep, Edit, Write | `AGENTS.md`, `agents/specialists/**` |
| EAC | Read, Glob, Grep, WebFetch, WebSearch, Edit, Write | `agents/specialists/**`, `lessons-learned/**` |
| Human-Replica | Read, Glob, Grep, Edit | `agents/human-replica/`, `update-bus/inbox/**` |
| Critic | Read, Glob, Grep | (read-only on every path) |
| Memory-Keeper | Read, Glob, Grep, Edit, Write | `memory/**`, `update-bus/inbox/` |
| Constitution-Service | Read, Glob, Grep | (read-only on every path) |

### Hardening vs. v0.1

The Critic and Constitution Service are **read-only end-to-end**. In v0.1 the Constitution Service was implicitly expected to write audit records; v0.2 routes audit writes through the v0.2 hooks instead. This preserves the independence that makes their review meaningful — they can't have an edit path into the artifacts they review.

The HR-Agent **may not edit base-agent SKILL.md files**. Those are kernel-level contracts; changing them requires an ADR. HR's write scope is narrower than "AGENTS.md + roster" — it's `AGENTS.md` plus specialist directories under `agents/specialists/`.

## Consequences

**Locks in:**
- Every Loom project ships with six real subagents available to a Claude Code session, automatically.
- Pre-dispatch context admission check (chaperone gate, ADR-0008) has a real implementer — the Critic subagent.
- Constitution validation has a real implementer — the Constitution-Service subagent.
- The HR-Agent's write scope is bounded; base-agent contracts are stable by construction.

**Locks out:**
- Self-modifying base agents (HR cannot rewrite its peers' SKILL.md files).
- Audit-record writes from the Constitution Service (those route through hooks, not the agent).

**Migration path if it fails:** subagents are opt-in via `.claude/agents/`. Removing a file disables that subagent without affecting the others or the hooks.

## Alternatives considered

- **HR can edit base agent SKILL.md files.** Rejected: those are kernel-level contracts. Changing them must require an ADR, not an HR-Agent invocation.
- **Constitution Service writes audit records directly.** Rejected: violates the read-only independence principle. Audit writes route through hooks (ADR-0011); the subagent emits decision payloads, hooks persist them.
- **One unified "supervisor" subagent that wraps all six.** Rejected: the Claude Code session is the supervisor (per L5 reframe in ADR-0011). The six subagents are dispatched-to, not a wrapper.
- **Defer subagents to v0.3.** Rejected: this was the highest-leverage gap from the real-session findings; without subagents the v0.1 spec's "base agent set" is purely aspirational.

## References

- [`../.claude/agents/`](../.claude/agents/) — runtime subagent files
- [`../agents/`](../agents/) — design SKILL.md files
- [`../AGENTS.md`](../AGENTS.md) — roster
- [`../layers/L2-agents.md`](../layers/L2-agents.md) — design/runtime split note
- ADR-0011 — hooks runtime that subagents emit `claim` events through
- ADR-0008 — context admission check, now implemented by the Critic subagent
