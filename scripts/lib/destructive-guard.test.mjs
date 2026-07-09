#!/usr/bin/env node
// Unit tests for scripts/lib/destructive-guard.mjs — the BR_01 (ADR-0047)
// tiered destructive-action decision. Each test corresponds to a row in
// observability/eval-suite/requirements/BR_01.md.

import { decideDestructiveAction, toHookOutput } from "./destructive-guard.mjs";
import { BR_01_CASES } from "../../observability/eval-suite/requirements/BR_01.cases.mjs";
import { emitTestCase } from "./testcase.mjs";

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`  ✓  ${label}`); }
  else { failed++; console.error(`  ✗  ${label}`); }
}

// Simulate a classifyToolCall() destructive hit.
function destructiveHit(matched_on, extra = {}) {
  return {
    category: "destructive_actions",
    enforcement: "hard",
    matched_on,
    decision: "ask",
    required_protocol: [{ present_action: "…" }, { rollback_path: "…" }],
    ...extra,
  };
}

// ─── BR_01 requirement: non-destructive calls pass through ──────────────────
console.log("\nBR_01 — no destructive signal → none");
{
  assert(decideDestructiveAction({ tool: "Read", input: { file_path: "src/index.ts" }, hits: [] }).decision === "none",
    "Read of a normal file → none");
  assert(decideDestructiveAction({ tool: "Bash", input: { command: "npm test" }, hits: [] }).decision === "none",
    "npm test → none");
  assert(decideDestructiveAction({ tool: "Edit", input: { file_path: "src/app.ts" }, hits: [] }).decision === "none",
    "Edit of a normal source file → none");
  // Guards against The Claude Protocol's substring-match bug (-n / -name):
  assert(decideDestructiveAction({ tool: "Bash", input: { command: "git commit -m \"fix-name\"" }, hits: [] }).decision === "none",
    "benign commit containing '-n' → none (no false positive)");
}

// ─── SE tier 2 (ASK): the destructive class ─────────────────────────────────
console.log("\nBR_01 — destructive class → ask (tier 2)");
{
  const rm = decideDestructiveAction({ tool: "Bash", input: { command: "rm -rf build" }, hits: [destructiveHit("rm -rf")] });
  assert(rm.decision === "ask" && rm.tier === 2, "rm -rf build → ask");
  assert(/Rule 20/.test(rm.reason), "ask reason cites Rule 20");
  assert(/rm -rf/.test(rm.reason), "ask reason names the matched op");

  assert(decideDestructiveAction({ tool: "Bash", input: { command: "git reset --hard HEAD~3" }, hits: [destructiveHit("git reset --hard")] }).decision === "ask",
    "git reset --hard → ask");
  assert(decideDestructiveAction({ tool: "Bash", input: { command: "psql -c 'DROP TABLE users'" }, hits: [destructiveHit("drop table")] }).decision === "ask",
    "DROP TABLE → ask");
  // Force-push to a NON-protected branch is destructive but not catastrophic → ask, not deny.
  const ffeat = decideDestructiveAction({ tool: "Bash", input: { command: "git push --force origin feature-x" }, hits: [destructiveHit("git push --force")] });
  assert(ffeat.decision === "ask", "force-push to feature branch → ask (not deny)");
  // Non-force push to main is a destructive hit → ask (reversible-ish), NOT tier-1 deny.
  const pushmain = decideDestructiveAction({ tool: "Bash", input: { command: "git push origin main" }, hits: [destructiveHit("git push origin main")] });
  assert(pushmain.decision === "ask", "non-force push to main → ask (not deny)");
}

