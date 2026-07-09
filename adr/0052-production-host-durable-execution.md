# ADR-0052: Production host — durable, governed execution (LangGraph)

**Status:** Accepted
**Date:** 2026-07-06
**Author:** Builder (Opus 4.8) — approved by Nick (autonomy mandate, 2026-07-06)
**Confidence:** [H] — the durable interrupt/resume path is verified live

---

## Context

[ADR-0048](./0048-north-star-model-agnostic-spec-and-adapters.md) Phase 4 / Option 4: a **production host** with **durable execution** — state that survives a pause/crash, resumable workflows, human-in-the-loop for gated actions. This is the axis that starts to address the "enterprise-hard" caveat (a governed agent workflow that can pause on a risky action, persist, and resume). [ADR-0050](./0050-second-adapter-langgraph.md) already chose LangGraph as a production-relevant host; this ADR uses its durability primitives.

## Decision

**Governed durable execution on LangGraph via a checkpointer + real `interrupt()`/`Command(resume)`.**

- `adapters/langgraph/durable.mjs` — a checkpointer-backed `StateGraph`. When the Loom guard returns **`ask`** for a destructive op, the graph calls the real LangGraph **`interrupt(payload)`**: execution pauses and state is **persisted to the checkpointer**. It resumes via **`Command({ resume })`** carrying the human decision — `approve` → the op executes; `reject` → it's skipped. Same Loom policy (`preToolGuard`) that governs the Claude Code + Python paths.
- **Checkpointer:** `MemorySaver` for the demo/tests — it is in-process, so it proves pause/resume **within a run** but **not** crash-recovery (a process crash destroys it). A persistent saver (Sqlite/Postgres) is the drop-in that adds cross-restart crash-recovery — **not yet tested here**.
- **Temporal** (cross-service durable workflows, retries, timers) remains the **heavier option, deferred** — it needs a Temporal server, so it's an adopt-on-trigger for multi-service production, not the template default.

## Evidence basis

> Required v0.4+ per [LR-05](../constitution/local-rules.md#lr-05).

- **Primary:** verified **live** against the installed `@langchain/langgraph` — `runDurableDemo()` interrupts on the destructive op (state persisted; confirmed via `getState().tasks[].interrupts` + `state.next=["guard"]`), then resumes: `approve` → EXECUTED, `reject` → skipped. `[artifact][H]`
- **Corroborating:** LangGraph checkpointer + interrupt/HIL docs (2026-07) `[institutional][H]`; ADR-0050 (LangGraph host), ADR-0047 (the guard/policy).
- **What would change this call:** a need for cross-service durability/timers/signals beyond a single graph → adopt Temporal (the deferred trigger).

## Consequences

**Locks in:** governed workflows are durable + resumable + HIL — a risky action pauses (persisted), a human decides, execution resumes. The production-host adapter reuses the same policy as every other adapter.

**Locks out:** nothing — MemorySaver→persistent-saver is a config swap; Temporal remains available on trigger.

**Honest limitation:** this proves the *durability + HIL mechanism*. True enterprise-hardness (load, multi-tenant, security, real-model scale, a persistent saver under failure injection) still requires a real deployment + testing — not claimed here.

## Alternatives considered

- **Temporal now.** Rejected for the template: needs a server; heavier than a single-graph checkpointer for the demonstrated need.
- **No durability (stateless).** Rejected: a stateless agent can't pause-on-risk-and-resume — not production-grade.

## Affects / Affected by

**Affects:** `adapters/langgraph/durable.mjs`, `adapters/langgraph/durable.run.mjs`, `adapters/langgraph/durable.test.mjs`, `adapters/langgraph/README.md`, `layers/L5-orchestration.md` (durable execution), roadmap `OB-P4-*`.
**Affected by:** `adr/0050` (LangGraph host), `adr/0047` (guard/policy), `adr/0048` (Phase 4), `constitution/kernel-v6.md` Rule 20 (destructive ops require confirmation — now durably enforced with HIL).

## References

- LangGraph checkpointer + `interrupt()`/`Command` HIL docs (2026-07) `[institutional][H]`
- ADR-0050 (LangGraph adapter), ADR-0048 (north star)
