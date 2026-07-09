// Loom v0.6 permissions classifier — reads .claude/loom-permissions.yaml
// and classifies a tool call against the LR-04 meta-rule policy categories.
//
// Per ADR-0027. Categories: external_service_setup / destructive_actions /
// credentials. Each has triggers + required_protocol + enforcement.
//
// Used by pre-tool-use.mjs to emit per-category events:
//   - external_service_setup_attempted (soft)
//   - destructive_action_attempted     (hard — checks for constitution-service claim)
//   - credential_action_attempted      (soft)
//
// LR-04 subsumes LR-02 (production-mutation) and LR-03 (secrets) as
// specializations of the unified permissions framework.
//
// v0.3.2 extension (ADR-0032 §B): triggers may declare separate
// `billable_command_patterns` / `billable_mcp_patterns` lists. Matches
// against those produce hits flagged with `requires_pre_flight_quota: true`,
// signaling that the operation targets a known billable cloud service and
// the caller must emit a `pre_flight_quota_check` event before proceeding.
// The classifier surfaces the requirement; downstream layers (PreToolUse
// hook + specialists) decide enforcement. Billable patterns are checked
// FIRST inside each category, so they take precedence when a command would
// otherwise also match a generic pattern.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";

const ROOT_DEFAULT = process.cwd();

export async function loadPermissions(root = ROOT_DEFAULT) {
  const main = path.join(root, ".claude", "loom-permissions.yaml");
  const localOverride = path.join(root, ".claude", "loom-permissions.local.yaml");
  if (!existsSync(main)) return { categories: {} };
  const mainText = await fs.readFile(main, "utf8");
  const merged = parsePermissionsYaml(mainText);
  if (existsSync(localOverride)) {
    const localText = await fs.readFile(localOverride, "utf8");
    const local = parsePermissionsYaml(localText);
    // Shallow merge: project-local categories override main categories field-wise.
    for (const [k, v] of Object.entries(local.categories || {})) {
      merged.categories[k] = { ...(merged.categories[k] || {}), ...v };
    }
  }
  return merged;
}

// Narrow YAML parser for the known permissions schema.
//
// Schema:
//   version: "1.0"
//   categories:
//     <name>:
//       triggers:
//         command_patterns:
//           - "..."
//         mcp_patterns: [ "..." ]
//         keywords: [ "..." ]
//       required_protocol:
//         - key: "value"
//       enforcement: soft | hard
export function parsePermissionsYaml(text) {
  const out = { categories: {} };
  const lines = text.split(/\r?\n/);
  let i = 0;

  // Skip until `categories:`
  while (i < lines.length && !/^categories\s*:/.test(lines[i])) i++;
  i++; // past `categories:`

  let currentCategory = null;
  let currentTriggerKey = null;

  while (i < lines.length) {
    const raw = lines[i];
    const stripped = raw.replace(/\s+$/, "");
    i++;
    if (!stripped.trim() || stripped.trim().startsWith("#")) continue;

    // Category name (indent 2, ends with `:`)
    const catMatch = stripped.match(/^\s{2}(\w+)\s*:\s*$/);
    if (catMatch) {
      currentCategory = catMatch[1];
      out.categories[currentCategory] = {
        triggers: { command_patterns: [], mcp_patterns: [], keywords: [] },
        required_protocol: [],
        enforcement: "soft",
        decision: null,
      };
      currentTriggerKey = null;
      continue;
    }

    if (!currentCategory) continue;

    // Top-level field within a category (indent 4)
    const fieldMatch = stripped.match(/^\s{4}(\w+)\s*:\s*(.*)$/);
    if (fieldMatch) {
      const [, key, val] = fieldMatch;
      if (key === "enforcement") {
        out.categories[currentCategory].enforcement = unquote(val.trim());
      } else if (key === "decision") {
        // ADR-0047 (BR_01): PreToolUse permissionDecision for this category —
        // "ask" | "deny" | "allow". Optional; the pre-tool-use guard derives a
        // default from `enforcement` when absent.
        out.categories[currentCategory].decision = unquote(val.trim());
      } else if (key === "triggers" || key === "required_protocol") {
        // Block follows on indented lines
        currentTriggerKey = key;
      }
      continue;
    }

    // Trigger sub-key (indent 6): command_patterns / mcp_patterns / keywords
    const subKey = stripped.match(/^\s{6}(\w+)\s*:\s*(.*)$/);
    if (subKey && currentTriggerKey === "triggers") {
      const k = subKey[1];
      out.categories[currentCategory].triggers[k] =
        out.categories[currentCategory].triggers[k] || [];
      continue;
    }

    // List item under a trigger sub-key (indent 8)
    const listItem = stripped.match(/^\s{8}-\s+(.+)$/);
    if (listItem && currentTriggerKey === "triggers") {
      const lastSub = lastNonEmpty(stripped, lines, i);
      // Find which sub-key we're under by re-scanning backwards
      let subName = null;
      for (let j = i - 2; j >= 0; j--) {
        const m = lines[j].match(/^\s{6}(\w+)\s*:\s*$/);
        if (m) { subName = m[1]; break; }
        if (/^\s{4}\w+/.test(lines[j])) break; // exited triggers
      }
      if (subName) {
        out.categories[currentCategory].triggers[subName] =
          out.categories[currentCategory].triggers[subName] || [];
        out.categories[currentCategory].triggers[subName].push(yamlUnescape(unquote(listItem[1].trim())));
      }
      continue;
    }

    // Required-protocol entry (indent 6 with leading `-`)
    const protoItem = stripped.match(/^\s{6}-\s+(\w+)\s*:\s*(.+)$/);
    if (protoItem && currentTriggerKey === "required_protocol") {
      out.categories[currentCategory].required_protocol.push({
        [protoItem[1]]: unquote(protoItem[2].trim()),
      });
      continue;
    }
  }
  return out;
}

