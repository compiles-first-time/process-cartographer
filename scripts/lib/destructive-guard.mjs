// Loom destructive-action guard — the decision logic behind BR_01 (ADR-0047).
//
// Pure, side-effect-free tier decision consumed by scripts/hooks/pre-tool-use.mjs.
// The POLICY (which files are immutable, which branches are protected, what
// counts as contained scope) is DATA in spec/policy/ (ADR-0048); this module is
// the portable *evaluator*. decideDestructiveAction() accepts a `policy`
// override so an adapter or project can supply its own without forking logic.
// Its branches ARE the SE/BE cases in observability/eval-suite/requirements/BR_01.md.
//
// Risk-proportionate friction mapped to reversibility × blast-radius
// (Kernel Rule 20 "temporal weighting"). Three tiers:
//
//   DENY  (tier 1) — immutable / catastrophic-irreversible (kernel rules,
//                     hook-managed files, force-push to a protected branch)
//   ASK   (tier 2) — the destructive class, rare so confirmation stays meaningful
//                     (Akhawe & Felt 2013; Herley 2009)
//   ALLOW (tier 3) — a destructive op contained inside a worktree (Rule 8)
//
// No destructive signal → { decision: "none" }. Fail-open is the caller's
// responsibility: any throw here must be caught and treated as "none".

import { DESTRUCTIVE_POLICY } from "../../spec/policy/destructive-actions.policy.mjs";

const CMD_FIELDS = ["command", "Command", "script"];

// Re-exported for back-compat; the source of truth is the spec policy.
export const IMMUTABLE_FILES = DESTRUCTIVE_POLICY.immutableFiles;
export const HOOK_MANAGED_FILES = DESTRUCTIVE_POLICY.hookManagedFiles;

// Force-push detection is host-neutral *mechanism*, not policy data.
const FORCE_PUSH_RE = /\bgit\s+push\b[^\n]*?(?:--force\b|--force-with-lease\b|-f\b)/i;

// Contained-scope prefix: a policy segment preceded by start, whitespace, a
// quote/paren/equals, or a slash — so "rm -rf .worktrees/x" and
// "cd repo/.worktrees/x" both match while "myworktrees/" does not.
const CONTAINED_PREFIX = "(?:^|[\\s\"'`(=]|/)";

// A regex that never matches — used when a policy list is empty, so an empty
// list means "nothing qualifies" (NOT an empty alternation `(?:)`, which would
// match everything).
const NEVER_MATCH = /(?!)/;

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
function buildProtectedBranchRe(branches = []) {
  if (!branches || branches.length === 0) return NEVER_MATCH;
  return new RegExp("\\b(?:" + branches.map(escapeRegex).join("|") + ")\\b", "i");
}
function buildContainedRe(segments = []) {
  if (!segments || segments.length === 0) return NEVER_MATCH;
  return new RegExp(CONTAINED_PREFIX + "(?:" + segments.map(escapeRegex).join("|") + ")");
}

function normPath(p) {
  return typeof p === "string" ? p.replace(/\\/g, "/") : "";
}

function extractFilePath(input) {
  if (input && typeof input === "object" && typeof input.file_path === "string") {
    return input.file_path;
  }
  return "";
}

function extractCommand(input) {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    for (const f of CMD_FIELDS) {
      if (typeof input[f] === "string") return input[f];
    }
  }
  return "";
}

function pathMatchesAny(filePath, relList) {
  const norm = normPath(filePath);
  if (!norm) return null;
  for (const rel of relList || []) {
    // Match exact tail so an absolute path (…/project/constitution/kernel-v6.md)
    // or a repo-relative path both resolve.
    if (norm === rel || norm.endsWith("/" + rel)) return rel;
  }
  return null;
}

// Tier 1 — context-based hard deny. Independent of the classifier: these are
// file targets / branch targets a command-pattern classifier does not see.
function checkDenyTier({ tool, filePath, command, policy, protectedRe }) {
  const isEdit = tool === "Edit" || tool === "Write" || tool === "NotebookEdit" || tool === "MultiEdit";

  if (isEdit && filePath) {
    const immutable = pathMatchesAny(filePath, policy.immutableFiles);
    if (immutable) {
      return {
        matched_on: immutable,
        reason:
          `Blocked: ${immutable} is amend-only under Kernel Rule 19 (foundational rules are immutable). ` +
          `Constitutional changes go through the documented amendment process (transparent, auditable, consent-based) — not a direct edit.`,
      };
    }
    const managed = pathMatchesAny(filePath, policy.hookManagedFiles);
    if (managed) {
      return {
        matched_on: managed,
        reason:
          `Blocked: ${managed} is a hook-managed bi-temporal file. Hand-edits break the append integrity the Stop / runtime-discovery hooks depend on. ` +
          `Let the hooks maintain it.`,
      };
    }
  }

  if (command && FORCE_PUSH_RE.test(command) && protectedRe.test(command)) {
    return {
      matched_on: (command.match(FORCE_PUSH_RE) || [""])[0].trim(),
      reason:
        `Blocked: force-push to a protected branch rewrites shared history irreversibly (Kernel Rule 20). ` +
        `Force-push to a feature branch instead, or open a PR.`,
    };
  }

  return null;
}

