# ADR-0050: Second adapter — LangGraph (the agnosticism proof)

**Status:** Accepted
**Date:** 2026-07-06
**Author:** Builder (Opus 4.8) — approved by Nick (2026-07-06)
**Confidence:** [H] on host choice; [M] on how much it proves (scoped below)

---

## Context

[ADR-0048](./0048-north-star-model-agnostic-spec-and-adapters.md) `OB-P2-01`: pick the second host whose adapter must pass the conformance suite ([`spec/conformance/`](../spec/conformance/)) — the milestone that turns "model-agnostic" from claim into fact. Candidates: **LangGraph** (rich seams, production-relevant, JS) vs **raw Gemini API** (bare model, tests the advisory path, needs credentials).

## Decision

**LangGraph (JS) is the second adapter.**

- **Rich enforcement seams → HARD enforcement.** LangGraph's `interrupt()` (human-in-the-loop) + conditional edges let the adapter map Loom's tiers faithfully: **ask → `interrupt()`** (pause for approval), **deny → route away from the ToolNode** (block), **allow/none → proceed**. This matches the Claude Code adapter's guarantee level, so the comparison is apples-to-apples.
- **JS → reuses the spec evaluator** (ADR-0049: one JS evaluator serves all JS hosts) — no OPA dependency yet, and the adapter's real work is the *host-specific enforcement mapping*, not re-deciding policy.
- **Model-agnostic by construction.** LangGraph binds any model (Gemini, OpenAI, Ollama, via LangChain integrations or LiteLLM). Loom's guard operates at the *tool-call seam*, independent of which model produced the call — so governing a LangGraph graph governs it regardless of model. That is the model-agnosticism Nick wants, demonstrated.
- **Efficient**: LangGraph is also the Phase-4 production-host candidate (durable orchestration), so this adapter does double duty.

Raw Gemini-API-direct is deferred: it's the *bare-model / advisory* complement and the trigger to actually adopt OPA (a non-JS or seam-less host) — a later step, and it needs a credential (LR-03).

## What this proves — and what it does NOT

**Proves (when the adapter passes conformance, `OB-P2-03`):**
- **Host-agnosticism** — the *same* spec + policy governs two architecturally different hosts (Claude Code hooks vs a LangGraph graph) with *different* enforcement mechanisms.
- **Model-agnostic governance** — the guard is model-independent by construction.

**Does NOT prove (explicitly out of scope here):**
- **Cross-language portability** — both adapters are JS reusing the same evaluator. A Python host can't `import` it; that's the separate ADR-0049 trigger for OPA and a future proof.
- **Live production hardness** — the conformance milestone is about *policy-decision parity across hosts*, verifiable without a live model. A live graph run (real deps + a fake model) is an additional, dependency-gated verification, not the milestone itself.

## Evidence basis

- **Primary:** LangGraph HIL/interrupt primitives (LangChain docs + LangGraph.js guide, 2026-07) — `interrupt()` + `interruptBefore: ["tools"]` + `Command({resume})`. `[institutional][H]`
- **Corroborating:** ADR-0048 (conformance milestone), ADR-0049 (JS-evaluator reuse). `[internal][H]`
- **What would change this call:** if LangGraph's seams turned out insufficient for hard enforcement (they aren't — HIL is a first-class feature), or if the primary target shifted to a non-JS host (then Gemini/OPA leads instead).

## Consequences

**Locks in:** a second, conformant adapter → the first real evidence for the agnosticism thesis; LangGraph as both proof-host (Phase 2) and production-host candidate (Phase 4).

**Locks out:** nothing — cross-language/OPA remains a clean future step.

## Affects / Affected by

**Affects:** `adapters/langgraph/*` (new adapter); `spec/conformance/*` (now exercised by two adapters); roadmap `OB-P2-*`; `adapters/README.md`.
**Affected by:** `adr/0048` (north star + conformance), `adr/0049` (JS-evaluator reuse), `constitution/local-rules.md` LR-03 (why Gemini-direct is deferred: credentials).

## References

- LangChain interrupts docs · LangGraph.js human-in-the-loop guide (2026-07) `[institutional][H]`
- ADR-0048, ADR-0049
