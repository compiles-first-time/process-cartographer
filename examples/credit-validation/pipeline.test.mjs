#!/usr/bin/env node
// Dogfood in Loom's suite: run the Python credit-validation pipeline's own test
// (validate_test.py) when a real Python runtime exists, and assert it passes —
// a real project built ON Loom, governed by the Loom guard, registering its
// BR/BE/SE into the registry. Skips gracefully (stays green) without Python.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`  ✓  ${label}`); }
  else { failed++; console.error(`  ✗  ${label}`); }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function findRealPython() {
  for (const cmd of ["python3", "python", "py"]) {
    try {
      const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
      if (r.status === 0 && /Python \d+\.\d+/.test(`${r.stdout || ""}${r.stderr || ""}`)) return cmd;
    } catch { /* not on PATH */ }
  }
  return null;
}

console.log("\ncredit-validation dogfood (a project built ON Loom)");
const py = findRealPython();
if (!py) {
  assert(true, "skipped — no real Python runtime found; install Python to run the dogfood pipeline");
} else {
  const script = path.join(ROOT, "examples", "credit-validation", "validate_test.py");
  const r = spawnSync(py, [script], { cwd: ROOT, encoding: "utf8" });
  if (r.stdout) process.stdout.write(r.stdout.split("\n").map((l) => "    " + l).join("\n"));
  if (r.status !== 0 && r.stderr) process.stderr.write(r.stderr);
  assert(r.status === 0, `pipeline validates + governs + registers its BR/BE/SE (via ${py})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
