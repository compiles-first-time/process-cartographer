# ADR-0038: Hook capture gap detection at session start

**Status:** Accepted
**Date:** 2026-06-01
**Author:** Builder — approved by Nick
**Confidence:** [H]

## Context

The Ravenwise bootstrap session (2026-05-22) demonstrated a silent-audit-degradation failure mode documented in [`lessons-learned/2026-05-22-browser-gated-provisioning-friction.md`](../lessons-learned/2026-05-22-browser-gated-provisioning-friction.md) Root cause 2:

> When the architect opens Claude Code from a non-Loom directory (e.g., `C:\Users\...\Internal Platform`) and then works inside a Loom project, the hooks configured in `.claude/settings.json` fire against the **original CWD**, not the project directory. The event log either goes to the wrong path or doesn't fire at all. **The audit trail goes silent without warning.**

[ADR-0034](./0034-specialist-invocation-discipline.md) §C described this gap and prescribed a manual companion check ("inspect the event log for a `session_start` event with the current session ID"). That check was advisory — it required the in-session agent to remember to perform it. This ADR converts it from advisory to operational.

The root cause is in [`scripts/hooks/_lib.mjs`](../scripts/hooks/_lib.mjs) line 17:

```javascript
export const PROJECT_ROOT = process.cwd();
```

All hooks use `PROJECT_ROOT` for event log paths, bootstrap paths, and runtime discovery. If `process.cwd()` is not the Loom project directory at session start, all downstream hook behavior is silently wrong.

## Decision

Add **automatic CWD validation** to the SessionStart hook. At session start, before any other hook work, the hook checks for Loom project indicators at the current working directory:

1. **Indicator files checked:** `CLAUDE.md`, `.claude/settings.json`, `constitution/kernel-v6.md`, `layers/L0-constitutional.md`. At least 2 must be present to pass.

2. **On failure (CWD is not a Loom project):**
   - Emit a `hook_capture_gap_detected` event to whatever event log path is reachable (so the gap is at least recorded somewhere, even if in the wrong directory)
   - Tag the `session_start` event with `hook_capture_gap: true` for downstream consumers
   - Emit a loud `stderr` warning banner visible in Claude Code's hook output — the `╔══════╗` box format ensures visibility even in noisy output

3. **On success (CWD is a Loom project):** proceed normally. No overhead.

4. **The validation function `validateProjectRoot()`** is exported from `_lib.mjs` so other hooks or scripts can call it. It returns `{ valid: boolean, reason?: string, found: string[] }`.

### Non-blocking by design

The CWD validation **does not block** the session or any tool calls. It emits a warning — consistent with Loom's hooks-are-transparency philosophy ([ADR-0011](./0011-claude-code-enforcement-runtime.md)). The architect can proceed with reduced audit coverage if they choose. The trade-off (loss of audit trail, not loss of correctness) is surfaced explicitly rather than discovered post-hoc.

## Evidence basis

- **Primary evidence:** Ravenwise session 2026-05-22 — real-session failure where CWD mismatch caused complete hook silence across the entire bootstrap, auth setup, and deploy phases. Zero events captured. Discovered only during post-mortem review. `[user-report][H]`
- **Corroborating:** ADR-0034 §C prescribes the manual check; this ADR operationalizes it. `[transcript][H]`
- **What would change this call:** Claude Code adding native CWD-awareness to hook loading (the upstream issue ADR-0020 references), making project-level detection unnecessary.

## Cost model

Not applicable — this ADR does not introduce an iterative LLM pattern. The validation is a synchronous filesystem check (4 `existsSync` calls, <1ms).

## Consequences

**Locks in:**
- Every Loom session gets an automatic CWD check at start — no manual step required
- The `hook_capture_gap_detected` event type becomes grepable in the event log for post-hoc audit
- The `hook_capture_gap: true` tag on `session_start` events enables downstream consumers to filter affected sessions

**Locks out:**
- Nothing — the check is additive and non-blocking

**Migration path:** If Claude Code adds native project-root awareness upstream, the `validateProjectRoot()` function can be removed. The event types remain for backward compatibility.

## Alternatives considered

- **Block the session until CWD is correct** — rejected: violates hooks-are-transparency, not blocking (ADR-0011). The architect may have a legitimate reason to work from a different CWD.
- **Auto-detect and change CWD** — rejected: hooks cannot change the parent process's CWD. `process.chdir()` would only affect the hook's own child process.
- **Add the check to every hook (not just SessionStart)** — rejected: SessionStart runs once; adding to PreToolUse/PostToolUse adds per-tool-call overhead for a condition that won't change mid-session. The `hook_capture_gap: true` tag on session_start is sufficient for downstream filtering.

## Affects / Affected by

**This ADR affects:**

- [`scripts/hooks/_lib.mjs`](../scripts/hooks/_lib.mjs) — `validateProjectRoot()` function added
- [`scripts/hooks/session-start.mjs`](../scripts/hooks/session-start.mjs) — CWD validation at session start
- [`adr/0034-specialist-invocation-discipline.md`](./0034-specialist-invocation-discipline.md) §C — companion check is now operational, not just advisory

**This ADR is affected by:**

- [`constitution/kernel-v6.md`](../constitution/kernel-v6.md) — Rule 22 (epistemic transparency: audit trail must not go silently dark)
- [`adr/0011-claude-code-enforcement-runtime.md`](./0011-claude-code-enforcement-runtime.md) — hooks are transparency, not blocking
- [`adr/0034-specialist-invocation-discipline.md`](./0034-specialist-invocation-discipline.md) §C — describes the gap this ADR closes

## References

- [`lessons-learned/2026-05-22-browser-gated-provisioning-friction.md`](../lessons-learned/2026-05-22-browser-gated-provisioning-friction.md) — Root cause 2
- [`scripts/hooks/_lib.mjs`](../scripts/hooks/_lib.mjs) — `validateProjectRoot()` implementation
- [`scripts/hooks/session-start.mjs`](../scripts/hooks/session-start.mjs) — SessionStart CWD validation
