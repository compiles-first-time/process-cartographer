---
date: 2026-07-18
author: Builder (Fable 5) — for Nick
topic: Universal repo cartography — full current state + continuation prompt
status: active
supersedes-context-in: 2026-07-10-github-push-and-continue-on-personal-pc.md
---

# Handoff — universal cartography is live; continue the improvement roadmap

## 0. TL;DR — paste into a NEW chat to continue

```
I'm Nick. This is process-cartographer — a 3D "city map" visualizer for ANY code
repository (and UiPath REFramework automations), governed by Loom, built under the
ADR-0055 accuracy contract: structure is COMPUTED by real parsers, never generated
by an LLM; anything unresolvable renders as an explicit unknown, never a guess.

Read in order:
  1. handoff/2026-07-18-universal-cartography-state.md   (this file — current state)
  2. docs/roadmap-improvements.md                        (✅-marked = shipped; rest = next)
  3. adr/0055-universal-repo-cartography-computed-not-generated.md  (the accuracy contract)
  4. adr/0056-ai-annotation-overlay.md                   (AI overlay guardrails)
  5. CLAUDE.md (governance), memory: project-state

Everything is on main (github.com/compiles-first-time/process-cartographer), tests
green (86), doctor 0 hard failures. Run: npm install && npm run dev → :5173.

CONTINUE THE ROADMAP in docs/roadmap-improvements.md, next items in order:
  - B1 real TypeScript resolver (ts.resolveModuleName + in-memory host; tsconfig
    paths/baseUrl; code-split so typescript stays out of the main bundle)
  - B2 oracle harness (dependency-cruiser/madge/tsc differential in CI; measured
    precision/recall published as the shipped confidence)
  - A3 path A→B lighting, A4 minimap, A5 edge tooltips, A6 session persistence
  - C4 Batch API bulk annotation, C6 hierarchical annotation
  - E2 trace replay (OTel/cpuprofile artifacts) → E3 live WebSocket tracer
    (companion CLI: pc-trace node app.js — buildings light up as code runs)
  - B4 Java/C# tiers, B5 wiring adapters (.claude/agents frontmatter tools: lists)
Keep it governed: doctor green before pushes, claim events for milestones, ADRs
for ▲-marked items, and NEVER let anything (LLM, runtime data) write structure.
```

## 1. What the product does today (all pushed, all tested)

**Ingest** (client-side): GitHub URL (10k-file ceiling, honest refusal beyond) ·
zip/.nupkg · local folder · IR-JSON (CLI/CI seam). UiPath projects auto-detected →
original state-machine city (untouched, 35 original tests still passing).

**Computed structure** (ADR-0055 tiers): tier-0 inventory for ANY language
(dirs=districts, files=buildings, height=LOC, color=language, every skip visible);
tree-sitter syntax tier for **TS/TSX/JS/Python** (symbols as enterable interiors,
imports-as-written); resolved import edges (Node/TS relative order; Python module
algorithm incl. ancestor-dir sys.path[0] — proven live: openai/swarm
`agents.py → tools.py`); **reference edges** from docs/config literal path mentions
(dashed amber pipes); dynamic imports as ⚡ unresolved, never guessed. Pipes draw at
the drill level where endpoints diverge. Ghost ⊘ districts = excluded dirs,
**"Parse this directory"** expands on demand (all 3 adapters), drill position kept.

**Exploration**: WASD/arrows movement + click-to-fly (CameraRig) · **blast-radius**
view (amber=upstream/blue=downstream over resolved imports only) · **global search**
with jump-to-zone · Esc/Enter keys · breadcrumb drill · accessible list view ·
extraction-honesty scorecard (skips, exclusions, assumptions, parse-clean %,
edges-by-tier) · **district intelligence** (computed: dominant language, entry
points, cohesion %, evidence-backed role badges).

**Execution overlay (E1)**: "▦ Coverage…" loads Istanbul/c8/Jest or coverage.py
JSON → buildings tint red→green by OBSERVED execution; districts aggregate;
unmatched entries disclosed; zero-match rejected loudly. Overlay never alters
structure.

**AI annotation (ADR-0056)**: per-building what/why/how, grounded in real
line-numbered source + computed facts, rendered visibly distinct ("Generated, not
computed"); Haiku default + "Deepen with Sonnet"; SHA-256 content-hash cache
(localStorage, LRU-300); prompt caching; key memory-only with opt-in remember.

## 2. Code map (src/)

- `ir/schema.ts` (UiPath IR v0.2.0) · `ir/repoSchema.ts` (RepoIR v0.2.0, edge kind
  import|reference) · `ir/sharedCore.ts` (Resolution enum, spans) · `genSchema.ts`
- `parser/` UiPath XAML pipeline (unchanged) · `repo/` universal: `assembleRepoIR`
  (options: syntax/extraWarnings/includeDirs), `detectLanguage`, `hygiene`
  (excluded dirs + overrides; `packages/` deliberately NOT excluded),
  `resolveImports` (+`resolvePython`, `referenceEdges`), `syntax/` (facts.ts
  JS/TS+Python walks; analyze.ts; browserEnv.ts — wasm pinned EXACT per RISK-10)
- `ingest/` adapters (all carry `expandDir`) + `buildIR.ts` routing
  (`buildLoadedWithSyntax(ingested, env, onPhase, includeDirs)`)
- `model/` cityModel (Zone; DistrictIntel), repoCityModel (districts/ghosts/pipes/
  intel), graph.ts (blast radius) · `overlay/coverage.ts` · `annotate/` (engine +
  cache) · `layout/` dagre · `scene/` (CityScene, Building tint, Pipe dashed,
  CameraRig) · `ui/` (panels, scorecard, search)
- Tests: 86 across 10 files (incl. real-WASM ABI smoke = the RISK-10 gate).
  `npm test` / `typecheck` / `build` / `node scripts/lib/doctor.mjs`.

## 3. Verification state

86/86 vitest · typecheck clean · vite build clean (wasm code-split; typescript NOT
yet in bundle — B1 must keep it code-split) · doctor 0 hard (2 known soft warns:
inherited-ADR links, constitution-coverage from test-harness events) · Loom suite
420/420 · live E2E proofs: expressjs/express (26.7k LOC, 178 ms, 100% parse-clean),
openai/swarm (74 resolved edges, agents↔tools). NOT yet: Playwright WebGL smoke;
WebKit wasm benchmark (OQ-10); UiPath true transition edges.

## 4. Governance reminders

ADR-0055 §A is constitutional: computed-not-generated; under-approximate; tier-
stamped; scalar accuracy claims refused. ADR-0056 bounds the AI overlay. New
▲-items (wiring adapters, E3 tracer) need ADRs (0057+). Claim events per milestone
to memory/event-log/. Doctor green before push. Loom-template stays untouched from
here (upstream via docs/upstream-to-loom-template.md conventions).

## 5. Where the next session starts

`docs/roadmap-improvements.md` — unshipped items, recommended order B1 → B2 → UX
cluster (A3-A6) → C4/C6 → E2 → E3 → B4/B5. B1 sketch: `ts.resolveModuleName` with
an in-memory ModuleResolutionHost over ingested files ('/'-prefixed paths),
tsconfig parsed via `ts.parseConfigFileTextToJson` + `convertCompilerOptionsFromJson`,
dynamic-imported so typescript lands in its own chunk; results feed
`resolveImportEdges` as an overrides map (assembleRepoIR stays pure/sync).
