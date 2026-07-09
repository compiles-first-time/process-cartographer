# ADR-0049: Policy engine — native policy-as-data first, OPA/Rego deferred

**Status:** Accepted
**Date:** 2026-07-06
**Author:** Builder (Opus 4.8) — approved by Nick (autonomy mandate, 2026-07-06)
**Confidence:** [H] for v1; the deferral trigger is explicit

---

## Context

[ADR-0048](./0048-north-star-model-agnostic-spec-and-adapters.md) named **OPA/Rego** as the policy engine for the portable spec. But Loom has a load-bearing **zero-runtime-dependency** ethos ([ADR-0039](./0039-observatory-architecture.md): the Observatory and hooks are pure Node, no npm packages). OPA is an external Go binary (or a Rego→WASM build + `@open-policy-agent/opa-wasm`) — adopting it now adds a dependency, a build step, and operational surface.

The [ADR-0048] decoupling proof already achieved the load-bearing goal **without** a dependency: policy is **data** (`spec/policy/*.mjs`, JSON-serializable) evaluated by a **pure JS function** (`scripts/lib/destructive-guard.mjs`) that any adapter calls, with a `policy` override. That is exactly "policy lives outside the harness; adapters call it" — the point of OPA — minus the dependency.

## Decision

**For v1, Loom's policy engine is native: JSON-serializable policy DATA in `spec/policy/` + thin pure-function evaluators. Defer OPA/Rego.**

To keep a future migration cheap:
1. **Policy is data, not code.** Each policy is a plain, JSON-serializable object (no logic in the policy file). Evaluators are separate, thin, and pure.
2. **Evaluators are per-language and small.** The JS evaluator serves all JS hosts (Claude Code, a Node/LangGraph.js adapter).

### Deferral trigger — adopt OPA/Rego (or a JSON-policy + per-language evaluators) when ANY fires:

- **A non-JS adapter needs to evaluate the SAME policy** (e.g., a Python LangGraph host can't `import` a `.mjs` evaluator). This is the most likely trigger and lands in Phase 2 — at which point a language-neutral engine (OPA/WASM) or a re-implemented evaluator per language becomes necessary. Because policy is already pure data, only the *evaluator* is re-authored, not the policy.
- **Policy complexity outgrows data + simple functions** (rule composition, RBAC hierarchies, external data joins) — OPA's strengths.
- **An auditor/compliance requirement** demands a standard, independently-auditable policy language.

## Evidence basis

> Required v0.4+ per [LR-05](../constitution/local-rules.md#lr-05).

- **Primary:** the working decoupling proof (this branch) — native policy-as-data passes 51 guard tests + 8 conformance scenarios with zero deps. `[internal][H]`
- **Corroborating:** ADR-0039 zero-dep constraint `[internal][H]`; OPA/Rego is CNCF-graduated and remains a sound future target `[institutional][H]`.
- **What would change this call:** any deferral trigger above firing — most likely a non-JS second adapter (Phase 2).

## Consequences

**Locks in:** zero-dep policy for v1; policy expressed as portable data (re-usable by any language); OPA remains a clean, triggered upgrade — not a sunk commitment.

**Locks out:** nothing irreversibly — the policy data survives an engine swap; only evaluators change.

**Migration path:** when the trigger fires, compile the policy data to Rego (or hand a per-language evaluator the same data) and route adapters through it; the conformance suite ([ADR-0048] OB-P1-04) guards behavior parity across the swap.

## Alternatives considered

- **Adopt OPA/Rego now.** Rejected for v1: adds a dependency + build step against the zero-dep ethos, before any non-JS host exists to justify it.
- **Bespoke DSL.** Rejected: reinvents Rego badly; data + pure functions is simpler and sufficient now.

## Affects / Affected by

**This ADR affects:**
- `spec/policy/*` — the canonical policy-as-data home
- `spec/conformance/*` — guards behavior parity across any future engine swap
- `adr/0048` — refines its "OPA/Rego" pick into "native-first, OPA-triggered"

**This ADR is affected by:**
- `adr/0048` (north star), `adr/0039` (zero-dep constraint)
- `constitution/local-rules.md` — LR-05 (best-current-call), LR-06 (avoid unneeded complexity/cost)

## References

- ADR-0048 (north star), ADR-0039 (Observatory zero-dep)
- OPA/Rego (CNCF) — deferred target `[institutional][H]`
