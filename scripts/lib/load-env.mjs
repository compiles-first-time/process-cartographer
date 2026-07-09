// Loom env-loader with keyring-reference resolution.
//
// Per ADR-0036: resolves `keyring:<service>/<account>` references in
// .env.local at runtime via @napi-rs/keyring. Literal values pass through
// unchanged. Designed to be called once per process startup BEFORE any
// other module reads process.env.
//
// Integration points (per ADR-0036 §C):
//   - Next.js: import this from instrumentation.ts (which fires before
//     any request handler)
//   - Plain Node: import { loadEnv } from "scripts/lib/load-env.mjs";
//     await loadEnv() at the top of your entry file
//   - Drizzle / Auth.js: read process.env as usual; values are already
//     resolved by the time these modules initialize
//
// Failure modes:
//   - keyring: reference present but @napi-rs/keyring not installed →
//     throws KEYRING_NOT_INSTALLED with the install command
//   - keyring: reference present but no matching entry →
//     throws KEYRING_ENTRY_MISSING with the recovery command
//   - keyring: reference shape is malformed →
//     throws MALFORMED_REFERENCE with the expected syntax
//
// All errors mention the env var NAME but never log the resolved value.
// LR-03 invariant.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";

const KEYRING_PREFIX = "keyring:";
const REFERENCE_SHAPE = /^keyring:([^\/]+)\/(.+)$/;

// Parse a .env.local file into { key: value } pairs. Honors POSIX-style
// quoting (single + double quotes) and # comments. Does NOT export to
// process.env — that's resolveAndExport's job.
export function parseEnvFile(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^﻿/, ""); // strip BOM
    // Skip blank lines + comments
    if (!line.trim() || line.trim().startsWith("#")) continue;

    // Match KEY=VALUE (optional `export ` prefix)
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];

    // Strip inline comments (only when value is unquoted; quoted values
    // can legitimately contain #).
    if (!isQuoted(value)) {
      const hashIdx = findUnquotedHash(value);
      if (hashIdx >= 0) value = value.slice(0, hashIdx);
    }

    value = unquote(value.trim());
    result[key] = value;
  }
  return result;
}

// Resolve a value that MIGHT be a keyring: reference. Returns the resolved
// string. Throws on missing entry / not-installed / malformed reference.
//
// Pass `getCredential` (from keyring.mjs) as the second arg so this module
// is unit-testable without touching the real OS keyring.
export async function resolveValue(value, getCredential, envVarName = "<unknown>") {
  if (typeof value !== "string") return value;
  if (!value.startsWith(KEYRING_PREFIX)) return value;

  const m = value.match(REFERENCE_SHAPE);
  if (!m) {
    const err = new Error(
      `${envVarName}: malformed keyring reference '${value}'. Expected: keyring:<service>/<account>`
    );
    err.code = "MALFORMED_REFERENCE";
    throw err;
  }
  const [, service, account] = m;

  let resolved;
  try {
    resolved = await getCredential(service, account);
  } catch (e) {
    // KEYRING_NOT_INSTALLED / KEYRING_BACKEND_ERROR — rethrow with the
    // env var name attached for diagnostic clarity.
    const err = new Error(
      `${envVarName}: keyring resolution failed for ${service}/${account}. ${e.message}`
    );
    err.code = e.code || "KEYRING_RESOLUTION_FAILED";
    err.cause = e;
    throw err;
  }

  if (resolved === null) {
    const err = new Error(
      `${envVarName}: keyring entry ${service}/${account} not found. ` +
        `Run: bash scripts/collect-credentials.sh <platform>  (or .ps1 on Windows)`
    );
    err.code = "KEYRING_ENTRY_MISSING";
    throw err;
  }
  return resolved;
}

// Top-level entry point. Loads .env.local, resolves any keyring: references,
// writes resolved values to process.env. Idempotent — safe to call multiple
// times (later calls overwrite earlier values).
//
// Options:
//   - root:          project root (defaults to process.cwd())
//   - envFile:       path to env file (defaults to <root>/.env.local)
//   - getCredential: injectable for tests (defaults to ./keyring.mjs)
//   - overwrite:     whether to overwrite existing process.env values
//                    (default: true — env file is authoritative)
export async function loadEnv({
  root = process.cwd(),
  envFile = null,
  getCredential = null,
  overwrite = true,
} = {}) {
  const file = envFile || path.join(root, ".env.local");
  if (!existsSync(file)) {
    // No .env.local — nothing to resolve. Caller may still have process.env
    // populated from another source (shell, hosting provider).
    return { loaded: 0, resolved: 0, errors: [] };
  }

  const text = await fs.readFile(file, "utf8");
  const parsed = parseEnvFile(text);

  // Lazy-import keyring.mjs only if any reference needs resolution.
  let getCredFn = getCredential;
  const hasKeyringRef = Object.values(parsed).some(
    (v) => typeof v === "string" && v.startsWith(KEYRING_PREFIX)
  );
  if (hasKeyringRef && !getCredFn) {
    const keyringMod = await import("./keyring.mjs");
    getCredFn = keyringMod.getCredential;
  }

  let loaded = 0;
  let resolved = 0;
  const errors = [];

  for (const [key, rawValue] of Object.entries(parsed)) {
    try {
      const value = await resolveValue(rawValue, getCredFn, key);
      if (overwrite || !(key in process.env)) {
        process.env[key] = value;
        loaded++;
        if (rawValue !== value) resolved++;
      }
    } catch (e) {
      errors.push({ key, error: e.message, code: e.code });
    }
  }

  return { loaded, resolved, errors };
}

// ─── helpers ─────────────────────────────────────────────────────────────

function isQuoted(s) {
  const t = s.trim();
  return (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  );
}

function unquote(s) {
  if (s.startsWith('"') && s.endsWith('"')) {
    return s
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (s.startsWith("'") && s.endsWith("'")) {
    // Single-quoted strings: no escape processing (POSIX behavior)
    return s.slice(1, -1);
  }
  return s;
}

function findUnquotedHash(s) {
  let inQuote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      if (c === inQuote && s[i - 1] !== "\\") inQuote = null;
      continue;
    }
    if (c === '"' || c === "'") inQuote = c;
    else if (c === "#") return i;
  }
  return -1;
}
