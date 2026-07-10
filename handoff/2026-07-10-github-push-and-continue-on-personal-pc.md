---
date: 2026-07-10
author: Builder (Opus 4.8) — for Nick
topic: Push to GitHub, clone on a personal PC, and continue building
status: active
supersedes-context-in: 2026-07-09-mvp-ingest-and-3d-render.md
---

# Handoff — push to GitHub, continue on your personal PC

> Read this first in a fresh chat. It has: (1) a paste-into-new-chat prompt, (2) exact push + clone steps, (3) current state + architecture, (4) how to run/test, (5) next milestones, (6) governance notes, (7) the upstream-to-Loom items + the lessons-service proposal.

## 0. TL;DR — paste into a NEW chat (on the personal PC, in the cloned repo)

```
I'm Nick. This is process-cartographer — a UiPath REFramework 3D "city map"
visualizer, and Loom's Phase-1 proof vehicle. It's governed by Loom (constitution,
hooks, doctor, discovery, specialists all live in this repo). Read these in order:
  1. handoff/2026-07-10-github-push-and-continue-on-personal-pc.md  (this file — current state)
  2. handoff/2026-07-09-mvp-ingest-and-3d-render.md                 (MVP details)
  3. handoff/2026-07-08-phase1-uipath-3d-visualizer.md              (locked scope + milestones)
  4. CLAUDE.md, AGENTS.md, discovery/requirements.md

Done so far: M0 (parser → versioned JSON IR, tested), MVP (ingest from GitHub repo /
.nupkg / folder → interactive 3D city), and an M2 re-architecture (states + Orchestrator
+ external systems as buildings you can ENTER to drill city→state→workflow→activities).
Stack: Vite + React + TS + react-three-fiber; fast-xml-parser; zod IR; dagre layout.

Setup: `npm install`, then `npm run dev` (http://localhost:5173) and click "Try the
vanilla REFramework". Run `npm test` (35 tests), `npm run typecheck`, `npm run build`,
and `node scripts/lib/doctor.mjs` (must be 0 hard failures) before PRs.

Next candidates (pick with me): (a) extract REAL state→state transition edges with their
VB conditions (the pipes currently use lifecycle/document order); (b) M3 requirement/
exception COVERAGE overlay (the confidence payoff — see discovery/open-questions.md OQ-07/08);
(c) a Playwright WebGL screenshot smoke test; (d) validate against a real non-template
REFramework project + a Flowchart-style Main. Keep it governed: doctor green, author real
discovery, dispatch the critic before consequential commits.
```

## 1. Push this repo to GitHub

