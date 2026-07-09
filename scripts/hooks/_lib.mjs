// Shared library for Loom Claude Code hooks.
//
// All hooks read a JSON event payload on stdin from Claude Code and append
// JSONL records to memory/event-log/YYYY-MM-DD.jsonl. This file holds the
// helpers they share.
//
// Cross-platform: Node 22+ on POSIX or Windows. No external deps.

import { promises as fs } from "node:fs";
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";

// ── Project-root resolution (ADR-0043) ────────────────────────────────────
//
// Priority chain:
//   1. LOOM_PROJECT_ROOT env var (explicit override)
//   2. Walk up from this file's location — fixes subdir/cwd-drift (Problem A)
//   3. process.cwd() fallback + ADR-0038 warning banner at session-start
//
// Problem B (launch from a foreign directory) requires launch discipline;
// see ADR-0043 §Consequences.

const LOOM_MARKERS = [
  "loom-spec.md",
  "constitution/kernel-v6.md",
  ".claude/loom-permissions.yaml",
];

function isLoomRoot(dir) {
  return LOOM_MARKERS.every((m) => existsSync(path.join(dir, m)));
}

function resolveProjectRoot() {
  // 1. Explicit env override.
  const envRoot = process.env.LOOM_PROJECT_ROOT;
  if (envRoot) {
    const normalized = path.resolve(envRoot);
    if (isLoomRoot(normalized)) return normalized;
    process.stderr.write(
      `[loom-hook] LOOM_PROJECT_ROOT="${envRoot}" is set but contains no Loom markers — ignoring.\n`
    );
  }

  // 2. Walk up from this hook file's location (resolves subdir launches).
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (isLoomRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  // 3. Fallback — cwd. ADR-0038 banner fires at session-start.
  return process.cwd();
}

export const PROJECT_ROOT = resolveProjectRoot();

export const EVENT_LOG_DIR = path.join(PROJECT_ROOT, "memory", "event-log");
export const KERNEL_VERSION = "v6";
export const LOOM_VERSION = "0.2.0";

// ── CWD / project-root validation (ADR-0034 §C, hook-capture-gap fix) ───
//
// Ravenwise session (2026-05-22) demonstrated the failure mode: when Claude
// Code's CWD at session start is NOT the Loom project directory, hooks load
// against the wrong CWD. The event log goes silent without warning because
// PROJECT_ROOT points to the parent dir, not the project.
//
// This function checks for Loom project indicators at the current CWD.
// Returns { valid: true } or { valid: false, reason: "..." }.
// Callers decide severity: SessionStart emits a loud warning; other hooks
// just tag the event as potentially-misrooted.

const LOOM_INDICATORS = [
  "CLAUDE.md",
  ".claude/settings.json",
  "constitution/kernel-v6.md",
  "layers/L0-constitutional.md",
];

export function validateProjectRoot(root = PROJECT_ROOT) {
  // Fast-path: all three ADR-0043 markers present → definitive match.
  if (isLoomRoot(root)) return { valid: true, found: [...LOOM_MARKERS] };

  // Fallback: ADR-0038 2-of-4 heuristic for partial installs.
  const found = LOOM_INDICATORS.filter((f) => existsSync(path.join(root, f)));
  if (found.length === 0) {
    return {
      valid: false,
      reason: `CWD "${root}" has none of the expected Loom project indicators (${LOOM_INDICATORS.join(", ")}). Hooks are likely running against the wrong directory. Open Claude Code IN the project directory to fix.`,
      found: [],
    };
  }
  if (found.length < 2) {
    return {
      valid: false,
      reason: `CWD "${root}" has only "${found[0]}" — may not be a Loom project root. Expected at least CLAUDE.md + .claude/settings.json.`,
      found,
    };
  }
  return { valid: true, found };
}

// ── Stdin payload ────────────────────────────────────────────────────────

export async function readStdinJson() {
  // Claude Code sends a JSON event on stdin. If stdin is a TTY (no payload),
  // return an empty object so the hook can still emit a synthetic record.
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw, _parse_error: true };
  }
}

// ── JSONL append ─────────────────────────────────────────────────────────

export function todayLogPath(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return path.join(EVENT_LOG_DIR, `${y}-${m}-${d}.jsonl`);
}

export function ensureLogDir() {
  if (!existsSync(EVENT_LOG_DIR)) mkdirSync(EVENT_LOG_DIR, { recursive: true });
}

export function appendEvent(record) {
  ensureLogDir();
  // Append-only. Synchronous: hooks need to finish before the next tool call.
  const line = JSON.stringify(record) + "\n";
  appendFileSync(todayLogPath(), line, "utf8");
}

// ── Mechanical record skeleton (Rule-22 subset that a hook can actually fill) ──

export function mechanicalRecord(eventType, extra = {}) {
  return {
    timestamp: new Date().toISOString(),
    session_id: process.env.CLAUDE_SESSION_ID || extra.session_id || "unknown",
    cwd: PROJECT_ROOT,
    event_type: eventType,
    kernel_version: KERNEL_VERSION,
    loom_version: LOOM_VERSION,
    ...extra,
  };
}

// ── Argument summary (truncate + scrub obvious secrets) ──────────────────
//
// Two layers of redaction (per ADR-0018):
//   1. By key name — if the field name matches secret-y words.
//   2. By value shape — token-shaped values are redacted regardless of key.
// Layer 2 was added in v0.3 PR-H because v0.2 had values pasted into Bash
// commands captured in cleartext (the key was `command`, not `token`).

import { redactSecrets } from "../lib/secret-patterns.mjs";

