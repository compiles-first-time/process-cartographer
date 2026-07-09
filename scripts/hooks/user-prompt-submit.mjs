#!/usr/bin/env node
// Loom UserPromptSubmit hook.
//
// Fired when the user submits a prompt. Runs the heuristic intent classifier
// (see _classify.mjs). For each matched intent, appends a `subagent_suggestion`
// event to today's JSONL and emits the suggestion as `additionalContext` so
// the model sees it on the way in.
//
// Per ADR-0017 (base classifier) + ADR-0023 (specialist registry path).
// Heuristic — wrong calls are quiet (extra context the model can ignore),
// not blocking.

import {
  appendEvent,
  mechanicalRecord,
  readStdinJson,
} from "./_lib.mjs";
import { classifyIntent } from "./_classify.mjs";

const event = await readStdinJson();
const sessionId =
  event.session_id || process.env.CLAUDE_SESSION_ID || "unknown";
const prompt = event.prompt || event.user_prompt || event.message || "";

const hits = await classifyIntent(prompt);

if (hits.length > 0) {
  appendEvent(
    mechanicalRecord("subagent_suggestion", {
      session_id: sessionId,
      prompt_preview: prompt.slice(0, 240),
      suggestions: hits.map((h) => ({
        intent: h.intent,
        suggest: h.suggest,
        rationale: h.rationale,
        matched: h.matched,
      })),
    })
  );

  // Inject context the model will see. JSON output with additionalContext
  // is the documented Claude Code mechanism for UserPromptSubmit context.
  const lines = ["[loom intent classifier] heuristic match — consider invoking:"];
  for (const h of hits) {
    const list = h.suggest.map((s) => `\`${s}\``).join(" + ");
    lines.push(`  • ${list} — ${h.rationale}`);
  }
  lines.push("(misclassification is harmless; ignore if not applicable.)");

  const additionalContext = lines.join("\n");
  process.stdout.write(
    JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext,
      },
    }) + "\n"
  );
}

process.exit(0);
