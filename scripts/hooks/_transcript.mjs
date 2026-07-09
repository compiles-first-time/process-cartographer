// Transcript token reader — used by the Stop hook to capture Claude Code
// token usage into the event log (observatory live-data fix).
//
// Claude Code hook payloads do NOT carry token counts, so the observatory's
// cost/token panels were structurally always zero during development sessions.
// The session transcript, however, records `message.usage` on every assistant
// turn. The Stop hook fires at the end of each turn, so summarizing the
// transcript there gives per-turn-fresh, accurate session totals with no
// per-tool-call overhead.
//
// Cross-platform, no external deps.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

function stripBom(s) {
  return typeof s === "string" && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// Sum token usage across all assistant messages in a transcript JSONL file.
// Returns { input_tokens, output_tokens, model, assistant_messages } or null
// if the file can't be read. Input is the full billed input side (prompt +
// cache-creation + cache-read); the observatory's flat-rate cost model treats
// them uniformly, so we report total volume rather than per-tier breakdown.
export async function summarizeTranscriptTokens(transcriptPath) {
  if (!transcriptPath) return null;
  let text;
  try {
    text = stripBom(await fs.readFile(transcriptPath, "utf8"));
  } catch {
    return null;
  }

  let input = 0;
  let output = 0;
  let model = null;
  let assistantMessages = 0;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const msg = rec.message;
    if (!msg || !msg.usage) continue;
    const u = msg.usage;
    input +=
      (u.input_tokens || 0) +
      (u.cache_creation_input_tokens || 0) +
      (u.cache_read_input_tokens || 0);
    output += u.output_tokens || 0;
    if (msg.model) model = msg.model;
    assistantMessages++;
  }

  return { input_tokens: input, output_tokens: output, model, assistant_messages: assistantMessages };
}

// Best-effort transcript-path resolution when the hook payload omits it.
// Claude Code stores transcripts at
//   ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
// The cwd encoding is non-trivial (drive letter lowercased, separators → "-"),
// so rather than reconstruct it we scan the project dirs for the session file.
// Returns an absolute path or null.
export async function findTranscript(sessionId) {
  if (!sessionId) return null;
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  let dirs;
  try {
    dirs = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const target = `${sessionId}.jsonl`;
  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(projectsDir, entry.name, target);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      /* not in this project dir */
    }
  }
  return null;
}
