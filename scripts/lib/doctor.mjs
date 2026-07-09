#!/usr/bin/env node
// `loom doctor` — cross-checks a Loom project for v0.2+ conformance.
//
// Exit codes:
//   0  all checks passed (warnings allowed)
//   1  one or more hard checks failed
//
// Per ADR-0015 (foundational), extended by ADR-0017 (LR-02 / constitution
// coverage), ADR-0022 (template conformance), ADR-0023 (bidirectional
// ADR links), ADR-0033 (MCP-vs-CLI alignment check), ADR-0034 (planned
// specialist-invocation-discipline check), and ADR-0044 (skill-verifier-declared).

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const FIX = args.has("--fix");

const results = [];
function hard(name, ok, detail) {
  results.push({ name, level: "hard", ok, detail });
}
function soft(name, ok, detail) {
  results.push({ name, level: "soft", ok, detail });
}

await main();

async function main() {
  await checkPlaceholders();
  await checkSizeCaps();
  await checkProposedAdrsInClaude();
  await checkMcpAlignment();
  await checkSubagentsParse();
  await checkEventLogCoverage();
  await checkConstitutionCoverage();
  await checkAdrTemplateConformance();
  await checkBidirectionalAdrLinks();
  await checkHandoffFreshness();
  await checkPlaybookFreshness();
  await checkSkeleton();
  await checkPs1Bom();
  await checkSkillVerifiers();
  await checkAgentModelTiers();
  await checkModelIdCurrent();

  report();
}

// ── Checks ───────────────────────────────────────────────────────────────

async function checkPlaceholders() {
  const FILES = [
    "README.md",
    "CLAUDE.md",
    "AGENTS.md",
    "loom-spec.md",
    "memory/self-knowledge.md",
    "tools/mcp-servers/config.yaml",
    "observability/langfuse-config.yaml",
  ];
  const tokens = ["<PROJECT_NAME>", "<USER_NAME>", "<YYYY-MM-DD>"];
  const hits = [];
  for (const rel of FILES) {
    const p = path.join(ROOT, rel);
    if (!existsSync(p)) continue;
    const text = await fs.readFile(p, "utf8");
    const found = tokens.filter((t) => text.includes(t));
    if (found.length) hits.push({ file: rel, tokens: found });
  }
  if (hits.length === 0) return hard("placeholders", true, "no <PLACEHOLDER> tokens remain in stamped files");

  if (FIX) {
    return hard("placeholders", false, `--fix cannot guess project/user names; run scripts/bootstrap.{sh,ps1} with the right args. Hits: ${JSON.stringify(hits)}`);
  }
  hard("placeholders", false, `unstamped tokens remain in ${hits.length} file(s): ${hits.map((h) => h.file).join(", ")}`);
}

async function checkSizeCaps() {
  const caps = [
    { rel: "CLAUDE.md", capBytes: 10 * 1024, label: "CLAUDE.md ≤ 10 KB" },
    { rel: "AGENTS.md", capBytes: 5 * 1024, label: "AGENTS.md ≤ 5 KB" },
  ];
  for (const { rel, capBytes, label } of caps) {
    const p = path.join(ROOT, rel);
    if (!existsSync(p)) {
      hard(label, false, `${rel} missing`);
      continue;
    }
    const bytes = (await fs.stat(p)).size;
    if (bytes <= capBytes) hard(label, true, `${bytes} bytes`);
    else hard(label, false, `${bytes} bytes > ${capBytes}`);
  }
}