const SECRET_KEY_PATTERN = /(token|key|secret|password|passwd|auth|bearer|api[_-]?key)/i;
const MAX_ARG_LEN = 240;

export function summarizeToolArgs(input) {
  if (input == null) return null;
  if (typeof input === "string") return redactSecrets(truncate(input));
  if (typeof input !== "object") return String(input);
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (SECRET_KEY_PATTERN.test(k)) {
      out[k] = "<redacted>";
      continue;
    }
    if (typeof v === "string") out[k] = redactSecrets(truncate(v));
    else if (Array.isArray(v)) out[k] = `array(len=${v.length})`;
    else if (v && typeof v === "object") out[k] = `object(keys=${Object.keys(v).length})`;
    else out[k] = v;
  }
  return out;
}

function truncate(s) {
  if (s.length <= MAX_ARG_LEN) return s;
  return s.slice(0, MAX_ARG_LEN) + `…(+${s.length - MAX_ARG_LEN} chars)`;
}

// ── Error signature (used by post-tool-use; consumed by Stop hook in PR-4) ──

export function errorSignature({ tool, errorText }) {
  if (!errorText) return null;
  // Canonicalize: lowercase, strip timestamps, drop absolute paths, collapse whitespace.
  const canon = String(errorText)
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.]+z?/g, "<ts>")
    .replace(/\/[a-z]:?\/[^\s"']+/gi, "<path>")
    .replace(/\\\\?[a-z]:\\[^\s"']+/gi, "<path>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  const h = crypto.createHash("sha1").update(`${tool || ""}::${canon}`).digest("hex");
  return h.slice(0, 16);
}

// ── Destructive-op classifier (used by post-tool-use) ────────────────────

const DESTRUCTIVE_PATTERNS = [
  { pattern: /\brm\s+-[rf]+\b/i, label: "rm -rf" },
  { pattern: /\bgit\s+reset\s+--hard\b/i, label: "git reset --hard" },
  { pattern: /\bgit\s+push\s+(-f|--force)\b/i, label: "git force push" },
  { pattern: /\bgit\s+branch\s+-D\b/i, label: "git branch -D" },
  { pattern: /\bgit\s+clean\s+-[fd]+/i, label: "git clean -fd" },
  { pattern: /\bdrop\s+(table|database|schema)\b/i, label: "DROP table/db" },
  { pattern: /\btruncate\s+table\b/i, label: "TRUNCATE table" },
  { pattern: /\bprisma\s+migrate\s+reset\b/i, label: "prisma migrate reset" },
  { pattern: /\bsupabase\s+db\s+reset\b/i, label: "supabase db reset" },
  { pattern: /\bremove-item\s+.*\s+-recurse\s+-force\b/i, label: "Remove-Item -Recurse -Force" },
  { pattern: /\bremove-item\s+.*\s+-force\s+-recurse\b/i, label: "Remove-Item -Force -Recurse" },
];

export function classifyDestructive({ tool, input }) {
  // Inspect the most common command-bearing fields across tools (Bash, PowerShell, etc.).
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
  if (!candidate) return null;
  for (const { pattern, label } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(candidate)) return { label, matched_on: f0(candidate, pattern) };
  }
  return null;
}

function f0(text, pattern) {
  const m = text.match(pattern);
  return m ? m[0] : null;
}

// ── Placeholder detection (used by session-start) ────────────────────────

export const PLACEHOLDER_FILES = [
  "README.md",
  "CLAUDE.md",
  "AGENTS.md",
  "loom-spec.md",
  "memory/self-knowledge.md",
  "tools/mcp-servers/config.yaml",
  "observability/langfuse-config.yaml",
];

export const PLACEHOLDER_TOKENS = ["<PROJECT_NAME>", "<USER_NAME>", "<YYYY-MM-DD>"];

export async function findPlaceholders() {
  const hits = [];
  for (const rel of PLACEHOLDER_FILES) {
    const abs = path.join(PROJECT_ROOT, rel);
    try {
      const text = await fs.readFile(abs, "utf8");
      const tokens = PLACEHOLDER_TOKENS.filter((t) => text.includes(t));
      if (tokens.length) hits.push({ file: rel, tokens });
    } catch {
      // File missing — ignore (bootstrap.sh would have flagged it).
    }
  }
  return hits;
}

// ── Derive bootstrap defaults (project name, user) ───────────────────────

export function deriveProjectName() {
  return path.basename(PROJECT_ROOT) || "unnamed-project";
}

export function deriveUserName() {
  return (
    process.env.LOOM_USER_NAME ||
    process.env.GIT_AUTHOR_NAME ||
    process.env.USER ||
    process.env.USERNAME ||
    os.userInfo()?.username ||
    "user"
  );
}

// ── Stderr helper ────────────────────────────────────────────────────────

export function warn(message) {
  process.stderr.write(`[loom-hook] ${message}\n`);
}

// ── Session inspection: has constitution-service been consulted? ─────────
//
// Used by pre-tool-use to enforce LR-02 (production mutations require a
// prior constitution-service claim in the same session). Returns true if any
// `event_type: claim` line in today's JSONL has the constitution-service as
// the `agent` field and matches the given session.

export async function sessionHasConstitutionClaim(sessionId) {
  try {
    const text = await fs.readFile(todayLogPath(), "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (rec.session_id !== sessionId) continue;
      if (rec.event_type !== "claim") continue;
      const agent = String(rec.agent || "").toLowerCase();
      if (agent === "constitution-service" || agent.endsWith("/constitution-service")) {
        return true;
      }
    }
  } catch {
    // No log today — no claim. Falls through to false.
  }
  return false;
}
