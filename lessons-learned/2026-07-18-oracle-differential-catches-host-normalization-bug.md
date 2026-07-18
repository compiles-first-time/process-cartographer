---
date: 2026-07-18
agent: builder (Fable 5)
severity: medium
share: true
---

# The B2 oracle differential caught a real resolver bug on its very first run — bare-dot imports never resolved

## What happened

The first full run of the new oracle harness (B2: dependency-cruiser + madge + tsc voting over pinned-SHA corpora) reported vue-core recall at **99.83%** with three `truthOnly` edges — edges **all three oracles affirmed unanimously** that our shipped resolver missed:

```
packages/runtime-core/src/apiCreateApp.ts   → packages/runtime-core/src/index.ts
packages/runtime-core/src/compat/global.ts  → packages/runtime-core/src/index.ts
packages/runtime-dom/src/apiCustomElement.ts → packages/runtime-dom/src/index.ts
```

All three were the same syntax: `import { version } from '.'` — a bare-dot directory import. Our IR had honestly classified them `external` (under-approximation held: nothing invented), but the edge was real and we weren't drawing it.

## Root cause

For a `.` specifier, `ts.resolveModuleName` probes the candidate directory **with a trailing slash** — `directoryExists("/pkg/src/")`. The B1 in-memory `ModuleResolutionHost` normalized *leading* slashes only, so the probe built the prefix `pkg/src//`, matched no file, returned `false` — and TypeScript switched to `onlyRecordFailures` mode: every subsequent `index.*` lookup was recorded as failed **without ever calling `fileExists`**. The instrumented probe made it unmissable: one single host call, `directoryExists( /pkg/src/ ) -> false`, then FAIL. The `ts.sys` host (which the tsc *oracle* used) normalizes trailing separators, which is exactly why the oracle saw the edge and the shipped host didn't.

Fix: normalize trailing slashes in the host's path `strip()` ([tsResolver.ts](../src/repo/syntax/tsResolver.ts)); regression test added (bare-dot → sibling `index.ts`). Re-measured: vue-core recall **100.00%**.

## Lessons

1. **The differential works — this is the proof.** B1 shipped with 5 passing unit tests and a live E2E demo, and still carried a resolution bug no test imagined (`.` as a specifier). The oracle harness found it in its first ten minutes of existence, from a 15-line disagreement list. "A resolver ships only with measured precision/recall against oracle tools" (ADR-0055 §B.5) is not ceremony; it is the only thing that looked in the right place.
2. **Unanimous `truthOnly` disagreements are gold.** The 12 `oursOnly` edges were a 2-vs-2 modeling split (tsconfig paths on shim files — defensible, disclosed). The 3 `truthOnly` edges with 3/3 oracle votes were a hard bug. Vote structure told us which disagreements to chase first.
3. **In-memory host fidelity is a bug class of its own.** Any host handed to a real compiler must match the real filesystem's path tolerance (trailing separators, case, `.`/`..`) — the compiler's internal probes are optimized to *skip work* when a host says no, so a single false negative silently poisons everything downstream of it. When a compiler API mysteriously fails against an in-memory host, instrument the host calls first (one console.log per method beats reading resolver source).
4. **Under-approximation contained the blast radius.** The bug produced missing edges classified `external`, never wrong edges — the ADR-0055 fail-toward-omission design meant even the bug was honest.
