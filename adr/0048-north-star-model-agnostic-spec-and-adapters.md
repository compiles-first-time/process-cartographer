# ADR-0048: North star — Loom as a model-agnostic governance spec + adapters

**Status:** Accepted (Nick, 2026-07-06)
**Date:** 2026-07-06
**Author:** Builder (Opus 4.8) — approved by Nick
**Confidence:** [H] on the architecture choice; [M] on specific component picks (revisit per adapter)

---

## Context

Loom began as an opinionated **Claude Code** template: its enforcement runs on Claude Code hooks, its agents are Claude subagents, its skills are Claude slash-commands, and — as demonstrated this session — its BR_01 guard emits Claude Code's exact `permissionDecision` format. A strategic review (2026-07-06) asked how much of that duplicates primitives Anthropic now ships natively (subagents, permissions, orchestration via the Workflow tool, memory, routing). The finding: **the overlap is "waste" only if Loom stays coupled to Claude Code.**

The architect's decision reframes the whole project: **Loom must be model-agnostic (Claude, Gemini, open-source) and enterprise-production-grade.** That inverts the primitive analysis — Loom *cannot* lean on Claude Code primitives, because they do not exist on Gemini, Ollama, or a LangGraph loop. The question became *how* to achieve agnosticism. Two options were weighed in depth:

- **A — Loom owns the runtime** (its own model-agnostic agent loop + sandbox + UX). Rejected: unsustainable for a small team, reinvents a field of funded/OSS harnesses (Claude Code, goose, OpenHands, Cursor), and a generic loop is *worse per-model* than each vendor's co-designed harness.
- **B — Loom as a portable spec + adapters** over proven vendor-neutral infrastructure. **Chosen.**

Three shaping decisions (architect, 2026-07-06): **(1)** govern *both* dev-time and production, **dev-time first**; **(2)** enforcement is **hard where the host exposes seams, advisory + logged elsewhere** (no bespoke Loom runtime yet); **(3)** **solo-operated, enterprise-shaped** — build enterprise-grade *patterns*, defer multi-tenancy/RBAC/compliance until a second operator exists.

## Decision

**Loom is a runtime-neutral specification + a set of host adapters + a conformance suite. Loom does not own the agent loop.**

### 1. Architecture

- **Spec (Loom owns, portable):** policy (constitution, permissions, BR tiers), schemas (requirements/exceptions per ADR-0046, event schema), and conventions (memory tiers, RAG, eval). Runtime-neutral formats — policy-as-code + JSON Schema/YAML.
- **Adapters (per host):** bind the spec to a host's extension seams. Claude Code adapter first (≈ what PR #52 already is); a production-host adapter second.
- **Conformance suite:** tests that assert an adapter enforces the spec. **"Model-agnostic" is not claimed until a second adapter passes it.**

### 2. The primitive-vs-opinion line (per layer)

| Concern | Portable spec (Loom owns) | Adapter binds to (host seam) | Adopted component |
|---|---|---|---|
| L0 Constitution / policy | rule semantics → policy-as-code | host enforcement point | **OPA / Rego** |
| Permissions (LR-04) + BR_01 | categories, tiers, `decision` | Claude Code hooks · LangGraph interrupts | **OPA / Rego** |
| L2 Agents | SKILL.md contracts, roster, HR/EAC lifecycle | host subagent mechanism | host-native |
| L3 Memory | tiers + RAG conventions + schema | host memory / vector store | pluggable store |
| L4 Tooling | tool + permission conventions | host MCP client | **MCP** |
| L5 Orchestration | task/flow spec, LR-06 cost discipline | host orchestrator | **LangGraph / Temporal** |
| L6 Observability + eval | event schema, requirements registry (0046), eval conventions | host emits spans/events | **OpenTelemetry**; promptfoo |
| L9 Observatory | projection/view spec | reads the OTel/event stream | OTel-backed |
| Inference / routing | model-tier policy (ADR-0045) | host model calls | **LiteLLM** (✓ already adopted) |

### 3. First-adopted components (Phase 1)

**LiteLLM** (inference — already in place, ADR-0045) · **OPA/Rego** (policy: the constitution + LR-04 + BR_01 tiers become evaluable policy any adapter calls) · **OpenTelemetry** (audit/observability; the event log emits OTel, the Observatory becomes an OTel view) · **Claude Code** (first dev-time adapter). Production host (**LangGraph** and/or **Temporal**) is confirmed in a Phase-2 ADR.

### 4. Enforcement model

Hard where the host exposes a seam (Claude Code PreToolUse, LangGraph interrupts); **advisory + fully logged** on bare models (raw Gemini/Ollama). No bespoke "reference runtime" is built in v1. This is an explicit, honest limitation — enforcement strength varies by host, and the conformance suite records which guarantees each adapter provides.

### 5. PR #52 reclassification

