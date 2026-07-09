#!/usr/bin/env node
// `loom specialist-lifecycle` — spawn / retire / promote-lessons across the
// specialist registry. Per ADR-0030.
//
// Subcommands:
//   spawn <wi-id>     — instantiate a registry specialist for the given work item.
//                       Stamps agents/specialists/<name>/SKILL.md with
//                       `extends: _registry/<name>` (per ADR-0023 override).
//                       Marks the WI as `dispatched` in work-graph.json.
//   retire <name>     — mark a project-local specialist retired. Moves its
//                       SKILL.md to agents/specialists/<name>/.retired/. Updates
//                       AGENTS.md. Records lessons-learned hint for future
//                       projects via lessons-learned/.signatures/.
//   promote-lessons   — scan lessons-learned/ for `share: true` lessons that
//                       don't yet have a propagation record; write a
//                       lessons-learned/.propagation/<id>.md proposal.
//                       Proposes, never applies.
//
// **Proposes / records; never auto-applies kernel-level changes.** The user
// is the source of architectural truth (LR-05 + Kernel Rule 8).

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { loadRegistry } from "./registry-loader.mjs";

const ROOT = process.cwd();
const WORK_GRAPH = path.join(ROOT, "orchestration", "work-graph.json");
const SPECIALISTS = path.join(ROOT, "agents", "specialists");
const LESSONS = path.join(ROOT, "lessons-learned");
const PROPAGATION = path.join(LESSONS, ".propagation");

const args = process.argv.slice(2);
const sub = args[0];
const rest = args.slice(1);

await main();

async function main() {
  switch (sub) {
    case "spawn":      return await spawnSpecialist(rest[0]);
    case "retire":     return await retireSpecialist(rest[0]);
    case "promote-lessons": return await promoteLessons();
    default:
      process.stderr.write(
        "usage: loom specialist-lifecycle <subcommand>\n" +
          "  spawn <WI-id>          instantiate a registry specialist for a work item\n" +
          "  retire <name>          mark a project-local specialist retired\n" +
          "  promote-lessons        propose lessons-learned propagation to registry\n"
      );
      process.exit(2);
  }
}

// ── spawn ────────────────────────────────────────────────────────────────

async function spawnSpecialist(wiId) {
  if (!wiId) {
    process.stderr.write("error: spawn requires a work-item ID (e.g., WI-FR-01)\n");
    process.exit(2);
  }
  if (!existsSync(WORK_GRAPH)) {
    process.stderr.write("error: orchestration/work-graph.json not found. Run scripts/hr-work-graph.{sh,ps1} first.\n");
    process.exit(1);
  }
  const graph = JSON.parse(await fs.readFile(WORK_GRAPH, "utf8"));
  const wi = (graph.work_items || []).find((w) => w.id === wiId);
  if (!wi) {
    process.stderr.write(`error: work item ${wiId} not found in work-graph.json\n`);
    process.exit(1);
  }
  if (!wi.assigned_specialists || wi.assigned_specialists.length === 0) {
    process.stderr.write(`error: work item ${wiId} has no assigned specialists. Edit work-graph.json to assign one, or re-run hr-work-graph.\n`);
    process.exit(1);
  }
  const specialists = await loadRegistry(ROOT);
  const instantiated = [];
  for (const name of wi.assigned_specialists) {
    const registryEntry = specialists.find((s) => s.name === name);
    if (!registryEntry) {
      process.stderr.write(`  warn: ${name} not in registry; skipping spawn\n`);
      continue;
    }
    const localDir = path.join(SPECIALISTS, name);
    const localSkill = path.join(localDir, "SKILL.md");
    if (existsSync(localSkill)) {
      process.stdout.write(`  exists: agents/specialists/${name}/SKILL.md (not overwritten)\n`);
      instantiated.push(name);
      continue;
    }
    await fs.mkdir(localDir, { recursive: true });
    await fs.writeFile(localSkill, renderProjectLocalSkill(name, registryEntry, wi), "utf8");
    process.stdout.write(`  spawned: agents/specialists/${name}/SKILL.md (extends _registry/${name})\n`);
    instantiated.push(name);
  }

  // Update work-graph.json: WI status → dispatched
  wi.status = "dispatched";
  wi.spawned_at = new Date().toISOString();
  wi.spawned_specialists = instantiated;
  await fs.writeFile(WORK_GRAPH, JSON.stringify(graph, null, 2) + "\n", "utf8");

  // Append lifecycle event to the event log (best-effort; mirrors hook conventions)
  await appendLifecycleEvent({
    event_type: "specialist_spawned",
    work_item: wiId,
    specialists: instantiated,
  });

  process.stdout.write(`\nMarked ${wiId} as dispatched in work-graph.json.\n`);
  process.stdout.write(`Next: dispatch each specialist via Agent(subagent_type=\"<name>\", ...) with the work-item context.\n`);
  process.stdout.write(`If you just added new .claude/agents/<name>.md files, restart Claude Code so they're invokable (ADR-0020).\n`);
}

