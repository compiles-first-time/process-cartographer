# Improvement roadmap — from "very good" to complete

> Authored 2026-07-18 from Nick's direction: improve UX, mapping accuracy, LLM cost,
> directory understanding, and explore live execution visualization — **without
> breaking what exists**. Every item below is additive: new modules and overlays on
> the existing seams (Zone tree, RepoIR, ingest adapters), never rewrites of them.
> Governance: items marked ▲ need an ADR when started; accuracy items inherit
> [ADR-0055](../adr/0055-universal-repo-cartography-computed-not-generated.md)'s contract.

## A. UX (days each, zero structural risk)

| # | Improvement | What it does | Why |
|---|---|---|---|
| A1 ✅ | **Blast-radius view** | Select a building → its full transitive import closure lights up (upstream = who depends on me, downstream = what I depend on), depth-faded | The #1 code-comprehension question ("what breaks if I touch this?"); pure graph traversal over edges we already compute |
| A2 ✅ | **Global search** | Search the WHOLE city (all levels: dirs, files, symbols, import specifiers), results jump-to-zone (jumpToFile generalized) | Current search is per-level; users think repo-wide |
| A3 | **Path A→B lighting** | Pick two buildings → shortest import path lights up | The UiPath RCA "light the failing path" idea, generalized |
| A4 | **Minimap / overview toggle** | Flat whole-city aerial with viewport indicator; needs InstancedMesh at >1k buildings | Drill-down-as-LOD is efficient but loses global orientation |
| A5 | **Edge tooltips** | Hover a pipe → who→whom, kind, evidence line, click-to-open panel | Pipes currently carry knowledge you can't interrogate |
| A6 | **Session persistence** | Recent repos + includeDirs choices + annotations in IndexedDB; one-click re-map | Re-ingesting on every visit wastes time and API budget |
| A7 ✅ | **Keyboard completion** | Esc = up a level, Enter = enter selected, F = fly to selected | Complements the new WASD movement |

## B. Mapping accuracy (the ADR-0055 ladder, climbed further)

| # | Improvement | Tier effect |
|---|---|---|
| B1 | **Real TypeScript resolver** (`@typescript/vfs` + `ts.resolveModuleName`, code-split like the wasm) | tsconfig `paths` aliases + workspace links resolve → the "@/lib/x shows external" gap closes; JS/TS becomes compiler-grade |
| B2 | **Oracle harness in CI** (dependency-cruiser + madge + tsc 2-of-3 for TS; Grimp for Python; pinned-SHA corpus) | "Accurate" becomes a *measured, published* number per release — the 0055 promise operationalized |
| B3 | **Export facts + named-import linking** | Record each file's exported symbols; link imported names to the target's exports → symbol-level pipes on drill-in ("which function uses which") — still purely syntactic |
| B4 | **Java tier** (imports are fully static — cheap win), then **C# `.sln`/`.csproj`** project districts (fast-xml-parser reuse) + namespace-index heuristic edges | Two more major ecosystems on the same ladder |
| B5 ▲ | **Wiring adapters** — pluggable deterministic parsers for KNOWN config formats: `.claude/agents/*.md` frontmatter (`tools:` lists), Python `entry_points`, `package.json` `bin`/`scripts`, GitHub workflows `uses:` | The agents→tools question answered at *schema* depth, not just literal-path mentions — each adapter is a per-format parser with evidence, zero LLM |
| B6 | **Worker-pool parsing** | Off-main-thread syntax tier (already designed; perf-only) — keeps 300k+ LOC ingests smooth |

## C. LLM cost reduction (annotation overlay)

