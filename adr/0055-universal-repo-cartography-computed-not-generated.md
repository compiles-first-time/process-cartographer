# ADR-0055: Universal repo cartography — computed-not-generated, tier-stamped extraction

**Status:** Accepted
**Date:** 2026-07-18
**Author:** Builder (Opus 4.8) — decision authority delegated by Nick ("you will be able to provide the appropriate answer"), scope + accuracy mandate set by Nick
**Confidence:** [H] — every load-bearing claim below was adversarially verified (12 claims: 10 held, 2 refuted-and-corrected; benchmarks independently reproduced; CORS behavior re-tested live). Research run: 23-agent workflow `wf_5b20a5de-89e`, 2026-07-18.

## Context

Nick's directive: extend process-cartographer beyond UiPath `.nupkg`/XAML to **any codebase or repository** (20–30k LOC typical, larger possible), with accuracy as the overriding requirement — *"no hallucinations or incorrect data/info… accuracy, accuracy, accuracy."* He hypothesized vectorizing the codebase might be the mechanism and delegated the technology decision.

A 7-angle research pass + adversarial verification established the evidence base (§Evidence basis). The decisive findings:

1. **Every production accuracy-critical code-intelligence system computes structure with real parsers/compilers** — GitHub code navigation (tree-sitter, ~23 languages), Sourcegraph (SCIP compiler-accurate indexes + syntactic fallback), Google Kythe, Meta Glean, Semgrep, CodeCharta, aider. None derives nodes or edges from an LLM or embedding similarity. (C9, held)
2. **LLMs are empirically worse than static analysis at structure extraction**: on Python call-graph construction, static PyCG scored 84.9% completeness vs 60.3% for the best of 24 LLMs incl. GPT-4o; ~20% of LLM-emitted package references were hallucinated in a 2025 study. (C8, held)
3. **Embeddings are for ranking, not structure**: even Sourcegraph retreated from embeddings for retrieval; similarity produces suggestions, not facts. (C10, held)
4. **In-browser parsing is trivially fast at target scale** — *independently reproduced*: web-tree-sitter (WASM) parsed expressjs/express (21.6k LOC) in ~97 ms and vuejs/core (157k LOC TS) in ~639 ms (~220–250k lines/s, Node 24 V8 = Chrome's engine). A 30k LOC repo ≈ 0.15 s. Memory (retained trees ~100 MB/157k LOC), not parse speed, is the constraint → parse → extract → `tree.delete()`. (C3, held — reproduced from scratch by the verifier)
5. **The honest accuracy boundary is a gradient inside static analysis** (C6 refuted-and-corrected): precision-by-omission is a **design property of under-approximating extractors**, not of static analysis per se — over-approximating call-graph tools show precision as low as 0.22–0.39. Exact call graphs are undecidable (Rice), and static call graphs miss 40–61% of dynamically executed methods (ISSTA 2024). Therefore: choose under-approximation everywhere, and **exclude call-level edges from v1 entirely**.
6. **Semantic (cross-file) resolution is per-language work with a maintenance cost** — GitHub archived stack-graphs (Sep 2025) after shipping precise navigation for only 2 languages. TS/JS is the mature compiler-grade-in-browser path (the real TypeScript compiler API + `@typescript/vfs`); Roslyn-in-browser exists in production (C4's correction) but is heavyweight; per-language resolvers must be spec-anchored, oracle-gated, and strictly additive.
7. **Ingest path verified live**: `codeload` zipballs are CORS-blocked, but `api.github.com`, `raw.githubusercontent.com`, and `cdn.jsdelivr.net/gh` all send `Access-Control-Allow-Origin: *` (re-curled 2026-07-18) — the existing tree-API + raw-fetch strategy generalizes; a companion CLI is the honest escape hatch beyond browser limits. (C11, held)
8. **The city metaphor itself is user-validated** — Wettel's ICSE 2011 controlled experiment (41 participants): +24% task correctness, −12% completion time. Districts=directories, buildings=files is the validated default granularity. (C12, held)

## Decision

### A. The accuracy contract (constitutional for this product)

1. **Computed, never generated.** Every node and edge in any IR enters only from a real parser, compiler, or spec-documented resolver. No LLM or embedding may write structure — enforced by schema shape (there is no code path for it), not by convention.
2. **Under-approximate by design.** Extraction fails toward *visible omission*, never invention. Anything unresolvable statically (dynamic `import(expr)`, `require(var)`, `importlib`, reflection, `Invoke-Expression`) becomes a **first-class unresolved-dynamic edge** with evidence span — the generalization of the XAML pipeline's existing dynamic-invoke discipline.
3. **Tier-stamped IR.** Every edge carries a mandatory `resolution` enum — `resolved-static | resolved-heuristic | inferred | unresolved-dynamic | external` — plus confidence ∈ [0,1] and a provenance/evidence span. Every file carries `parseStatus`. Tiers render visually distinct; inferred edges are toggle-gated.
4. **Refused outright** (rendered as explicit unknowns or not at all): LLM/embedding-derived structure; guessed targets for dynamic/reflective loads; **call-level edges in v1**; column-level SQL lineage without schema; silent file omission (every skipped/oversize/unparsed file is a visible "not analyzed" building); and any scalar "99.99% accurate" claim — accuracy is published only as the per-fact-class **extraction-honesty scorecard** (parse-clean %, edges per tier, unresolved count, assumptions in force).
5. **Embeddings/LLM confinement:** search-ranking and (future) citation-anchored explanation over already-computed IR nodes only — ranked suggestions, never nodes or edges. Any change to this boundary requires a new ADR (governance-enforced, not conventional).

### B. The architecture (separate RepoIR + shared core; U-ladder delivery)

- **Parallel `RepoIR`** (`src/ir/repoSchema.ts`, zod, versioned, boundary-validated) rather than mutating the tested UiPath `IRGraph` — the 3D renderer already consumes the recursive **Zone** tree, not the IR, so a second Zone builder (`buildRepoCityModel`) plugs in with the scene/layout/search/list/detail layers unchanged. Shared conventions (provenance, confidence, resolution, diagnostics) live in a common module both schemas import, mitigating drift.
- **Tier-0 universal honesty floor:** any repo in any language renders day one — directories=districts, files=buildings (height=LOC under a declared counting rule, color=detected language), with hygiene policy (default excludes, size caps) surfacing every skip.
- **Tier-1 syntax:** web-tree-sitter WASM (runtime + grammars **version-locked from a single source** — mixed-source ABI failure was reproduced during research) in Workers; declarations/literal imports/spans per file; `tree.delete()` immediately.
- **Tier-2 resolved-static per language, oracle-gated:** TS/JS first via the real TypeScript compiler resolver (`@typescript/vfs` + `ts.resolveModuleName`); then Python (spec-implemented import algorithm, validated vs Grimp), Java (static imports + package-directory convention, validated vs JavaParser/jdeps), C# (exact `.sln`/`.csproj` graphs via the existing fast-xml-parser path). A resolver ships only with measured precision/recall against oracle tools on a pinned corpus — the measured number **is** the published confidence.
- **Milestones:** U0 any-repo inventory city → U1 TS/JS syntax tier (symbol interiors) → U2 compiler-resolved TS/JS import pipes → U3 Python+Java → U4 C#/solution graphs → U5 companion CLI (same code native; SCIP import as optional compiler-grade upgrade). Every milestone leaves main shippable; the "load IR JSON" ingest path ships in U0 as the CLI's interop seam.
- **Verification harness** (grows with each milestone): pinned-SHA golden corpus with canonicalized IR projections; differential 2-of-3 oracle voting (scc/cloc for LOC; dependency-cruiser/madge/tsc for TS edges) with disagreement→triage→golden-fixture discipline; metamorphic invariants (byte-identical determinism, edge-endpoint existence, LOC partition sums, subset-induces-subgraph, discovery-order independence).

## Consequences

- The UiPath pipeline and its 35 tests remain untouched; universal mapping is additive.
- "Accuracy" becomes a *measured, published artifact* (the scorecard + per-language oracle numbers), not a marketing scalar — the only honest operationalization of Nick's 99.99% mandate.
- Per-language Tier-2 resolvers are the recurring maintenance cost (stack-graphs' archival is the cautionary precedent); they are strictly additive — the city always renders without them.
- Browser benchmarks are V8-verified; WebKit/Safari numbers are an open item (OQ-10).
- Call graphs, if ever added, enter as a visibly lower tier, default-off, via a new ADR.

## Evidence basis

- Research + adversarial verification run `wf_5b20a5de-89e` (2026-07-18): 7 research angles → 12 load-bearing claims → independent verification (10 held, C4 + C6 refuted with corrections incorporated above). Full agent outputs: workflow journal (session artifacts). `[primary][H]`
- Key primary sources verified by ≥2 independent agents: tree-sitter official docs (guarantees; no semantic analysis); Clem & Thomson, CACM 2022 (GitHub code navigation); github/stack-graphs archival (2025-09-09); Samhi et al., ISSTA 2024 (call-graph soundness: 13 static tools "all miss executed methods"); Venkatesh et al., EMSE 2025 (PyCG 84.9% vs best-LLM 60.3%; ~20% hallucinated package refs); Wettel/Lanza/Robbes, ICSE 2011 (city-metaphor user study); Sourcegraph code-navigation docs (precise vs search-based tiers; embeddings retreat); MSR 2024 (WALA 0-CFA precision 0.22–0.39 — the C6 correction); live CORS curl tests (2026-07-18); first-party reproduced web-tree-sitter benchmarks (express 97 ms / vue-core 639 ms). `[peer-reviewed + vendor][H]`
- What would change this call: a production-grade universal semantic indexer runnable client-side (would collapse Tier 1/2 into one); or evidence that tier-visuals fail user comprehension (would force a redesign of the honesty surface, not of the contract).

## Affects / Affected by

**This ADR affects:**
- `src/ir/repoSchema.ts` (new — RepoIR, the tier-stamped contract)
- `src/ir/sharedCore.ts` (new — shared provenance/resolution/confidence fragments)
- `src/repo/assembleRepoIR.ts` (new — tier-0 assembly), `src/repo/detectLanguage.ts`, `src/repo/hygiene.ts`, `src/repo/loc.ts` (new)
- `src/model/repoCityModel.ts` (new — second Zone builder)
- `src/ingest/types.ts`, `src/ingest/fromGithub.ts`, `src/ingest/fromNupkg.ts`, `src/ingest/fromFolder.ts` (generalized to all-files + auto-detect)
- `src/ui/DiagnosticsBar.tsx` (extraction-honesty scorecard)
- `discovery/requirements.md`, `discovery/risk-register.md`, `discovery/open-questions.md` (scope extension rows)

**This ADR is affected by:**
- `adr/0022-xlsx-docs-convention.md` (risk-register format its rows follow)
- `constitution/local-rules.md` (LR-06 token-cost discipline governed the research run)
- `constitution/kernel-v6.md` (Rule 22 provenance — the contract §A is its application to extraction)

## Notes

Approval basis: Nick delegated the technology decision explicitly (2026-07-18: "I am 100% confident that you will be able to provide the appropriate answer, better than I can make"). The delegation, the research run, and this acceptance are recorded as claim events in `memory/event-log/2026-07-18.jsonl`.