Not reverted. Its **policy** (destructive tiers, the BR_01 register, the ADR-0046 schema) *is* the portable spec; its **mechanism** (`permissionDecision` emission + hook wiring) *is* the Claude Code adapter. A follow-up ADR migrates the bespoke JS classifier to Rego so the *policy* is host-neutral while the *hook* stays the adapter.

### 6. Scope guardrails

Build now: policy-as-code, audit trail, resilience/recovery patterns, state persistence. **Defer** (until a second operator/customer): multi-tenancy, RBAC, SSO, SOC2-style compliance tooling. Enterprise-grade *craft*, solo-operator *scope*.

### 7. Two standing gates (every future change + research item)

1. **"Does the host already provide this primitive?"** — if yes, adapt to it; don't reimplement.
2. **"Spec or adapter?"** — new capability goes in the portable spec unless it is irreducibly host-specific, in which case it goes in an adapter and is called out as non-portable.

## Evidence basis

- **Primary:** the 2026-07-06 strategic analysis + the concrete coupling demonstrated this session (Claude Code's classifier blocked a push before Loom's did; BR_01's mechanism is Claude-Code-shaped). `[internal][H]`
- **Corroborating:** the "commoditize your complement" platform-risk principle `[institutional][M]`; enterprise adoption of the chosen vendor-neutral components — OPA and OpenTelemetry (CNCF graduated), LiteLLM, LangGraph, Temporal `[institutional][H]`; the productivity J-curve (workflow-redesign > tooling; ADR/CLAUDE.md) supporting "the method is the durable asset, not the code" `[H]`.
- **Synthesizer reasoning:** a spec-over-proven-infra layer is the only shape that is both solo-sustainable and genuinely portable; owning the loop (A) trades portability for per-model mediocrity and unbounded maintenance. `[synth][M]`
- **What would change this call:** a single agent platform becoming a de-facto universal standard (agnosticism moot → revisit coupling); or adapter-maintenance cost exceeding portability value (revisit toward A or a narrower host set).

## Consequences

**Locks in:** portability as a first-class constraint; **adopt-over-build** for runtime primitives; the spec (policy + schemas + conventions) as Loom's durable, differentiated asset.

**Locks out:** Claude-Code-only features that cannot be expressed portably; bespoke reimplementation of adopted primitives; the "own runtime" ambition (A) unless this ADR is superseded.

**Migration:** existing Claude-Code-coupled code is *recontextualized as the Claude Code adapter*, not deleted. Concrete migrations (constitution→Rego, event-log→OTel, Observatory→OTel view, production-host adapter) are tracked as follow-up ADRs 0049+.

**Honest limitations:** enforcement is uneven across hosts (§4); "model-agnostic" is aspirational until adapter #2 passes conformance; this is a multi-phase effort, not a single PR.

**Self-modification note:** this materially changes Loom's identity, so per Kernel **Rule 19** it is executed through a transparent, auditable, consent-based ADR — which this is. Foundational rules 1–8 are untouched.

## Alternatives considered

- **A — own runtime.** Rejected (solo-unsustainable; per-model mediocrity; reinvents Claude Code / goose / OpenHands).
- **C — stay Claude-Code-coupled.** Rejected by the architect (agnosticism is required).
- **Hybrid B + thin-A reference runtime** (minimal loop for bare models). Deferred, not rejected — gated on the §4 enforcement bar; revisit if advisory-on-bare-models proves insufficient.

## Affects / Affected by

**This ADR affects** *(downstream — reviewed in follow-up ADRs 0049+)*:

- `CLAUDE.md` — project identity shifts from "Claude Code template" to "spec + adapters"
- `layers/L0-constitutional.md`, `constitution/` — constitution expressed as policy-as-code (Rego)
- `layers/L5-orchestration.md`, `adr/0002-*` — LangGraph reframed as a *production-host adapter*, not the default engine
- `layers/L6-observability.md`, `adr/0039-0041` — Observatory/event-log → OpenTelemetry
- `adr/0011-*` (enforcement runtime), `adr/0027-*` / LR-04 (permissions) — become the Claude Code adapter + Rego policy
- `adr/0046-0047` + PR #52 — reclassified: spec (portable) + Claude Code adapter
- repo structure — a future `spec/` vs `adapters/` separation

**This ADR is affected by** *(upstream)*:

- `constitution/kernel-v6.md` — Rule 19 (self-modification via transparent ADR), Rule 8
- `constitution/local-rules.md` — LR-05 (best-current-call), LR-06 (cost discipline)
- `adr/0045-*` — LiteLLM, validated here as the inference component

## References

- 2026-07-06 strategic analysis (this session) — primary
- OPA/Rego, OpenTelemetry (CNCF), LiteLLM, LangGraph, Temporal — adopted/candidate components `[institutional][H]`
- goose / OpenHands / Aider — surveyed as Option-A build-on candidates (not chosen) `[H]`
- Brynjolfsson et al., AEJ:Macro 2021 — productivity J-curve (method > tooling) `[H]`