**Pre-push checklist (all currently green):**
```bash
node scripts/lib/secrets-doctor.mjs   # ✓ no token-shaped values (verified 2026-07-10)
node scripts/lib/doctor.mjs           # ✓ 0 hard failures
npm test                              # ✓ 35 passing
```
There are **no secrets** in the repo (it's a static, client-side analyzer — no credentials). `node_modules/`, `dist/`, and `.env*` (except `.env.example`) are gitignored.

**State:** all work is on branch `phase1/governance-bootstrap-and-m0` (3 commits). There is no `main` yet.

**Option A — `gh` CLI (authenticated here as `compiles-first-time`):**
```bash
cd /c/Users/14134/dev/process-cartographer
git branch -m phase1/governance-bootstrap-and-m0 main   # make this the default branch
gh repo create process-cartographer --private --source=. --remote=origin --push
# → creates the repo, sets 'origin', pushes 'main'
```
Use `--public` instead of `--private` if you want it public. To create under a different owner: `gh repo create <owner>/process-cartographer ...`.

**Option B — manual (any GitHub account):** create an empty repo `process-cartographer` on github.com (no README/license), then:
```bash
git branch -m phase1/governance-bootstrap-and-m0 main
git remote add origin https://github.com/<owner>/process-cartographer.git
git push -u origin main
```

**Keeping the milestone branch:** if you prefer the governed PR flow instead of renaming, push the feature branch and open a PR into a fresh `main` — but for solo continuation, renaming to `main` (above) is simplest.

## 2. Clone + continue on the personal PC

```bash
git clone https://github.com/<owner>/process-cartographer.git
cd process-cartographer
npm install          # restores the toolchain (react-three-fiber, dagre, fflate, vitest, …)
npm run dev          # http://localhost:5173  → "Try the vanilla REFramework"
```

**Governance on the fresh clone (this is the CLEAN case):** open Claude Code **in the cloned repo directory** (`cd process-cartographer && claude`). Because `.claude/` already exists in the clone, hooks register and subagents (`critic`, `eac`, `uipath-xaml`, …) are invokable **from session start** — no cold-start gap (contrast the founding session; see `lessons-learned/2026-07-10-first-governed-session-cold-start.md`). Verify hooks fired: check `memory/event-log/<today>.jsonl` for a `session_start` event.

**Requirements on the new PC:** Node ≥ 20 (developed on 24), Git. Windows PowerShell 5.1 is fine (the `bootstrap.ps1` PS-5.1 bug is already fixed in this repo's copy).

## 3. Current state & architecture

**Milestones done:** M0 (parser→IR, tested) · MVP (ingest + 3D render + search + detail + a11y list) · M2 re-architecture (states/Orchestrator/systems as enterable buildings, drill-down, ground/panel fixes). Verified: 35 vitest tests, typecheck clean, `vite build` clean, `loom doctor` 0 hard failures, Loom's own suite 420/420, live GitHub ingest against `UiPath/ReFrameWork`.

**Code map (`src/`):**
- `ir/schema.ts` — versioned **zod IR** (v0.2.0), the parser↔renderer contract + boundary validation. `genSchema.ts` generates `schema/ir.schema.json` from it (drift-free). Run `npm run gen:schema` after IR changes.
- `parser/` — `xamlParser.ts` (pure XAML→workflow, incl. per-state `State.Entry` invoke containment), `assembleIR.ts` (browser-safe graph builder — resolves invoke edges + per-state invoke ids), `projectMeta.ts`, `loadProject.ts` (Node/fs path for tests/CLI).
- `ingest/` — `fromGithub.ts` (tree API + raw, retry/backoff on 429), `fromNupkg.ts` (fflate unzip), `fromFolder.ts` (webkitdirectory), `normalize.ts` (re-root to project.json dir), `buildIR.ts`. All reuse `assembleIR`.
- `model/cityModel.ts` — the recursive **Zone tree**: level 0 = state + Orchestrator + system buildings; enter → children (workflows → their invokes → leaf activities). Owns the color palette.
- `layout/cityLayout.ts` — dagre layout of a zone's children → buildings/pipes; height scaled relative to siblings per level.
- `scene/` — r3f `CityScene` (ground plane + finite grid + fog + OrbitControls), `Building` (per-kind geometry, enter ring), `Pipe`.
- `ui/` — `IngestPanel`, `DetailPanel` (440px), `Legend`, `DiagnosticsBar`, `WorkflowList` (ZoneList — accessible fallback), `search.ts`.
- `App.tsx` — drill-nav stack + breadcrumb + search + view toggle + reduce-motion.

**Fixture:** `fixtures/reframework/` — the vendored vanilla UiPath REFramework (the golden test target; OQ-01).

## 4. Run / test / build

```bash
npm run dev        # dev server + HMR (http://localhost:5173)
npm test           # vitest — 35 tests (parser, ingest, model, layout, search, a11y list)
npm run typecheck  # tsc --noEmit
npm run build      # production bundle
npm run gen:schema # regenerate schema/ir.schema.json from src/ir/schema.ts
node scripts/lib/doctor.mjs          # Loom conformance (0 hard failures required)
node scripts/lib/secrets-doctor.mjs  # before any commit touching creds
```

## 5. Next milestones (pick with Nick)

- **Real state transitions:** extract `<Transition>` `To`/`Condition` (resolve `x:Reference`↔`x:Name`) so level-0 pipes are the true control flow (retry/exception loops) with conditions on hover — today they're the lifecycle/document-order spine.
- **M3 — requirement/exception coverage overlay** (the confidence payoff): ingest the Requirements & Exceptions xlsx/PDD, map each to a traceable path, show covered/uncovered. First resolve **OQ-07** (matching mechanism + a coverage golden fixture) and **OQ-08** (IR field reservation — non-breaking) in `discovery/open-questions.md`.
- **WebGL smoke test:** Playwright screenshot per drill level in CI (the one thing not yet auto-verified).
- **Real-project validation:** run against a non-template REFramework and a Flowchart-style `Main`; harden the parser (coded `.cs` workflows are not XAML — detect + stub, per the `uipath-xaml` specialist).
- **M2 polish:** distinct geometry for decisions/loops/script-calls inside leaf workflows; LOD + render-culling at the "thousands of activities" scale (the critic's perf-budget flag).

## 6. Governance reminders

- `loom doctor` green (0 hard) before any PR; note warnings in the PR body.
- Author real discovery; dispatch the **critic** before consequential commits/ADRs (it caught real gaps here). On the fresh clone it's a normal subagent; in a cold-start session use ADR-0034 **path 2b**.
- New domain expertise → have the **EAC** author a specialist (that's how `uipath-xaml` was made).
- Secrets (v2 Orchestrator creds) via keyring per LR-03; never literal `.env`.
- Project-specific ADRs start at **0055** (0000–0054 are inherited from loom-template).

## 7. For the loom-template repo (carry these over — do NOT edit loom-template from here)

- **`docs/upstream-to-loom-template.md`** — curated list of framework findings + fixes from this build (the `bootstrap.ps1` PS-5.1 fix, the cold-start-governance gap, discovery-must-be-authored, the inherited-ADR-link noise, and what worked well).
- **`docs/proposals/lessons-learned-service.md`** — the design for a **shared lessons-learned service** (central canonical store + semantic index; projects pull-what-they-need, query on demand, push updates back; dedup/supersede + critic gates). Bring it to loom-template as an ADR.
- Upstream-tagged lessons (frontmatter `upstream: loom-template`): `lessons-learned/2026-07-08-bootstrap-ps1-getdate-asutc-ps51.md`, `2026-07-10-first-governed-session-cold-start.md`, `2026-07-10-discovery-must-be-authored-not-stamped.md`.
