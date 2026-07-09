#!/usr/bin/env node
// Unit tests for observatory/lib/aggregator.mjs.
// Covers all 18 EVENT_HANDLERS, recordActivity(), ingestUpdateBusItem(),
// updateUpdateBusDecision(), cost math, and cap enforcement.

import { Aggregator } from "./aggregator.mjs";

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓  ${label}`);
  } else {
    failed++;
    console.error(`  ✗  ${label}`);
  }
}

// Build a minimal valid event record.
function ev(event_type, extra = {}) {
  return {
    timestamp: "2026-07-02T12:00:00.000Z",
    session_id: "test-session",
    event_type,
    kernel_version: "v6",
    loom_version: "0.2.0",
    ...extra,
  };
}

// ─── 1. session_start ────────────────────────────────────────────────────────
console.log("\nsession_start");
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("session_start", { source: "claude-code" }));
  assert(agg.state.sessions.active.length === 1,         "adds session to active");
  assert(agg.state.sessions.active[0].session_id === "test-session", "session_id correct");
  assert(agg.state.sessions.active[0].source === "claude-code",      "source preserved");
  assert(agg.state.sessions.history.length === 0,        "history stays empty until end");
}

// ─── 2. session_end ──────────────────────────────────────────────────────────
console.log("\nsession_end");
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("session_start"));
  agg.ingestEvent(ev("session_end", { tool_calls: 7, errors: 2 }));
  assert(agg.state.sessions.active.length === 0,         "removes from active");
  assert(agg.state.sessions.history.length === 1,        "adds to history");
  assert(agg.state.sessions.history[0].tool_calls === 7, "tool_calls in history");
  assert(agg.state.sessions.history[0].errors === 2,     "errors in history");
}

// ─── 3. tool_call ────────────────────────────────────────────────────────────
console.log("\ntool_call");
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("session_start"));
  agg.ingestEvent(ev("tool_call", { tool: "Read" }));
  agg.ingestEvent(ev("tool_call", { tool: "Edit" }));
  const s = agg.state.sessions.active[0];
  assert(s.tool_calls === 2,     "tool_calls incremented");
  assert(s.last_tool === "Edit", "last_tool updated to most recent");
}

// tool_call without a matching active session must not crash
{
  const agg = new Aggregator();
  let threw = false;
  try { agg.ingestEvent(ev("tool_call", { tool: "Bash" })); } catch { threw = true; }
  assert(!threw, "no active session — does not throw");
}

// ─── 4. tool_result ──────────────────────────────────────────────────────────
console.log("\ntool_result");
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("tool_result", { tool: "Bash", exit_code: 1, error_signature: "sig-abc", error_preview: "cmd not found" }));
  assert(agg.state.failures.errors.length === 1,              "non-zero exit tracked in failures");
  assert(agg.state.failures.error_signatures["sig-abc"] === 1, "error signature counted");
}
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("tool_result", { tool: "Read", exit_code: 0 }));
  assert(agg.state.failures.errors.length === 0, "zero exit does not add to failures");
}
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("tool_result", { tool: "Read", exit_code: null }));
  assert(agg.state.failures.errors.length === 0, "null exit_code does not add to failures");
}

// ─── 5. destructive_op ───────────────────────────────────────────────────────
console.log("\ndestructive_op");
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("destructive_op", { tool: "Bash", destructive_pattern: "rm -rf", label: "rm -rf" }));
  assert(agg.state.compliance.destructive_ops.length === 1, "destructive_op recorded");
  assert(agg.state.compliance.destructive_ops[0].pattern === "rm -rf", "pattern preserved");
}

// ─── 6. constitution_check_missing ───────────────────────────────────────────
console.log("\nconstitution_check_missing");
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("constitution_check_missing", { category: "payments", message: "no prior claim" }));
  assert(agg.state.compliance.constitution_checks.length === 1, "check recorded");
  assert(agg.state.compliance.constitution_checks[0].category === "payments", "category preserved");
}

// ─── 7–9. deployment lifecycle ───────────────────────────────────────────────
console.log("\ndeployment lifecycle");
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("deployment_started", { platform: "vercel" }));
  assert(agg.state.deploys.active !== null,               "deployment_started sets active");
  assert(agg.state.deploys.active.platform === "vercel",  "platform on active deploy");

  agg.ingestEvent(ev("deployment_completed", { platform: "vercel", exit_code: 0 }));
  assert(agg.state.deploys.active === null,               "deployment_completed clears active");
  assert(agg.state.deploys.history.length === 1,          "completed deploy in history");
  assert(agg.state.deploys.history[0].state === "succeeded", "state=succeeded on exit_code 0");
}
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("deployment_started", { platform: "fly" }));
  agg.ingestEvent(ev("deployment_non_progressing", { reason: "stall" }));
  assert(agg.state.deploys.active === null,                        "non_progressing clears active");
  assert(agg.state.deploys.history[0].state === "non_progressing", "non_progressing in history");
}
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("deployment_completed", { platform: "render", exit_code: 1 }));
  assert(agg.state.deploys.history[0].state === "failed", "exit_code 1 → state=failed");
}

// ─── 10–11. specialist lifecycle ─────────────────────────────────────────────
console.log("\nspecialist lifecycle");
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("specialist_spawned", { specialist_name: "auth" }));
  assert(agg.state.agents.specialists.spawned.length === 1, "specialist_spawned recorded");

  agg.ingestEvent(ev("specialist_retired", { specialist_name: "auth", archived_path: "archive/auth.md" }));
  assert(agg.state.agents.specialists.spawned.length === 0, "retired specialist removed from spawned");
  assert(agg.state.agents.specialists.retired.length === 1, "retired specialist in retired list");
  assert(agg.state.agents.specialists.retired[0].archived_path === "archive/auth.md", "archive path preserved");
}

// ─── 12. loop_cost_summary — ACCUMULATE semantics ────────────────────────────
console.log("\nloop_cost_summary");
{
  const agg = new Aggregator({ costRates: { "claude-sonnet-4": { input: 3.0, output: 15.0 } } });
  agg.ingestEvent(ev("loop_cost_summary", { estimated_input_tokens: 500, estimated_output_tokens: 200, model: "claude-sonnet-4" }));
  agg.ingestEvent(ev("loop_cost_summary", { estimated_input_tokens: 300, estimated_output_tokens: 100, model: "claude-sonnet-4" }));
  const s = agg.state.cost.by_session["test-session"];
  assert(s.input_tokens === 800,  "accumulates input_tokens across loops");
  assert(s.output_tokens === 300, "accumulates output_tokens across loops");
  assert(s.loops.length === 2,    "both loop records stored");
  assert(agg.state.cost.cumulative.input_tokens === 800, "cumulative updated after loop");
}

// ─── 13. session_token_usage — SET semantics ─────────────────────────────────
console.log("\nsession_token_usage");
{
  const agg = new Aggregator({ costRates: { "claude-sonnet-4": { input: 3.0, output: 15.0 } } });
  agg.ingestEvent(ev("session_token_usage", { input_tokens: 1000, output_tokens: 500, model: "claude-sonnet-4" }));
  const s1 = agg.state.cost.by_session["test-session"];
  assert(s1.input_tokens === 1000, "initial input_tokens set");
  assert(s1.estimated_usd > 0,     "USD cost calculated");

  // Re-emit with higher count — should REPLACE, not accumulate
  agg.ingestEvent(ev("session_token_usage", { input_tokens: 2000, output_tokens: 1000, model: "claude-sonnet-4" }));
  const s2 = agg.state.cost.by_session["test-session"];
  assert(s2.input_tokens === 2000,  "SET semantics: input_tokens replaced");
  assert(s2.output_tokens === 1000, "SET semantics: output_tokens replaced");
}

// multi-session cumulative
{
  const agg = new Aggregator({ costRates: { "claude-sonnet-4": { input: 3.0, output: 15.0 } } });
  agg.ingestEvent(ev("session_token_usage", { session_id: "s1", input_tokens: 1000, output_tokens: 500, model: "claude-sonnet-4" }));
  agg.ingestEvent(ev("session_token_usage", { session_id: "s2", input_tokens: 2000, output_tokens: 1000, model: "claude-sonnet-4" }));
  assert(agg.state.cost.cumulative.input_tokens === 3000,  "cumulative sums across sessions");
  assert(agg.state.cost.cumulative.output_tokens === 1500, "cumulative output sums");
}

// ─── 14–15. test_result and test_run_summary ─────────────────────────────────
console.log("\ntesting");
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("test_result", { suite: "foo.test.mjs", status: "pass", asserts_passed: 3, asserts_failed: 0, duration_ms: 50 }));
  agg.ingestEvent(ev("test_result", { suite: "bar.test.mjs", status: "fail", asserts_passed: 1, asserts_failed: 2, duration_ms: 30 }));
  assert(agg.state.testing.results.length === 2, "test_result records stored");

  agg.ingestEvent(ev("test_run_summary", { total: 6, passed: 4, failed: 2, files: 2, duration_ms: 80 }));
  assert(agg.state.testing.last_run !== null,       "last_run set after summary");
  assert(agg.state.testing.last_run.passed === 4,   "passed count in summary");
  assert(agg.state.testing.last_run.failed === 2,   "failed count in summary");
  assert(agg.state.testing.runs.length === 1,        "run recorded");
}

// test_result cap (500)
{
  const agg = new Aggregator();
  for (let i = 0; i < 510; i++) {
    agg.ingestEvent(ev("test_result", { suite: `t${i}.mjs`, status: "pass" }));
  }
  assert(agg.state.testing.results.length === 500, "test_result list capped at 500");
}

// test_run_summary cap (25)
{
  const agg = new Aggregator();
  for (let i = 0; i < 30; i++) {
    agg.ingestEvent(ev("test_run_summary", { total: 1, passed: 1, failed: 0 }));
  }
  assert(agg.state.testing.runs.length === 25, "test run list capped at 25");
}

// ─── 16. subagent_suggestion ─────────────────────────────────────────────────
console.log("\nsubagent_suggestion");
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("session_start"));
  agg.ingestEvent(ev("subagent_suggestion", { suggestions: [{ intent: "deploy", suggest: ["deploy"] }] }));
  assert(agg.state.sessions.active[0].last_suggestions?.length === 1, "suggestions stored on active session");
}

// ─── 17. oauth_preference_hint ───────────────────────────────────────────────
console.log("\noauth_preference_hint");
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("oauth_preference_hint"));
  agg.ingestEvent(ev("oauth_preference_hint"));
  assert(agg.state.compliance.redaction_hits === 2, "redaction_hits incremented per hint");
}

// ─── 18. lessons_autosuggest ─────────────────────────────────────────────────
console.log("\nlessons_autosuggest");
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("lessons_autosuggest", { suggested: 2, skipped: 1 }));
  assert(agg.state.failures.lessons_drafts.length === 1,  "draft record created");
  assert(agg.state.failures.lessons_drafts[0].suggested === 2, "suggested count preserved");
}

// ─── ingestUpdateBusItem ─────────────────────────────────────────────────────
console.log("\ningestUpdateBusItem");
{
  const agg = new Aggregator();
  agg.ingestUpdateBusItem({ id: "item-1", risk: "low", source: "internal-audit" });
  assert(agg.state.update_bus.inbox.length === 1, "item added to inbox");

  agg.ingestUpdateBusItem({ id: "item-1", risk: "high", source: "internal-audit" });
  assert(agg.state.update_bus.inbox.length === 1,     "same id does not duplicate");
  assert(agg.state.update_bus.inbox[0].risk === "high", "existing item updated in place");
}

// ─── updateUpdateBusDecision ─────────────────────────────────────────────────
console.log("\nupdateUpdateBusDecision");
{
  const agg = new Aggregator();
  agg.ingestUpdateBusItem({ id: "item-1", risk: "low" });
  agg.updateUpdateBusDecision("item-1", { verdict: "approve", decided_by: "user" });
  assert(agg.state.update_bus.inbox[0].user_decision?.verdict === "approve", "decision recorded on item");
}

// ─── Activity feed ───────────────────────────────────────────────────────────
console.log("\nactivity feed");
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("session_start", { source: "claude-code" }));
  agg.ingestEvent(ev("tool_call",   { tool: "Read", tool_args_summary: { file_path: "foo.md" } }));
  agg.ingestEvent(ev("tool_result", { tool: "Read", exit_code: 0 }));           // success — must NOT add
  agg.ingestEvent(ev("tool_result", { tool: "Bash", exit_code: 1, error_preview: "err" })); // failure — must add
  agg.ingestEvent(ev("session_end", { tool_calls: 2, errors: 1 }));
  const feed = agg.state.activity.feed;
  assert(feed.length === 4,                                    "session_start + tool_call + failed result + session_end in feed");
  assert(feed.some(e => e.kind === "session" && e.tool === "session_start"), "session_start entry present");
  assert(feed.some(e => e.kind === "tool" && e.tool === "Read"),              "tool_call entry present");
  assert(feed.some(e => e.kind === "error"),                                  "failed tool_result entry present");
  assert(!feed.some(e => e.kind === "tool_result"),                           "successful tool_result NOT in feed");
}

// activity feed cap (300)
{
  const agg = new Aggregator();
  for (let i = 0; i < 310; i++) {
    agg.ingestEvent(ev("tool_call", { tool: "Read" }));
  }
  assert(agg.state.activity.feed.length === 300, "activity feed capped at 300");
}

// token usage entry in activity feed
{
  const agg = new Aggregator({ costRates: { "claude-sonnet-4": { input: 3.0, output: 15.0 } } });
  agg.ingestEvent(ev("session_token_usage", { input_tokens: 1000, output_tokens: 200, model: "claude-sonnet-4" }));
  assert(agg.state.activity.feed.some(e => e.kind === "tokens"), "token event appears in activity feed");
}

// ─── Unknown event_type robustness ───────────────────────────────────────────
console.log("\nrobustness");
{
  const agg = new Aggregator();
  let threw = false;
  try { agg.ingestEvent(ev("unknown_future_event_v99", { data: "whatever" })); } catch { threw = true; }
  assert(!threw, "unknown event_type does not throw");
}

// ─── getState() returns redacted copy ────────────────────────────────────────
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("session_start"));
  const state = agg.getState();
  assert(state !== null && typeof state === "object", "getState returns an object");
  assert(Array.isArray(state.sessions?.active),       "getState includes sessions.active");
}

// ─── test_case registry (ADR-0046) ──────────────────────────────────────────
console.log("\ntest_case (requirements registry)");
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("test_case", {
    id: "BR-01_ForcePushMain_SE-01", parent_id: "BR_01", type: "SE",
    title: "force-push to main", framework_location: "PreToolUse",
    expected_input: "git push --force origin main", expected_output: "deny",
    actual_input: "git push --force origin main", actual_output: "deny",
    status: "pass", justification: "Rule 20 — irreversible history rewrite",
  }));
  const c = agg.state.requirements.cases[0];
  assert(agg.state.requirements.cases.length === 1,     "test_case adds a case");
  assert(c.id === "BR-01_ForcePushMain_SE-01",          "case id captured");
  assert(c.parent_id === "BR_01",                       "parent_id (traceability) captured");
  assert(c.type === "SE",                               "type captured");
  assert(c.expected_output === "deny" && c.actual_output === "deny", "expected + actual output captured");
  assert(c.status === "pass",                           "status captured");
  assert(c.justification.includes("Rule 20"),           "justification (why) captured");
  assert(agg.state.requirements.by_requirement.BR_01.total === 1, "by_requirement rolls up total");
  assert(agg.state.requirements.by_requirement.BR_01.pass === 1,  "by_requirement rolls up pass count");
  assert(agg.state.activity.feed.some(e => e.kind === "test_case"), "test_case appears in activity feed");
}

// upsert by id: re-emitting the same id updates in place (regression view)
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("test_case", { id: "X-1", parent_id: "BR_01", type: "SE", status: "fail" }));
  agg.ingestEvent(ev("test_case", { id: "X-1", parent_id: "BR_01", type: "SE", status: "pass" }));
  assert(agg.state.requirements.cases.length === 1,     "re-emitting same id does not duplicate");
  assert(agg.state.requirements.cases[0].status === "pass", "latest run wins (status updated)");
  assert(agg.state.requirements.by_requirement.BR_01.pass === 1, "rollup reflects updated status");
  assert(agg.state.requirements.by_requirement.BR_01.fail === 0, "rollup drops stale fail count");
}

// distinct ids accumulate; rollup groups by parent
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("test_case", { id: "A", parent_id: "BR_01", type: "BR", status: "pass" }));
  agg.ingestEvent(ev("test_case", { id: "B", parent_id: "BR_01", type: "SE", status: "fail" }));
  agg.ingestEvent(ev("test_case", { id: "C", parent_id: "BR_02", type: "BE", status: "pending" }));
  assert(agg.state.requirements.cases.length === 3,          "distinct ids accumulate");
  assert(agg.state.requirements.by_requirement.BR_01.total === 2, "BR_01 groups 2 cases");
  assert(agg.state.requirements.by_requirement.BR_01.fail === 1,  "BR_01 counts the failing case");
  assert(agg.state.requirements.by_requirement.BR_02.pending === 1, "BR_02 counts the pending case");
}

// cap enforcement
{
  const agg = new Aggregator();
  for (let i = 0; i < 520; i++) agg.ingestEvent(ev("test_case", { id: `case-${i}`, parent_id: "BR_X", status: "pass" }));
  assert(agg.state.requirements.cases.length === 500, "cases capped at 500");
  assert(agg.state.requirements.cases[0].id === "case-20", "cap keeps the most recent 500");
}

// defaults + getState exposure
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("test_case", { id: "D" }));
  assert(agg.state.requirements.cases[0].type === "---",     "type defaults to ---");
  assert(agg.state.requirements.cases[0].status === "pending", "status defaults to pending");
  assert(Array.isArray(agg.getState().requirements?.cases),  "getState exposes requirements.cases");
}

// ─── ticket / kanban (ADR-0048 OB-X-01) ─────────────────────────────────────
console.log("\nticket (kanban)");
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("ticket", { id: "OB-P0-05", title: "Kanban foundation", parent_id: "BR_01", state: "todo" }));
  const t = agg.state.kanban.tickets[0];
  assert(agg.state.kanban.tickets.length === 1,      "ticket adds to kanban");
  assert(t.id === "OB-P0-05" && t.title === "Kanban foundation", "ticket id/title captured");
  assert(t.parent_id === "BR_01",                    "ticket links to requirement (parent_id)");
  assert(t.state === "todo",                         "ticket state captured");
  assert(agg.state.kanban.by_state.todo === 1,       "by_state rollup counts todo");
  assert(agg.state.activity.feed.some(e => e.kind === "ticket"), "ticket appears in activity feed");
}

// time-in-state accrues across transitions
{
  const agg = new Aggregator();
  const t0 = "2026-07-06T00:00:00.000Z";
  const t1 = "2026-07-06T00:01:00.000Z"; // +60s
  const t2 = "2026-07-06T00:03:00.000Z"; // +120s after t1
  agg.ingestEvent(ev("ticket", { id: "T1", state: "backlog", timestamp: t0 }));
  agg.ingestEvent(ev("ticket", { id: "T1", state: "in_progress", timestamp: t1 }));
  agg.ingestEvent(ev("ticket", { id: "T1", state: "done", timestamp: t2 }));
  const t = agg.state.kanban.tickets[0];
  assert(agg.state.kanban.tickets.length === 1,      "same ticket id upserts, no dup");
  assert(t.state === "done",                         "latest state wins");
  assert(t.time_in_state.backlog === 60000,          "time_in_state: 60s in backlog");
  assert(t.time_in_state.in_progress === 120000,     "time_in_state: 120s in in_progress");
  assert(t.transitions.length === 3,                 "all 3 transitions recorded");
}

// same-state re-emit: no phantom transition, but mutable fields update
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("ticket", { id: "T2", state: "todo", timestamp: "2026-07-06T00:00:00.000Z" }));
  agg.ingestEvent(ev("ticket", { id: "T2", state: "todo", title: "renamed", timestamp: "2026-07-06T00:05:00.000Z" }));
  const t = agg.state.kanban.tickets[0];
  assert(t.transitions.length === 1,                 "same-state re-emit adds no transition");
  assert(t.title === "renamed",                      "same-state re-emit still updates mutable fields");
}

// no-id ignored; getState exposure; cap
{
  const agg = new Aggregator();
  agg.ingestEvent(ev("ticket", { state: "todo" }));
  assert(agg.state.kanban.tickets.length === 0,      "ticket without id is ignored");
  assert(Array.isArray(agg.getState().kanban?.tickets), "getState exposes kanban.tickets");
  for (let i = 0; i < 520; i++) agg.ingestEvent(ev("ticket", { id: `k-${i}`, state: "backlog" }));
  assert(agg.state.kanban.tickets.length === 500,    "kanban tickets capped at 500");
}

// ─── Report ──────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
