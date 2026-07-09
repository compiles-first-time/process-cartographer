#!/usr/bin/env node
// `loom skeleton-amend` — proposes additions / removals to the project's
// skeleton based on what `discovery/requirements.md` actually says.
//
// Per ADR-0026 / L8.
//
// **Proposes, never applies.** Output is a markdown file at
// `lessons-learned/skeleton-amendment-proposals/<YYYY-MM-DD>-proposal.md`
// for the user to review. Constitution-as-text: the system proposes;
// the user decides; the user runs the resulting commands.
//
// MVP heuristic for v0.5: keyword scan over requirements.md vs. the
// specialist registry manifest. v0.6+ can extend with deeper NFR/risk
// analysis once we see the heuristic in real use.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { loadRegistry } from "./registry-loader.mjs";

const ROOT = process.cwd();
const REQ = path.join(ROOT, "discovery", "requirements.md");
const RISK = path.join(ROOT, "discovery", "risk-register.md");
const OUT_DIR = path.join(ROOT, "lessons-learned", "skeleton-amendment-proposals");

await main();

async function main() {
  if (!existsSync(REQ)) {
    process.stderr.write("error: discovery/requirements.md is missing. Run scripts/discover.{sh,ps1} first.\n");
    process.exit(1);
  }
  const requirementsText = await fs.readFile(REQ, "utf8");
  const riskText = existsSync(RISK) ? await fs.readFile(RISK, "utf8") : "";
  const haystack = `${requirementsText}\n${riskText}`.toLowerCase();

  const specialists = await loadRegistry(ROOT);
  const proposals = [];

  for (const s of specialists) {
    if (!s.triggers || !Array.isArray(s.triggers.patterns)) continue;
    let matched = false;
    for (const p of s.triggers.patterns) {
      try {
        const re = new RegExp(p, "i");
        if (re.test(haystack)) {
          matched = true;
          break;
        }
      } catch {
        // skip invalid regex
      }
    }
    if (matched && !isInstantiated(s.name)) {
      proposals.push({
        kind: "add-specialist",
        target: `agents/specialists/${s.name}/`,
        rationale: `requirements / risk register mention this domain; specialist exists in registry as \`${s.name}\` (${s.summary || ""})`,
        suggested_action: `Override / customize the registry specialist by creating agents/specialists/${s.name}/SKILL.md with \`extends: _registry/${s.name}\` in frontmatter (per ADR-0023).`,
      });
    }
  }

  // Quick-scan-derived: if compliance regime is set and the corresponding
  // critic checklist isn't being reviewed by anyone, propose surfacing.
  const quickScan = path.join(ROOT, "discovery", "quick-scan.md");
  if (existsSync(quickScan)) {
    const qs = (await fs.readFile(quickScan, "utf8")).toLowerCase();
    const regimes = ["gdpr", "hipaa", "soc2", "pci", "ferpa", "ccpa"];
    for (const r of regimes) {
      if (qs.includes(r)) {
        proposals.push({
          kind: "review-checklist",
          target: `observability/eval-suite/critic-checklists/compliance.md`,
          rationale: `quick-scan declares ${r.toUpperCase()} regime; Critic should review compliance.md against requirements.md`,
          suggested_action: `Dispatch Agent(subagent_type="critic") with the compliance.md checklist + this project's requirements.md / risk-register.md.`,
        });
      }
    }
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const out = path.join(OUT_DIR, `${date}-proposal.md`);
  await fs.writeFile(out, renderProposal(proposals, date), "utf8");
  process.stdout.write(`wrote ${path.relative(ROOT, out)} (${proposals.length} proposal${proposals.length === 1 ? "" : "s"})\n`);
  if (proposals.length === 0) {
    process.stdout.write("  no skeleton amendments proposed based on current discovery artifacts.\n");
  }
}

function isInstantiated(name) {
  // A specialist is "instantiated" if a project-local SKILL.md exists at
  // agents/specialists/<name>/SKILL.md (i.e., the user has chosen to use it).
  return existsSync(path.join(ROOT, "agents", "specialists", name, "SKILL.md"));
}

function renderProposal(proposals, date) {
  if (proposals.length === 0) {
    return `# Skeleton amendment proposal — ${date}

No amendments proposed. Discovery artifacts do not mention any specialist
domains beyond what is already instantiated, and no compliance regime is
declared in quick-scan.md.

Re-run \`scripts/lib/skeleton-amend.mjs\` after updates to \`discovery/\`.
`;
  }
  const lines = [
    `# Skeleton amendment proposal — ${date}`,
    "",
    "> **Proposed, not applied.** Per [ADR-0026](../../adr/0026-discovery-gate.md). Constitution-as-text: Loom proposes; the user decides; the user runs the resulting commands.",
    "",
    `${proposals.length} proposal${proposals.length === 1 ? "" : "s"} based on discovery artifacts at \`discovery/\`.`,
    "",
    "| # | Kind | Target | Rationale | Suggested action |",
    "|---|---|---|---|---|",
  ];
  proposals.forEach((p, i) => {
    lines.push(
      `| ${i + 1} | \`${p.kind}\` | \`${p.target}\` | ${escapePipe(p.rationale)} | ${escapePipe(p.suggested_action)} |`
    );
  });
  lines.push("");
  lines.push("## Review workflow");
  lines.push("");
  lines.push("1. Read each proposal.");
  lines.push("2. Decide: accept (run the suggested action) / reject (record reason here) / defer.");
  lines.push("3. Update the rightmost column with your decision + date.");
  lines.push("4. Keep this file (lessons-learned/ is append-only).");
  lines.push("");
  return lines.join("\n") + "\n";
}

function escapePipe(s) {
  return String(s || "").replace(/\|/g, "\\|");
}
