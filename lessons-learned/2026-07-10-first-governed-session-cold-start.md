---
date: 2026-07-10
agent: builder (Opus 4.8)
severity: medium
share: true
upstream: loom-template
---

# The FIRST governed session can't self-govern — bootstrapping Loom mid-session leaves hooks/subagents inactive until restart

## What happened

Phase-1 kickoff asked for the "first governed step" to be: bootstrap Loom into a fresh project dir → run discovery → M0, all *inside* the governed session. But when you copy the template into a new directory and bootstrap it **during an already-running Claude Code session**, that session started before `.claude/` existed. Consequence (per [ADR-0020](../adr/0020-runtime-discovery.md)):

- **Hooks don't fire** for the current session (SessionStart/PreToolUse/PostToolUse/Stop were not registered at launch), so the mechanical Rule-22 audit trail is silent unless you write to it by hand.
- **Subagents aren't invokable** (`critic`, `eac`, etc. register at session start), so you can't dispatch them the normal way.

So the "first governed step" is inherently *not* auto-governed. We worked around it by (a) invoking the subagents via [ADR-0034](../adr/0034-specialist-invocation-discipline.md) **path 2b** (the Agent tool seeded with the agent's own definition), and (b) emitting `session_start` + `claim` event-log records manually. It worked, and doctor/tests were green — but only because we knew to do it. A less careful run would have produced a project that *looks* bootstrapped while its audit trail for the founding session is empty.

## Why it happens

Claude Code builds the hook + subagent registry once, at session start, from the CWD's `.claude/`. Bootstrapping creates `.claude/` mid-session, after that snapshot. The very act of standing up governance is therefore outside governance.

## What we did

- Path-2b agent invocation for critic + EAC; manual `claim`/`session_start` records to `memory/event-log/`.
- Confirmed hook *wiring* is correct even so: ran the hook scripts by hand and verified they resolve `PROJECT_ROOT` to the new dir and write there (ADR-0043 markers present).
- Documented the restart requirement prominently in the handoff.

## What we'd do differently (recommendations for loom-template)

1. **Make the cold-start explicit in bootstrap output.** The RESTART banner exists; add one line: *"Hooks and subagents are NOT active for the current session. Until you restart, (a) invoke agents via ADR-0034 path 2b and (b) expect the audit trail to be hand-authored."*
2. **A `session_start` self-note when placeholders were just stamped this session** — emit a `bootstrapped_this_session: true` marker so the gap is visible in the log rather than inferred.
3. **Consider a two-step bootstrap doc:** step 1 (in any shell) copy + `bootstrap.ps1`; step 2 restart Claude Code *then* run discovery/M0 — so the genuinely-governed work happens in a session that was born governed. Note the tension with "do it all in one governed session" and let the architect choose.
4. **A fresh clone is the clean case:** cloning an already-bootstrapped repo and opening Claude Code in it registers everything at session start — no cold-start gap. Worth stating as the recommended path for subsequent machines.

## Related

- [ADR-0020 — agent registration requires restart](../adr/0020-runtime-discovery.md)
- [ADR-0034 §path 2b — specialist invocation](../adr/0034-specialist-invocation-discipline.md)
- [ADR-0043 — cwd-robust project-root resolution](../adr/0043-cwd-robust-project-root-resolution.md)
- [[loom-template-bootstrap-ps51-bug]] · sibling upstream lesson: `2026-07-08-bootstrap-ps1-getdate-asutc-ps51.md`
