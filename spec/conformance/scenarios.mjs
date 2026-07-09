// Canonical conformance scenarios — the ADAPTER CONTRACT (ADR-0048 OB-P1-04).
//
// The DATA lives in `scenarios.json` so it is LANGUAGE-NEUTRAL — a Python (or any
// other language) conformance runner reads the SAME scenarios as the JS suite.
// This module loads it for JS consumers.
//
// "Any Loom adapter, given this tool call + classifier hits, MUST reach `expected`."
// `requires_hard`: a compliant adapter must HARD-enforce (deny/ask) vs may degrade
// to advisory+log on a seam-less host (ADR-0048 §4).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

export const CONFORMANCE_SCENARIOS = JSON.parse(
  readFileSync(path.join(DIR, "scenarios.json"), "utf8"),
);
