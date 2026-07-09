#!/usr/bin/env node
// `loom eval-subagents` — for each canonical prompt at
// observability/eval-suite/subagents/<name>.md, dispatches the prompt to
// the subagent via the `claude` CLI, captures the response, and writes
// observability/eval-suite/runs/YYYY-MM-DD/<name>.md for human grading.
//
// Per ADR-0021.
//
// Requires the `claude` CLI on PATH. The runner does NOT grade — grading
// is human, against the marker_behaviors in each canonical prompt file.
//
// Usage:
//   node scripts/lib/eval-subagents.mjs              # run all
//   node scripts/lib/eval-subagents.mjs critic       # run one
//   node scripts/lib/eval-subagents.mjs --dry-run    # print plan, don't dispatch

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const EVAL_DIR = path.join(ROOT, "observability", "eval-suite", "subagents");
const RUNS_DIR = path.join(ROOT, "observability", "eval-suite", "runs");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const FILTER = args.find((a) => !a.startsWith("-"));

await main();

async function main() {
  if (!existsSync(EVAL_DIR)) {
    process.stderr.write(`error: ${EVAL_DIR} does not exist\n`);
    process.exit(2);
  }

  const cliOk = ensureClaudeCli();
  if (!cliOk && !DRY) {
    process.stderr.write(
      "error: `claude` CLI not on PATH. Install Claude Code's CLI or run with --dry-run.\n" +
        "See https://claude.com/claude-code for installation instructions.\n"
    );
    process.exit(2);
  }

  const files = (await fs.readdir(EVAL_DIR))
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .filter((f) => !FILTER || f === `${FILTER}.md`);

  if (files.length === 0) {
    process.stderr.write(`error: no eval files match filter "${FILTER}"\n`);
    process.exit(2);
  }

  const today = new Date().toISOString().slice(0, 10);
  const runDir = path.join(RUNS_DIR, today);
  await fs.mkdir(runDir, { recursive: true });

  process.stdout.write(`loom eval-subagents — ${files.length} eval(s), output: ${runDir}\n\n`);

  for (const f of files) {
    const evalPath = path.join(EVAL_DIR, f);
    const text = await fs.readFile(evalPath, "utf8");
    const { subagent, canonical_prompt: prompt } = parseFrontmatter(text);
    if (!subagent || !prompt) {
      process.stderr.write(`  ✗ ${f}: missing subagent or canonical_prompt in frontmatter\n`);
      continue;
    }

    process.stdout.write(`  → ${subagent}\n`);
    if (DRY) {
      process.stdout.write(`    DRY-RUN: would dispatch prompt (${prompt.length} chars) to subagent\n`);
      continue;
    }

    const startTs = Date.now();
    const result = spawnSync(
      "claude",
      ["--print", "--agent", subagent, prompt],
      { cwd: ROOT, encoding: "utf8" }
    );
    const durationMs = Date.now() - startTs;

    const captured = renderCapture({
      subagent,
      prompt,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      exitCode: result.status,
      durationMs,
      ranAt: new Date().toISOString(),
      evalSource: path.relative(ROOT, evalPath),
    });
    const outPath = path.join(runDir, `${subagent}.md`);
    await fs.writeFile(outPath, captured, "utf8");
    process.stdout.write(`    captured: ${path.relative(ROOT, outPath)} (exit ${result.status}, ${(durationMs / 1000).toFixed(1)}s)\n`);
  }

  process.stdout.write(`\nGrading: open each ${path.relative(ROOT, runDir)}/<subagent>.md and grade against marker_behaviors in observability/eval-suite/subagents/<subagent>.md.\n`);
  process.exit(0);
}

function ensureClaudeCli() {
  const probe = spawnSync("claude", ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]+?)\n---/);
  if (!m) return {};
  const yaml = m[1];
  const out = {};
  // Minimal: `key: value` on a single line; `key: |\n  multiline` block.
  const lines = yaml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const single = line.match(/^(\w+):\s*(.*)$/);
    if (!single) continue;
    const key = single[1];
    const val = single[2];
    if (val === "|") {
      // Multiline block — collect indented lines.
      const block = [];
      let j = i + 1;
      while (j < lines.length && /^\s{2,}/.test(lines[j])) {
        block.push(lines[j].replace(/^\s{2}/, ""));
        j++;
      }
      out[key] = block.join("\n").trim();
      i = j - 1;
    } else {
      out[key] = val.trim();
    }
  }
  return out;
}

function renderCapture({ subagent, prompt, stdout, stderr, exitCode, durationMs, ranAt, evalSource }) {
  return [
    "---",
    `subagent: ${subagent}`,
    `ran_at: ${ranAt}`,
    `exit_code: ${exitCode}`,
    `duration_ms: ${durationMs}`,
    `eval_source: ${evalSource}`,
    "---",
    "",
    `# ${subagent} — capture`,
    "",
    "> Grade against the `marker_behaviors:` in the eval source. Pass / Partial / Fail per the rubric in that file.",
    "",
    "## Prompt",
    "",
    "```",
    prompt,
    "```",
    "",
    "## Response (stdout)",
    "",
    "```",
    stdout.trim() || "(empty)",
    "```",
    "",
    "## Stderr (if any)",
    "",
    "```",
    stderr.trim() || "(empty)",
    "```",
    "",
    "## Grade",
    "",
    "*(human-fill: Pass | Partial | Fail; mark each marker_behavior; notes below)*",
    "",
  ].join("\n");
}
