# ADR-0039: Observatory architecture — real-time dashboard for Loom operations

**Status:** Accepted (Nick, 2026-07-07 — Observatory shipped & operational)
**Date:** 2026-06-04
**Author:** Builder — proposed to Nick
**Confidence:** [M]

## Context

Loom captures rich operational data through hooks (JSONL event log), orchestration ledgers (task-ledger, progress-ledger, work-graph), the specialist registry, and the Update Bus. None of this is visible to the user in real time. Operators must grep JSONL files or read markdown tables to understand system state.

A real-time dashboard closes the observability loop. L6 defines what signals exist; this ADR introduces L9, a rendering layer that surfaces those signals for human consumption.

## Decision

Ship a locally-hosted, zero-external-dependency dashboard as a new layer (L9-Observatory).

### Tech stack

- **Backend:** Node.js `http` module (no Express/Fastify). The route surface is 5–8 endpoints; a framework would add dependency and complexity without proportionate benefit.
- **Real-time transport:** Server-Sent Events (SSE). The data flow is unidirectional (server→browser). The only client→server traffic is Update Bus accept/reject, which uses plain HTTP POST. SSE auto-reconnects natively and works through corporate proxies.
- **Frontend:** Vanilla HTML/CSS/JS served from `observatory/public/`. No React, no build step. CSS custom properties for theming. This keeps the dashboard zero-dep and auditable.
- **State management:** In-memory aggregator with 8 projections, rebuilt on startup by replaying the last 7 days of JSONL (configurable). No SQLite — the JSONL files are already the durable store, and replay takes <100ms for typical event volume.

### Architecture

```
fs.watch(memory/event-log/)  ──┐
fs.watch(orchestration/)     ──┼──> Aggregator (in-memory) ──> SSE /api/events/stream
fs.watch(update-bus/inbox/)  ──┘                            ──> GET /api/state
                                                            ──> POST /api/update-bus/:id/decision
```

1. On startup, replay JSONL files from the last N days to build initial state.
2. `fs.watch` on event-log directory tails new JSONL lines (tracks byte offset per file).
3. Each new event passes through redaction, then dispatches to the relevant projection.
4. Projections emit deltas pushed to connected SSE clients.
5. The browser maintains local state; on `state_init` it replaces everything; on `delta` it patches.

### Redaction boundary

All data passes through `observatory/lib/redactor.mjs` before reaching the browser. The redactor wraps the existing `scripts/lib/secret-patterns.mjs` (HIGH-confidence token detection) and adds defense-in-depth scrubbing for emails, IP addresses, and user-path segments. The aggregator's constructor takes the redactor as a dependency; projections never hold raw strings.

### Layer assignment

L9-Observatory, not an extension of L6. L6 defines what to measure and the eval harness. L9 defines how measurements reach a human. Conflating them would violate single-responsibility.

### Write paths

The observatory writes to exactly two places:
1. **Nothing** in normal operation (pure read-only consumer of L0–L8 artifacts).
2. **Update Bus inbox items** — adding the `user_decision` sub-object when the user clicks Accept/Reject. This is explicitly user-initiated, consistent with Kernel Rule 19.

## Evidence basis

- **Primary:** Empirical — the event log format has been stable since v0.2 (ADR-0011) with additive extensions through v0.3.4 (37 merged PRs). No breaking schema changes.
- **Corroborating:** SSE vs WebSocket comparison — SSE is sufficient for unidirectional push; per MDN Web Docs and RFC 8895, SSE auto-reconnects and has native browser support without polyfills.
- **What would change this call:** If Loom's event volume exceeds ~10K events/day, the in-memory replay approach should be re-evaluated. At current scale (hundreds/day), it is adequate.

## Consequences

**Locks in:**
- L9 as a layer number (available; L0–L8 taken).
- SSE as the real-time transport (could add WebSocket later without removing SSE).
- Vanilla JS frontend (migration to a framework possible but not needed at this scale).

**Locks out:**
- Multi-user access (localhost-only by design; adding auth would require a separate ADR).
- Persistent dashboard state across restarts (acceptable; JSONL replay is fast).

**Migration path:** None required — this is additive. Existing projects gain the observatory by pulling the template update.

## Alternatives considered

1. **Grafana + Prometheus** — powerful but heavy. Requires running Prometheus + Grafana instances locally. Overkill for a single-user dev tool.
2. **Langfuse integration** — L6 lists Langfuse as an integration target. The observatory doesn't replace that intent; it provides a zero-dep fallback that works without Langfuse setup.
3. **TUI dashboard (blessed/ink)** — considered for terminal-native UX. Rejected because SVG-based DAG rendering and complex table layouts are easier in a browser.

## Affects / Affected by

- **Affects:** L6 (observatory renders L6 signals), L7 (observatory surfaces Update Bus inbox), ADR-0040 (projection schemas formalize this ADR's state shape), ADR-0041 (Update Bus integration completes the decision write-path)
- **Affected by:** ADR-0011 (event log schema), ADR-0016 (Update Bus schema), ADR-0027 (permissions categories), ADR-0032 (deploy terminal states)

## References

- [ADR-0011: Claude Code enforcement runtime](./0011-claude-code-enforcement-runtime.md)
- [ADR-0016: Update Bus stub](./0016-update-bus-stub.md)
- [L6-observability.md](../layers/L6-observability.md)
- [L9-observatory.md](../layers/L9-observatory.md)
- [MDN: Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
