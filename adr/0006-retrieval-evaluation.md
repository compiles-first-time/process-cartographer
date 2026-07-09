# ADR-0006: Retrieval evaluation + faithfulness-drift as the primary drift signal

**Status:** Accepted
**Date:** 2026-05-18
**Author:** Architect handoff (Phase 1 research) — approved by Nick
**Confidence:** [H]

## Context

`layers/L6-observability.md` and `observability/eval-suite/README.md` defined smoke / capability / drift / adversarial evals — but **none** tested retrieval quality, and the drift eval relied on "confidence drift" (declining average self-reported confidence) as its primary signal.

Phase 1 research:

- Long context worsens model calibration, and **self-reported confidence is an unreliable signal** for drift (Kadavath et al.). Treating declining average confidence as the canary is fragile.
- Retrieval systems have established evaluation metrics: **faithfulness/groundedness**, **retrieval recall**, **retrieval precision**. The RAGAS framework (Es et al., EACL 2024) and ARES (Saad-Falcon et al., NAACL 2024) operationalize them. `[research-p1][H]`

The eval-suite's own **anti-collapse rule** (per [`layers/L7-extension.md`](../layers/L7-extension.md)) permits this change: new evals are *added alongside*, never replacing existing ones.

## Decision

1. Add a fifth eval category, **Retrieval**, to the eval suite. It tests faithfulness/groundedness, retrieval recall, and retrieval precision. Runs nightly. Lives in `observability/eval-suite/retrieval/`.
2. Shift the primary drift signal from "confidence drift" (declining average self-reported confidence) to **`faithfulness drift` measured against a fixed golden set**. Self-reported confidence is retained as a weak secondary signal.

The change is additive (retrieval is a new category; faithfulness drift is a new signal layered alongside confidence drift). No existing eval is removed.

## Consequences

**Locks in:**
- Every Loom project ships a Retrieval eval directory with at least one golden-set faithfulness check.
- Drift dashboards primarily watch faithfulness against the golden set; confidence drift is kept as a noisy secondary.

**Locks out:**
- Drift detection that relied solely on the unreliable self-confidence signal.

**Migration path if it fails:** the additive structure means rolling back means turning off the new eval and the new dashboard row; existing evals are untouched.

## Alternatives considered

- **Replace confidence drift entirely** — rejected: violates the L7 anti-collapse rule (new evals add alongside; do not replace).
- **Add retrieval evals but keep confidence drift as primary** — rejected: research shows confidence is unreliable; the change would be cosmetic.
- **Use only LLM-as-judge for faithfulness** — partially adopted (it is the practical way to score faithfulness automatically), but a fixed golden set anchors it, since LLM-judges themselves drift.

## References

- [`../layers/L6-observability.md`](../layers/L6-observability.md) — dashboard signal + eval table
- [`../observability/eval-suite/README.md`](../observability/eval-suite/README.md) — Retrieval category
- [`../spec/loom-spec-v0.1-full.md`](../spec/loom-spec-v0.1-full.md) §B.7
- ADR-0003 (retrieval pipeline) — what is being evaluated
- [ADR-0037](./0037-retrieval-pipeline-evidence-review.md) — the later retrieval-pipeline evidence review builds on this eval framework (this ADR is affected by ADR-0037)
- `[research-p1][H]` Phase 1 retrieval & context-engineering research synthesis
