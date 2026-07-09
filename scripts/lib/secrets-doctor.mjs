#!/usr/bin/env node
// `loom secrets-doctor` — scans the event log + uncommitted tracked files
// for token-shaped values that may be accidentally leaked secrets.
//
// Per ADR-0018.
//
// Exit codes:
//   0  no findings (or only medium-confidence noise the user has cleared)
//   1  one or more HIGH-confidence findings (real-looking tokens detected)
//   2  invocation error

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { scanForSecrets } from "./secret-patterns.mjs";
import { detectOauthPreferenceMisses } from "./oauth-preference.mjs";

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const INCLUDE_MEDIUM = args.has("--include-medium");
const HISTORY_DAYS = parseInt(process.env.LOOM_SECRETS_DAYS || "30", 10);

await main();

async function main() {
  const findings = [];
  const oauthMisses = [];

  await scanEventLog(findings, oauthMisses);
  await scanUncommittedFiles(findings, oauthMisses);

  report(findings, oauthMisses);
}

// ── Scanners ─────────────────────────────────────────────────────────────

async function scanEventLog(findings, oauthMisses) {
  const dir = path.join(ROOT, "memory", "event-log");
  if (!existsSync(dir)) return;
  const files = (await fs.readdir(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));
  files.sort();
  const recent = files.slice(-HISTORY_DAYS);
  for (const f of recent) {
    const p = path.join(dir, f);
    let text;
    try {
      text = await fs.readFile(p, "utf8");
    } catch {
      continue;
    }
    const hits = scanForSecrets(text);
    for (const h of hits) {
      findings.push({ source: `event-log/${f}`, ...h });
    }
    const oauth = detectOauthPreferenceMisses(text);
    for (const m of oauth) {
      oauthMisses.push({ source: `event-log/${f}`, ...m });
    }
  }
}

async function scanUncommittedFiles(findings, oauthMisses) {
  // Untracked + modified, but not deleted.
  const status = spawnSync(
    "git",
    ["status", "--porcelain", "--no-renames"],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (status.status !== 0) return;
  const lines = (status.stdout || "").split("\n").filter(Boolean);
  for (const line of lines) {
    if (line.length < 4) continue;
    const code = line.slice(0, 2);
    if (code.includes("D")) continue; // deleted
    const file = line.slice(3).trim();
    // Skip binary-likely files and our own .gitignored event log.
    if (/\.(jpg|jpeg|png|gif|webp|pdf|zip|tgz|gz|woff2?)$/i.test(file)) continue;
    if (file.startsWith("memory/event-log/")) continue;
    if (file.startsWith("node_modules/")) continue;
    if (file === ".env" || /^\.env\./.test(file)) {
      // .env files are EXPECTED to contain secrets but should never be
      // committed — call this out as a separate finding.
      findings.push({
        source: file,
        label: ".env file present in working tree — verify .gitignore covers it",
        confidence: "high",
        sample: "(file presence; not scanning contents)",
      });
      continue;
    }
    const abs = path.join(ROOT, file);
    if (!existsSync(abs)) continue;
    let text;
    try {
      text = await fs.readFile(abs, "utf8");
    } catch {
      continue; // binary
    }
    const hits = scanForSecrets(text);
    for (const h of hits) {
      findings.push({ source: file, ...h });
    }
    const oauth = detectOauthPreferenceMisses(text);
    for (const m of oauth) {
      oauthMisses.push({ source: file, ...m });
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────

function report(findings, oauthMisses = []) {
  const high = findings.filter((f) => f.confidence === "high");
  const medium = findings.filter((f) => f.confidence === "medium");

  process.stdout.write(`loom secrets-doctor — scanned event log (last ${HISTORY_DAYS} days) + uncommitted tracked files\n\n`);

  if (high.length === 0 && medium.length === 0 && oauthMisses.length === 0) {
    process.stdout.write("  ✓ no token-shaped values found\n");
    process.exit(0);
  }

  if (high.length > 0) {
    process.stdout.write(`HIGH-confidence findings (${high.length}):\n`);
    for (const h of high) {
      process.stdout.write(`  ✗ ${h.source}: ${h.label} — sample ${h.sample}\n`);
    }
    process.stdout.write("\n");
  }

  if (INCLUDE_MEDIUM && medium.length > 0) {
    process.stdout.write(`MEDIUM-confidence findings (${medium.length}; many are non-secret JWTs / generic 'token=' lines):\n`);
    for (const h of medium) {
      process.stdout.write(`  ! ${h.source}: ${h.label} — sample ${h.sample}\n`);
    }
    process.stdout.write("\n");
  } else if (medium.length > 0) {
    process.stdout.write(`(${medium.length} medium-confidence finding(s) suppressed; pass --include-medium to see them)\n\n`);
  }

  if (oauthMisses.length > 0) {
    process.stdout.write(`OAuth-preference findings (${oauthMisses.length}) — long-lived keys where OAuth is available (per ADR-0028):\n`);
    for (const m of oauthMisses) {
      process.stdout.write(`  i ${m.source}: ${m.service} ${m.sample}\n`);
      process.stdout.write(`     → ${m.oauth_alternative}\n`);
      process.stdout.write(`     reason: ${m.rationale}\n`);
    }
    process.stdout.write("\n");
  }

  if (high.length > 0) {
    process.stdout.write("Remediation: rotate the exposed credential, scrub the source location, and re-run.\n");
    process.exit(1);
  }
  process.exit(0);
}
