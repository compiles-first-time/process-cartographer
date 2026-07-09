# process-cartographer

> A web app that ingests a **UiPath REFramework** automation (XAML — from a repo URL and/or NuGet package) and renders a **3D "city map"** of the process — for **root-cause analysis, debugging, and building confidence** that the automation meets its business/technical requirements + exceptions. Metaphor: buildings = systems, districts = workflows, pipes = transaction paths (highlightable), with **search** so large automations don't render everything at once.

**Status:** greenfield — created 2026-07-08. Nothing built yet; this is the project directory + git repo.

## Start here

The full build spec, architecture, milestones, and a **paste-ready bootstrap prompt** live in the Loom kickoff handoff:

```
C:\Users\14134\dev\loom-template\handoff\2026-07-08-phase1-uipath-3d-visualizer.md
```

This project is **governed by Loom** (`github: compiles-first-time/loom-template`) and is the **Phase-1 proof vehicle** for [ADR-0054](../loom-template/adr/0054-path-to-top-tier-proof-first.md) — Loom's path-to-top-tier program. Building it *governed*, and measuring whether the discipline actually holds on a novel non-web project, is part of the point.

## Immediate next steps (for the fresh Claude Code session)

1. **Bootstrap Loom governance into this directory first** — copy loom-template's governance (constitution, `.claude/` hooks + agents, `scripts/`, discovery, specialists) so hooks fire against this CWD. Do this *before* building, or the audit trail stays silent (ADR-0020 / ADR-0038). Then restart Claude Code so the subagents register.
2. **Run Loom discovery** (requirements + risk register) — do not skip it.
3. **M0** — parse the vanilla public UiPath REFramework → a JSON intermediate-representation (IR) graph, *tested*.
4. **M1** — render the IR as a basic 3D map with search (first visible win).
5. **M2** city aesthetic → **M3** requirement/exception confidence overlay → **M4** runtime-log overlay (v2).

**Stack:** Vite + React + TypeScript + react-three-fiber (Three.js) · `fast-xml-parser` · a versioned JSON IR contract between parser and renderer.

**Input:** start with the vanilla public UiPath REFramework (predictable skeleton = a good base); Nick's real project (repo URL / `.nupkg`) is the next input.

---

*Directory/project name `process-cartographer` is a working title — rename freely (it's an empty repo).*
