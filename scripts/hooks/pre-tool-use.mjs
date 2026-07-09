#!/usr/bin/env node
// Loom PreToolUse hook.
//
// Fired before each tool call. Appends one JSON line per call to today's
// event log, with the tool name and a redacted/truncated argument summary.
//
// The Rule-22 fields a hook can mechanically supply are written here; the
// introspective fields (confidence, what_would_raise_to_95, decision_log)
// are emitted by the model itself as `event_type: claim` records (see
// CLAUDE.md "Claim convention").

import {
  appendEvent,
  mechanicalRecord,
  readStdinJson,
  summarizeToolArgs,
  sessionHasConstitutionClaim,
} from "./_lib.mjs";
import { classifyProductionMutation } from "./_classify.mjs";
import { loadPermissions, classifyToolCall } from "../lib/permissions-classifier.mjs";
import { detectOauthPreferenceMisses } from "../lib/oauth-preference.mjs";
import { decideDestructiveAction, toHookOutput } from "../lib/destructive-guard.mjs";

const event = await readStdinJson();
const sessionId = event.session_id || process.env.CLAUDE_SESSION_ID || "unknown";
const toolName = event.tool_name || event.tool || "unknown";
const toolInput = event.tool_input || event.input || null;

appendEvent(
  mechanicalRecord("tool_call", {
    session_id: sessionId,
    tool: toolName,
    tool_args_summary: summarizeToolArgs(toolInput),
  })
);

// Production-mutation detection (LR-02 / ADR-0017 — now subsumed by LR-04 / ADR-0027).
// Kept for backward compatibility; LR-04 classifier below produces the unified events.
const prodMutation = classifyProductionMutation({ tool: toolName, input: toolInput });
if (prodMutation) {
  appendEvent(
    mechanicalRecord("production_mutation_attempted", {
      session_id: sessionId,
      tool: toolName,
      production_mutation_pattern: prodMutation.label,
      matched_on: prodMutation.matched_on,
    })
  );
}

// LR-04 unified permissions classifier (PR-P / ADR-0027). Subsumes LR-02 +
// LR-03 as specializations of the permissions framework.
let classifierHits = [];
try {
  const perms = await loadPermissions();
  classifierHits = classifyToolCall({ tool: toolName, input: toolInput, permissions: perms });
  for (const h of classifierHits) {
    appendEvent(
      mechanicalRecord(`${h.category}_attempted`, {
        session_id: sessionId,
        tool: toolName,
        matched_on: h.matched_on,
        enforcement: h.enforcement,
        required_protocol: h.required_protocol,
        rule: "LR-04",
      })
    );
    // Hard-enforcement categories also check for constitution-service claim.
    if (h.enforcement === "hard") {
      const hasCheck = await sessionHasConstitutionClaim(sessionId);
      if (!hasCheck) {
        appendEvent(
          mechanicalRecord("constitution_check_missing", {
            session_id: sessionId,
            tool: toolName,
            category: h.category,
            matched_on: h.matched_on,
            rule: "LR-04",
            message: `${h.category} action without constitution-service claim — LR-04 requires consultation for hard-enforcement categories.`,
          })
        );
      }
    }
  }
} catch {
  // Permissions classifier is best-effort. v0.5 functionality unaffected.
}

// OAuth-preference detector (PR-Q / ADR-0028). Surfaces "you're using a
// long-lived API key for a service that offers OAuth" as a hint event.
// Non-blocking; the credential_action category in LR-04 carries the
// hard-failure path for actual exposures.
try {
  const fields = ["command", "Command", "script"];
  let candidate = "";
  if (typeof toolInput === "string") candidate = toolInput;
  else if (toolInput && typeof toolInput === "object") {
    for (const f of fields) {
      if (typeof toolInput[f] === "string") {
        candidate = toolInput[f];
        break;
      }
    }
  }
  if (candidate) {
    const oauthHits = detectOauthPreferenceMisses(candidate);
    for (const m of oauthHits) {
      appendEvent(
        mechanicalRecord("oauth_preference_hint", {
          session_id: sessionId,
          tool: toolName,
          service: m.service,
          oauth_alternative: m.oauth_alternative,
          rationale: m.rationale,
          rule: "LR-04 / credentials",
        })
      );
    }
  }
} catch {
  // Best-effort.
}

// ── BR_01 (ADR-0047): hook-enforced confirmation for destructive actions ──
// Act on the classification above instead of only logging it. Risk-proportionate
// tiers (deny / ask / allow) mapped to reversibility × blast-radius (Rule 20):
//   deny  — immutable (kernel rules 1-8) / hook-managed files / force-push to a
//           protected branch;
//   ask   — the destructive class (rare → confirmation stays meaningful);
//   allow — destructive op contained inside a worktree (Rule 8: trust the scope).
// The permissionDecision is written to stdout (honored by Claude Code); the audit
// event is still logged. Fail-open: any error falls through to exit 0 (today's
// log-only behavior) so a guard fault never breaks a tool call.
try {
  const guard = decideDestructiveAction({
    tool: toolName,
    input: toolInput,
    hits: classifierHits,
  });
  if (guard.decision !== "none") {
    appendEvent(
      mechanicalRecord("destructive_action_decision", {
        session_id: sessionId,
        tool: toolName,
        decision: guard.decision,
        tier: guard.tier,
        matched_on: guard.matched_on,
        reason: guard.reason,
        rule: "ADR-0047",
      })
    );
    const output = toHookOutput(guard);
    if (output) process.stdout.write(JSON.stringify(output) + "\n");
  }
} catch {
  // Fail-open — never break a tool call on a guard fault.
}

process.exit(0);