// ─── SE tier 1 (DENY): immutable / catastrophic-irreversible ────────────────
console.log("\nBR_01 — immutable / catastrophic → deny (tier 1)");
{
  const krepo = decideDestructiveAction({ tool: "Edit", input: { file_path: "constitution/kernel-v6.md" }, hits: [] });
  assert(krepo.decision === "deny" && krepo.tier === 1, "Edit kernel-v6.md (repo-relative) → deny");
  assert(/Rule 19/.test(krepo.reason), "kernel deny reason cites Rule 19");

  const kabs = decideDestructiveAction({ tool: "Write", input: { file_path: "C:/Users/x/dev/loom-template/constitution/kernel-v6.md" }, hits: [] });
  assert(kabs.decision === "deny", "Write kernel-v6.md (absolute path) → deny (suffix match)");

  const kback = decideDestructiveAction({ tool: "Edit", input: { file_path: "C:\\Users\\x\\dev\\loom-template\\constitution\\kernel-v6.md" }, hits: [] });
  assert(kback.decision === "deny", "Edit kernel-v6.md (backslash path) → deny (normalized)");

  assert(decideDestructiveAction({ tool: "Write", input: { file_path: "orchestration/progress-ledger.md" }, hits: [] }).decision === "deny",
    "Write progress-ledger.md → deny (hook-managed)");
  assert(decideDestructiveAction({ tool: "Edit", input: { file_path: "tools/discovered-runtime.md" }, hits: [] }).decision === "deny",
    "Edit discovered-runtime.md → deny (hook-managed)");

  const fmain = decideDestructiveAction({ tool: "Bash", input: { command: "git push --force origin main" }, hits: [destructiveHit("git push --force")] });
  assert(fmain.decision === "deny" && fmain.tier === 1, "force-push to main → deny");
  assert(decideDestructiveAction({ tool: "Bash", input: { command: "git push -f origin master" }, hits: [] }).decision === "deny",
    "force-push -f to master → deny (even with no classifier hit)");
  assert(decideDestructiveAction({ tool: "Bash", input: { command: "git push --force-with-lease origin production" }, hits: [] }).decision === "deny",
    "force-with-lease to production → deny");

  // Explicit YAML decision:deny hit.
  const yamlDeny = decideDestructiveAction({ tool: "Bash", input: { command: "some-cmd" }, hits: [{ category: "custom", matched_on: "some-cmd", decision: "deny" }] });
  assert(yamlDeny.decision === "deny", "explicit decision:deny hit → deny");
}

// ─── BE tier 3 (ALLOW): contained scope ─────────────────────────────────────
console.log("\nBR_01 — contained scope → allow (tier 3)");
{
  const wt = decideDestructiveAction({ tool: "Bash", input: { command: "rm -rf .worktrees/bd-12/tmp" }, hits: [destructiveHit("rm -rf")] });
  assert(wt.decision === "allow" && wt.tier === 3, "rm -rf inside .worktrees/ → allow");
  assert(/[Cc]ontained/.test(wt.reason), "allow reason mentions contained scope");
  // SECURITY (critic C1): a COMPOUND command is NOT contained even if it mentions
  // .worktrees/ — its destructive segment may target elsewhere. Falls to ask.
  const wtChained = decideDestructiveAction({ tool: "Bash", input: { command: "cd repo/.worktrees/bd-3 && git clean -fd" }, hits: [destructiveHit("git clean -fd")] });
  assert(wtChained.decision === "ask", "chained cmd mentioning .worktrees/ → ask (not allow)");
  assert(decideDestructiveAction({ tool: "Bash", input: { command: "rm -rf /var/data && cd .worktrees/x" }, hits: [destructiveHit("rm -rf")] }).decision === "ask",
    "BYPASS blocked: rm outside worktree + '&& cd .worktrees' → ask, NOT allow");
  assert(decideDestructiveAction({ tool: "Bash", input: { command: "rm -rf /var/data #.worktrees/x" }, hits: [destructiveHit("rm -rf")] }).decision === "ask",
    "BYPASS blocked: comment mentioning .worktrees → ask, NOT allow");
  // But the SAME op OUTSIDE a worktree → ask.
  assert(decideDestructiveAction({ tool: "Bash", input: { command: "git clean -fd" }, hits: [destructiveHit("git clean -fd")] }).decision === "ask",
    "git clean -fd outside worktree → ask");
}

// ─── SE robustness: malformed / edge input never throws ─────────────────────
console.log("\nBR_01 — robustness (fail-safe input handling)");
{
  assert(decideDestructiveAction({}).decision === "none", "empty ctx → none (no throw)");
  assert(decideDestructiveAction({ tool: "Bash", input: null, hits: null }).decision === "none", "null input/hits → none");
  assert(decideDestructiveAction({ tool: "Bash", input: "rm -rf /", hits: [destructiveHit("rm -rf")] }).decision === "ask", "string input honored → ask");
  assert(decideDestructiveAction({ tool: "Edit", input: { file_path: "" }, hits: [] }).decision === "none", "empty file_path → none");
  // Deny tier must win even if a contained marker is also present (immutable file inside a worktree is still immutable).
  const both = decideDestructiveAction({ tool: "Edit", input: { file_path: ".worktrees/x/constitution/kernel-v6.md" }, hits: [] });
  assert(both.decision === "deny", "kernel-v6.md even under .worktrees/ → deny (tier 1 precedence)");
}

