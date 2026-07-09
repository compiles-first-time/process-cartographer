#!/usr/bin/env node
// `loom hr-work-graph` — HR-Agent's work-graph generator.
//
// Per ADR-0029. Reads discovery/requirements.md + discovery/risk-register.md
// + agents/specialists/_registry/manifest.yaml, produces:
//
//   orchestration/work-graph.json   — canonical, machine-readable
//   orchestration/task-ledger.md    — human-readable markdown mirror
//
// Per v0.4-plan disagreement #4: JSON-backed, markdown-mirrored. HR-Agent
// consumes the JSON; humans read the markdown; the script keeps them in
// sync.
//
// MVP heuristic: each functional requirement (FR-NN) becomes a work item.
// If a row mentions a known specialist domain (oauth, payments, etc.),
// the work item is tagged with the responsible specialist. Risks tag the
// work items they apply to. NFR pillars become cross-cutting tasks.
//
// **Proposes, never applies.** HR generates the graph; the user reviews;
// the user dispatches work items to specialists.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { loadRegistry } from "./registry-loader.mjs";

const ROOT = process.cwd();
const REQ = path.join(ROOT, "discovery", "requirements.md");
const RISK = path.join(ROOT, "discovery", "risk-register.md");
const WG_JSON = path.join(ROOT, "orchestration", "work-graph.json");
const TASK_LEDGER = path.join(ROOT, "orchestration", "task-ledger.md");

await main();

async function main() {
  if (!existsSync(REQ)) {
    process.stderr.write(
      "error: discovery/requirements.md not found. Run scripts/discover.{sh,ps1} first.\n"
    );
    process.exit(1);
  }
  const requirementsText = await fs.readFile(REQ, "utf8");
  const riskText = existsSync(RISK) ? await fs.readFile(RISK, "utf8") : "";
  const specialists = await loadRegistry(ROOT);

  const workItems = [];

  // Functional requirements → work items
  for (const fr of extractFunctionalRequirements(requirementsText)) {
    const assigned = inferSpecialists(fr.capability + " " + (fr.notes || ""), specialists);
    workItems.push({
      id: `WI-${fr.id}`,
      kind: "functional",
      source: `discovery/requirements.md#${fr.id}`,
      title: fr.capability,
      actor: fr.actor || null,
      trigger: fr.trigger || null,
      outcome: fr.outcome || null,
      status: "pending",
      assigned_specialists: assigned,
      depends_on: [],
      risks: [],
    });
  }

  // NFR pillars → cross-cutting work items
  for (const nfr of extractNfrRows(requirementsText)) {
    workItems.push({
      id: `WI-NFR-${slug(nfr.category)}`,
      kind: "nfr",
      source: `discovery/requirements.md#nfr-${slug(nfr.category)}`,
      title: `Non-functional: ${nfr.category} — ${nfr.requirement}`,
      threshold: nfr.threshold,
      status: "pending",
      assigned_specialists: nfrCategorySpecialists(nfr.category, specialists),
      depends_on: [],
      risks: [],
    });
  }

  // Risks tag the work items they apply to
  for (const risk of extractRiskRows(riskText)) {
    const targets = inferRiskTargets(risk, workItems);
    for (const targetId of targets) {
      const wi = workItems.find((w) => w.id === targetId);
      if (wi) wi.risks.push(risk.id);
    }
  }

  const graph = {
    version: "1.0",
    generated_at: new Date().toISOString(),
    source: {
      requirements: "discovery/requirements.md",
      risk_register: existsSync(RISK) ? "discovery/risk-register.md" : null,
    },
    work_items: workItems,
    edges: [], // dependency edges (v1.0 MVP: empty; user fills `depends_on` manually for now)
  };

  await fs.mkdir(path.dirname(WG_JSON), { recursive: true });
  await fs.writeFile(WG_JSON, JSON.stringify(graph, null, 2) + "\n", "utf8");
  await fs.writeFile(TASK_LEDGER, renderTaskLedger(graph), "utf8");

  process.stdout.write(`wrote orchestration/work-graph.json (${workItems.length} work item${workItems.length === 1 ? "" : "s"})\n`);
  process.stdout.write(`wrote orchestration/task-ledger.md (markdown mirror)\n`);
  if (workItems.length === 0) {
    process.stdout.write("  no work items generated — discovery/requirements.md may have only template rows.\n");
  }
}

// ── Extraction ───────────────────────────────────────────────────────────

function extractFunctionalRequirements(text) {
  // Functional requirements table:
  // | FR-NN | Capability | User / Actor | Trigger | Outcome | Notes |
  const rows = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\|\s*(FR-\d+)\s*\|\s*([^|]+)\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|/);
    if (!m) continue;
    const cap = m[2].trim();
    if (!cap || cap.startsWith("*(") || cap === "—") continue;
    rows.push({
      id: m[1],
      capability: cap,
      actor: m[3].trim(),
      trigger: m[4].trim(),
      outcome: m[5].trim(),
      notes: m[6].trim(),
    });
  }
  return rows;
}

