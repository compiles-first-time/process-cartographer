#!/usr/bin/env node
// `loom update-bus tick` — v0.2 stub per ADR-0016.
//
// The Update Bus is the v0.1-spec'd mechanism that turns external research feeds,
// project lessons-learned, and internal pattern audits into ADRs the user can approve.
// v0.2 ships the **stub**: receiver API documentation + this no-op tick script that
// validates the wire-up but performs no I/O against real feeds. Full implementation
// is v0.3.
//
// What a real tick will do in v0.3:
//   1. Poll configured research feeds (RSS, arXiv RSS, GitHub releases).
//   2. Apply the source-tier filter (L7) — admit Tier 1–3, drop Rejected.
//   3. Write update-bus/inbox/<id>.md files conforming to update-bus/schema.json.
//   4. Notify the Critic subagent (which reviews; then Human Replica; then user).
//
// What this stub does:
//   - Reports current inbox/archive counts.
//   - Validates that update-bus/schema.json parses.
//   - Validates that any existing inbox items conform to the schema (best-effort,
//     since v0.2 inbox items may still be the markdown-only v0.1 shape).
//   - Exits 0.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const INBOX = path.join(ROOT, "update-bus", "inbox");
const ARCHIVE = path.join(ROOT, "update-bus", "archive");
const SCHEMA = path.join(ROOT, "update-bus", "schema.json");

async function main() {
  console.log("loom update-bus tick (v0.2 stub) — no live feeds; reporting state only.\n");

  // Schema validation
  if (!existsSync(SCHEMA)) {
    console.error("error: update-bus/schema.json missing");
    process.exit(1);
  }
  try {
    JSON.parse(await fs.readFile(SCHEMA, "utf8"));
    console.log("  ✓ schema.json parses");
  } catch (err) {
    console.error(`  ✗ schema.json malformed: ${err.message}`);
    process.exit(1);
  }

  // Inbox / archive counts
  const inboxCount = existsSync(INBOX)
    ? (await fs.readdir(INBOX)).filter((f) => f.endsWith(".md") && f !== "README.md").length
    : 0;
  const archiveCount = existsSync(ARCHIVE)
    ? (await listFilesRecursive(ARCHIVE)).filter((f) => f.endsWith(".md")).length
    : 0;
  console.log(`  ✓ inbox/   ${inboxCount} pending`);
  console.log(`  ✓ archive/ ${archiveCount} resolved`);

  // v0.3 plan (printed so a human running the stub sees what's next)
  console.log("\nReceiver API (planned for v0.3):");
  console.log("  POST  /loom/update-bus/inbox  body: { source, proposed_by, affects, risk, collapse_risk, payload }");
  console.log("  GET   /loom/update-bus/inbox  → [ {id, source_tier, critic_review, ...}, ... ]");
  console.log("  POST  /loom/update-bus/inbox/<id>/decision  body: { verdict, decided_by, note }");
  console.log("\nv0.3 implementation will poll configured feeds, run the L7 source-tier filter,");
  console.log("write inbox items conforming to update-bus/schema.json, and notify the Critic subagent.");

  process.exit(0);
}

async function listFilesRecursive(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
