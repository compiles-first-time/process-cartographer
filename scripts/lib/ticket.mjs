// Kanban action-item (ticket) emitter (ADR-0048 roadmap OB-X-01).
//
// A ticket is a unit of work moving across kanban states. It links to the
// requirement it serves via `parent_id` (a BR from the ADR-0046 registry), so a
// board card can surface that requirement's exceptions (BE/SE). The aggregator
// computes time-in-state from the sequence of ticket events (upserted by id).
//
// buildTicketFields() is pure/testable; emitTicket() appends a `ticket` event.

import { appendEvent, mechanicalRecord } from "../hooks/_lib.mjs";

// Canonical ordered kanban states (columns). Adapters/projects may extend, but
// the Observatory panel renders these in order and buckets unknown states last.
export const KANBAN_STATES = ["backlog", "todo", "in_progress", "blocked", "review", "done"];

export function buildTicketFields(t = {}) {
  return {
    id: t.id || null,
    title: t.title || "",
    state: t.state || "backlog",
    parent_id: t.parent_id || null, // the requirement (BR) this ticket serves
    assignee: t.assignee || null,   // agent name or human
    note: t.note || "",
  };
}

export function emitTicket(t = {}) {
  try {
    appendEvent(mechanicalRecord("ticket", { session_id: t.session_id, ...buildTicketFields(t) }));
    return true;
  } catch {
    return false;
  }
}
