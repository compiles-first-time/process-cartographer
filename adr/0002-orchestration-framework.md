# ADR-0002: Orchestration framework — LangGraph.js as v1 default

**Status:** Accepted (Nick, 2026-07-07) — reframed by ADR-0048; see note
**Date:** 2026-05-14
**Author:** Loom template
**Confidence:** [M]

> **Update (2026-07-07 audit):** Reframed by the ADR-0048 north star. Loom is now **runtime-neutral** — it does not mandate a single orchestration framework; orchestration binds via host **adapters**. [ADR-0050](./0050-second-adapter-langgraph.md) made LangGraph one *proven* adapter (alongside the Claude Code host). So LangGraph.js is the **reference/default** orchestration choice a project *may* adopt — **not** a mandate. The "confirm or override at bootstrap" spirit stands.

## Context

The base PRISM document listed three candidates for the agent orchestration framework: Mastra, LangGraph.js, and OpenAI Agents SDK TS. Loom needs a default that ships with the template; projects can override.

Constraints:
- Must support MCP natively or via mature adapter
- Must be multi-provider (Anthropic, OpenAI, Google, local)
- Must be maintained and have an active community
- Must work on a solo developer's machine without vendor lock-in

## Decision

Adopt **LangGraph.js** as the v1 default.

## Consequences

**Locked in (for now):**
- TypeScript-first agent code paths
- LangChain ecosystem dependency footprint
- Use of LangGraph's state-graph abstraction for orchestration

**Locked out (for now):**
- Mastra's tighter MCP-native ergonomics (revisit in 6 months)
- OpenAI Agents SDK's vendor-specific routing optimizations

**Migration path if it fails:** Switch is non-trivial but bounded — agent definitions are small SKILL.md files plus thin adapters; supervisor logic is the largest port surface.

## Alternatives considered

- **Mastra** — promising but immature (beta as of 2025); revisit later
- **OpenAI Agents SDK TS** — vendor-locked; OpenAI-centric routing assumptions conflict with Loom's multi-provider goal
- **Custom orchestration on top of plain MCP** — too much code to maintain at solo scale

## References

- [`../spec/loom-spec-v0.1-full.md`](../spec/loom-spec-v0.1-full.md) §B.5
- [`../layers/L4-tooling.md`](../layers/L4-tooling.md)
- Spec §G.1 — synthesizer flagged this as a judgment call, not strongly evidenced

## Confirmation note

Before first run, confirm this choice still fits. If overriding, supersede this ADR with a new one.
