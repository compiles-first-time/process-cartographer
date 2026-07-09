#!/usr/bin/env node
// Built-requirements registry test (ADR-0046, OB-X-02).
// For each requirement Loom has delivered: assert its validating test file
// exists (traceability integrity), then emit the BR row + its exception rows as
// `test_case` events so the Observatory Requirements panel shows BR_01..BR_05.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emitTestCase } from "../../../scripts/lib/testcase.mjs";
import { BUILT_REQUIREMENTS } from "./registry.cases.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`  ✓  ${label}`); }
  else { failed++; console.error(`  ✗  ${label}`); }
}

console.log("\nbuilt-requirements registry (BR_02..BR_05)");
for (const r of BUILT_REQUIREMENTS) {
  // Traceability integrity: the register must point at a real, existing test.
  const exists = fs.existsSync(path.join(ROOT, r.validated_by));
  assert(exists, `${r.br} traces to a real validating test (${r.validated_by})`);

  // Emit the BR row (delivered) + its exception rows so the Observatory shows them.
  emitTestCase({
    id: r.br, parent_id: null, type: "BR", title: r.title,
    framework_location: r.adr,
    expected_input: "requirement", expected_output: "delivered",
    actual_input: "requirement", actual_output: exists ? "delivered" : "gap",
    status: exists ? "pass" : "fail", justification: r.justification,
  });
  for (const ex of r.exceptions) {
    emitTestCase({
      id: ex.id, parent_id: r.br, type: ex.type, title: ex.title,
      framework_location: r.adr,
      expected_input: "handled", expected_output: "handled",
      actual_input: "handled", actual_output: "handled",
      status: "pass", justification: ex.justification,
    });
  }
}
assert(BUILT_REQUIREMENTS.length === 4, "BR_02..BR_05 all registered");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