// ─── toHookOutput mapping ────────────────────────────────────────────────────
console.log("\ntoHookOutput()");
{
  const deny = toHookOutput({ decision: "deny", reason: "nope" });
  assert(deny.hookSpecificOutput.permissionDecision === "deny", "deny → permissionDecision deny");
  assert(deny.hookSpecificOutput.hookEventName === "PreToolUse", "deny → hookEventName PreToolUse");
  assert(deny.hookSpecificOutput.permissionDecisionReason === "nope", "deny → reason passed through");
  const ask = toHookOutput({ decision: "ask", reason: "confirm?" });
  assert(ask.hookSpecificOutput.permissionDecision === "ask", "ask → permissionDecision ask");
  assert(toHookOutput({ decision: "allow", reason: "ok" }) === null, "allow → null (no stdout)");
  assert(toHookOutput({ decision: "none", reason: null }) === null, "none → null (no stdout)");
  assert(toHookOutput(null) === null, "null result → null");
}

// ─── Policy override (decoupling proof, ADR-0048) ───────────────────────────
// Behavior must follow the spec DATA, not hardcode — that IS the decoupling.
console.log("\npolicy override (spec/policy is data-driven)");
{
  const strict = { immutableFiles: [], hookManagedFiles: [], protectedBranches: ["main"], containedScopeSegments: [".worktrees/"], destructiveDefault: "deny" };
  assert(decideDestructiveAction({ tool: "Bash", input: { command: "rm -rf x" }, hits: [destructiveHit("rm -rf")], policy: strict }).decision === "deny",
    "destructiveDefault:deny → whole destructive class hard-blocks");

  const custom = { immutableFiles: [], hookManagedFiles: [], protectedBranches: ["release"], containedScopeSegments: [], destructiveDefault: "ask" };
  assert(decideDestructiveAction({ tool: "Bash", input: { command: "git push --force origin release" }, hits: [], policy: custom }).decision === "deny",
    "custom protectedBranches: force-push to 'release' → deny");
  assert(decideDestructiveAction({ tool: "Bash", input: { command: "git push --force origin main" }, hits: [destructiveHit("git push --force")], policy: custom }).decision === "ask",
    "with 'main' not in custom protected list → force-push main is ask, not deny");

  const immut = { immutableFiles: ["secrets/master.key"], hookManagedFiles: [], protectedBranches: [], containedScopeSegments: [], destructiveDefault: "ask" };
  assert(decideDestructiveAction({ tool: "Edit", input: { file_path: "secrets/master.key" }, hits: [], policy: immut }).decision === "deny",
    "custom immutableFiles: editing it → deny");
  assert(decideDestructiveAction({ tool: "Edit", input: { file_path: "constitution/kernel-v6.md" }, hits: [], policy: immut }).decision === "none",
    "kernel NOT in custom immutable list → editing it is none (policy data is the source of truth)");
}

// ─── BR_01 canonical register cases (data-driven assert + emit) ─────────────
// Each case is asserted against the guard AND emitted as a test_case event, so
// the Observatory Requirements panel + regression history populate on each run
// (ADR-0046 "actual captured at run time"). One source of truth: BR_01.cases.mjs.
console.log("\nBR_01 canonical register cases (ADR-0046 emit)");
{
  let allPass = true;
  for (const c of BR_01_CASES) {
    if (!c.input) continue; // the BR row itself has no runnable input
    const r = decideDestructiveAction({ tool: c.tool, input: c.input, hits: c.hits || [] });
    const ok = r.decision === c.expected;
    if (!ok) allPass = false;
    assert(ok, `${c.id}: ${c.title} → ${c.expected}`);
    const io = c.input.command || c.input.file_path || "";
    emitTestCase({
      id: c.id, parent_id: "BR_01", type: c.type, title: c.title,
      framework_location: c.framework_location,
      expected_input: io, expected_output: c.expected,
      actual_input: io, actual_output: r.decision,
      status: ok ? "pass" : "fail", justification: c.justification,
    });
  }
  const br = BR_01_CASES.find((c) => c.type === "BR");
  if (br) {
    emitTestCase({
      id: br.id, parent_id: null, type: "BR", title: br.title,
      framework_location: br.framework_location,
      expected_input: br.expected_input, expected_output: "enforced",
      actual_input: br.expected_input, actual_output: allPass ? "enforced" : "gap",
      status: allPass ? "pass" : "fail", justification: br.justification,
    });
  }
  assert(allPass, "all BR_01 canonical cases pass (registry emitted)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