| # | Improvement | Saving |
|---|---|---|
| C1 ✅ | **Persistent annotation cache** keyed by (content hash, model, prompt version) in IndexedDB; exportable alongside IR JSON | Never pay twice for an unchanged file — the single biggest saver |
| C2 ✅ | **Prompt caching** (`cache_control` on the system prompt + shared repo-context prefix) | ~90% input-token discount on cache hits when annotating several buildings in a session |
| C3 ✅ | **Model tiering** | Haiku for district/file "what" summaries; Sonnet only on an explicit "deepen" click for why/how |
| C4 | **Batch API for bulk jobs** ("annotate this district") | 50% discount; minutes-latency is fine for bulk, results stream in as they land |
| C5 | **Grounding compression** | Send computed facts + only the symbol-bearing line ranges for large files, not whole files |
| C6 | **Hierarchical annotation** | Annotate leaf dirs first; parent annotations consume child summaries (bottom-up) — cheaper AND more accurate at scale |

## D. Directory understanding — computed first, LLM second

| # | Improvement | Notes |
|---|---|---|
| D1 ✅ | **Computed district intelligence** (no LLM): dominant language, entry points (`main`/`index.*`/`__init__.py`/`package.json#main`), fan-in/fan-out, cohesion ratio (internal vs external edges) on every district panel | Answers most "what is this directory" questions deterministically |
| D2 ✅ | **Role badges** from deterministic signals: `tests` (test patterns/frameworks), `CI` (`.github/workflows`), `docs`, `config`, `entry point` — each with evidence | Structure semantics without interpretation risk |
| D3 | **README surfacing** | Nearest README rendered in the district panel (already fed to the AI; show it computed too) |
| D4 | Combined with C6: district AI annotations grounded in D1–D3 facts | The "why is it structured this way" answer gets sharper as the computed context gets richer |

## E. ▲ Execution visualization — the "live data through the city" feature

**Verdict: feasible — and mock data is the wrong path.** The repo's own tests/app
produce REAL execution data; observed-events-only rendering keeps the accuracy
contract intact (runtime data is an OVERLAY keyed to file paths — it never writes
structure). Three stages, each shippable alone:

1. ✅ **E1 — Coverage overlay (artifact upload, no live infra).** Load standard
   coverage artifacts — V8/c8/Jest coverage JSON, Python `coverage.py` JSON, and
   UiPath execution logs for the original pipeline — via a "load overlay" seam
   next to the IR-JSON loader. Executed files GLOW (intensity = hit count), cold
   files dim, uncovered-but-imported buildings get flagged. Run your tests, drop
   the file, see what actually executes. Deterministic; days of work.
2. **E2 — Trace replay.** Load a trace (OTel spans JSON, `--cpu-prof`, chrome
   tracing format) → a time scrubber replays the run: pipes pulse in call order,
   buildings light in sequence. Still artifact-based — no daemon, no sockets.
3. **E3 — Live streaming (companion CLI, the U5 item grown up).** `pc-trace node app.js`
   / `pc-trace pytest` wraps the user's own process with standard instrumentation
   (Node `--import` hook / `diagnostics_channel` / OTel auto-instrumentation;
   Python `sys.setprofile` or coverage's tracer) and streams file/function-enter
   events over a **local WebSocket** to the browser. Buildings light up live as
   the program runs; events are batched (~60 Hz) for backpressure. Local-first,
   user's own process, honest: only observed events render.

E1 → E2 → E3 in order: each stage de-risks the next, and E1 alone already delivers
the "confidence" payoff (which code actually runs) with zero infrastructure.

## Recommended build order (no-break, each independently shippable)

1. **A1 + A2 + A7** (blast-radius, global search, keyboard) — biggest daily-use win, zero risk.
2. **C1 + C2 + C3** (annotation cache + prompt caching + tiering) — cost drops ~an order of magnitude for repeat use.
3. **B1 + B2** (real tsc + oracle harness) — completes the accuracy story for the primary stack and makes accuracy *measured*.
4. **D1 + D2** (computed district intelligence) — the directory-understanding ask, LLM-free.
5. **E1** (coverage overlay) — first taste of execution data, then **E2/E3** once proven.
6. **B4/B5** (Java/C#/wiring adapters) as the ecosystems demand.

*Discovery/OQ updates and per-item ADRs (▲) happen at build time, per item.*
