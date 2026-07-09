// Requirements & Exceptions Test-Case Registry — emitter (ADR-0046).
//
// buildTestCaseFields() normalizes a case object to the registry schema (pure,
// testable). emitTestCase() appends it to the event log as a `test_case` event
// so the Observatory Requirements panel populates and regression history
// accrues. Cases are upserted by `id` in the aggregator (latest run wins).

import { appendEvent, mechanicalRecord } from "../hooks/_lib.mjs";

/**
 * Normalize a case object to the registry schema. Pure — no side effects.
 * `why` is accepted as an alias for `justification` (ADR-0022 column rename).
 */
export function buildTestCaseFields(c = {}) {
  return {
    id: c.id || null,
    parent_id: c.parent_id || null,
    type: c.type || "---",
    title: c.title || c.usecase || "",
    framework_location: c.framework_location || null,
    expected_input: c.expected_input ?? null,
    expected_output: c.expected_output ?? null,
    actual_input: c.actual_input ?? null,
    actual_output: c.actual_output ?? null,
    status: c.status || "pending",
    justification: c.justification || c.why || "",
  };
}

/**
 * Emit a `test_case` event to today's event log. Best-effort: never throws
 * (returns false on failure) so a test harness can call it without risk.
 */
export function emitTestCase(c = {}) {
  try {
    appendEvent(mechanicalRecord("test_case", { session_id: c.session_id, ...buildTestCaseFields(c) }));
    return true;
  } catch {
    return false;
  }
}
