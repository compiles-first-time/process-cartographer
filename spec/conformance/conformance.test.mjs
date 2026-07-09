#!/usr/bin/env node
// Conformance suite (ADR-0048 OB-P1-04/05).
//   (a) POLICY conformance — the portable spec evaluator meets the contract.
//   (b) CLAUDE CODE adapter conformance — it maps decisions to the host format.
// A future second adapter (OB-P2) re-uses (a) with its own decide fn; passing it
// is what turns "model-agnostic" from claim into fact.

import { CONFORMANCE_SCENARIOS } from "./scenarios.mjs";
import { runConformance } from "./conformance.mjs";
import { decideDestructiveAction, toHookOutput } from "../../scripts/lib/destructive-guard.mjs";

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`  ✓  ${label}`); }
  else { failed++; console.error(`  ✗  ${label}`); }
}

// (a) Policy conformance — the spec evaluator (shared by all JS adapters).
console.log("\npolicy conformance (portable spec evaluator)");
{
  const decide = (sc) => decideDestructiveAction({ tool: sc.tool, input: sc.input, hits: sc.hits || [] }).decision;
  const report = runConformance(decide, CONFORMANCE_SCENARIOS);
  for (const r of report.results) {
    assert(r.ok, `${r.id}: ${r.description} → ${r.expected}${r.ok ? "" : ` (got ${r.actual})`}`);
  }
  assert(report.failed === 0, `spec evaluator passes all ${report.total} conformance scenarios`);
  const hard = report.results.filter((r) => r.requires_hard).length;
  console.log(`  · ${hard}/${report.total} scenarios require HARD enforcement from a compliant adapter`);
}

// (b) Claude Code adapter conformance — decision → host-native permissionDecision.
console.log("\nClaude Code adapter conformance (decision → permissionDecision)");
{
  assert(toHookOutput({ decision: "deny", reason: "x" })?.hookSpecificOutput?.permissionDecision === "deny",
    "deny → permissionDecision:deny (hard-enforced)");
  assert(toHookOutput({ decision: "ask", reason: "x" })?.hookSpecificOutput?.permissionDecision === "ask",
    "ask → permissionDecision:ask (hard-enforced)");
  assert(toHookOutput({ decision: "allow" }) === null, "allow → no host output (tool proceeds)");
  assert(toHookOutput({ decision: "none" }) === null, "none → no host output (tool proceeds)");
  console.log("  · Claude Code adapter provides HARD enforcement at PreToolUse (OB-P1-05 ✓)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
