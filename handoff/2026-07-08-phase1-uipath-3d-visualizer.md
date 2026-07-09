---
date: 2026-07-08
author: Builder (Opus 4.8) — approved by Nick
topic: Phase-1 proof vehicle — the UiPath REFramework 3D process visualizer
status: active
---

# Phase-1 kickoff — UiPath REFramework 3D process visualizer

> This is the **first real build** on the top-tier program ([ADR-0054](../adr/0054-path-to-top-tier-proof-first.md)). It is BOTH Nick's product AND Loom's Phase-1 proof vehicle: the build tests whether Loom's governed workflow actually holds on a novel, non-web project (the thing every prior dogfood — AnonForum, Ravenwise — failed silently at). Scoreboard: [`orchestration/roadmap-to-number-one.md`](../orchestration/roadmap-to-number-one.md).

## TL;DR — paste into a NEW chat to start building

```
I'm Nick. We're starting a new project: a WEB APP that ingests a UiPath
REFramework automation (XAML files, from a repo URL and/or NuGet package) and
renders a 3D "city map" of the process — for root-cause analysis, debugging, and
building confidence that the automation meets its business/technical requirements
+ exceptions. UI is the point (think the Cyberpunk 2077 city map: buildings =
systems, pipes = transaction paths, search to de-clutter).

Set it up as its OWN project directory (suggested: C:\Users\14134\dev\process-
cartographer) GOVERNED BY LOOM: copy/bootstrap the loom-template governance in
(constitution, hooks, doctor, discovery, specialists), then RUN LOOM DISCOVERY on
this project before building. This build is also Loom's Phase-1 proof — measure
whether the discipline holds (per C:\Users\14134\dev\loom-template\handoff\2026-
07-08-phase1-uipath-3d-visualizer.md and ADR-0054).

v1 SCOPE (locked): static map from XAML (every possible path + all systems +
requirement/exception coverage), UI-first. Runtime execution-log overlay = v2.
Start with the VANILLA public UiPath REFramework as the first target (predictable
skeleton). Stack: Vite + React + TypeScript + react-three-fiber (Three.js);
fast-xml-parser for XAML; a JSON intermediate-representation (IR) graph as the
contract between parser and renderer.

First milestone: parse the REFramework into the IR graph (tested), then render it
as a basic 3D graph with search. THEN the city aesthetic. Have the EAC author a
`uipath-xaml` specialist (this proves Loom leaves the web lane — Phase 2b).

Read the full kickoff doc above first. Then run discovery, scaffold the app, and
show me the REFramework mapped in 3D.
```

## The vision (Nick, precise)

A web app that ingests a UiPath REFramework automation and builds a **3D visual map** of the process to (a) do root-cause analysis + debug, and (b) **build confidence** the automation does its job per business requirements, business exceptions, technical requirements, technical exceptions. The map shows: transactions, variables/arguments (+ values, v2), decisions, the distinct pathways (one per use-case/scenario), the systems/apps in use **and which area** (login page, a web-app page, a DB table, an API call, an Excel file), and the XAMLs being executed. UI metaphor: a game-like 3D city — **buildings = systems**, **pipes = paths** (highlightable), plus **search** so large automations don't render everything at once.

## Scope decisions (locked with Nick, 2026-07-08)

- **Build the visualizer (not the Excel→automation generator) first.** Generator is a sibling track later; the shared IR feeds both.
- **Web app.** UI-first — the 3D rendering is the differentiator, not the parser.
- **v1 = static** (XAML structure + all possible paths + systems + requirement/exception coverage). A **PDD** (Process Definition Document) and/or the **Requirements & Exceptions xlsx** are optional *helper* inputs to enrich flow/intent understanding. **Runtime** (real values, actual-path-taken, live "currently executing" — from UiPath execution logs / Orchestrator) = **v2**.
- **First target: the vanilla public UiPath REFramework** ("the ReFramework as a whole" — a good, predictable base). Nick will also provide his real project (repo URL and/or NuGet) as the next input.

## Architecture — four layers