async function checkProposedAdrsInClaude() {
  const adrDir = path.join(ROOT, "adr");
  if (!existsSync(adrDir)) return hard("proposed-adrs-in-claude", false, "adr/ directory missing");
  const files = (await fs.readdir(adrDir)).filter((f) => /^\d{4}-.+\.md$/.test(f));
  const proposed = [];
  for (const f of files) {
    // ADR-0000 is the *template* — its Status line is a literal enumeration
    // "Proposed | Accepted | Superseded by ADR-XXXX", not a real status.
    if (/^0000-/.test(f)) continue;
    const text = await fs.readFile(path.join(adrDir, f), "utf8");
    const m = text.match(/\*\*Status:\*\*\s*([^\n]+)/);
    if (!m) continue;
    // Real Proposed status starts with "Proposed" and does NOT contain "Accepted"
    // (the template-0000 enumeration "Proposed | Accepted | Superseded ..." would match).
    const status = m[1].trim();
    if (/^Proposed\b/i.test(status) && !/\bAccepted\b/i.test(status)) {
      const numMatch = f.match(/^(\d{4})/);
      if (numMatch) proposed.push(numMatch[1]);
    }
  }
  const claudePath = path.join(ROOT, "CLAUDE.md");
  if (!existsSync(claudePath)) return hard("proposed-adrs-in-claude", false, "CLAUDE.md missing");
  const claudeText = await fs.readFile(claudePath, "utf8");

  // Look for the "ADRs in flight" section.
  const flightIdx = claudeText.indexOf("ADRs in flight");
  const flightBlock = flightIdx >= 0 ? claudeText.slice(flightIdx, flightIdx + 1500) : "";

  const missing = proposed.filter((n) => !flightBlock.includes(n));
  if (proposed.length === 0) return hard("proposed-adrs-in-claude", true, "no Proposed ADRs");
  if (missing.length === 0) return hard("proposed-adrs-in-claude", true, `${proposed.length} Proposed ADR(s) all listed in CLAUDE.md`);
  hard("proposed-adrs-in-claude", false, `Proposed ADRs missing from CLAUDE.md "ADRs in flight": ${missing.join(", ")}`);
}

async function checkMcpAlignment() {
  const gen = path.join(ROOT, "scripts", "lib", "mcp-yaml-to-settings.mjs");
  if (!existsSync(gen)) return hard("mcp-yaml-json-alignment", false, "scripts/lib/mcp-yaml-to-settings.mjs missing");
  const result = spawnSync("node", [gen, "--check"], { cwd: ROOT, encoding: "utf8" });
  if (result.status === 0) return hard("mcp-yaml-json-alignment", true, "tools/mcp-servers/config.yaml ↔ .claude/settings.json#mcpServers in sync");
  if (FIX) {
    const fix = spawnSync("node", [gen], { cwd: ROOT, encoding: "utf8" });
    if (fix.status === 0) return hard("mcp-yaml-json-alignment", true, "regenerated via --fix");
    return hard("mcp-yaml-json-alignment", false, `--fix failed: ${fix.stderr || fix.stdout}`);
  }
  hard("mcp-yaml-json-alignment", false, `drift; run with --fix or \`node scripts/lib/mcp-yaml-to-settings.mjs\`. ${result.stderr.trim() || result.stdout.trim()}`);
}

async function checkSubagentsParse() {
  const dir = path.join(ROOT, ".claude", "agents");
  if (!existsSync(dir)) return hard("subagents-present", false, ".claude/agents/ missing");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md"));
  if (files.length < 6) return hard("subagents-present", false, `expected ≥ 6 subagents, found ${files.length}`);
  const bad = [];
  for (const f of files) {
    const text = await fs.readFile(path.join(dir, f), "utf8");
    if (!/^---\s*\n[\s\S]+?\n---/.test(text)) bad.push(`${f}: missing or malformed frontmatter`);
    if (!/^name:\s*\S+/m.test(text)) bad.push(`${f}: missing 'name:' field`);
    if (!/^description:\s*\S+/m.test(text)) bad.push(`${f}: missing 'description:' field`);
  }
  if (bad.length) return hard("subagents-present", false, bad.join("; "));
  hard("subagents-present", true, `${files.length} subagents, all parse-clean`);
}

