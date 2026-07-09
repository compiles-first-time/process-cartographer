# ADR-0043: cwd-robust project-root resolution for hooks

**Status:** Accepted
**Date:** 2026-06-14
**Author:** Builder — approved by Nick
**Confidence:** [H]

## Context

[`scripts/hooks/_lib.mjs`](../scripts/hooks/_lib.mjs) line 17 sets:

```js
export const PROJECT_ROOT = process.cwd();
```

All hooks resolve the event log path, runtime discovery, and placeholder checks from this value. When Claude Code is launched from any directory other than the repo root, `process.cwd()` is wrong and hook output silently misroutes. ADR-0038 detects and banners this condition; this ADR fixes the **subdir/cwd-drift** case (Problem A) and documents the **foreign-directory** case (Problem B) as a launch requirement.

Two failure modes exist:

| | Problem A — subdir/cwd drift | Problem B — foreign directory |
|---|---|---|
| Example | Session launched from `adr/`, `scripts/`, etc. | Session launched from a sibling repo |
| Fix | Walk up from hook's own file location | Cannot self-fix; `LOOM_PROJECT_ROOT` env or launch discipline |
| This ADR? | **Yes** | **Documented requirement** — see §Consequences |

The observatory already implements `LOOM_PROJECT_ROOT || cwd`; this ADR aligns hooks with that pattern and adds the walk-up fallback.

## Decision

Replace the `process.cwd()` assignment in `_lib.mjs` with a `resolveProjectRoot()` function applying this priority chain:

### Priority chain

1. **`LOOM_PROJECT_ROOT` env var** — explicit override; if set and the path passes the marker check, use it unconditionally. If set but invalid, warn to stderr and fall through.
2. **Walk up from the hook's own location** — start at `path.dirname(fileURLToPath(import.meta.url))` (i.e., `scripts/hooks/`) and ascend parent directories, depth cap 8, until a directory passes the marker check.
3. **`process.cwd()` fallback** — if neither resolves, fall back to cwd. The ADR-0038 banner fires at session-start for the foreign-dir case.

### Marker set (ADR-0043)

A directory qualifies as a Loom root if it contains **all three** of:
- `loom-spec.md`
- `constitution/kernel-v6.md`
- `.claude/loom-permissions.yaml`

These three together are not plausible in a non-Loom directory. Stricter than the ADR-0038 2-of-4 heuristic, which remains the fallback in `validateProjectRoot()`.

### `validateProjectRoot()` update

The existing function (ADR-0038, 2-of-4 threshold) gains a fast-path: if all three ADR-0043 markers are present, return `{ valid: true }` immediately. The 2-of-4 fallback is retained for partial installs.

### Observatory

No change to `observatory/server.mjs` — it already uses `LOOM_PROJECT_ROOT || cwd`. Walk-up is not added there because the observatory is launched explicitly from a known path. The shared resolution contract (priority 1–3) is documented here; a shared module can be extracted later if drift becomes a problem.

## Evidence basis

- **Primary:** 2026-06-07/08 session ran from `…\Internal Platform`, producing zero mechanical events — discovered via ADR-0038 banner post-hoc. `[user-report][H]`
- **Prior art:** `observatory/server.mjs` already uses `LOOM_PROJECT_ROOT || cwd`, proving the env-var pattern is viable. `[codebase][H]`
- **Depth cap of 8:** `scripts/hooks/_lib.mjs` is 2 levels below the project root. A monorepo with the deepest plausible hook nesting would need ≤6 levels; 8 is conservative headroom without risk of scanning the filesystem root. `[reasoning][M]`

## Consequences

**Locks in:**
- Subdir launches now find the correct project root automatically — no env var required.
- `LOOM_PROJECT_ROOT` is the documented escape hatch for unusual launch configurations.
- Problem B (foreign-directory launches) is documented as a **launch requirement**: open Claude Code from within the Loom project directory. The ADR-0038 banner remains the signal when this is violated.

**Locks out:**
- Nothing. Change is additive (new function); callers are unchanged.

**Migration:** If Claude Code adds native project-root awareness, `resolveProjectRoot()` can be removed and `PROJECT_ROOT` reverts to `process.cwd()` with no other changes.

## Alternatives considered

- **Ship a `LOOM_PROJECT_ROOT` population snippet (shell profile / settings stanza):** Rejected for Problem B. Couples user shell state to a specific project path; adds out-of-band setup burden. The launch requirement is cleaner.
- **Walk from `process.cwd()` instead of `import.meta.url`:** Rejected. Fails Problem A — if cwd is a non-Loom sibling dir, the walk finds nothing. Walking from the hook's own file location is reliable regardless of cwd.
- **Deeper depth cap (16+):** Rejected. Risks scanning irrelevant filesystem trees on deeply nested monorepos. 8 is sufficient and bounded.

## Affects / Affected by

**This ADR affects:**
- [`scripts/hooks/_lib.mjs`](../scripts/hooks/_lib.mjs) — `resolveProjectRoot()` replaces the `process.cwd()` one-liner; `validateProjectRoot()` gains ADR-0043 fast-path

**This ADR is affected by:**
- [ADR-0038](./0038-hook-capture-gap-detection.md) — detects the gap this ADR fixes; the banner is retained for Problem B
- [ADR-0011](./0011-claude-code-enforcement-runtime.md) — hooks are transparency, not blocking; no behavior change on degraded path
- [`constitution/kernel-v6.md`](../constitution/kernel-v6.md) — Rule 22 (audit trail must not go silently dark)

## References

- [`scripts/hooks/_lib.mjs`](../scripts/hooks/_lib.mjs) — implementation
- [`observatory/server.mjs`](../observatory/server.mjs) — prior art (`LOOM_PROJECT_ROOT || cwd`)
- [`handoff/2026-06-08-credential-setup-and-resolutions.md`](../handoff/2026-06-08-credential-setup-and-resolutions.md) — R1 requirement