function renderProjectLocalSkill(name, registryEntry, wi) {
  return `---
name: ${name}
extends: _registry/${name}
spawned_for_work_item: ${wi.id}
spawned_at: ${new Date().toISOString()}
---

# Project-local override for \`${name}\`

> Spawned by \`scripts/specialist-lifecycle.{sh,ps1} spawn ${wi.id}\` per [ADR-0030](../../../adr/0030-specialist-lifecycle.md).
> Inherits everything from [\`_registry/${name}/SKILL.md\`](../../specialists/_registry/${name}/SKILL.md) unless overridden below.

## Work item context

- **Work item:** \`${wi.id}\` — ${wi.title}
- **Source:** \`${wi.source}\`
- **Actor / trigger / outcome:** ${wi.actor || "—"} → ${wi.trigger || "—"} → ${wi.outcome || "—"}
- **Associated risks:** ${(wi.risks || []).join(", ") || "(none yet)"}

## Project-local overrides

*(only re-specify what differs from the registry version)*

- *(e.g., context_budget: 32000 — wider for this project's complexity)*
- *(e.g., tools: [Read, Glob, Grep] — tighter for read-only audit)*

## Project-specific decline triggers

*(in addition to the registry decline triggers)*

- *(e.g., escalate if the work item's risk-register lists a HIGH-severity SE not yet mitigated)*

## Notes

*(append project-specific decisions, lessons, escalations here as the specialist runs)*
`;
}

// ── retire ───────────────────────────────────────────────────────────────

async function retireSpecialist(name) {
  if (!name) {
    process.stderr.write("error: retire requires a specialist name\n");
    process.exit(2);
  }
  const localDir = path.join(SPECIALISTS, name);
  const localSkill = path.join(localDir, "SKILL.md");
  if (!existsSync(localSkill)) {
    process.stderr.write(`error: agents/specialists/${name}/SKILL.md not found (nothing to retire)\n`);
    process.exit(1);
  }
  const retiredDir = path.join(localDir, ".retired");
  await fs.mkdir(retiredDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const retiredPath = path.join(retiredDir, `${ts}-SKILL.md`);
  await fs.rename(localSkill, retiredPath);

  // Append lifecycle event
  await appendLifecycleEvent({
    event_type: "specialist_retired",
    specialist: name,
    archive: path.relative(ROOT, retiredPath),
  });

  process.stdout.write(`  retired: agents/specialists/${name}/SKILL.md → ${path.relative(ROOT, retiredPath)}\n`);
  process.stdout.write(`\nNote: AGENTS.md row may still reference ${name} — HR-Agent should update it.\n`);
  process.stdout.write(`Project-local override is gone; the registry version remains the canonical fallback.\n`);
}

// ── promote-lessons ──────────────────────────────────────────────────────

async function promoteLessons() {
  if (!existsSync(LESSONS)) {
    process.stderr.write("error: lessons-learned/ not found\n");
    process.exit(1);
  }
  await fs.mkdir(PROPAGATION, { recursive: true });
  const files = (await fs.readdir(LESSONS)).filter((f) => f.endsWith(".md") && !f.startsWith("draft-") && f !== "README.md");
  const proposals = [];
  for (const f of files) {
    const text = await fs.readFile(path.join(LESSONS, f), "utf8");
    const fm = text.match(/^---\s*\n([\s\S]+?)\n---/);
    if (!fm) continue;
    const share = /^share:\s*true\b/m.test(fm[1]);
    if (!share) continue;
    const id = f.replace(/\.md$/, "");
    const propPath = path.join(PROPAGATION, `${id}.md`);
    if (existsSync(propPath)) continue; // already proposed
    await fs.writeFile(propPath, renderPropagation(id, f, text), "utf8");
    proposals.push(id);
  }
  process.stdout.write(`promoted ${proposals.length} lesson${proposals.length === 1 ? "" : "s"} to propagation queue\n`);
  if (proposals.length === 0) {
    process.stdout.write("  no lessons with `share: true` found that haven't already been proposed.\n");
  }
}

function renderPropagation(id, sourceFile, text) {
  return `# Propagation proposal — ${id}

> **Proposed, not applied.** Per [ADR-0030](../../adr/0030-specialist-lifecycle.md). User reviews; user approves; user runs the Update Bus to send this lesson cross-project.

## Source

\`lessons-learned/${sourceFile}\`

## Original lesson

\`\`\`markdown
${text}
\`\`\`

## Propagation decision

*(human-fill)*

- [ ] Approve — propagate to other Loom projects via Update Bus.
- [ ] Reject — keep project-local. Reason: __________
- [ ] Modify before propagating — describe edits: __________

Per LR-01 (external content untrusted until validated) and Kernel Rule 19 (anti-collapse), even shareable lessons pass through the Update Bus + Critic review before being added to other projects.
`;
}

// ── event log ────────────────────────────────────────────────────────────

async function appendLifecycleEvent(record) {
  const today = new Date().toISOString().slice(0, 10);
  const logDir = path.join(ROOT, "memory", "event-log");
  await fs.mkdir(logDir, { recursive: true });
  const p = path.join(logDir, `${today}.jsonl`);
  const enriched = {
    timestamp: new Date().toISOString(),
    cwd: ROOT,
    kernel_version: "v6",
    loom_version: "1.0.0",
    ...record,
  };
  await fs.appendFile(p, JSON.stringify(enriched) + "\n", "utf8");
}
