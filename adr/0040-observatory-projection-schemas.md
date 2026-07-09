# ADR-0040: Observatory projection schemas

**Status:** Accepted (Nick, 2026-07-07 — Observatory shipped & operational)
**Date:** 2026-06-04
**Author:** Builder — proposed to Nick
**Confidence:** [M]

## Context

ADR-0039 shipped the L9 Observatory with an in-memory aggregator that maintains 8 projections, rebuilt on startup by replaying JSONL event logs. The projection shapes are implicit in `observatory/lib/aggregator.mjs` — correct for a first implementation, but any consumer beyond the bundled dashboard (CLI exporters, external monitoring bridges, test assertions on observatory state) needs a stable contract.

This ADR formalizes the 8 projection schemas so they can be versioned, validated, and referenced by downstream ADRs (notably ADR-0041 for Update Bus integration).

## Decision

Define the canonical shape of each projection as returned by `GET /api/state` and the `state_init` SSE event. The aggregator's `getState()` method returns an object conforming to these schemas after redaction.

### Projection schemas

**1. `sessions`** — Active and historical Claude Code sessions.

```json
{
  "active": [{
    "session_id": "string",
    "started_at": "ISO-8601",
    "source": "string",
    "tool_calls": "number",
    "last_tool": "string | null",
    "last_activity": "ISO-8601 | null",
    "last_suggestions": "string[] | null"
  }],
  "history": [{
    "session_id": "string",
    "started_at": "ISO-8601 | null",
    "ended_at": "ISO-8601",
    "tool_calls": "number",
    "errors": "number"
  }]
}
```

**Populated by:** `session_start`, `session_end`, `tool_call`, `subagent_suggestion` event handlers.

**2. `agents`** — Base agent roster and specialist lifecycle.

```json
{
  "active": [],
  "specialists": {
    "spawned": [{
      "name": "string",
      "work_item": "string | null",
      "spawned_at": "ISO-8601"
    }],
    "available": [],
    "retired": [{
      "name": "string",
      "retired_at": "ISO-8601",
      "archived_path": "string"
    }]
  }
}
```

**Populated by:** `specialist_spawned`, `specialist_retired` event handlers. `active` and `available` are reserved for future population from `manifest.yaml` reading (see ADR-0039 "What's left").

**3. `tasks`** — Work-graph items and orchestration ledger.

```json
{
  "work_items": [{
    "id": "string (WI-FR-NN | WI-NFR-slug)",
    "title": "string",
    "status": "pending | dispatched | in_progress | completed | reviewed | blocked | cancelled",
    "assigned_specialists": "string[]",
    "risks": "string[]"
  }],
  "ledger": [{
    "task_id": "string",
    "agent_assigned": "string | null",
    "status": "string",
    "dependencies": "string[]"
  }],
  "progress": []
}
```

**Populated by:** Future `work-graph.json` file-watch integration. Currently empty until HR work-graph generates artifacts.

**4. `cost`** — Token spend tracking per session and cumulative.

```json
{
  "by_session": {
    "<session_id>": {
      "input_tokens": "number",
      "output_tokens": "number",
      "loops": [{
        "loop_id": "string",
        "pattern": "string (crag | self-rag | fan-out | custom)",
        "iterations": "number",
        "agents": "number",
        "input_tokens": "number",
        "output_tokens": "number",
        "wall_clock_ms": "number",
        "exit_reason": "string"
      }]
    }
  },
  "cumulative": {
    "input_tokens": "number",
    "output_tokens": "number",
    "estimated_usd": "number"
  }
}
```

**Populated by:** `loop_cost_summary` event handler. USD estimation uses rates from `observatory/config.yaml`.

**5. `failures`** — Errors, error signatures, and lessons-learned drafts.

```json
{
  "errors": [{
    "timestamp": "ISO-8601",
    "session_id": "string",
    "tool": "string",
    "exit_code": "number",
    "error_signature": "string | null",
    "error_preview": "string | null"
  }],
  "error_signatures": {
    "<signature>": "number (count)"
  },
  "lessons_drafts": [{
    "timestamp": "ISO-8601",
    "session_id": "string",
    "suggested": "number",
    "skipped": "number"
  }]
}
```

**Populated by:** `tool_result` (non-zero exit code), `lessons_autosuggest` event handlers.

**6. `deploys`** — Deployment history and active deploy tracking.

```json
{
  "history": [{
    "session_id": "string",
    "completed_at": "ISO-8601",
    "platform": "string | null",
    "exit_code": "number | null",
    "duration_ms": "number | null",
    "url": "string | null",
    "health": "string | null",
    "state": "succeeded | failed | non_progressing",
    "reason": "string | null",
    "message": "string | null"
  }],
  "active": {
    "session_id": "string",
    "started_at": "ISO-8601",
    "platform": "string | null",
    "command": "string | null"
  } | null
}
```

