// Portable destructive-action policy (ADR-0047/0048/0050).
//
// The DATA now lives in the sibling `destructive-actions.policy.json` so it is
// LANGUAGE-NEUTRAL: the JS evaluator (scripts/lib/destructive-guard.mjs), a
// Python evaluator (adapters/python/loom_guard.py), and any other host's
// evaluator all read the SAME single source of truth. This module just loads
// that JSON for JS consumers — policy is data; the evaluator is separate.
//
// Loaded via readFileSync against the module's own dir so cwd never matters.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

export const DESTRUCTIVE_POLICY = JSON.parse(
  readFileSync(path.join(DIR, "destructive-actions.policy.json"), "utf8"),
);
