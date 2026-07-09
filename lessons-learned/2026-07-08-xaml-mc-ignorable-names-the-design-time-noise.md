---
date: 2026-07-08
agent: eac
severity: medium
share: true
---

# The `.xaml` file tells you which of its own namespaces are noise — read `mc:Ignorable`, don't hardcode

## What happened

While grounding the `uipath-xaml` specialist against the vendored REFramework fixture (`fixtures/reframework/Main.xaml`), the naive plan for the M0 parser was to strip design-time cruft by a **hardcoded prefix blocklist** — `sap`, `sap2010`, `sads` — because those namespaces carry no control-flow structure, only editor layout and debugger data:

- `sap` / `sap2010` (`.../xaml/activities/presentation`) → `WorkflowViewState.ViewStateManager` blocks: canvas coordinates, `HintSize`, connector point collections. In `Main.xaml` this is **~330 of 723 lines** — nearly half the file — and pure visual layout.
- `sads` (`.../xaml/activities/debugger`) → `DebugSymbol.Symbol`, a single base64 blob encoding the author's local file path and source-map offsets.
- `sap2010:Annotation.AnnotationText` → human annotations (semantically *useful* as hints, but same namespace family).

A hardcoded blocklist works on this file — but it is brittle across Studio versions, which have historically renamed/re-versioned these presentation namespaces (`2009` → `2010` families already coexist).

## Why it happened / the non-obvious insight

The root element hands you the answer:

```xml
<Activity mc:Ignorable="sap sap2010 sads" x:Class="Main" ...>
```

`mc:Ignorable` is the WPF/XAML **markup-compatibility** attribute: it names the namespace prefixes a XAML processor "may ignore" without raising an error if it cannot resolve them. `[learn.microsoft.com/wpf/mc-ignorable][vendor][H]` That is *exactly* the design-time-noise list — authored into every file, by the tool that wrote it. So the correct filter is: **parse `mc:Ignorable`, drop those prefixes' subtrees/attributes**, rather than maintaining a blocklist that drifts out of date.

Two related traps the same fixture exposes:

1. **Annotations are in an ignorable namespace but are semantically valuable.** `sap2010:Annotation.AnnotationText` on states/transitions is genuine documentation ("Read configuration file and initialize applications used in the process"). A blanket "drop everything ignorable" loses free semantic labels. The parser should special-case annotations as `medium`-confidence hints *before* discarding the rest of the ignorable content.
2. **`mc:Ignorable` ≠ "safe to skip the element entirely."** Per the spec, `mc:ProcessContent` can force a processor to still read children of an ignored element. For a static IR extractor this is minor, but a strict implementation should honor it rather than blind-pruning whole subtrees.

## What we did

Encoded UIXAML-EX-02 in the specialist SKILL: read the root `mc:Ignorable` list, drop those subtrees + `ViewStateManager`/`DebugSymbol.Symbol`, but lift `Annotation.AnnotationText` as a hint first. Filter is data-driven off the file, not a constant.

## What we'd do differently

1. **Never hardcode a namespace blocklist for XAML** when `mc:Ignorable` declares it per-file. Version-robust by construction.
2. **Distinguish "layout noise" from "authoring metadata" inside the ignorable set** — annotations survive; view-state and debug symbols don't.
3. **Candidate parser assertion:** if `mc:Ignorable` is *absent* on a file that still contains `sap2010:` elements, flag it — the file may be hand-edited or from an unexpected serializer, and the noise heuristic can't be trusted.

## Related

- `agents/specialists/uipath-xaml/SKILL.md` (UIXAML-EX-02), `.claude/agents/uipath-xaml.md`
- `fixtures/reframework/Main.xaml`, `fixtures/reframework/Framework/InitAllSettings.xaml`
- [ADR-0054 — proof-first path to top tier](../adr/0054-path-to-top-tier-proof-first.md) (this specialist is the first non-web lane)
- Microsoft Learn: [mc:Ignorable Attribute](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/mc-ignorable-attribute)
