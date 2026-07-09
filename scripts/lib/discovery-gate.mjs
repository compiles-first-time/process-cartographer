// Discovery gate — checks that discovery/ artifacts meet "good enough"
// criteria before letting deploy.mjs proceed. Per ADR-0026 / L8.
//
// Criteria (from discovery/README.md "When is discovery done?"):
//   - requirements.md has ≥ 1 FR-NN row + ≥ 1 NFR row (filled, not template)
//   - risk-register.md has ≥ 1 SE row + ≥ 1 BE row, each with non-empty Next Step
//   - open-questions.md has no Blocking? = yes rows
//
// Returns { ok: boolean, missing: string[], warnings: string[] }.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";

const ROOT_DEFAULT = process.cwd();

export async function checkDiscoveryGate(root = ROOT_DEFAULT) {
  const d = path.join(root, "discovery");
  const missing = [];
  const warnings = [];

  if (!existsSync(d)) {
    return {
      ok: false,
      missing: ["discovery/ directory does not exist — run scripts/discover.{sh,ps1}"],
      warnings: [],
    };
  }

  // requirements.md
  const reqPath = path.join(d, "requirements.md");
  if (!existsSync(reqPath)) {
    missing.push("discovery/requirements.md is missing");
  } else {
    const text = await fs.readFile(reqPath, "utf8");
    const filledFr = countFilledRows(text, "FR-");
    const filledNfr = countFilledNfrRows(text);
    if (filledFr < 1) missing.push("discovery/requirements.md: no filled functional requirement (FR-NN) — has only the template row");
    if (filledNfr < 1) missing.push("discovery/requirements.md: no filled NFR pillar — has only the template row");
  }

  // risk-register.md
  const riskPath = path.join(d, "risk-register.md");
  if (!existsSync(riskPath)) {
    missing.push("discovery/risk-register.md is missing");
  } else {
    const text = await fs.readFile(riskPath, "utf8");
    const seRows = countRiskRows(text, "SE");
    const beRows = countRiskRows(text, "BE");
    if (seRows < 1) missing.push("discovery/risk-register.md: no filled SE (System Exception) row with Next Step");
    if (beRows < 1) missing.push("discovery/risk-register.md: no filled BE (Business Exception) row with Next Step");
  }

  // open-questions.md
  const oqPath = path.join(d, "open-questions.md");
  if (!existsSync(oqPath)) {
    warnings.push("discovery/open-questions.md is missing — recommended, not blocking");
  } else {
    const text = await fs.readFile(oqPath, "utf8");
    if (hasBlockingOpenQuestion(text)) {
      missing.push("discovery/open-questions.md: at least one row has Blocking? = yes — resolve before deploy");
    }
  }

  // quick-scan.md is recommended but not blocking
  if (!existsSync(path.join(d, "quick-scan.md"))) {
    warnings.push("discovery/quick-scan.md is missing — run scripts/discover.{sh,ps1} --quick");
  }

  return {
    ok: missing.length === 0,
    missing,
    warnings,
  };
}

// ── Heuristic row counters ───────────────────────────────────────────────

function countFilledRows(text, idPrefix) {
  // Look at the Functional requirements markdown table. A "filled" row is
  // one whose ID column matches /FR-\d\d+/ AND whose Capability column is
  // not the literal template (`*(e.g., ...)*`) AND not empty.
  let count = 0;
  const lines = text.split("\n");
  for (const line of lines) {
    const m = line.match(/^\|\s*(FR-\d+)\s*\|\s*([^|]+)\|/);
    if (!m) continue;
    if (!m[1].startsWith(idPrefix)) continue;
    const cap = m[2].trim();
    if (!cap || cap.startsWith("*(") || cap === "—") continue;
    count++;
  }
  return count;
}

function countFilledNfrRows(text) {
  // The NFR table has explicit category labels. A row is "filled" if the
  // Requirement column has been replaced from the template placeholder.
  let count = 0;
  let inNfr = false;
  for (const line of text.split("\n")) {
    if (/^##\s+Non-functional requirements/i.test(line)) {
      inNfr = true;
      continue;
    }
    if (inNfr && /^##\s+/.test(line)) break;
    if (!inNfr) continue;
    const m = line.match(/^\|\s*([A-Za-z][\w\s]+)\s*\|\s*([^|]+)\|/);
    if (!m) continue;
    const category = m[1].trim();
    const req = m[2].trim();
    // Skip header rows
    if (category === "Category" || /^-+$/.test(category)) continue;
    // The shipped template includes pre-filled examples (e.g. "p95 first-byte
    // latency < 500ms"). Treat any non-empty value as "the user has reviewed."
    // A `*(e.g.…` placeholder would not count.
    if (!req || req.startsWith("*(") || req === "—") continue;
    count++;
  }
  return count;
}

function countRiskRows(text, type) {
  // Risk-register rows look like `| RISK-NN | SE | ... | <Next Step> | <Justifications> |`.
  // Count rows where Type matches AND Next Step + Justifications are non-empty / non-template.
  let count = 0;
  for (const line of text.split("\n")) {
    const m = line.match(/^\|\s*(RISK-\d+|[A-Z]+-EX-\d+)\s*\|\s*(SE|BE)\s*\|/);
    if (!m) continue;
    if (m[2] !== type) continue;
    // Pull the Next Step column (11th) — markdown tables in this register
    // have 12 columns. Quick heuristic: split by | and check column 12.
    const cells = line.split("|").map((c) => c.trim());
    // cells[0] is empty (leading |), cells[1] is ID, ... cells[11] is Next Step, cells[12] is Justifications
    if (cells.length < 13) continue;
    const nextStep = cells[11];
    const justifications = cells[12];
    if (!nextStep || nextStep.startsWith("*(") || nextStep === "—") continue;
    if (!justifications || justifications.startsWith("*(") || justifications === "—") continue;
    count++;
  }
  return count;
}

function hasBlockingOpenQuestion(text) {
  for (const line of text.split("\n")) {
    const m = line.match(/^\|\s*(OQ-\d+)\s*\|\s*[^|]+\|\s*(yes|y|true)\s*\|/i);
    if (m) return true;
  }
  return false;
}
