#!/usr/bin/env node
// Unit tests for scripts/lib/ticket.mjs (buildTicketFields normalization) +
// a roadmap seed: emit the Option-B roadmap tasks as `ticket` events so the
// Observatory Kanban panel + time-in-state populate on every `node scripts/test.mjs`.

import { buildTicketFields, KANBAN_STATES, emitTicket } from "./ticket.mjs";

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`  ✓  ${label}`); }
  else { failed++; console.error(`  ✗  ${label}`); }
}

console.log("\nbuildTicketFields");
{
  const f = buildTicketFields({});
  assert(f.state === "backlog", "state defaults to backlog");
  assert(f.id === null && f.parent_id === null, "id/parent_id default null");
  assert(f.title === "" && f.note === "", "title/note default empty");

  const g = buildTicketFields({ id: "OB-P2-03", title: "2nd adapter conformance", state: "backlog", parent_id: "BR_01", assignee: "builder" });
  assert(g.id === "OB-P2-03" && g.title === "2nd adapter conformance", "id/title passthrough");
  assert(g.parent_id === "BR_01", "parent_id (requirement link) passthrough");
  assert(g.assignee === "builder", "assignee passthrough");
}

console.log("\nKANBAN_STATES");
{
  assert(Array.isArray(KANBAN_STATES) && KANBAN_STATES.includes("in_progress") && KANBAN_STATES.includes("done"),
    "canonical states include in_progress + done");
  assert(KANBAN_STATES[0] === "backlog", "backlog is the first column");
}

// ─── Roadmap seed (populates the Observatory Kanban) ────────────────────────
// Mirrors orchestration/roadmap-option-b.md. Upserted by id in the aggregator.
console.log("\nroadmap seed → ticket events");
{
  const seed = [
    { id: "OB-P0-01", title: "ADR-0048 north star", state: "done" },
    { id: "OB-P0-02", title: "Roadmap / checklist", state: "done" },
    { id: "OB-P0-03", title: "spec/ + adapters/ structure", state: "done" },
    { id: "OB-P0-04", title: "Decoupling proof: policy → spec/policy", state: "done", parent_id: "BR_01" },
    { id: "OB-P0-05", title: "Kanban foundation", state: "in_progress", parent_id: "BR_01" },
    { id: "OB-P1-02", title: "Constitution + LR-04 + BR_01 → policy-as-data", state: "in_progress" },
    { id: "OB-P1-03", title: "Evaluate OPA/Rego vs native evaluator", state: "todo" },
    { id: "OB-P1-04", title: "Conformance suite skeleton", state: "todo" },
    { id: "OB-P2-01", title: "Pick 2nd host (LangGraph / Gemini)", state: "backlog" },
    { id: "OB-P2-03", title: "2nd adapter passes conformance (agnosticism proof)", state: "backlog" },
    { id: "OB-P3-01", title: "Event log → OpenTelemetry", state: "backlog" },
    { id: "OB-P4-01", title: "Production host adapter (LangGraph/Temporal)", state: "backlog" },
  ];
  let emitted = 0;
  for (const t of seed) { if (emitTicket(t)) emitted++; }
  assert(emitted === seed.length, `emitted all ${seed.length} roadmap tickets`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
