# ADR-0011: Claude Code enforcement runtime — hooks emit Rule-22 mechanical subset

**Status:** Accepted
**Date:** 2026-05-18
**Author:** Architect handoff — Loom v0.2 enforcement runtime — approved by Nick
**Confidence:** [H]

> **Update (2026-07-07 audit):** The "transparency layer, **not** an enforcement layer" stance in this ADR was **superseded on that point by [ADR-0047](./0047-hook-enforced-destructive-action-confirmation.md)** — the `PreToolUse` hook now *blocks* (`deny`) / *confirms* (`ask`) destructive actions via `decideDestructiveAction`. The hook-emits-Rule-22-events design here remains accurate; only the no-blocking posture changed.

## Context

A real agentic session (Claude Code, Opus 4.7) bootstrapped a Next.js + Supabase + AI SDK forum app from the v0.1 template. The session exposed concrete gaps between what the spec promises and what actually runs:

- **No agent ran.** Six "base agents" exist as `agents/<name>/SKILL.md` role docs, but none are wired as Claude Code subagents. The Critic never reviewed any ADR; the Constitution Service never checked any action against Kernel V6.
- **Both ledgers stayed empty.** `orchestration/task-ledger.md` and `progress-ledger.md` recorded nothing through ~30 tool calls.
- **No Rule-22 trace was emitted.** `memory/event-log/` stayed empty. L6 declares the trace schema "non-optional"; nothing produced one.
- **MCP config is a parallel universe.** `tools/mcp-servers/config.yaml` and `.claude/settings.json` are unrelated.
- **`scripts/bootstrap.sh` doesn't auto-run.** Placeholders like `<PROJECT_NAME>` remained in stamped files throughout the build.

This ADR introduces the **enforcement runtime** that v0.1 assumed existed. v0.1 was constitution-as-text; the goal here is to keep the text authoritative and add a thin layer that operationalizes its directives — not to replace the text.

## Decision

Ship a project-level `.claude/settings.json` plus four Node ESM hook scripts at `scripts/hooks/`:

| Hook | Purpose |
|---|---|
| `session-start.mjs` | Writes a `session_start` event; runs `scripts/bootstrap.{sh,ps1}` idempotently if placeholders are still present in stamped files |
| `pre-tool-use.mjs`  | Appends one `tool_call` event per tool invocation to `memory/event-log/YYYY-MM-DD.jsonl` (tool name + redacted arg summary) |
| `post-tool-use.mjs` | Appends a `tool_result` event with exit code and error signature; if the command matches a destructive-op pattern, also writes a `destructive_op` event |
| `stop.mjs` | Tallies today's events for this session, writes a `session_end` event, and appends a row to `orchestration/progress-ledger.md` "Session log" — the L5 closing-the-books checkpoint |

**Mechanical vs. introspective split.** The Rule-22 trace schema in L6 lists `confidence`, `what_would_raise_to_95`, `decision_log`, and `constitutional_check`. A hook running on `PreToolUse` sees only the tool name and arg payload — it has **no access to the model's internal reasoning**. We split the schema:

- **Mechanical fields (hook-emitted):** `timestamp`, `session_id`, `cwd`, `event_type`, `tool`, `tool_args_summary`, `exit_code`, `error_signature`, `kernel_version`, `loom_version`. Always present on every event.
- **Introspective fields (LLM-emitted by convention):** `confidence`, `what_would_raise_to_95`, `decision_log`, `constitutional_check`. Emitted by the model itself as `event_type: claim` records when it states a non-trivial confidence-tagged claim. Convention is documented in `CLAUDE.md`.

The combined log is Rule-22 compliant in spirit (every action has provenance; every claim has confidence) but honest about what each emitter can actually fill.

**Bumps Loom to 0.2.0.** This is the first runtime addition over the v0.1 documentary scaffold.

## Consequences

**Locks in:**
- Every Claude Code session in a Loom project produces a JSONL audit trail at `memory/event-log/YYYY-MM-DD.jsonl`, automatically.
- Destructive operations (`rm -rf`, `git reset --hard`, `git push --force`, `DROP TABLE`, `prisma migrate reset`, `supabase db reset`, `Remove-Item -Recurse -Force`, etc.) are tagged in the log for cheap grep.
- The progress-ledger gains one row per session as a closing-the-books checkpoint, so L5's two-ledger pattern actually has data to record.
- Bootstrap becomes self-healing: if a session starts in a project with unstamped placeholders, the bootstrap script runs with derived defaults (project name = `basename $PWD`, user name from git/env).

**Locks out:**
- The pretense that the full Rule-22 schema is hook-emittable. It isn't. The split above is now the canonical interpretation.
- Silent sessions. Even an empty session emits `session_start` + `session_end`.

**Migration path if it fails:** hooks are opt-in via `.claude/settings.json`. Removing the file disables them entirely; the underlying JSONL append is harmless (gitignored).

**v0.1 backward compatibility:** purely additive. Existing v0.1 projects can upgrade by copying `.claude/settings.json` and `scripts/hooks/` from the v0.2 template. No edits to v0.1 files break v0.1 behavior.

## Alternatives considered

- **Bash + PowerShell hook scripts.** Rejected: requires duplicating logic in two languages, slow process spawn on Windows, and Node is already a documented prerequisite. One Node script per hook works everywhere.
- **Full Rule-22 schema from hooks via static analysis.** Rejected: `confidence` and `what_would_raise_to_95` are LLM introspection — there is no way to derive them from tool name + args.
- **Block tool calls from `PreToolUse` for destructive ops.** Rejected for v0.2: blocking belongs to the Critic / Constitution-Service subagents (PR-2). The hook is a transparency layer, not an enforcement layer.
- **Auto-promote lesson drafts from the Stop hook.** Rejected: Kernel Rule 22 + user's "human in the loop" constraint. Lesson promotion is PR-4 (E) and explicitly manual.
- **Skip the supervisor / ledger reframe.** Rejected: v0.1's L5 describes a "Magentic-One supervisor" that doesn't exist. The session itself is the supervisor in practice — L5 is amended to say so honestly.

## References

- [`../.claude/settings.json`](../.claude/settings.json) — hook configuration
- [`../scripts/hooks/`](../scripts/hooks/) — implementation
- [`../layers/L6-observability.md`](../layers/L6-observability.md) — Rule-22 mechanical/introspective split
- [`../layers/L5-orchestration.md`](../layers/L5-orchestration.md) — session-is-supervisor reframe
- [`../CLAUDE.md`](../CLAUDE.md) — claim convention
- [`../spec/loom-spec-v0.1-full.md`](../spec/loom-spec-v0.1-full.md) Part J — v0.2 amendments
- v0.2 PR plan: A (this ADR) → B subagents → D bootstrap → E lessons → C doctor → F update-bus stub
