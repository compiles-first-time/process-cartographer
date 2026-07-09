#!/usr/bin/env node
// Cross-language conformance (ADR-0050 Phase 3). Proves the policy is
// LANGUAGE-NEUTRAL: runs the Python evaluator against the SAME scenarios.json
// and asserts it agrees with the JS evaluator (one shared policy, two languages).
//
// Skips gracefully — and stays green — where no REAL Python runtime is present
// (a Windows Store alias stub is NOT accepted). Install Python and it activates
// automatically: `node scripts/test.mjs` then proves JS↔Python parity.

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
      const out = `${r.stdout || ""}${r.stderr || ""}`;
      // Require an actual version string — the Windows Store stub prints
      // "Python was not found…", which does NOT match, so it's rejected.
      if (r.status === 0 && /Python \d+\.\d+/.test(out)) return cmd;
    } catch { /* not on PATH */ }
  }
  return null;
}

console.log("\ncross-language conformance (JS ↔ Python, one policy)");
const py = findRealPython();
if (!py) {
  assert(true, "skipped — no real Python runtime found; install Python to activate the JS↔Python proof");
} else {
  const script = path.join(ROOT, "adapters", "python", "conformance_check.py");
  const r = spawnSync(py, [script], { cwd: ROOT, encoding: "utf8" });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.status !== 0 && r.stderr) process.stderr.write(r.stderr);
  assert(r.status === 0, `Python evaluator agrees with JS on every conformance scenario (via ${py})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
