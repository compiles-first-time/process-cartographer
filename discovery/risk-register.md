# Risk register

> Per [L8](../layers/L8-discovery.md) / [ADR-0025](../adr/0025-discovery-scaffolding.md). Format per [ADR-0022](../adr/0022-xlsx-docs-convention.md) — register with SE/BE classification + Justifications.
> Updated: 2026-07-08

## Risks

`Type` is **SE** (System Exception: technical/infrastructure failure) or **BE** (Business Exception: business-rule/interpretation failure). Note the pleasing recursion: this visualizer's own failure modes classify exactly like the RPA exceptions it exists to make visible.

| ID | Type | Framework Location | Usecase | Assets / Cred | Input Source | Expected Input | Expected Output | Input Format | Output Format | Next Step | Justifications |
|---|---|---|---|---|---|---|---|---|---|---|---|
| RISK-01 | SE | Parser (FR-02) | Malformed / custom / unfamiliar XAML activity | none | Ingested `.xaml` | Well-formed XAML with known activity types | IR nodes/edges | XML | JSON IR | Schema-tolerant parse; emit an `unknown` node for unrecognized activities; surface an "N activities unparsed" count in diagnostics. **Fail loud, never drop silently.** | Silent drops are the exact failure Phase-1 exists to catch: the map would look complete while omitting real paths, inverting the confidence value prop. |
| RISK-02 | SE | IR boundary (FR-04/FR-05) | Parser and renderer disagree on IR shape | none | In-memory IR | IR matching the versioned schema | Validated IR consumed by renderer | JSON | 3D scene | Version the IR schema; validate at the boundary at runtime (reject/loudly warn on mismatch); a contract test asserts parser output ⊨ schema. | A drifting contract crashes or mis-renders the map. The IR is the whole architecture's seam — it must be enforced, not assumed. |
| RISK-03 | SE | Renderer (FR-06) | Large automation → render everything at once | none | Full IR | Search-gated subgraph | Interactive 3D at ~60fps | JSON IR | WebGL scene | On-demand render gated by search/filter; level-of-detail; a node budget with a visible "showing X of Y" indicator. | A frozen/OOM tab makes the tool unusable on exactly the large automations that most need mapping. |
| RISK-04 | BE | Classifier (FR-03) | Activity mapped to the wrong system/area | none | Activity metadata (selector / URL / connection string / file path) | Correct system + area | Tagged IR node | XAML attrs | IR node tag + confidence | Classify from concrete evidence only; attach a confidence score; render low-confidence tags as visibly uncertain (never hide the uncertainty). | A confidently-wrong building placement produces a plausible but false map — worse than an obviously-incomplete one. |
| RISK-05 | BE | Coverage overlay (FR-08) | Requirement marked "covered" by a path that doesn't actually satisfy it | none | Requirements/exceptions xlsx + IR paths | Requirement ↔ genuinely-covering path | Coverage/confidence view | xlsx + JSON | Overlay | Show the *actual matched path* + the evidence for the match; require human confirmation of each mapping; never assert coverage without a traceable, inspectable path. | The product's core promise is *confidence*. A false "covered" is the most damaging possible defect — it manufactures unwarranted trust. |
| RISK-06 | SE | Ingest (FR-01) | Untrusted `.nupkg` / repo: path traversal, zip bomb, huge files | filesystem | `.nupkg` (zip) / repo URL | A UiPath project archive | Extracted project files | zip / git | files on disk | Path-validate every entry (no `..` escape); enforce size + entry-count limits; extract to a scoped temp dir. | Even self-authored archives can be malformed; a visualizer must not become an extraction exploit vector. |
| RISK-07 | SE | Parser (FR-02) | XXE / external-entity / entity-expansion attack via a crafted XAML from repo-URL ingest (input is not guaranteed self-authored) | none | Ingested `.xaml` | Well-formed XAML | IR nodes/edges | XML | JSON IR | Use a parser with **no DTD / external-entity resolution**. `fast-xml-parser` does not process DTDs or external entities (only standard/numeric char refs) — this is a deliberate mitigation, confirmed not incidental. Reject/skip any file containing a `<!DOCTYPE`/`<!ENTITY` with a warning. | Repo-URL ingest (FR-01) means "self-authored only" is not guaranteed; a validating/entity-resolving XML parser would be an SSRF/file-read vector. (Critic flag, 2026-07-08.) |
| RISK-08 | SE | Renderer (FR-05/FR-08) | XAML-derived strings (activity names, selectors, arguments) rendered into DOM/3D labels contain markup-like content → injection/XSS | none | IR node fields | Parsed strings | Escaped labels | JSON IR | DOM/WebGL text | React escapes by default; never use `dangerouslySetInnerHTML` on IR-derived text; treat selectors/arguments as untrusted display data. | A crafted or third-party-sourced automation could carry markup-like strings; the map must not execute them. (Critic flag, 2026-07-08.) |

## Risk owners

| Risk ID | Owner | Review cadence |
|---|---|---|
| RISK-01 | Nick (builder) | Each parser change |
| RISK-02 | Nick (builder) | Each IR schema change |
| RISK-03 | Nick (builder) | M1 / M2 (render milestones) |
| RISK-04 | Nick (builder) | M2 (classification) |
| RISK-05 | Nick (builder) | M3 (coverage overlay) |
| RISK-06 | Nick (builder) | When repo/nupkg ingest lands |

## Acceptance / Mitigation status

| Risk ID | Status | Decision date | Decision notes |
|---|---|---|---|
| RISK-01 | mitigation-planned | 2026-07-08 | `unknown`-node + diagnostics count is an M0 acceptance criterion |
| RISK-02 | mitigation-planned | 2026-07-08 | Versioned IR + boundary validation + contract test — M0 |
| RISK-03 | mitigation-planned | 2026-07-08 | Search-gated render is a hard FR (FR-06), addressed M1 |
| RISK-04 | mitigation-planned | 2026-07-08 | Confidence-scored classifier — M2 |
| RISK-05 | mitigation-planned | 2026-07-08 | Traceable-path-required overlay — M3 |
| RISK-06 | accepted-deferred | 2026-07-08 | M0 uses a local vendored fixture; harden when ingest lands |
| RISK-07 | mitigation-in-place | 2026-07-08 | M0 parser uses `fast-xml-parser` (no DTD/external-entity resolution). Add DOCTYPE/ENTITY rejection when repo/nupkg ingest lands. Raised by critic. |
| RISK-08 | mitigation-planned | 2026-07-08 | React default escaping; enforced at M1 render + M3 overlay. Raised by critic. |

## References

- [discovery/requirements.md](./requirements.md) — the FRs/NFRs these risks attach to
- [ADR-0022](../adr/0022-xlsx-docs-convention.md) — xlsx convention this register follows
