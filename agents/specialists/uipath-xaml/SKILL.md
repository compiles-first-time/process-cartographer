---
name: uipath-xaml
summary: Static parsing of UiPath REFramework `.xaml` workflows — extracts states, transitions, activities, and InvokeWorkflowFile call edges into a schema-validated JSON IR graph for a 3D visualizer. Read-only over source; never executes robots.
tier: project-local
context_budget: 28000
tools: [Read, Glob, Grep, Edit, Write]
verifier_type: schema_check
---

# uipath-xaml specialist

> Project-local specialist (first non-web lane) per [ADR-0054 — proof-first path](../../../adr/0054-path-to-top-tier-proof-first.md). Registry/lifecycle per [ADR-0023](../../../adr/0023-specialist-registry.md) / [ADR-0030](../../../adr/0030-specialist-lifecycle.md). Failure-mode table columns per [ADR-0022](../../../adr/0022-xlsx-docs-convention.md).

## Role + scope

Parses UiPath **REFramework** `.xaml` files **statically** (as XML — the robot is never run) and emits a JSON **IR graph** (nodes + edges) that a downstream 3D visualizer renders. The IR captures the workflow control structure — StateMachine states and transitions, sequence/activity containment, and the `InvokeWorkflowFile` call edges that stitch the modular workflow set (`Main.xaml` → `Framework/*.xaml` → `Process.xaml`) into a project-wide graph.

REFramework's `Main.xaml` is a `StateMachine` with three states plus one final state — **Initialization**, **Get Transaction Data**, **Process Transaction**, **End Process** — wired by seven transitions. `[github.com/UiPath/ReFrameWork][vendor][H]` (confirmed against the vendored fixture `fixtures/reframework/Main.xaml`). The modular spine is `ui:InvokeWorkflowFile`, whose `WorkflowFileName` attribute is a **project-relative path** to the invoked `.xaml`. `[docs.uipath.com/activities][vendor][H]`

Scope boundary: this specialist reads and classifies; it does not repair, refactor, or execute workflows. Emitting `.xaml` is out of scope — the only files it Writes are IR artifacts (`*.ir.json`) and parser fixtures/tests.

When to invoke: prompts mentioning "REFramework", "`.xaml`", "UiPath workflow", "Invoke Workflow File", "state machine graph", "parse workflow into IR", "visualize the process", "Main.xaml", "transition/activity graph".

## Tool scope

- Read / Glob / Grep across the whole repo (workflow trees are deep; Glob `**/*.xaml` to enumerate, Grep to locate `InvokeWorkflowFile`/`WorkflowFileName`/`StateMachine` without loading every file into budget).
- Edit / Write scoped to `**/*.ir.json` (emitted IR), `parser/**`, `schema/**`, and `fixtures/**` test assets. Never Write `.xaml` — source workflows are read-only inputs.
- Never invokes the UiPath CLI, `UiRobot`, or any executor. Structure is derived from the XML tree only.

## Failure modes

| ID | Type | Framework Location | Usecase | Assets / Cred | Input Source | Expected Input | Expected Output | Input Format | Output Format | Next Step | Justifications |
|---|---|---|---|---|---|---|---|---|---|---|---|
| UIXAML-EX-01 | BE | Parse | Element is a custom / third-party / unrecognized activity (not in the known UiPath activity vocabulary) | Activity name map | XML element tag | Element QName + attrs | `uixaml.unknown_activity` node | XAML element | JSON IR node | Emit an `activity` node with `kind:"unknown"`, preserve the raw QName (e.g. `ui:SomeVendorActivity`) and `DisplayName`, set `confidence:"low"`; do NOT drop it | The IR must be lossless on structure even when semantics are unknown — a dropped node silently breaks the visualized graph. Unknown ≠ invalid; the activity vocabulary is open-ended (marketplace packages) |
| UIXAML-EX-02 | BE | Parse | Design-time metadata pollutes the tree (`sap:` / `sap2010:` presentation, `sads:` debugger, `WorkflowViewState`, `HintSize`, `DebugSymbol`) | `mc:Ignorable` list | Root attributes + subtree | Root `mc:Ignorable` + element prefixes | Noise-filtered node set | XAML | JSON IR (filtered) | Read the root `mc:Ignorable` attribute — it enumerates the ignorable prefixes — and drop those subtrees plus the `ViewStateManager` / `DebugSymbol.Symbol` blocks before graphing | `mc:Ignorable` names prefixes a XAML processor "may ignore" without error — i.e. the design-time noise list, supplied by the file itself. `[learn.microsoft.com/wpf/mc-ignorable][vendor][H]` Filtering by it (not a hardcoded prefix list) is version-robust |
| UIXAML-EX-03 | BE | Resolve | `InvokeWorkflowFile` target is a runtime expression, not a literal path — e.g. `WorkflowFileName="[Row(&quot;WorkflowFile&quot;).ToString]"` | — | `WorkflowFileName` attr | Attr string | `uixaml.dynamic_invoke` edge | XAML attr | JSON IR edge | Emit a call edge with `target:null`, `dynamic:true`, `expression:"<verbatim>"`, `confidence:"low"`; do NOT fabricate a resolved target | `WorkflowFileName` accepts string variables/expressions, so the callee is only known at runtime. `[docs.uipath.com/activities/invoke-workflow-file][vendor][H]` Static resolution is impossible; guessing would inject false edges into the visualization |
| UIXAML-EX-04 | BE | Detect | Project mixes / uses C# expression language rather than VB (`.xaml` still, but conditions are C#) | `project.json` | `project.json` + `mva:VisualBasic.Settings` | `expressionLanguage` field | Language-tagged IR | JSON | JSON IR (annotated) | Read `expressionLanguage` from `project.json` (`VisualBasic` \| `CSharp`); tag each captured expression node with `lang`; do NOT attempt to evaluate/normalize the expression text | `expressionLanguage` in `project.json` is the authority (`VisualBasic` or `CSharp`). `[docs.uipath.com/studio/about-the-projectjson-file][vendor][H]` The IR records expressions as opaque strings; language matters only for downstream tooling, so tag, don't interpret |
| UIXAML-EX-05 | BE | Detect | Target "workflow" is a **coded** automation (`.cs`, `CodedWorkflow` class) — not XAML at all | — | Project file list | `.cs` file / `InvokeWorkflow` of `.cs` | `uixaml.not_xaml` decline | `.cs` source | JSON IR stub + decline note | Emit a stub node `kind:"coded", parseable:false` and DECLINE to parse the body; flag it for a future coded-workflow specialist | Coded workflows are C# files inheriting the `CodedWorkflow` partial class — a code-based interface, not XAML serialization. `[docs.uipath.com/studio/coded-workflow][vendor][H]` An XML parser cannot and must not attempt them |