async function checkEventLogCoverage() {
  // Soft: ratio of commit days in last 14 with at least one event-log entry.
  const log = spawnSync(
    "git",
    ["log", "--since=14.days", "--format=%cs"],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (log.status !== 0) return soft("event-log-coverage", true, "git history unavailable (skipped)");
  const commitDays = new Set((log.stdout || "").trim().split("\n").filter(Boolean));
  if (commitDays.size === 0) return soft("event-log-coverage", true, "no commits in last 14 days (skipped)");
  const eventDir = path.join(ROOT, "memory", "event-log");
  let coveredDays = new Set();
  if (existsSync(eventDir)) {
    const files = (await fs.readdir(eventDir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));
    coveredDays = new Set(files.map((f) => f.replace(".jsonl", "")));
  }
  const covered = [...commitDays].filter((d) => coveredDays.has(d)).length;
  const total = commitDays.size;
  const ratio = total ? covered / total : 1;
  const detail = `${covered}/${total} commit days have an event-log file (last 14 days)`;
  if (ratio >= 0.5) soft("event-log-coverage", true, detail);
  else soft("event-log-coverage", false, `${detail} — under 50%; hooks may have been disabled`);
}

async function checkConstitutionCoverage() {
  // Soft check (LR-02 / ADR-0017): for each session in the last 14 days that
  // emitted a production_mutation_attempted event, was there a prior
  // constitution-service claim in the same session?
  const eventDir = path.join(ROOT, "memory", "event-log");
  if (!existsSync(eventDir)) return soft("constitution-coverage", true, "no event log (skipped)");
  const files = (await fs.readdir(eventDir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));
  // last 14 by name sort
  files.sort();
  const recent = files.slice(-14);
  const sessions = new Map(); // session_id -> { mutated, constitutionClaimed }
  for (const f of recent) {
    let text;
    try {
      text = await fs.readFile(path.join(eventDir, f), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      const sid = rec.session_id;
      if (!sid) continue;
      const cur = sessions.get(sid) || { mutated: false, constitutionClaimed: false };
      if (rec.event_type === "production_mutation_attempted") cur.mutated = true;
      if (rec.event_type === "claim") {
        const agent = String(rec.agent || "").toLowerCase();
        if (agent === "constitution-service" || agent.endsWith("/constitution-service")) {
          cur.constitutionClaimed = true;
        }
      }
      sessions.set(sid, cur);
    }
  }
  let violations = 0;
  for (const v of sessions.values()) {
    if (v.mutated && !v.constitutionClaimed) violations++;
  }
  if (violations === 0) {
    soft("constitution-coverage", true, "no sessions mutated prod without a constitution-service claim (last 14 days)");
  } else {
    soft("constitution-coverage", false, `${violations} session(s) mutated prod without a constitution-service claim (LR-02). Grep memory/event-log/ for production_mutation_attempted to find them.`);
  }
}

async function checkAdrTemplateConformance() {
  // Soft (LR-05 / ADR-0022): v0.4+ ADRs (≥ 0022) must have an
  // `Evidence basis` section and an `Affects / Affected by` section.
  // Pre-v0.4 ADRs (≤ 0021) predate the convention and are exempt.
  const adrDir = path.join(ROOT, "adr");
  if (!existsSync(adrDir)) return;
  const files = (await fs.readdir(adrDir)).filter((f) => /^\d{4}-.+\.md$/.test(f));
  const missing = [];
  for (const f of files) {
    const num = parseInt(f.slice(0, 4), 10);
    if (num < 22) continue; // pre-v0.4
    if (f.startsWith("0000-")) continue; // template
    const text = await fs.readFile(path.join(adrDir, f), "utf8");
    const lacks = [];
    if (!/## Evidence basis/m.test(text)) lacks.push("Evidence basis");
    if (!/## Affects \/ Affected by/m.test(text)) lacks.push("Affects / Affected by");
    if (lacks.length) missing.push(`${f}: missing ${lacks.join(" + ")}`);
  }
  if (missing.length === 0) {
    soft("adr-template-conformance", true, "all v0.4+ ADRs include Evidence basis + Affects sections");
  } else {
    soft("adr-template-conformance", false, `${missing.length} ADR(s) missing required v0.4+ sections: ${missing.join("; ")}`);
  }
}

async function checkBidirectionalAdrLinks() {
  // Soft (ADR-0022 interoperability tracking): for each v0.4+ ADR with an
  // `Affects / Affected by` "This ADR affects" block, verify the named
  // downstream artifacts reference this ADR back. One-shot pass: build the
  // set of artifacts each ADR claims to affect, then grep each for the
  // ADR number.
  const adrDir = path.join(ROOT, "adr");
  if (!existsSync(adrDir)) return;
  const files = (await fs.readdir(adrDir)).filter((f) => /^\d{4}-.+\.md$/.test(f) && !f.startsWith("0000-"));
  const orphans = [];
  for (const f of files) {
    const num = parseInt(f.slice(0, 4), 10);
    if (num < 22) continue;
    const text = await fs.readFile(path.join(adrDir, f), "utf8");
    const affectsBlock = extractAffectsBlock(text);
    if (!affectsBlock) continue;
    const adrNum = `ADR-${String(num).padStart(4, "0")}`;
    for (const target of affectsBlock) {
      const targetPath = path.join(ROOT, target);
      if (!existsSync(targetPath)) {
        orphans.push(`${f} → ${target} (target file missing)`);
        continue;
      }
      const targetText = await fs.readFile(targetPath, "utf8");
      if (!targetText.includes(adrNum) && !targetText.includes(`${num}-`)) {
        orphans.push(`${f} → ${target} (no back-reference to ${adrNum})`);
      }
    }
  }
  if (orphans.length === 0) {
    soft("bidirectional-adr-links", true, "all v0.4+ ADR `Affects` links are reciprocal");
  } else {
    soft("bidirectional-adr-links", false, `${orphans.length} one-way link(s): ${orphans.slice(0, 5).join("; ")}${orphans.length > 5 ? " …" : ""}`);
  }
}

function extractAffectsBlock(text) {
  // Pull file paths from the "affects" bullet list under
  // "## Affects / Affected by". Accepts BOTH marker forms: the template
  // "**This ADR affects**" and the compact "**Affects:**" — earlier ADRs use
  // one, later ones the other. Parsing only the first silently skipped ~13
  // v0.4+ ADRs (their links went unverified). Heuristic: backticked paths.
  const sectionMatch = text.match(/##\s+Affects \/ Affected by\s*([\s\S]+?)(?=\n##\s+|\n#\s+|$)/);
  if (!sectionMatch) return null;
  const block = sectionMatch[1];
  const affectsSubsection = block.split(/\*\*(?:This ADR affects|Affects):?\*\*/)[1];
  if (!affectsSubsection) return null;
  // Stop at whichever "affected by" marker form appears.
  const upstream = affectsSubsection.split(/\*\*(?:This ADR is affected by|Affected by):?\*\*/)[0] || "";
  const paths = [];
  const re = /`([^`]+\.(?:md|mjs|js|json|yaml|sh|ps1))`/g;
  let m;
  while ((m = re.exec(upstream)) !== null) {
    const p = m[1];
    // Skip placeholders (`<file>`) and glob/brace patterns (`*/SKILL.md`,
    // `{a,b}.md`) — those name a *set*, not a single resolvable target.
    if (/[<>*{}]/.test(p)) continue;
    paths.push(p);
  }
  return paths;
}

async function checkHandoffFreshness() {
  // Per ADR-0031 §F. Soft check — surfaces a warning, never blocks.
  const handoffDir = path.join(ROOT, "handoff");
  if (!existsSync(handoffDir)) return soft("handoff-freshness", true, "no handoff/ directory (skipped)");
  const files = (await fs.readdir(handoffDir))
    .filter((f) => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f))
    .sort();
  if (files.length === 0) return soft("handoff-freshness", false, "no dated handoff documents found");
  const latest = files[files.length - 1];
  const latestDate = latest.slice(0, 10);
  const daysSince = Math.floor((Date.now() - new Date(latestDate + "T00:00:00Z").getTime()) / (24 * 3600 * 1000));

  // Commits on milestone-shaped paths since the latest handoff date.
  const log = spawnSync(
    "git",
    ["log", `--since=${latestDate}`, "--format=%H %s", "--", "adr/", "layers/", "scripts/", ".claude/", "constitution/"],
    { cwd: ROOT, encoding: "utf8" }
  );
  const milestoneCommits = (log.stdout || "")
    .split("\n")
    .filter(Boolean)
    .filter((line) => /Merge pull request|adr\/\d{4}|layers\/L\d/.test(line));

  if (daysSince > 30 && milestoneCommits.length > 0) {
    return soft("handoff-freshness", false,
      `latest handoff is ${daysSince} days old AND ${milestoneCommits.length} milestone commit(s) have landed since. Write a new handoff at handoff/${new Date().toISOString().slice(0, 10)}-<topic>.md per ADR-0031.`);
  }
  if (milestoneCommits.length >= 5) {
    return soft("handoff-freshness", false,
      `${milestoneCommits.length} milestone commits since latest handoff (${latest}). Consider writing a new handoff per ADR-0031.`);
  }
  soft("handoff-freshness", true, `latest handoff ${latest} (${daysSince} days old; ${milestoneCommits.length} milestone commits since)`);
}

async function checkPlaybookFreshness() {
  // Per ADR-0035 §C layer 1. Soft check — surfaces a warning, never blocks.
  // Scans tools/provisioning-playbooks/*.md for the frontmatter `last_verified`
  // date AND per-section `<!-- last_verified: YYYY-MM-DD -->` markers.
  // Warns when ANY date is > 90 days old. Per-section dating lets the warning
  // be precise about which slice of the playbook needs re-validation.
  const playbookDir = path.join(ROOT, "tools", "provisioning-playbooks");
  if (!existsSync(playbookDir)) return soft("playbook-freshness", true, "no playbooks present (skipped)");
  const files = (await fs.readdir(playbookDir)).filter((f) => f.endsWith(".md") && !f.startsWith("README"));
  if (files.length === 0) return soft("playbook-freshness", true, "no playbooks present (skipped)");

  const STALE_DAYS = 90;
  const now = Date.now();
  const stale = []; // [{ playbook, scope, date, days }, ...]

  for (const f of files) {
    const text = await fs.readFile(path.join(playbookDir, f), "utf8");
    // Top-of-file frontmatter (line beginning "> last_verified: YYYY-MM-DD")
    const headerMatch = text.match(/^>\s*last_verified:\s*(\d{4}-\d{2}-\d{2})/m);
    if (headerMatch) {
      const date = headerMatch[1];
      const days = Math.floor((now - new Date(date + "T00:00:00Z").getTime()) / (24 * 3600 * 1000));
      if (days > STALE_DAYS) stale.push({ playbook: f, scope: "header", date, days });
    }
    // Per-section markers
    const sectionRe = /<!--\s*last_verified:\s*(\d{4}-\d{2}-\d{2})/g;
    let m;
    while ((m = sectionRe.exec(text)) !== null) {
      const date = m[1];
      const days = Math.floor((now - new Date(date + "T00:00:00Z").getTime()) / (24 * 3600 * 1000));
      if (days > STALE_DAYS) {
        // Try to find the nearest preceding heading for context
        const before = text.slice(0, m.index);
        const headingMatch = [...before.matchAll(/^##+ (.+)$/gm)];
        const scope = headingMatch.length > 0 ? headingMatch[headingMatch.length - 1][1] : "(unknown section)";
        stale.push({ playbook: f, scope, date, days });
      }
    }
  }

  if (stale.length === 0) {
    soft("playbook-freshness", true, `${files.length} playbook(s) all verified within ${STALE_DAYS} days`);
  } else {
    const summary = stale.slice(0, 3).map((s) => `${s.playbook}/${s.scope} (${s.days}d)`).join("; ");
    const more = stale.length > 3 ? ` … and ${stale.length - 3} more` : "";
    soft(
      "playbook-freshness",
      false,
      `${stale.length} playbook section(s) stale (> ${STALE_DAYS}d): ${summary}${more}. Run scripts/validate-playbook.{sh,ps1} <platform> per ADR-0035 §C layer 3.`
    );
  }
}

async function checkSkeleton() {
  const required = [
    "CLAUDE.md",
    "AGENTS.md",
    "constitution/kernel-v6.md",
    "spec/loom-spec-v0.1-full.md",
    "tools/mcp-servers/config.yaml",
    ".claude/settings.json",
  ];
  const missing = required.filter((rel) => !existsSync(path.join(ROOT, rel)));
  if (missing.length === 0) hard("skeleton-intact", true, "core files present");
  else hard("skeleton-intact", false, `missing: ${missing.join(", ")}`);
}

async function checkPs1Bom() {
  // Soft check (R2): flag any .ps1 in scripts/ containing non-ASCII bytes without a UTF-8 BOM.
  // Files that are pure ASCII parse fine under PS 5.1 regardless; non-ASCII without BOM fail.
  const scriptsDir = path.join(ROOT, "scripts");
  if (!existsSync(scriptsDir)) return soft("ps1-bom", true, "no scripts/ directory (skipped)");
  const files = (await fs.readdir(scriptsDir)).filter((f) => f.endsWith(".ps1"));
  if (files.length === 0) return soft("ps1-bom", true, "no .ps1 files in scripts/ (skipped)");

  const flagged = [];
  for (const f of files) {
    const buf = await fs.readFile(path.join(scriptsDir, f));
    const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    if (hasBom) continue;
    const hasNonAscii = buf.some((b) => b > 127);
    if (hasNonAscii) flagged.push(f);
  }

  if (flagged.length === 0) {
    soft("ps1-bom", true, `${files.length} .ps1 file(s) checked — no non-ASCII bytes without BOM`);
  } else {
    soft(
      "ps1-bom",
      false,
      `${flagged.length} .ps1 file(s) have non-ASCII bytes but no UTF-8 BOM (will fail under PS 5.1): ${flagged.join(", ")}. Fix: prepend EF BB BF.`
    );
  }
}

async function checkSkillVerifiers() {
  // Soft check (ADR-0044): every SKILL.md under agents/specialists/_registry/
  // and agents/specialists/ (project-local) must declare a verifier_type: field
  // in its YAML frontmatter.
  const dirs = [
    path.join(ROOT, "agents", "specialists", "_registry"),
    path.join(ROOT, "agents", "specialists"),
  ];
  const missing = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(dir, entry.name, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      const text = await fs.readFile(skillPath, "utf8");
      if (!/^verifier_type:\s*\S+/m.test(text)) {
        missing.push(path.relative(ROOT, path.join(dir, entry.name, "SKILL.md")).replace(/\\/g, "/"));
      }
    }
  }
  if (missing.length === 0) {
    soft("skill-verifier-declared", true, "all SKILL.md files declare verifier_type");
  } else {
    soft(
      "skill-verifier-declared",
      false,
      `${missing.length} SKILL.md file(s) missing verifier_type (ADR-0044): ${missing.join(", ")}. Add verifier_type: <exit_code|schema_check|test_suite|human_gate|surrogate> to frontmatter.`
    );
  }
}

async function checkAgentModelTiers() {
  // Soft check (ADR-0045): every .claude/agents/*.md must declare a model: field
  // so Claude Code routes each subagent to the correct cost tier. Without it the
  // agent inherits the parent session's model (often Opus) regardless of task
  // complexity.
  const dir = path.join(ROOT, ".claude", "agents");
  if (!existsSync(dir)) return;
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md"));
  if (files.length === 0) return;
  const missing = [];
  for (const f of files) {
    const text = await fs.readFile(path.join(dir, f), "utf8");
    if (!/^model:\s*\S+/m.test(text)) missing.push(f);
  }
  if (missing.length === 0) {
    soft("agent-model-tiers", true, `${files.length} subagent(s) all declare model: tier (ADR-0045)`);
  } else {
    soft(
      "agent-model-tiers",
      false,
      `${missing.length} subagent(s) missing model: tier (ADR-0045): ${missing.join(", ")}. Add model: <id> per layers/L4-tooling.md §per-agent-model-tiers.`
    );
  }
}

async function checkModelIdCurrent() {
  // Soft check (ADR-0045 / ADR-0054 Phase 1b): every .claude/agents/*.md `model:`
  // value must be a CURRENT model ID per spec/policy/model-ids.json (the single
  // source of truth). Catches model-ID rot — e.g. a Sonnet-tier agent left on a
  // superseded generation — which otherwise degrades per-agent routing silently.
  const dir = path.join(ROOT, ".claude", "agents");
  const policyPath = path.join(ROOT, "spec", "policy", "model-ids.json");
  if (!existsSync(dir) || !existsSync(policyPath)) return;
  let policy;
  try {
    policy = JSON.parse(await fs.readFile(policyPath, "utf8"));
  } catch {
    return soft("model-id-current", false, "spec/policy/model-ids.json is unparseable");
  }
  const current = new Set(policy.current || []);
  const retired = policy.retired || {};
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md"));
  const stale = [];
  for (const f of files) {
    const text = await fs.readFile(path.join(dir, f), "utf8");
    const m = text.match(/^model:\s*(\S+)/m);
    if (!m) continue; // absence is checkAgentModelTiers' job
    const id = m[1];
    if (current.has(id)) continue;
    stale.push(`${f}: ${id}${retired[id] ? ` -> use ${retired[id]}` : " (not in current set)"}`);
  }
  let ttlWarn = "";
  if (policy.last_verified) {
    const days = Math.floor((Date.now() - new Date(policy.last_verified + "T00:00:00Z").getTime()) / 86400000);
    const ttl = policy.ttl_days || 120;
    if (days > ttl) ttlWarn = ` (model-ids.json last verified ${days}d ago > ${ttl}d TTL — re-verify against the current lineup)`;
  }
  if (stale.length === 0 && !ttlWarn) {
    soft("model-id-current", true, `${files.length} subagent(s) all on current model IDs (spec/policy/model-ids.json)`);
  } else {
    soft(
      "model-id-current",
      false,
      `${stale.length} subagent(s) on stale model IDs${stale.length ? ": " + stale.join("; ") : ""}${ttlWarn}. Fix the agent model: field or update spec/policy/model-ids.json.`
    );
  }
}

// ── Report ───────────────────────────────────────────────────────────────

function report() {
  let hardFailed = 0;
  let softFailed = 0;
  for (const r of results) {
    const mark = r.ok ? "✓" : r.level === "hard" ? "✗" : "!";
    const tag = r.level === "hard" ? "" : " (warn)";
    process.stdout.write(`  ${mark} ${r.name}${tag}: ${r.detail}\n`);
    if (!r.ok) {
      if (r.level === "hard") hardFailed++;
      else softFailed++;
    }
  }
  process.stdout.write(
    `\n${hardFailed === 0 && softFailed === 0 ? "All checks passed." : `${hardFailed} hard failure(s), ${softFailed} warning(s).`}\n`
  );
  process.exit(hardFailed > 0 ? 1 : 0);
}
