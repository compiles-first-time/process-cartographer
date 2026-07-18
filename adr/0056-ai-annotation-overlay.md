# ADR-0056: AI annotation overlay — interpretation, never structure

**Status:** Accepted
**Date:** 2026-07-18
**Author:** Builder (Fable 5) — feature requested by Nick ("annotations on the nodes… what type of business, why the directory/file is structured a certain way, how this file is doing it"); decision authority delegated
**Confidence:** [H] — implements the exact confinement ADR-0055 §A.5 reserved; guardrails follow the evidence from the 0055 research (LLMs hallucinate ~20% of dependency refs → they may explain, never assert structure).

## Context

Nick wants per-building annotations: **what** a file/directory is (business purpose), **why** it's structured the way it is, and **how** it does its work. These are interpretive questions — exactly what the computed pipeline cannot and should not answer, and exactly what an LLM is good at *when grounded in real source*. ADR-0055 §A.5 pre-authorized this lane ("search-ranking and citation-anchored explanation over already-computed IR nodes… never nodes or edges") and required a new ADR to define the surface.

## Decision

Ship an **AI interpretation** section in the building detail panel (`src/annotate/annotate.ts`, rendered by `DetailPanel`), under these governance-enforced boundaries:

1. **Interpretation, never structure.** The annotation result is display-only. It cannot write to any IR, draw an edge, place a building, or alter search/coverage. There is no code path from annotation output into the map.
2. **Grounded input only.** The model receives the file's *actual source* (line-numbered, truncated at a declared cap) plus *parser-computed* facts (declarations, resolved imports, importers). Districts get the computed file inventory + any README. The prompt requires line-anchored claims `(L42)`, hedged "why" phrasing (inferred intent), and explicitly permits "not determinable from the provided source".
3. **Visibly distinct rendering.** The section is labeled "Generated, not computed", styled apart (dashed warning border), and states the model used. It must never be stylable to look like the computed sections.
4. **Key hygiene (LR-03 spirit):** the Anthropic API key is held in React state only — never persisted, never logged, never proxied; calls go browser→`api.anthropic.com` directly (CORS-enabled by Anthropic for direct browser access).
5. **On-demand and per-zone.** Annotations run only on explicit user click, are cached per zone in memory for the session, and are discarded on re-ingest.
6. **Model** pinned in code to a current id from `spec/policy/model-ids.json` (`claude-sonnet-5`); the doctor `model-id-current` discipline applies when it changes.

## Consequences

- The "what/why/how" need is met without contaminating the accuracy contract: a user can always tell computed fact (solid sections, tiers, confidence) from AI reading (dashed, labeled).
- Cost is user-controlled (their key, their clicks). No backend appears.
- Future upgrades (citation-API quote extraction, symbol-table-validated linkification) tighten grounding further; loosening any boundary above requires a new ADR.

## Amendment (2026-07-18-b) — opt-in key persistence

User feedback (Nick): the operator "will already be hooked up to an LLM on the backend so it really should just be a button." Until a backend exists, the friction-reducer is OPT-IN persistence: a "Remember key on this device" checkbox stores the key in localStorage; default remains memory-only; unchecking removes it immediately. This amends boundary #4 (was: "never persisted") to "never persisted WITHOUT explicit opt-in". A configurable backend proxy (organization-supplied LLM endpoint) remains the intended end state and would restore the stricter default.

## Evidence basis

- ADR-0055 evidence base: Venkatesh et al., EMSE 2025 (~20% hallucinated package refs — why the overlay may not assert structure); Sourcegraph's precise-vs-search tier labeling precedent (visibly distinct fidelity classes). `[peer-reviewed + vendor][H]`
- Anthropic CORS direct-browser-access header — vendor-documented API capability. `[vendor][H]`
- What would change this call: evidence users conflate the AI section with computed facts despite the styling (would force stronger separation, e.g. a modal or opt-in reveal).

## Affects / Affected by

**This ADR affects:**
- `src/annotate/annotate.ts` (the engine + guardrail prompt)
- `src/ui/DetailPanel.tsx` (the labeled, distinct section)
- `src/App.tsx` (memory-only key state; per-zone cache)

**This ADR is affected by:**
- `adr/0055-universal-repo-cartography-computed-not-generated.md` (§A.5 confinement this implements)
- `constitution/local-rules.md` (LR-03 credential hygiene applied to the user's API key)
