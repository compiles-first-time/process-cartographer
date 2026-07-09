#!/usr/bin/env node
// Unit tests for scripts/lib/testcase.mjs — buildTestCaseFields() normalization
// (pure; emitTestCase's side effect is exercised by destructive-guard.test.mjs).

import { buildTestCaseFields } from "./testcase.mjs";

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`  ✓  ${label}`); }
  else { failed++; console.error(`  ✗  ${label}`); }
}

console.log("\nbuildTestCaseFields — defaults");
{
  const f = buildTestCaseFields({});
  assert(f.type === "---", "type defaults to ---");
  assert(f.status === "pending", "status defaults to pending");
  assert(f.id === null && f.parent_id === null, "id/parent_id default null");
  assert(f.expected_input === null && f.actual_output === null, "I/O fields default null");
  assert(f.justification === "", "justification defaults empty");
}

console.log("\nbuildTestCaseFields — passthrough + aliases");
{
  const f = buildTestCaseFields({
    id: "BR-01_SE-01", parent_id: "BR_01", type: "SE",
    usecase: "force push", expected_input: "git push --force",
    expected_output: "deny", actual_input: "git push --force", actual_output: "deny",
    status: "pass", why: "Rule 20",
  });
  assert(f.id === "BR-01_SE-01", "id passthrough");
  assert(f.parent_id === "BR_01", "parent_id passthrough");
  assert(f.title === "force push", "usecase aliases to title");
  assert(f.justification === "Rule 20", "why aliases to justification");
  assert(f.expected_output === "deny" && f.actual_output === "deny", "expected/actual output passthrough");
  assert(f.status === "pass", "status passthrough");
}

console.log("\nbuildTestCaseFields — title beats usecase; justification beats why");
{
  const f = buildTestCaseFields({ title: "explicit", usecase: "fallback", justification: "j", why: "w" });
  assert(f.title === "explicit", "explicit title wins over usecase");
  assert(f.justification === "j", "explicit justification wins over why");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