// Tier 3 — contained scope: a destructive op whose target is inside a worktree
// isolation dir. Bounded blast radius → trust the scope (Rule 8).
//
// SECURITY: a command with shell chaining / substitution / comments is NOT
// eligible — its destructive target may be OUTSIDE the worktree even if
// ".worktrees/" appears in another segment (e.g. "rm -rf /data && cd
// .worktrees/x", or "rm -rf /data #.worktrees"). Those fall through to `ask`.
// Contained-scope is a best-effort ask→allow downgrade, never a deny→allow
// bypass; the deny tier is unaffected. See BR_01.md known-limitations.
const CHAINED_OR_COMMENT = /&&|\|\||[;|&\n#]|\$\(|`/;

function checkContainedScope({ filePath, command, containedRe }) {
  // File target: precise — the edited path itself must be contained.
  if (filePath && containedRe.test(normPath(filePath))) return { marker: "contained-scope" };
  // Command: trust only a SINGLE, unchained, un-substituted, un-commented command.
  if (command && !CHAINED_OR_COMMENT.test(command) && containedRe.test(normPath(command))) {
    return { marker: "contained-scope" };
  }
  return null;
}

function isDestructiveSignal(hits) {
  if (!Array.isArray(hits)) return null;
  // A classifier hit is a destructive signal when its category is
  // destructive_actions OR it carries an explicit decision of ask/deny.
  return (
    hits.find((h) => h && h.decision === "deny") ||
    hits.find((h) => h && (h.category === "destructive_actions" || h.decision === "ask")) ||
    null
  );
}

/**
 * Decide the PreToolUse tier for a tool call.
 *
 * @param {object} ctx
 * @param {string} ctx.tool     - tool name (e.g. "Bash", "Edit")
 * @param {*}      ctx.input    - tool_input payload
 * @param {Array}  [ctx.hits]   - classifier hits from classifyToolCall()
 * @param {object} [ctx.policy] - policy override (defaults to the spec policy)
 * @returns {{decision:"deny"|"ask"|"allow"|"none", tier:number, reason:(string|null), matched_on:(string|null)}}
 */
export function decideDestructiveAction(ctx = {}) {
  const { tool = "", input = null, hits = [], policy = DESTRUCTIVE_POLICY } = ctx;
  const filePath = extractFilePath(input);
  const command = extractCommand(input);
  const protectedRe = buildProtectedBranchRe(policy.protectedBranches);
  const containedRe = buildContainedRe(policy.containedScopeSegments);

  // Tier 1: context-based hard deny (immutable files, hook-managed files, force-push-protected).
  const denial = checkDenyTier({ tool, filePath, command, policy, protectedRe });
  if (denial) {
    return { decision: "deny", tier: 1, reason: denial.reason, matched_on: denial.matched_on };
  }

  // Explicit policy decision:deny on any classifier hit also hard-denies.
  const denyHit = Array.isArray(hits) ? hits.find((h) => h && h.decision === "deny") : null;
  if (denyHit) {
    return {
      decision: "deny",
      tier: 1,
      reason:
        `Blocked by policy (${denyHit.category}): ${denyHit.matched_on}. Category decision=deny in loom-permissions.yaml.`,
      matched_on: denyHit.matched_on,
    };
  }

  const signal = isDestructiveSignal(hits);
  if (!signal) return { decision: "none", tier: 0, reason: null, matched_on: null };

  // Tier 3: contained scope → trust + allow (still logged by the caller).
  const contained = checkContainedScope({ filePath, command, containedRe });
  if (contained) {
    return {
      decision: "allow",
      tier: 3,
      reason: `Contained scope — trusting worktree isolation.`,
      matched_on: signal.matched_on || null,
    };
  }

  // Tier 2: the destructive class. Default decision comes from policy ("ask").
  const protocol = summarizeProtocol(signal.required_protocol);
  return {
    decision: policy.destructiveDefault || "ask",
    tier: 2,
    reason:
      `Destructive/irreversible (${signal.category || "destructive_actions"}): ${signal.matched_on || "matched"}. ` +
      `Kernel Rule 20 — confirm to proceed${protocol ? `; ${protocol}` : ""}.`,
    matched_on: signal.matched_on || null,
  };
}

function summarizeProtocol(required_protocol) {
  if (!Array.isArray(required_protocol) || required_protocol.length === 0) return "";
  const keys = required_protocol
    .map((p) => (p && typeof p === "object" ? Object.keys(p)[0] : null))
    .filter(Boolean);
  if (keys.length === 0) return "";
  return `check: ${keys.join(", ")}`;
}

/**
 * Build the Claude Code PreToolUse decision object for a deny/ask result.
 * Returns null for allow/none (the hook simply exits 0 and does not print).
 * NOTE: this shape (permissionDecision) is Claude-Code-specific — it lives here
 * only for back-compat; new adapters should map { decision, reason } themselves.
 */
export function toHookOutput(result) {
  if (!result || (result.decision !== "deny" && result.decision !== "ask")) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: result.decision,
      permissionDecisionReason: result.reason || "",
    },
  };
}
