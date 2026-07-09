#!/usr/bin/env node
// OB-P2-03 — the milestone. The LangGraph adapter passes the SAME conformance
// suite as the Claude Code adapter, and maps decisions to LangGraph's OWN
// enforcement primitives. Two architecturally different hosts, one spec+policy
// => "model-agnostic" is a fact (host-agnostic). (Cross-language/Python is a
// separate future proof — ADR-0049/0050.) Dependency-free: no @langchain/langgraph.

import { CONFORMANCE_SCENARIOS } from "../../spec/conformance/scenarios.mjs";
import { runConformance } from "../../spec/conformance/conformance.mjs";
import { decide, toLangGraphControl, preToolGuard } from "./guard.mjs";
import { decideDestructiveAction } from "../../scripts/lib/destructive-guard.mjs";

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`  ✓  ${label}`); }
  else { failed++; console.error(`  ✗  ${label}`); }
}
function dhit(matched_on) {
  return { category: "destructive_actions", enforcement: "hard", decision: "ask", matched_on, required_protocol: [] };
}

// (1) THE milestone: LangGraph adapter passes the conformance suite.
console.log("\nLangGraph adapter — conformance (OB-P2-03)");
{
  const report = runConformance(decide, CONFORMANCE_SCENARIOS);
  for (const r of report.results) {
    assert(r.ok, `${r.id}: ${r.description} → ${r.expected}${r.ok ? "" : ` (got ${r.actual})`}`);
  }
  assert(report.failed === 0, `LangGraph adapter passes all ${report.total} conformance scenarios`);
}

// (2) Cross-adapter parity: same spec => same decisions across both hosts.
console.log("\ncross-adapter parity (one spec, two hosts)");
{
  let agree = 0;
  for (const sc of CONFORMANCE_SCENARIOS) {
    const cc = decideDestructiveAction({ tool: sc.tool, input: sc.input, hits: sc.hits || [] }).decision;
    const lg = decide(sc);
    if (cc === lg) agree++;
  }
  assert(agree === CONFORMANCE_SCENARIOS.length, "Claude Code adapter and LangGraph adapter agree on every scenario");
}

// (3) Host-specific enforcement mapping (the adapter's real, non-trivial work).
console.log("\nLangGraph enforcement mapping (decision → interrupt/block/proceed)");
{
  const deny = toLangGraphControl({ decision: "deny", reason: "no" });
  assert(deny.action === "block" && deny.proceed === false, "deny → block (tool not executed)");
  const ask = toLangGraphControl({ decision: "ask", reason: "confirm" });
  assert(ask.action === "interrupt" && ask.interrupt === true, "ask → interrupt (human-in-the-loop)");
  assert(ask.payload && ask.payload.type === "approval_required", "ask → carries an interrupt payload");
  assert(toLangGraphControl({ decision: "allow" }).proceed === true, "allow → proceed");
  assert(toLangGraphControl({ decision: "none" }).proceed === true, "none → proceed");
}

// (4) preToolGuard end-to-end (what a graph node calls before a tool runs).
console.log("\npreToolGuard end-to-end");
{
  assert(preToolGuard({ tool: "Bash", input: { command: "git push --force origin main" } }).action === "block",
    "force-push to main → block");
  assert(preToolGuard({ tool: "Edit", input: { file_path: "constitution/kernel-v6.md" } }).action === "block",
    "edit immutable constitution → block");
  assert(preToolGuard({ tool: "Bash", input: { command: "rm -rf build" }, hits: [dhit("rm -rf")] }).action === "interrupt",
    "rm -rf → interrupt (approval)");
  assert(preToolGuard({ tool: "Bash", input: { command: "rm -rf .worktrees/x" }, hits: [dhit("rm -rf")] }).action === "proceed",
    "rm -rf in worktree → proceed (contained)");
  assert(preToolGuard({ tool: "Bash", input: { command: "npm test" } }).action === "proceed",
    "benign → proceed");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