1. **Ingest + parse** — read the UiPath project (`.xaml` + `project.json` + `Config.xlsx`; a `.nupkg` is just a zip — unzip → same files). Parse the Workflow XML: workflows, `InvokeWorkflowFile` (REFramework's modular spine), `TryCatch`, `FlowDecision`/`Switch` (decision/pathway branches), arguments/variables (+ defaults), each activity's **target** (selector / URL / DB connection / file). REFramework's fixed skeleton (Main → InitAllSettings → GetTransactionData → Process → SetTransactionStatus → End, + the retry/business-exception/system-exception flow) is a **reliable spine** to hang the map on.
2. **Intermediate representation (IR)** — a structured JSON graph (nodes: workflows, activities, decisions, systems; edges: invokes, transaction paths, branches). The renderer's contract, and **independently testable** (parse REFramework → assert the graph). This is milestone 0.
3. **Target classification** — infer *which system + area* each activity touches: web page (selector has URL/title), DB table (query activity), API (HTTP Request), Excel (Excel activities), login (credential activities). This is Loom's classifier idiom (cf. `scripts/lib/permissions-classifier.mjs`). Activities → buildings + "which floor."
4. **3D city + search** — react-three-fiber: **buildings = systems**, **districts = workflows**, **pipes = transaction paths** (highlight per scenario), each **requirement/exception = a traceable, lightable path**. Search/filter by system / file / variable / use-case → render on demand (large automations must not render everything at once). Layout: a graph-layout pass (elkjs/dagre) to position nodes, then render as 3D.

**The payoff view:** overlay the Requirements & Exceptions xlsx onto the paths → "does every requirement + exception have a covered path?" = the confidence dashboard. RCA = light the failing transaction's path, see which building/floor it broke at.

## Stack (recommended, decided)

- **Vite + React + TypeScript** app.
- **react-three-fiber** (+ drei) over Three.js for the 3D city (ergonomic with React state/search/panels).
- **fast-xml-parser** (or `@xmldom`) for XAML → JS objects.
- **JSON IR** as the parser↔renderer contract (versioned schema).
- One language (TS) end-to-end — keeps it Loom-native. (Python is viable for the parser but splits the stack; not worth it.)

## Milestones (incremental — UI-forward but parser-backed)

- **M0** — Parser: vanilla REFramework → IR JSON graph. Tested (assert workflows, invokes, decisions, activity targets). *(the provable base)*
- **M1** — Basic 3D render of the IR (nodes as blocks, edges as lines) + search/filter. *(first visible map)*
- **M2** — The city aesthetic: buildings = systems, districts = workflows, pipes = paths, highlight-on-select, the Cyberpunk-map feel.
- **M3** — Requirement/exception overlay (ingest the xlsx/PDD) → coverage/confidence view + RCA path-lighting.
- **M4 (v2)** — Runtime overlay: ingest UiPath execution logs / Orchestrator → real values, actual-path-taken, live "currently executing."

## Loom proof hooks (this is Phase 1)

- **Run Loom discovery** on the project first (requirements + risk-register) — don't skip it; that skip is exactly what failed in AnonForum/Ravenwise.
- **EAC authors a `uipath-xaml` specialist** (XAML/REFramework parsing domain knowledge) — proves Loom leaves the web lane (**scoreboard: Domain reach / Phase 2b**).
- **Measure**: did the discipline hold end-to-end (no silent degradation)? Update the scoreboard (**Reliability, Efficacy**).
- Governance applies: `loom doctor` green before PRs; dispatch `critic` before consequential commits; secrets (Orchestrator creds, v2) via keyring per LR-03.

## Dependencies / what to have ready

- **The input automation.** Start with the **public UiPath REFramework** (UiPath's official template — cloneable/exportable). Nick's real project (repo URL / `.nupkg`) is the next input once available.
- Optionally, a **PDD** or the **Requirements & Exceptions xlsx** for the M3 overlay.

## Honest scope note

This is a real product (weeks, incremental), not a one-session build. It's also the honest test of whether Loom's dogfood governance actually holds on a hard, novel project — which is the whole point of Phase 1. Build it *governed*, measure whether the governance held, and let that measurement (not a claim) tell us if Loom is on track for top-tier.