function extractNfrRows(text) {
  const rows = [];
  let inNfr = false;
  for (const line of text.split("\n")) {
    if (/^##\s+Non-functional requirements/i.test(line)) { inNfr = true; continue; }
    if (inNfr && /^##\s+/.test(line)) break;
    if (!inNfr) continue;
    const m = line.match(/^\|\s*([A-Za-z][\w\s]+)\s*\|\s*([^|]+)\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)\|/);
    if (!m) continue;
    const cat = m[1].trim();
    const req = m[2].trim();
    if (cat === "Category" || /^-+$/.test(cat) || cat === "Category ") continue;
    if (!req || req.startsWith("*(") || req === "—") continue;
    rows.push({
      category: cat,
      requirement: req,
      threshold: m[3].trim(),
      source: m[4].trim(),
      notes: m[5].trim(),
    });
  }
  return rows;
}

function extractRiskRows(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\|\s*(RISK-\d+|[A-Z]+-EX-\d+)\s*\|\s*(SE|BE)\s*\|/);
    if (!m) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 13) continue;
    const usecase = cells[4] || "";
    if (!usecase || usecase.startsWith("*(") || usecase === "—") continue;
    rows.push({
      id: m[1],
      type: m[2],
      framework_location: cells[3],
      usecase,
      next_step: cells[11],
      justifications: cells[12],
    });
  }
  return rows;
}

// ── Specialist inference ─────────────────────────────────────────────────

function inferSpecialists(text, specialists) {
  if (!text || !Array.isArray(specialists)) return [];
  const out = [];
  for (const s of specialists) {
    const patterns = s.triggers?.patterns || [];
    for (const p of patterns) {
      try {
        const re = new RegExp(p, "i");
        if (re.test(text)) {
          out.push(s.name);
          break;
        }
      } catch { /* skip */ }
    }
  }
  return out;
}

function nfrCategorySpecialists(category, specialists) {
  // Map common NFR pillars to the specialist(s) that own them.
  const map = {
    security: ["auth", "oauth", "secrets"],
    performance: ["monitoring"],
    reliability: ["monitoring", "error-tracking", "queues"],
    accessibility: [], // no specialist yet
    "i18n": [],
    scalability: ["monitoring", "queues", "file-storage"],
    compliance: ["secrets", "payments"],
    observability: ["monitoring", "error-tracking"],
  };
  const key = category.toLowerCase();
  const candidates = map[key] || [];
  // Filter to specialists that are actually in the registry
  const available = new Set(specialists.map((s) => s.name));
  return candidates.filter((c) => available.has(c));
}

function inferRiskTargets(risk, workItems) {
  // Heuristic: a risk applies to a work item if the risk's framework_location
  // or usecase mentions a domain that maps to one of the work item's specialists,
  // OR if the work item's title mentions a keyword from the risk.
  const haystack = `${risk.framework_location} ${risk.usecase} ${risk.justifications}`.toLowerCase();
  const targets = [];
  for (const wi of workItems) {
    if (wi.assigned_specialists.some((s) => haystack.includes(s.toLowerCase()))) {
      targets.push(wi.id);
      continue;
    }
    if (haystack.includes(wi.title.toLowerCase().slice(0, 30))) {
      targets.push(wi.id);
    }
  }
  // If the risk doesn't clearly attach to any work item, attach to all NFR items
  // of the matching category (best-effort).
  if (targets.length === 0) {
    for (const wi of workItems) {
      if (wi.kind !== "nfr") continue;
      if (haystack.includes(wi.title.toLowerCase().split(":")[1]?.trim().slice(0, 12) || "___")) {
        targets.push(wi.id);
      }
    }
  }
  return targets;
}

// ── Markdown rendering ───────────────────────────────────────────────────

function renderTaskLedger(graph) {
  const date = graph.generated_at;
  const lines = [
    "# Task Ledger",
    "",
    `> Per [ADR-0029](../adr/0029-hr-work-graph.md). Generated from \`discovery/requirements.md\` + \`discovery/risk-register.md\` by \`scripts/lib/hr-work-graph.mjs\`.`,
    "> Canonical source: [`work-graph.json`](./work-graph.json). This markdown file is a mirror.",
    "> Generated: " + date,
    "",
    "**Schema (per L5 + ADR-0029):**",
    "",
    "| task_id | kind | title | assigned_specialists | status | risks | source |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const wi of graph.work_items) {
    lines.push(
      `| ${wi.id} | ${wi.kind} | ${escapePipe(wi.title)} | ${(wi.assigned_specialists || []).map((s) => "`" + s + "`").join(", ") || "—"} | ${wi.status} | ${(wi.risks || []).join(", ") || "—"} | \`${wi.source}\` |`
    );
  }
  lines.push("");
  lines.push("## Dependency edges");
  lines.push("");
  if ((graph.edges || []).length === 0) {
    lines.push("_(none yet — fill `depends_on` arrays in `work-graph.json` and re-run, or hand-edit below.)_");
  } else {
    lines.push("| from | to | kind |");
    lines.push("|---|---|---|");
    for (const e of graph.edges) {
      lines.push(`| ${e.from} | ${e.to} | ${e.kind || "blocks"} |`);
    }
  }
  lines.push("");
  lines.push("## Status legend");
  lines.push("");
  lines.push("- `pending` — generated; not yet dispatched.");
  lines.push("- `dispatched` — work item handed to a specialist; in-flight.");
  lines.push("- `completed` — specialist marked the work item done; pending Critic review.");
  lines.push("- `reviewed` — Critic has approved the deliverable.");
  lines.push("");
  lines.push("## Manual edits");
  lines.push("");
  lines.push("This file is regenerated each time `hr-work-graph.mjs` runs. To preserve manual edits, put them BELOW the auto-generated section or in a separate file.");
  lines.push("");
  return lines.join("\n");
}

function escapePipe(s) {
  return String(s || "").replace(/\|/g, "\\|");
}

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
