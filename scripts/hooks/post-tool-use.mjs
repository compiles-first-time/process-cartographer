#!/usr/bin/env node
// Loom PostToolUse hook.
//
// Fired after each tool call. Writes a tool_result event and — if the
// command matches a destructive-op pattern (rm -rf, git reset --hard,
// drop table, prisma migrate reset, etc.) — also writes a
// destructive_op event so they're cheap to grep.

import {
  appendEvent,
  mechanicalRecord,
  readStdinJson,
  summarizeToolArgs,
  classifyDestructive,
  errorSignature,
} from "./_lib.mjs";

const event = await readStdinJson();
const toolName = event.tool_name || event.tool || "unknown";
const toolInput = event.tool_input || event.input || null;
const toolResponse = event.tool_response || event.response || null;

// Exit code best-effort across tool shapes (Bash returns integer; others
// don't have a concept of exit code).
let exitCode = null;
if (toolResponse && typeof toolResponse === "object") {
  if (typeof toolResponse.exit_code === "number") exitCode = toolResponse.exit_code;
  else if (typeof toolResponse.exitCode === "number") exitCode = toolResponse.exitCode;
  else if (toolResponse.is_error === true || toolResponse.error) exitCode = 1;
}

// Error text best-effort.
let errorText = null;
if (toolResponse && typeof toolResponse === "object") {
  if (typeof toolResponse.stderr === "string" && toolResponse.stderr.trim()) {
    errorText = toolResponse.stderr;
  } else if (typeof toolResponse.error === "string") {
    errorText = toolResponse.error;
  } else if (exitCode !== null && exitCode !== 0 && typeof toolResponse.stdout === "string") {
    errorText = toolResponse.stdout.slice(-400);
  }
}

const sig = errorSignature({ tool: toolName, errorText });

appendEvent(
  mechanicalRecord("tool_result", {
    session_id: event.session_id || process.env.CLAUDE_SESSION_ID || "unknown",
    tool: toolName,
    tool_args_summary: summarizeToolArgs(toolInput),
    exit_code: exitCode,
    error_signature: sig,
    error_preview: errorText ? errorText.slice(0, 240) : null,
  })
);

const destructive = classifyDestructive({ tool: toolName, input: toolInput });
if (destructive) {
  appendEvent(
    mechanicalRecord("destructive_op", {
      session_id: event.session_id || process.env.CLAUDE_SESSION_ID || "unknown",
      tool: toolName,
      destructive_pattern: destructive.label,
      matched_on: destructive.matched_on,
      exit_code: exitCode,
    })
  );
}

process.exit(0);
