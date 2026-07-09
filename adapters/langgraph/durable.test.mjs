#!/usr/bin/env node
// Durable governed execution (ADR-0052). Runs when @langchain/langgraph is
// installed; skips gracefully (stays green) otherwise. Proves: a destructive op
// triggers a durable interrupt (state persisted), and resume enforces the human
// decision — approve → executes, reject → skipped.

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`  ✓  ${label}`); }
  else { failed++; console.error(`  ✗  ${label}`); }
}

console.log("\ndurable governed execution (LangGraph checkpointer + interrupt/resume)");

let mod = null;
try {
  mod = await import("./durable.mjs");
} catch (e) {
  if (e && e.code === "ERR_MODULE_NOT_FOUND") {
    mod = null; // @langchain/langgraph not installed — skip, stay green
  } else {
    throw e; // a real error — do NOT mask it
  }
}

if (!mod) {
  assert(true, "skipped — @langchain/langgraph not installed (run `npm install` in adapters/langgraph)");
} else {
  const approve = await mod.runDurableDemo("approve");
  assert(approve.interrupted, "destructive op → durable interrupt (state persisted to checkpointer)");
  assert(approve.interruptPayload && approve.interruptPayload.type === "approval_required", "interrupt carries the approval payload");
  assert(approve.executed, "resume(approve) → op executes");

  const reject = await mod.runDurableDemo("reject");
  assert(reject.interrupted && !reject.executed, "resume(reject) → op skipped (governance denied)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
