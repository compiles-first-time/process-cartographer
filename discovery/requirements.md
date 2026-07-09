# Requirements

> Per [L8](../layers/L8-discovery.md) / [ADR-0025](../adr/0025-discovery-scaffolding.md).
> Updated: 2026-07-08 · Authored in the governed Phase-1 setup session (not skipped — the skip is what broke prior dogfoods).

Scope frame: **v1 = static analysis** of a UiPath REFramework automation, rendered as an explorable 3D "city." Runtime/Orchestrator overlay is v2 (M4). See [handoff/2026-07-08-phase1-uipath-3d-visualizer.md](../handoff/2026-07-08-phase1-uipath-3d-visualizer.md).

## Functional requirements

| ID | Capability | User / Actor | Trigger | Outcome | Notes |
|---|---|---|---|---|---|
| FR-01 | Ingest a UiPath project | Developer | Provides a local folder, a repo URL, or a `.nupkg` | Project files available: `*.xaml`, `project.json`, `Config.xlsx` (a `.nupkg` is a zip → unzip → same files) | Local folder first (M0); repo/nupkg ingest can follow |
| FR-02 | Parse XAML → IR | System | A project is ingested | Every workflow parsed: `InvokeWorkflowFile` invoke edges, `TryCatch`, `FlowDecision`/`Switch` branches, arguments/variables + defaults, activity tree | REFramework's fixed skeleton (Main → InitAllSettings → GetTransactionData → Process → SetTransactionStatus → End) is the reliable spine |
| FR-03 | Classify each activity's target | System | During parse | Each activity tagged with system + area: web page (selector/URL), DB table (query), API (HTTP Request), Excel (Excel activities), login (credential activities), or `unknown` | Evidence-based; emits a confidence level (see RISK-04) |
| FR-04 | Emit a versioned JSON IR | System | Parse completes | A schema-validated IR graph (nodes: workflows, activities, decisions, systems; edges: invokes, branches, transaction paths) — the parser↔renderer contract | Independently testable — this is M0's deliverable |
| FR-05 | Render IR as a 3D city | Developer | Loads an IR | 3D scene: buildings = systems, districts = workflows, pipes = transaction paths | M1 basic (blocks + lines) → M2 aesthetic |
| FR-06 | Search / filter, render on demand | Developer | Types a query (system / file / variable / use-case) | Only matching subgraph renders; large automations never render everything at once | Core usability requirement, not a nice-to-have (RISK-03) |
| FR-07 | Highlight a path | Developer | Selects a transaction path / requirement / exception | That path lights up end-to-end across buildings/floors | Enables RCA ("where did it break?") |
| FR-08 | Requirement/exception coverage overlay | Reviewer | Loads a Requirements & Exceptions xlsx (+ optional PDD) | Each requirement/exception maps to a traceable path; shows covered vs uncovered = the confidence view | M3; xlsx schema is OQ-05 |

## Non-functional requirements

| Category | Requirement | Threshold | Source / Driver | Notes |
|---|---|---|---|---|
| Performance | Parse the vanilla REFramework → IR | < 2 s | Interactive feel; ~30–50 xaml | Larger real projects: async/streamed parse |
| Performance | 3D interaction frame rate | ~60 fps for a rendered subgraph | Perceived smoothness | Achieved via search-gated render + level-of-detail, not by rendering everything |
| Reliability | Parser determinism | Same input → byte-identical IR | Testability / diffability | Enables golden-fixture tests (M0) |
| Reliability | Graceful degradation | Unknown/custom activities → `unknown` node, never a crash; unparsed count surfaced | RISK-01 | Fail loud (report), not silent (drop) |
| Security | Automation source stays local (v1) | No project bytes leave the machine | v1 is client-side/local analysis | v2 Orchestrator creds via keyring per [LR-03](../constitution/local-rules.md); never literal `.env` |
| Security | Safe archive ingest | Path-traversal-safe unzip, size limits | RISK-06 | `.nupkg`/repo ingest |
| Accessibility | Non-3D fallback + WCAG 2.2 AA chrome | Tree/list view + keyboard nav + search reachable without 3D | 3D is inherently visual; EAA / Section 508 | The map is a lens, not the only way in |
| Accessibility | Motion sensitivity | Honor `prefers-reduced-motion`: disable flythrough/auto-animation, keep transitions instant | Critic flag; product is animation-heavy (M2) | WCAG 2.3.3 |
| Accessibility | No info by color alone | Confidence tags (RISK-04) + path highlighting (FR-07) carry a second channel (icon/label/pattern), not just color | Critic flag; WCAG 1.4.1 | The fallback tree view is the accessible path into the same data — it gets a screen-reader test |
| i18n | UTF-8-safe **ingest** (distinct from UI locale) | Parser/IR/renderer preserve non-ASCII activity names, selectors, arguments end-to-end | Critic flag; automations may target non-English UIs | UI stays English-first; the *data* must be Unicode-clean |
| Scalability | Real-project size | Hundreds of xaml / thousands of activities remain navigable | Nick's real project is the next input | LOD + search-gated rendering |
| Scalability | Numeric budget at real scale | Define an explicit fps / memory / rendered-node-count budget at the "thousands of activities" target (not only the ~30–50-xaml REFramework) before M2 | Critic flag; RISK-03 names this scale | Pin the number against Nick's real project when it arrives |
| Compliance | Regime | none (v1) | No PII; source is the author's own automation | Re-check at v2 (Orchestrator data) |
| Observability | Parse diagnostics + IR provenance | Counts (workflows/activities/edges/unknowns); each IR node carries source file + xaml path | Rule 22 (provenance) | Makes the IR auditable + the classifier's confidence inspectable |

## Out of scope (v1 — recorded so it doesn't reappear)

- **Runtime overlay** — real values, actual-path-taken, live "currently executing" from UiPath execution logs / Orchestrator. → **v2 / M4**.
- **The Excel → automation generator.** Sibling track; the shared IR feeds it later.
- **Editing / round-tripping XAML.** This tool reads and visualizes; it does not modify the automation.
- **Non-REFramework projects** as the first target. REFramework's predictable skeleton is the M0 base; generalization comes after.

## References

- [discovery/quick-scan.md](./quick-scan.md) — the 5-minute scan that preceded this
- [discovery/risk-register.md](./risk-register.md) — failure-modes register
- [discovery/open-questions.md](./open-questions.md) — what we still don't know
- [handoff/2026-07-08-phase1-uipath-3d-visualizer.md](../handoff/2026-07-08-phase1-uipath-3d-visualizer.md) — locked scope + milestones
