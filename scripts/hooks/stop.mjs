#!/usr/bin/env node
// Loom Stop hook.
//
// Fired when the Claude Code session ends. Reads today's event log to
// compute a tiny summary (tool calls, errors, destructive ops, error
// signatures observed) and appends:
//   1. A session_end record to today's JSONL.
//   2. A row to orchestration/progress-ledger.md "Session log" table —
//      the "closing the books" checkpoint from L5.
//
// Lessons-learned auto-suggestion (PR-4 / E, per ADR-0014) is wired at the
// bottom: today's failures are grouped by error signature, novel signatures
// produce `lessons-learned/draft-*.md` files. Drafts are never auto-promoted.

import {
  appendEvent,
  mechanicalRecord,
  readStdinJson,
  todayLogPath,
  PROJECT_ROOT,
} from "./_lib.mjs";
import { summarizeTranscriptTokens, findTranscript } from "./_transcript.mjs";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";

const event = await readStdinJson();
const sessionId =
  event.session_id || process.env.CLAUDE_SESSION_ID || `local-${Date.now()}`;

// ── Tally today's events ────────────────────────────────────────────────

const summary = {
  tool_calls: 0,
  tool_results: 0,
  errors: 0,
  destructive_ops: 0,
  error_signatures: new Set(),
  destructive_patterns: new Set(),
  first_ts: null,
  last_ts: null,
};

let logText = "";
try {
  logText = await fs.readFile(todayLogPath(), "utf8");
} catch {
  // No log today — session was empty or hooks weren't wired.
}

for (const line of logText.split("\n")) {
  if (!line.trim()) continue;
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    continue;
  }
  if (rec.session_id && rec.session_id !== sessionId) continue;
  summary.first_ts = summary.first_ts || rec.timestamp;
  summary.last_ts = rec.timestamp;
  if (rec.event_type === "tool_call") summary.tool_calls++;
  if (rec.event_type === "tool_result") {
    summary.tool_results++;
    if (rec.exit_code !== null && rec.exit_code !== 0) {
      summary.errors++;
      if (rec.error_signature) summary.error_signatures.add(rec.error_signature);
    }
  }
  if (rec.event_type === "destructive_op") {
    summary.destructive_ops++;
    if (rec.destructive_pattern) summary.destructive_patterns.add(rec.destructive_pattern);
  }
}

// ── Append session_end record ───────────────────────────────────────────

appendEvent(
  mechanicalRecord("session_end", {
    session_id: sessionId,
    started_at: summary.first_ts,
    ended_at: summary.last_ts || new Date().toISOString(),
    tool_calls: summary.tool_calls,
    tool_results: summary.tool_results,
    errors: summary.errors,
    destructive_ops: summary.destructive_ops,
    error_signatures: [...summary.error_signatures],
    destructive_patterns: [...summary.destructive_patterns],
  })
);

// ── Token usage summary (observatory live-data fix) ─────────────────────
//
// Hook payloads carry no token counts, so the observatory's cost/token panels
// were structurally always zero during Claude Code sessions. The transcript
// records per-turn usage; summarize it here (Stop fires per turn) and emit a
// session-cumulative token event. Best-effort — never fail Stop over it.
try {
  const transcriptPath = event.transcript_path || (await findTranscript(sessionId));
  const usage = await summarizeTranscriptTokens(transcriptPath);
  if (usage && (usage.input_tokens > 0 || usage.output_tokens > 0)) {
    appendEvent(
      mechanicalRecord("session_token_usage", {
        session_id: sessionId,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        model: usage.model,
        assistant_messages: usage.assistant_messages,
      })
    );
  }
} catch {
  // Best-effort; token capture must never break the Stop hook.
}

// ── Update progress-ledger.md (Session log table) ───────────────────────

await appendSessionRow({
  sessionId,
  startedAt: summary.first_ts,
  endedAt: summary.last_ts,
  toolCalls: summary.tool_calls,
  errors: summary.errors,
  note:
    summary.destructive_ops > 0
      ? `destructive ops: ${[...summary.destructive_patterns].join(", ") || "(unlabeled)"}`
      : summary.errors > 0
      ? `${summary.errors} error(s); signatures: ${[...summary.error_signatures].join(",") || "—"}`
      : "—",
});

// Auto-suggest lessons-learned drafts (PR-4 / E, per ADR-0014).
// Lazy-loaded so removing stop-lessons.mjs is a non-fatal disable.
try {
  const stopLessons = await import("./stop-lessons.mjs");
  if (stopLessons && typeof stopLessons.default === "function") {
    const result = await stopLessons.default({ sessionId });
    if (result && (result.suggested || result.skipped)) {
      appendEvent(
        mechanicalRecord("lessons_autosuggest", {
          session_id: sessionId,
          suggested: result.suggested,
          skipped: result.skipped,
        })
      );
    }
  }
} catch (err) {
  // Auto-suggest is best-effort. Never fail the Stop hook over it.
  appendEvent(
    mechanicalRecord("lessons_autosuggest_error", {
      session_id: sessionId,
      error: String(err && err.message ? err.message : err).slice(0, 240),
    })
  );
}

process.exit(0);

// ── Helpers ─────────────────────────────────────────────────────────────

async function appendSessionRow({
  sessionId,
  startedAt,
  endedAt,
  toolCalls,
  errors,
  note,
}) {
  const ledgerPath = path.join(PROJECT_ROOT, "orchestration", "progress-ledger.md");
  if (!existsSync(ledgerPath)) return;

  let text = await fs.readFile(ledgerPath, "utf8");
  const header = "## Session log";
  const tableHeader = [
    "| session_id | started | ended | tool_calls | errors | note |",
    "|---|---|---|---|---|---|",
  ].join("\n");

  if (!text.includes(header)) {
    // Append section at end of file.
    const newSection = `\n\n---\n\n${header}\n\n> Closing-the-books checkpoint per [L5](../layers/L5-orchestration.md). One row per Claude Code session, written by the Stop hook.\n\n${tableHeader}\n`;
    text = text.replace(/\s+$/, "") + newSection;
  }

  const row = `| ${sessionId} | ${startedAt || ""} | ${endedAt || ""} | ${toolCalls} | ${errors} | ${escapePipe(
    note
  )} |\n`;

  // Append row at end of file (the Session log table is the last block).
  if (text.endsWith("\n")) text += row;
  else text += "\n" + row;

  await fs.writeFile(ledgerPath, text, "utf8");
}

function escapePipe(s) {
  return String(s || "").replace(/\|/g, "\\|");
}
