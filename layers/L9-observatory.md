# L9 — Observatory (Real-Time Dashboard)

> **Canonical source:** ADR-0039.

---

## Purpose

L9 is the human-facing rendering layer for Loom's operational signals. L6 (Observability) defines **what** to measure — hooks, event log, eval harness, drift signals. L9 defines **how** those measurements reach a human in real time via a locally-hosted dashboard.

The observatory consumes — never modifies — data produced by L0–L8. The only write path is the Update Bus accept/reject endpoint, which records a user decision into an existing inbox item (Kernel Rule 19: human approval gate).

## Architecture

Single-process Node.js HTTP server at `localhost:4040`. No external dependencies beyond Node 22+.

**Data flow:**
- `fs.watch` on `memory/event-log/`, `orchestration/`, `update-bus/inbox/`
- In-memory aggregator builds 8 projections from the JSONL event stream
- Server-Sent Events (SSE) push deltas to the browser
- Vanilla HTML/CSS/JS frontend — no build step, no framework

The JSONL event stream the Observatory consumes is the same audit stream targeted for OpenTelemetry OTLP export ([ADR-0051](../adr/0051-opentelemetry-otlp-audit.md)); the Observatory reads it locally while OTLP carries it to external backends.

## Projections

| Projection | Source | Dashboard panel |
|---|---|---|
| Sessions | session_start, session_end, tool_call | Overview, Agents |
| Agents | specialist_spawned/retired, manifest.yaml | Agents |
| Tasks | work-graph.json, task-ledger.md | Tasks |
| Cost | loop_cost_summary events | Cost |
| Failures | tool_result (exit!=0), lessons-learned/ | Failures |
| Deploys | deployment_* events | Deploys |
| Compliance | constitution_check_missing, destructive_op, oauth_preference_hint | Compliance |
| Update Bus | update-bus/inbox/*.md | Update Bus |

## Redaction boundary

All data passes through `observatory/lib/redactor.mjs` before reaching the browser. The redactor wraps `scripts/lib/secret-patterns.mjs` (HIGH-confidence token patterns) and adds email, IP, and user-path scrubbing. No raw event data bypasses this module.

## Panels (10)

Overview, Agents, Tasks, Cost, Failures, Deploys, Compliance, Update Bus, Testing, Systems.

The Testing panel surfaces the requirements & exceptions test-case registry ([ADR-0046](../adr/0046-requirements-exceptions-testcase-registry.md)); pass / fail rollups per requirement come from that register.

## Relationship to other layers

- **Depends on L6** (reads event log, eval results, drift signals)
- **Depends on L5** (reads task-ledger, progress-ledger, work-graph)
- **Depends on L4** (reads MCP config for Systems panel)
- **Depends on L7** (reads Update Bus inbox; writes user decisions)
- **Does not modify** L0–L8 artifacts except Update Bus `user_decision` field

## Open work

- [ ] PR-2: Wire all 8 projections + Overview panel with live data
- [ ] PR-3–7: Remaining panels (Agents, Tasks, Cost, Failures, Deploys, Compliance, Update Bus, Testing, Systems)
- [ ] PR-8: Dark/light theme toggle, responsive layout, per-model cost rates
- [ ] v2: Agent-to-agent message visualization (blocked on A2A/ACP implementation)
- [ ] v2: RAGAS faithfulness scoring display (blocked on eval runner implementation)