Type legend matches db-migration: **BE** = behavioral/expected (guard fires by design), **SE** = system/tool error.

## Response shape

The IR is the contract; it is validated against `schema/ir.schema.json` before return (this is why `verifier_type: schema_check` — success is a schema-valid emit, not a process exit code, since parsing runs in-process with no external CLI).

### Node shape

```json
{ "id": "State_2", "kind": "state|final-state|sequence|activity|invoke|unknown|coded",
  "displayName": "Initialization", "activityType": "ui:InvokeWorkflowFile",
  "isFinal": false, "expression": null, "lang": "VisualBasic",
  "children": ["..."], "confidence": "high|medium|low", "raw": { "qname": "..." } }
```

### Edge shape

```json
{ "from": "State_3", "to": "State_2", "kind": "transition|invoke|contains",
  "condition": "[SystemError IsNot Nothing]", "displayName": "Error",
  "target": "Framework\\InitAllSettings.xaml", "dynamic": false, "confidence": "high" }
```

### Classification confidence tiers the specialist commits to

- **high** — literal, unambiguous structure: `StateMachine`/`State`/`Transition` topology; `x:Reference` transition targets resolved by `x:Name`; `InvokeWorkflowFile` with a literal `WorkflowFileName`; known UiPath/system activity tags.
- **medium** — recognized shape with a soft edge: annotations used as semantic hints; activity recognized by namespace (`ui:`) but not by specific type.
- **low** — structure preserved, semantics unresolved: unknown/custom activities (UIXAML-EX-01), dynamic invoke targets (UIXAML-EX-03), coded stubs (UIXAML-EX-05). Never silently upgraded.

### Internal contract (what THIS specialist returns)

- IR artifact path(s) emitted (`*.ir.json`), schema-validation result.
- Node + edge counts, and a per-confidence-tier breakdown.
- List of unresolved edges (dynamic invokes) and unknown activities, by ID.
- Failure-mode IDs (UIXAML-EX-*) triggered during the parse.

## Decline triggers

- **Coded (`.cs`) workflow bodies** → decline; emit the `coded` stub (UIXAML-EX-05) and escalate to EAC for a future coded-workflow specialist. This is an XAML parser.
- **Runtime / execution-log analysis** (which path actually ran, timings, queue state) → decline; that is a v2 dynamic-analysis capability, out of scope for a static parser.
- **Non-REFramework projects as the first target** → decline for M0; the parser is proven against the vanilla REFramework fixture first, then generalized. Arbitrary Sequence/Flowchart-only projects come after the state-machine spine is solid.
- **Editing / repairing / generating `.xaml`** → decline; source workflows are read-only inputs.

## Evidence basis

- **Primary (official UiPath, `[vendor][H]`):**
  - REFramework `Main.xaml` topology — [github.com/UiPath/ReFrameWork](https://github.com/UiPath/ReFrameWork/blob/master/Main.xaml) (state machine: 3 states + 1 final + 7 transitions), cross-checked against the vendored `fixtures/reframework/Main.xaml`.
  - Invoke Workflow File `WorkflowFileName` semantics (project-relative path; accepts string variables) — [docs.uipath.com/activities/invoke-workflow-file](https://docs.uipath.com/activities/other/latest/workflow/invoke-workflow-file).
  - `project.json` `expressionLanguage` (`VisualBasic`|`CSharp`), `main`, `targetFramework` — [docs.uipath.com/studio/about-the-projectjson-file](https://docs.uipath.com/studio/standalone/2024.10/user-guide/about-the-projectjson-file).
  - Coded workflows are C# `.cs` (`CodedWorkflow` class), not XAML — [docs.uipath.com/studio/coded-workflow](https://docs.uipath.com/studio/standalone/2024.10/user-guide/coded-workflow).
- **Corroborating:**
  - `mc:Ignorable` = namespace prefixes a XAML processor may ignore without error (design-time compatibility) — [Microsoft Learn, mc:Ignorable Attribute](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/mc-ignorable-attribute). `[vendor][H]`
  - REFramework state-flow narrative (Init → Get Data → Process → End; retry/BRE semantics) — independent editorial guides (SOAIS, HashStudioz) corroborate the four-state model. `[editorial][M]`
- **What would change this call:** a REFramework variant whose `Main` is a Flowchart or Sequence (not StateMachine), or a Studio release that changes the `sap2010`/`sads` serialization or drops `mc:Ignorable` — either would force the parser's topology assumptions and the noise-filter heuristic to be re-derived.

## Runtime counterpart

[`../../../.claude/agents/uipath-xaml.md`](../../../.claude/agents/uipath-xaml.md).
