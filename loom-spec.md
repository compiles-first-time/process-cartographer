# LOOM — The Reusable AI-Augmented Development Ecosystem

**Document type:** Phase 1 synthesis output (single canonical specification)
**Document status:** Draft v0.1 — synthesized 2026-05-12 from project files; v0.2 amendments tracked in Part J of [`spec/loom-spec-v0.1-full.md`](./spec/loom-spec-v0.1-full.md) (template ships v0.2.0)
**Successor to:** PRISM-Architecture-Spec-For-LLM-Review (which Loom now subsumes as project-agnostic substrate)
**Companion to:** Trajectory Kernel V6 (constitutional substrate)
**Author:** Synthesizer (Claude Opus 4.7) on behalf of Nick
**Target consumer:** Claude Code, then the human reader, then future LLM instances bootstrapping into the project

---

## Reading guide (for ADD-friendly navigation)

This document is long on purpose. You do not need to read it linearly. Use this map.

| If you want to… | Read |
|---|---|
| Understand what Loom is in 2 minutes | §A.1 Executive Summary |
| See how the synthesis was performed and what was cut | §A.2 Methodology + §F Cut List |
| Build something with Loom right now | §B.1 (skeleton) + §C (bootstrap protocol) |
| Understand the governance | §B.2 (Constitutional Substrate) + companion Kernel V6 doc |
| Find every claim's source | Inline `[provenance][confidence]` tags + §I Bibliography |
| Push back on what I decided | §G Disputed Claims + §H Open Questions |

Every non-trivial claim carries two inline tags:

- **Provenance tag** (where it came from): `[base]`, `[LLM-A]`, `[LLM-B]`, `[kernel]`, `[transcript]`, `[consult-gov]`, `[consult-plat]`, `[primer]`, `[synth]`, or combinations
- **Confidence tag** (how much to trust it): `[H]` (primary source verified), `[M]` (corroborated, details inferred), `[L]` (training-knowledge only), `[S]` (speculative reasoning), `[V]` (vendor marketing — discount)

---

# Part A — Executive Summary & Methodology

## §A.1 — Executive Summary

### What Loom is, in one paragraph

**Loom is a reusable AI-augmented development ecosystem.** It is the *workshop* in which agentic software projects (such as Prism) are designed, scaffolded, governed, and continuously refined. It is not itself a product; it is the substrate on top of which many products can be built. Think of it as the difference between *a house* (a specific software product) and *a general contractor's truck full of tools, blueprints, and standard operating procedures* (Loom). Each new project gets a fresh "warp" of Loom threaded into it via a `loom init` bootstrap step that completes in minutes, the same way `python -m venv .venv` produces an isolated Python environment in seconds.

### The three properties that define Loom

| Property | What it means concretely | Where it's specified |
|---|---|---|
| **Best-of-breed substrate** | Every layer pulls the strongest available pattern from the research base, not the most familiar one | §B (all layers) |
| **Bootstrap-fast** | `loom init <project-name>` produces a complete, governed, agent-ready project scaffold in under 5 minutes on a developer laptop | §C Bootstrap Protocol |
| **Living** | New patterns, models, MCP servers, and lessons-learned can be folded back into Loom and propagate to existing projects via a semi-automatic update mechanism with human approval gates | §B.7 + §D Update Mechanism |

> **Note:** This is the canonical Loom v0.1 spec as authored 2026-05-12. The full text is preserved verbatim in [`spec/loom-spec-v0.1-full.md`](./spec/loom-spec-v0.1-full.md). This top-level file contains the executive summary and pointers; for the complete synthesis (Parts A–I + Appendices) consult the full file.

---

## Quick navigation

| Layer | Spec file | Purpose |
|---|---|---|
| L0 — Constitutional substrate | [layers/L0-constitutional.md](./layers/L0-constitutional.md) | Kernel v6 governance |
| L1 — Project skeleton | [layers/L1-skeleton.md](./layers/L1-skeleton.md) | Spec-as-codebase |
| L2 — Agent topology | [layers/L2-agents.md](./layers/L2-agents.md) | 6 base agents + dynamic specialists |
| L3 — Memory architecture | [layers/L3-memory.md](./layers/L3-memory.md) | 5 memory subsystems |
| L4 — Tooling layer | [layers/L4-tooling.md](./layers/L4-tooling.md) | MCP + A2A/ACP/UCP roadmap |
| L5 — Orchestration | [layers/L5-orchestration.md](./layers/L5-orchestration.md) | Supervisor + ledgers |
| L6 — Observability & evaluation | [layers/L6-observability.md](./layers/L6-observability.md) | Langfuse, OTel, evals |
| L7 — Self-extension & Update Bus | [layers/L7-extension.md](./layers/L7-extension.md) | Living-software mechanism |
| L8 — Discovery | [layers/L8-discovery.md](./layers/L8-discovery.md) | Quick scan + full discovery flow |
| L9 — Observatory | [layers/L9-observatory.md](./layers/L9-observatory.md) | Real-time operations dashboard |

---

*The complete v0.1 synthesis (~1,000 lines with Parts A–I, Bibliography, Glossary, and Appendices) lives at [`spec/loom-spec-v0.1-full.md`](./spec/loom-spec-v0.1-full.md). It is the source of record for this scaffold.*

*Synthesizer: Claude Opus 4.7 · Document date: 2026-05-12*