**Populated by:** `deployment_started`, `deployment_completed`, `deployment_non_progressing` event handlers. Terminal state detection per ADR-0032.

**7. `compliance`** — Constitution checks, destructive operation audit trail, and redaction metrics.

```json
{
  "constitution_checks": [{
    "timestamp": "ISO-8601",
    "session_id": "string",
    "tool": "string",
    "category": "string",
    "message": "string"
  }],
  "redaction_hits": "number",
  "destructive_ops": [{
    "timestamp": "ISO-8601",
    "session_id": "string",
    "tool": "string",
    "pattern": "string",
    "exit_code": "number | null"
  }]
}
```

**Populated by:** `constitution_check_missing`, `destructive_op`, `oauth_preference_hint` event handlers.

**8. `update_bus`** — Pending proposals from the Update Bus inbox.

```json
{
  "inbox": [{
    "id": "string (kebab-case + hash)",
    "source": "research-feed | project-lesson | internal-audit",
    "proposed_by": "string",
    "date": "ISO-8601",
    "affects": "string[]",
    "risk": "low | medium | high",
    "collapse_risk": "boolean",
    "critic_review": {
      "verdict": "approve | reject | escalate",
      "reason": "string",
      "reviewed_at": "ISO-8601"
    } | null,
    "human_replica_recommendation": {
      "verdict": "approve | reject | defer",
      "reasoning": "string",
      "confidence": "number (0-1)",
      "reviewed_at": "ISO-8601"
    } | null,
    "user_decision": {
      "verdict": "approve | reject | defer",
      "decided_at": "ISO-8601",
      "decided_by": "string",
      "note": "string"
    } | null
  }]
}
```

**Populated by:** File-watch on `update-bus/inbox/` directory. Schema per `update-bus/schema.json` (ADR-0016).

### Versioning

Projection schemas follow additive-only evolution. New fields may be added; existing fields are never removed or have their type changed. Breaking changes require a new ADR that supersedes this one. The `state_init` SSE event always sends the complete current-version shape.

### SSE event contract

- `state_init` — Full state conforming to the union of all 8 projections. Sent once on SSE connect.
- `delta` — `{ event_type: string, payload: object }`. The payload is the redacted event record; the client uses `event_type` to decide which projection to re-render.
- `file_changed` — `{ path: string }`. Signals that an orchestration or Update Bus file changed on disk.

## Evidence basis

- **Primary:** Empirical — the 8 projections are implemented and verified in ADR-0039's test plan. Schemas extracted from `observatory/lib/aggregator.mjs` lines 6–15 (state shape) and lines 44–209 (event handlers). `[base][H]`
- **Corroborating:** The `update_bus` projection schema aligns with `update-bus/schema.json` (ADR-0016). `[base][H]`
- **What would change this call:** If a new event type is added that doesn't fit any existing projection (e.g., a `discovery_scan` event), a new projection or an amendment to this ADR would be needed.

## Consequences

**Locks in:**
- The 8-projection decomposition as the canonical state shape for the observatory API.
- Additive-only schema evolution policy.

**Locks out:**
- Nothing — projections can be extended and new projections can be added by future ADRs.

**Migration path:** No migration needed — this formalizes what's already shipped.

## Alternatives considered

1. **JSON Schema files per projection** — Considered placing `.json` schema files alongside `update-bus/schema.json`. Rejected because the projections are internal to the observatory (not a public API); markdown in the ADR is sufficient and easier to maintain alongside the code.
2. **Single flat state object** — No projection decomposition. Rejected because it would make the SSE delta routing opaque and panel rendering harder to reason about.

## Affects / Affected by

**This ADR affects:**
- `observatory/lib/aggregator.mjs` — the authoritative implementation of these schemas
- `observatory/public/js/app.mjs` — panels consume these projections
- `observatory/lib/router.mjs` — `/api/state` returns the union of all projections
- ADR-0041 — Update Bus integration references the `update_bus` projection

**This ADR is affected by:**
- ADR-0039 — Observatory architecture (parent ADR)
- ADR-0011 — Event log schema (defines the event types that populate projections)
- ADR-0016 — Update Bus schema (defines inbox item shape for the `update_bus` projection)
- ADR-0032 — Deploy terminal states (defines deploy state machine for the `deploys` projection)

## References

- [ADR-0039: Observatory architecture](./0039-observatory-architecture.md)
- [ADR-0016: Update Bus stub](./0016-update-bus-stub.md)
- [ADR-0011: Claude Code enforcement runtime](./0011-claude-code-enforcement-runtime.md)
- [observatory/lib/aggregator.mjs](../observatory/lib/aggregator.mjs)
- [update-bus/schema.json](../update-bus/schema.json)
