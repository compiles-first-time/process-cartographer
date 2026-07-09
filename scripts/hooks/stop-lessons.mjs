// Loom lessons-learned auto-suggestion (PR-4 / E).
//
// Called from stop.mjs at session end. Scans today's JSONL for tool failures
// (exit_code != 0 OR error_signature != null), groups by signature, and writes
// a draft lessons-learned/draft-YYYY-MM-DD-<slug>.md for any novel signature.
//
// Drafts are NEVER auto-promoted. Promotion is manual: a human renames the
// file from `draft-...` to `YYYY-MM-DD-...` and removes `status: draft` from
// the frontmatter, per Kernel Rule 22 (human in the loop on memory writes).

import { promises as fs } from "node:fs";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { todayLogPath, PROJECT_ROOT } from "./_lib.mjs";

const LESSONS_DIR = path.join(PROJECT_ROOT, "lessons-learned");
const SIG_DIR = path.join(LESSONS_DIR, ".signatures");

export default async function suggestLessons({ sessionId }) {
  if (!existsSync(LESSONS_DIR)) return { suggested: 0, skipped: 0 };
  if (!existsSync(SIG_DIR)) mkdirSync(SIG_DIR, { recursive: true });

  let logText = "";
  try {
    logText = await fs.readFile(todayLogPath(), "utf8");
  } catch {
    return { suggested: 0, skipped: 0 };
  }

  const failures = new Map(); // signature -> { tool, errorPreview, count, firstTs, lastTs }
  for (const line of logText.split("\n")) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.session_id && rec.session_id !== sessionId) continue;
    if (rec.event_type !== "tool_result") continue;
    if (!rec.error_signature) continue;

    const cur = failures.get(rec.error_signature) || {
      tool: rec.tool || "unknown",
      errorPreview: rec.error_preview || "",
      count: 0,
      firstTs: rec.timestamp,
      lastTs: rec.timestamp,
    };
    cur.count++;
    cur.lastTs = rec.timestamp;
    failures.set(rec.error_signature, cur);
  }

  let suggested = 0;
  let skipped = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const [sig, info] of failures) {
    const sigPath = path.join(SIG_DIR, `${sig}.txt`);
    // Existing signature ⇒ already covered, skip.
    if (existsSync(sigPath)) {
      skipped++;
      continue;
    }
    // Also check that no draft for this signature exists already today.
    const slug = makeSlug(info);
    const draftPath = path.join(LESSONS_DIR, `draft-${today}-${slug}.md`);
    if (existsSync(draftPath)) {
      skipped++;
      continue;
    }

    await fs.writeFile(draftPath, renderDraft({ sig, slug, today, info, sessionId }), "utf8");
    await fs.writeFile(
      sigPath,
      `Auto-suggested ${today} from session ${sessionId}. Draft: lessons-learned/draft-${today}-${slug}.md\n`,
      "utf8"
    );
    suggested++;
  }

  return { suggested, skipped };
}

function makeSlug(info) {
  const base = `${info.tool}-${info.errorPreview}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return base || "unclassified";
}

function renderDraft({ sig, slug, today, info, sessionId }) {
  return `---
date: ${today}
agent: stop-hook-autosuggest
severity: medium
share: false
status: draft
signature: ${sig}
auto_suggested: true
auto_suggested_from_session: ${sessionId}
auto_suggested_observation_count: ${info.count}
---

# Draft lesson — ${info.tool} failure (auto-suggested)

> **Auto-suggested by the Stop hook (PR-4 / E).** A human must (a) verify this is a real lesson, (b) fill in the sections below, (c) rename this file from \`draft-${today}-${slug}.md\` to \`${today}-${slug}.md\`, and (d) remove the \`status: draft\` and \`auto_suggested\` keys from the frontmatter. **Do not auto-promote.** Kernel Rule 22 requires human review of memory writes.

## What happened

The tool \`${info.tool}\` returned an error this session. First observed at ${info.firstTs}; last at ${info.lastTs}; observed ${info.count} time(s).

Error preview (first ~240 chars, paths/timestamps redacted):

\`\`\`
${info.errorPreview || "(no preview captured)"}
\`\`\`

## Why it happened

*(fill in — what was the root cause?)*

## What we did

*(fill in — workaround, fix, or escalation)*

## What we'd do differently

*(fill in — the heuristic future agents should apply)*

## Related

- Session ID: \`${sessionId}\`
- Error signature: \`${sig}\` (kept at \`.signatures/${sig}.txt\`)
- Event log: see \`memory/event-log/${today}.jsonl\` for the full \`tool_result\` records with this signature.
`;
}
