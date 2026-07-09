# ADR-0054: Path to top-tier — the governance axis + a proof-first program

**Status:** Accepted (Nick, 2026-07-08 — "continue with what you recommend; I like that idea")
**Date:** 2026-07-08
**Author:** Builder (Opus 4.8) — strategic recommendation approved by the architect
**Confidence:** [H] that proof + reliability are the binding constraints on "top-tier"; [M] on the exact phase sequencing (tune with evidence)

## Context

The architect's directive (2026-07-08): Loom must not be "reasonable" or second-place — it must be **best-in-class**. This ADR records the strategy to get there so it survives context resets and governs future work.

**Honest current state** (per LR-05; evidence below): Loom is **world-class design with near-zero proof.** 53 prior ADRs, a coherent constitution + spec + 12-specialist registry — but *no efficacy benchmark* and *no fully-proven end-to-end build*. And a recurring pattern to stare at directly: **every real test project — AnonForum (v0.2/0.3), Ravenwise (2026-05-22) — surfaced the same failure: the agent discipline silently degrades** (agents don't run, hooks go dark, specialists never get invoked). A top tool's core competency cannot be its recurring failure mode.

**Competitive landscape:** the agent-framework field (LangGraph, CrewAI, AutoGen/AG2, OpenAI Agents SDK, Mastra) is strong on *orchestration* and comparatively weak on *governance, safety-by-default, cross-project institutional memory, and model-portable policy*. Loom rides on that orchestration infrastructure (ADR-0048) rather than competing with it. The governance/memory/safety axis is Loom's winnable territory.

## Decision

**1. The winning axis.** Loom commits to being #1 at **governed, auditable, memory-compounding, model-portable AI software development** — not at raw orchestration (delegated to proven infra per ADR-0048). Every roadmap decision is judged against *"does this widen our lead on that axis?"*

**2. Proof-first, not design-first.** The binding constraint on "top" is **proof + reliability**, not more features/ADRs. Until Loom can *measure* its value and *guarantee* its discipline holds, further design is deferred. This inverts the pattern that produced 53 unproven ADRs.

### The program (phased; each phase has hard exit criteria)

**Phase 1 — Prove it works + make the discipline hold** *(foundation; highest leverage)*
- **1a. Efficacy eval harness** — a task suite run governed-vs-ungoverned, measuring safety-incidents-caught, discipline-adherence rate, rework avoided, outcome quality, and token cost. Produces Loom's first *number*.
- **1b. Discipline enforcement** — eliminate silent degradation: ship the deferred SessionStart enforcement (ADR-0034 §D); convert load-bearing soft-checks to hard gates; auto-invoke specialists on classified intent; build the `model-id-current` check (ADR-0045). **Constitution-service review is required** — mandatory discipline narrows operator/agent possibility space (Rules 1/2/8), so enforcement must be consent-based + escapable, per the ADR-0053 guardrail precedent.
- **Exit:** a repeatable eval producing a governed-vs-ungoverned delta **and** a full test run with **zero silent-degradation** (discipline holds without the operator remembering).

**Phase 2 — Prove model-portability + domain reach**
- **2a. Live second-model adapter** (Gemini or Ollama) executing a real governed task; conformance suite green across models. Converts "model-agnostic by construction" → *fact*.
- **2b. EAC domain proof** — the EAC authors a *production-grade* specialist for a new, non-web domain (e.g., `video-pipeline` or `game-engine`), validated by its eval rubric. Proves Loom scales to "any development task."
- **Exit:** the same policy enforced live on ≥2 models; ≥1 EAC-authored non-web specialist passing its eval.

**Phase 3 — Enterprise-harden**
- Real deployment; persistent checkpointer (crash-recovery — the ADR-0052 gap); security review; load + multi-project scale.
- **Exit:** a real deployed governed project surviving crash-recovery + a security review + a load test.

**Phase 4 — Distribution + ergonomics**
- Installable CLI (`npm create loom` / `loom init`); refreshed docs (README predates Option-B); zero-to-governed-project quick-start; optional docs site.
- **Exit:** a new user reaches a governed project in < 15 min.

### The scoreboard (how "top" is measured — not asserted)

A living tracker (`orchestration/roadmap-to-number-one.md`, created at Phase-1 kickoff) carrying, per axis: **target · current-measured · evidence-link.** Honest initial baselines:

| Axis | Metric | Target | Current |
|---|---|---|---|
| Efficacy | governed-vs-ungoverned safety-catch + rework delta | large, measured | **unmeasured** |
| Reliability | discipline-adherence on a full run | 100% (no silent degradation) | **fails** (AnonForum/Ravenwise) |
| Portability | models w/ live conformance-passing adapter | ≥ 2 | ~1 (Claude live; LangGraph reuses the JS evaluator) |
| Domain reach | proven production-grade specialists incl. non-web | growing | 12 web, **0 non-web proven** |
| Hardness | crash-recovery + security review + load test | pass | **none** |
| Adoption | time-to-first-governed-project | < 15 min | manual folder copy |

"Top" is declared only when the scoreboard is green on **efficacy + reliability + portability** — measured, not claimed.

## Evidence basis

> Required v0.4+ per [LR-05](../constitution/local-rules.md#lr-05).

- **Primary:** architect top-tier directive (2026-07-08); the recurring silent-degradation finding across real sessions ([`lessons-learned/2026-05-22-browser-gated-provisioning-friction.md`](../lessons-learned/2026-05-22-browser-gated-provisioning-friction.md)). `[user-report][H]`
- **Corroborating:** [ADR-0048](./0048-north-star-model-agnostic-spec-and-adapters.md) (spec-over-infra — why we don't out-orchestrate); [ADR-0034](./0034-specialist-invocation-discipline.md) / [ADR-0038](./0038-hook-capture-gap-detection.md) (the discipline-reliability gap); [ADR-0053](./0053-agent-reputation-and-dispatch.md) (consent-based-enforcement guardrail precedent); the productivity J-curve working agreement (capability gains require workflow redesign + measurement, not tool adoption alone). `[internal][H]`
- **Competitive reasoning:** major agent frameworks optimize orchestration; governance/memory/safety is comparatively underserved. `[institutional][M]` — strengthen with a formal competitive teardown (a Phase-1 side task).
- **What would change this call:** an efficacy eval showing governance adds little measurable value (→ re-pick the axis); or a competitor shipping equivalent governance + memory + portability (→ re-pick the axis).

## Consequences

**Locks in:** a measured, honest scoreboard as the definition of success; a proof-first discipline (design defers to proof); the governance/memory/safety/portability axis as Loom's identity.

**Locks out:** feature/ADR accretion without proof; "top-tier" as an unmeasured claim; competing on raw orchestration.

**Migration/fallback:** if proof-first proves too slow, the fallback is passive — Loom remains a well-designed governance scaffold and nothing regresses. The scoreboard makes the decision to continue-or-pivot evidence-based.

## Alternatives considered

- **Keep adding design/specialists (design-first).** Rejected — it is the exact pattern that produced 53 unproven ADRs.
- **Compete on orchestration / autonomy.** Rejected — well-funded incumbents; ADR-0048 already delegates orchestration to proven infra.
- **Declare v1.0 "done."** Rejected — "done" without proof *is* second-place.

## Affects / Affected by

**This ADR affects** *(downstream — when this ADR changes, these must be reviewed)*:

- `orchestration/roadmap-to-number-one.md` *(living scoreboard — created at Phase-1 kickoff; absent until then)*
- `observability/eval-suite/` — the efficacy eval harness (Phase 1a)
- `scripts/hooks/session-start.mjs` — SessionStart discipline enforcement (Phase 1b)
- `scripts/lib/doctor.mjs` — hard-gate promotion + `model-id-current` check (Phase 1b)
- `adr/0034-specialist-invocation-discipline.md` — §D enforcement operationalized
- `README.md` — refresh (Phase 4; currently pre-Option-B)

**This ADR is affected by** *(upstream — these constrain this decision)*:

- `adr/0048-north-star-model-agnostic-spec-and-adapters.md` — the axis + spec-over-infra premise
- `constitution/kernel-v6.md` — Rules 1/2/8 (enforcement must stay consent-based), Rule 22 (measurement is transparency)
- `constitution/local-rules.md` — LR-05 (proof supersedes design), LR-06 (cost measured)
- `adr/0053-agent-reputation-and-dispatch.md` — guardrail precedent for mandatory-discipline review

## References

- Architect directive 2026-07-08 (top-tier; proof-first)
- ADR-0048 (north star), ADR-0034 / ADR-0038 (discipline gap), ADR-0053 (guardrail precedent)
- Lessons: AnonForum + Ravenwise silent-degradation post-mortems
