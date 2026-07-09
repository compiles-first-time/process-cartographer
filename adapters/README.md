# `adapters/` — host bindings for the Loom spec

Per [ADR-0048](../adr/0048-north-star-model-agnostic-spec-and-adapters.md). An **adapter** binds the runtime-neutral [`spec/`](../spec/) to one host's extension seams. Loom does **not** own the agent loop — the host does; the adapter governs it from the side.

## The adapter contract (what makes an adapter "Loom-compliant")

Every adapter must:

1. **Evaluate spec policy at the host's pre-action seam** and enforce the strongest decision the host supports:
   - hosts with real seams (Claude Code hooks, LangGraph interrupts) → **hard** `deny` / `ask` / `allow`;
   - bare models with no seam (raw Gemini/Ollama) → **advisory + logged** (honest degradation, per ADR-0048 §4).
2. **Emit audit events** conforming to the spec's event schema (later: OpenTelemetry, roadmap `OB-P3-01`).
3. **Declare its guarantees** — which enforcement is hard vs advisory on this host — so the conformance report is honest.
4. **Pass the conformance suite** (roadmap `OB-P1-04`). Passing is the *definition* of an adapter; "model-agnostic" is only claimed once a **second** adapter passes (`OB-P2-03`).

## Adapters

| Adapter | Host | Enforcement | Status |
|---|---|---|---|
| [`claude-code/`](./claude-code/) | Claude Code | Hard (PreToolUse hooks) | ◐ first adapter (≈ PR #52) |
| _langgraph/_ | LangGraph app | Hard (interrupts) | ☐ Phase 2 candidate ([ADR-0050](../adr/0050-second-adapter-langgraph.md)) |
| _gemini/_ | Raw Gemini API | Advisory + logged | ☐ Phase 2 candidate (proves the bare-model path) |

## Rule

An adapter may import host SDKs and know host formats. It may **not** contain policy or business rules — those live in `spec/`. If you're writing an `if` about *what is allowed*, it belongs in the spec; if you're writing *how this host is told*, it belongs here.
