---
date: 2026-07-08
agent: builder (Opus 4.8)
severity: medium
share: true
upstream: loom-template
---

# `scripts/bootstrap.ps1` crashes on Windows PowerShell 5.1 — `Get-Date -AsUTC` is PS 6+ only

## What happened

First governed action of the process-cartographer Phase-1 build: run `scripts/bootstrap.ps1` after copying the Loom template in. Placeholder substitution (step 1) and smoke checks (step 2) succeeded, then step 3 ("Generating v0.2 runtime artifacts") threw:

```
A parameter cannot be found that matches parameter name 'AsUTC'.
```

The offending line:

```powershell
$dateLog = Join-Path $root "memory/event-log/$(Get-Date -AsUTC -Format 'yyyy-MM-dd').jsonl"
```

`Get-Date -AsUTC` was introduced in **PowerShell 6.0**. The default shell on Windows is **Windows PowerShell 5.1** (`powershell.exe`), which has no `-AsUTC` parameter → the whole bootstrap aborts (`$ErrorActionPreference = "Stop"`) *after* stamping placeholders but *before* creating the event-log file, regenerating MCP settings, stamping the subagent sentinel, and running quick-scan discovery.

## Why it matters (Phase-1 signal)

This is exactly the class of **silent/partial-degradation-at-setup** that Phase-1 exists to catch. A less careful run would have seen "All smoke checks passed" scroll by, taken the crash as cosmetic, and proceeded with a **half-bootstrapped project**: no seeded event log (hooks would create it lazily, but the bootstrap audit record is skipped), no runtime-discovery sentinel, no quick-scan. The governance would appear installed while several post-conditions silently didn't run. The `.sh` path is unaffected, so it only bites Windows-default shells — the easiest environment to overlook in testing.

## What we did

Fixed the copy in `process-cartographer/scripts/bootstrap.ps1` with a 5.1-safe expression:

```powershell
$dateLog = Join-Path $root "memory/event-log/$((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')).jsonl"
```

Re-ran; bootstrap completed all steps (event log `2026-07-09.jsonl` created, MCP settings in sync, sentinel stamped, quick-scan written). `node scripts/lib/doctor.mjs` → 0 hard failures.

**Not modified: `loom-template` itself** (per the standing constraint for this build). This lesson carries `upstream: loom-template` so the fix can be propagated there via the Update Bus.

## What we'd do differently

1. **Author `.ps1` scripts against Windows PowerShell 5.1**, not just PS 7 — it is the default on Windows and the lowest common denominator. Avoid 6+-only params (`-AsUTC`, `-AsHashtable`, ternary/`??`/`?.`, `&&`/`||`).
2. **Candidate `loom doctor` soft-check:** grep `scripts/*.ps1` for known 6+-only tokens (`-AsUTC`, `-AsHashtable`, ` ?? `, `?.`, `&&`, `||`) and warn — a cheap portability gate that would have flagged this before first run.
3. **Bootstrap step failures should be loud about which post-conditions were skipped**, not just abort — a partially-bootstrapped project is a silent-coverage landmine (cf. [2026-07-06-fileurl-to-path-windows-drive-letter](./2026-07-06-fileurl-to-path-windows-drive-letter.md)).

## Related

- `scripts/bootstrap.ps1:127` (fixed in this project's copy 2026-07-08)
- Sibling POSIX path `scripts/bootstrap.sh` — unaffected
- Kindred Windows-portability lesson: [2026-07-06-fileurl-to-path-windows-drive-letter](./2026-07-06-fileurl-to-path-windows-drive-letter.md)
- Phase-1 kickoff: [handoff/2026-07-08-phase1-uipath-3d-visualizer.md](../handoff/2026-07-08-phase1-uipath-3d-visualizer.md)