function lastNonEmpty(_curr, _arr, _i) { return null; }  // placeholder for clarity

function unquote(s) {
  s = stripInlineComment(s).trim();
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  return s;
}

function stripInlineComment(s) {
  let inQuote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      if (c === inQuote && s[i - 1] !== "\\") inQuote = null;
      continue;
    }
    if (c === '"' || c === "'") inQuote = c;
    else if (c === "#") return s.slice(0, i).trimEnd();
  }
  return s;
}

// YAML double-quoted unescape (matches registry-loader.mjs behavior).
function yamlUnescape(s) {
  return s.replace(/\\(.)/g, (_, c) => {
    switch (c) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case "\\": return "\\";
      case "\"": return "\"";
      default: return "\\" + c; // keep regex escapes
    }
  });
}

// Known billable cloud platforms (per ADR-0032 §B). Operations against any
// of these classified by billable_command_patterns or billable_mcp_patterns
// require a pre_flight_quota_check event before the operation proceeds.
// Adding a new platform = add it here + add the platform's billable action
// patterns to .claude/loom-permissions.yaml. The list is informational +
// used by isBillablePlatform(); the actual pattern matching is driven by
// the YAML config to keep behavior data-driven and auditable.
export const KNOWN_BILLABLE_PLATFORMS = Object.freeze([
  "vercel",
  "netlify",
  "fly",
  "render",
  "supabase",
  "railway",
  "planetscale",
  "aws",
  "gcp",
  "azure",
  "digitalocean",
  "cloudflare",
  "openai",
  "anthropic",
]);

export function isBillablePlatform(name) {
  if (typeof name !== "string") return false;
  return KNOWN_BILLABLE_PLATFORMS.includes(name.toLowerCase());
}

// Convenience predicate over a classifier hit. Returns true when the hit
// was matched against a billable_* pattern.
export function requiresPreFlightQuota(hit) {
  return Boolean(hit && hit.requires_pre_flight_quota);
}

// ── Classify a tool call against the loaded permissions config ───────────

export function classifyToolCall({ tool, input, permissions }) {
  if (!permissions || !permissions.categories) return [];
  const fields = ["command", "Command", "script"];
  let candidate = "";
  if (typeof input === "string") candidate = input;
  else if (input && typeof input === "object") {
    for (const f of fields) {
      if (typeof input[f] === "string") {
        candidate = input[f];
        break;
      }
    }
  }
  const hits = [];
  for (const [name, cat] of Object.entries(permissions.categories)) {
    const matched = matchCategory(candidate, tool, cat);
    if (matched) {
      hits.push({
        category: name,
        enforcement: cat.enforcement || "soft",
        decision: cat.decision || null,
        matched_on: matched.matched_on,
        matched_via: matched.matched_via,
        requires_pre_flight_quota: matched.requires_pre_flight_quota,
        required_protocol: cat.required_protocol || [],
      });
    }
  }
  return hits;
}

// Match a command/tool against one category's trigger lists. Billable
// patterns are checked FIRST so they take precedence when both a billable
// and a generic pattern would match the same input — preserves the
// ADR-0032 §B requirement that billable ops are recognized as such even
// when a generic external_service_setup pattern also matches.
//
// Returns null on no match, or:
//   { matched_on, matched_via, requires_pre_flight_quota }
// where `matched_via` is one of:
//   billable_command_patterns | billable_mcp_patterns |
//   command_patterns | mcp_patterns | keywords
function matchCategory(commandText, toolName, cat) {
  const t = cat.triggers || {};

  // Billable command patterns — flag the hit as requiring pre-flight quota.
  for (const p of t.billable_command_patterns || []) {
    try {
      const re = new RegExp(p, "i");
      const m = commandText.match(re);
      if (m) {
        return {
          matched_on: m[0],
          matched_via: "billable_command_patterns",
          requires_pre_flight_quota: true,
        };
      }
    } catch { /* skip invalid regex */ }
  }

  // Billable MCP patterns — flag the hit as requiring pre-flight quota.
  for (const p of t.billable_mcp_patterns || []) {
    try {
      const re = new RegExp(p, "i");
      if (re.test(toolName)) {
        return {
          matched_on: toolName,
          matched_via: "billable_mcp_patterns",
          requires_pre_flight_quota: true,
        };
      }
    } catch { /* skip */ }
  }

  // command_patterns: regex against the command string
  for (const p of t.command_patterns || []) {
    try {
      const re = new RegExp(p, "i");
      const m = commandText.match(re);
      if (m) {
        return {
          matched_on: m[0],
          matched_via: "command_patterns",
          requires_pre_flight_quota: false,
        };
      }
    } catch { /* skip invalid regex */ }
  }

  // mcp_patterns: regex against the tool name (when it's an MCP tool name)
  for (const p of t.mcp_patterns || []) {
    try {
      const re = new RegExp(p, "i");
      if (re.test(toolName)) {
        return {
          matched_on: toolName,
          matched_via: "mcp_patterns",
          requires_pre_flight_quota: false,
        };
      }
    } catch { /* skip */ }
  }

  // keywords: literal string check in command text
  for (const k of t.keywords || []) {
    if (commandText.toLowerCase().includes(k.toLowerCase())) {
      return {
        matched_on: k,
        matched_via: "keywords",
        requires_pre_flight_quota: false,
      };
    }
  }
  return null;
}
