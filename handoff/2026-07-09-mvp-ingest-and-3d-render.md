---
date: 2026-07-09
author: Builder (Opus 4.8) — for Nick
topic: MVP reached — ingest (.nupkg / folder / GitHub) → 3D city render
status: active
supersedes-context-in: 2026-07-08-phase1-uipath-3d-visualizer.md (scope doc still current)
---

# MVP — you can now load a UiPath project and see it as a 3D city

## What works now (branch `phase1/governance-bootstrap-and-m0`, unmerged)

**Ingest (all in-browser, no backend):**
- **GitHub repo URL** — `owner/repo`, full URL, or `.../tree/branch/subdir`. Uses the GitHub tree API + raw.githubusercontent.com (both CORS-safe), fetches only `.xaml`/`project.json`, retry+backoff on 429, optional token for private repos / higher limits. Verified live against `UiPath/ReFrameWork` (13 workflows, 603 activities, 16 invokes) — reproduces the on-disk parse exactly.
- **`.nupkg` / `.zip`** — unzipped client-side with fflate; NuGet plumbing filtered out; re-rooted to the `project.json` directory.
- **Folder** — `webkitdirectory` picker; reads only `.xaml`/`project.json`; files never leave the machine.
- One-click **"Try the vanilla REFramework"** demo button.

**Render + interaction:**
- 3D city (react-three-fiber): **buildings = workflows** (height = activity mass, color = dominant system touched), **arced pipes = resolved invoke edges**, **amber beacons = dynamic/unresolved invokes** (RISK-01: surfaced, not faked).
- **Search** (FR-06) over names / systems / arguments / activities / states → dims non-matches, `X/Y` count.
- **Click a building** → detail panel (kind, states, arguments, systems-touched with confidence, invokes in/out — click-through to navigate).
- **Legend**, **diagnostics bar** (project meta + counts + collapsible warnings), **accessible non-3D list view** (keyboard-operable, the screen-reader path), **reduce-motion** toggle + `prefers-reduced-motion` honoring.

## How to run
```
npm install
npm run dev      # http://localhost:5173  → "Try the vanilla REFramework"
npm test         # 28 tests: parser, ingest (incl. live-parity nupkg + mocked GitHub retry), layout, search, a11y list
npm run build    # production bundle
```

## Verified vs not
- **Verified:** full data path (ingest → IR → layout → list) via 28 tests; live GitHub ingest; typecheck; production build; `loom doctor` 0 hard failures; Loom suite 420/420.
- **NOT yet verified in CI:** the actual WebGL paint (only rendered in a real browser). Next: a Playwright screenshot smoke test.

## Architecture notes for the next session
- `src/parser/assembleIR.ts` + `projectMeta.ts` are **browser-safe** (no `node:fs`); `loadProject.ts` is the Node/CLI/test path. All ingest adapters reuse `assembleIR` — one graph-builder, four entry points.
- IR contract: `src/ir/schema.ts` (zod, source of truth) → `schema/ir.schema.json` (generated, `npm run gen:schema`).
- Layout: `src/layout/cityLayout.ts` (dagre). Palette + labels shared by scene and legend.

## Next milestones
- **M2 polish:** districts per folder, better materials/skyline, edge-bundling for dense graphs, LOD + render-culling at the "thousands of activities" scale (critic's perf-budget flag).
- **M3:** requirement/exception coverage overlay (see OQ-07: define the matching mechanism + a coverage golden fixture; OQ-08 IR field reservation is a non-breaking add).
- **M4 (v2):** runtime execution-log / Orchestrator overlay.
- **Still owed:** browser WebGL smoke test; validate against a real non-template REFramework + a Flowchart-style Main; propagate the `bootstrap.ps1` PS5.1 fix upstream to loom-template.
