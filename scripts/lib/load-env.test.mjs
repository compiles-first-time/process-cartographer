#!/usr/bin/env node
// Tests for scripts/lib/load-env.mjs — keyring-reference resolution.
//
// Run: node scripts/lib/load-env.test.mjs
// Exit 0 on pass, 1 on any failure.
//
// Uses an injectable mock `getCredential` to test the resolver without
// touching the real OS keyring. The keyring.mjs module itself is integration-
// tested by the collect-credentials script's end-to-end flow.

import { parseEnvFile, resolveValue, loadEnv } from "./load-env.mjs";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) passed++;
  else {
    failed++;
    failures.push(msg);
    process.stderr.write(`  FAIL: ${msg}\n`);
  }
}
function assertEq(actual, expected, msg) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}
async function assertThrows(fn, expectedCode, msg) {
  try {
    await fn();
    failed++;
    failures.push(`${msg} — expected throw with code ${expectedCode}, got success`);
    process.stderr.write(`  FAIL: ${msg}\n`);
  } catch (e) {
    if (e.code === expectedCode) passed++;
    else {
      failed++;
      failures.push(`${msg} — expected code ${expectedCode}, got ${e.code} (${e.message})`);
      process.stderr.write(`  FAIL: ${msg}\n`);
    }
  }
}

// ── parseEnvFile ─────────────────────────────────────────────────────────
{
  const out = parseEnvFile(`
# A comment
FOO=bar
BAZ="quoted value"
EMPTY=
QUOTED_WITH_HASH="value#not_a_comment"
WITH_COMMENT=value # this is a comment
SPACED = spaced_value
SINGLE='no \\n escape'
`);
  assertEq(out.FOO, "bar", "parse: bare KEY=value");
  assertEq(out.BAZ, "quoted value", "parse: double-quoted value");
  assertEq(out.EMPTY, "", "parse: empty value");
  assertEq(out.QUOTED_WITH_HASH, "value#not_a_comment", "parse: # inside quotes is literal");
  assertEq(out.WITH_COMMENT, "value", "parse: # outside quotes is comment");
  assertEq(out.SPACED, "spaced_value", "parse: whitespace around =");
  assertEq(out.SINGLE, "no \\n escape", "parse: single quotes are literal (no escape)");
}

// ── resolveValue: literal pass-through ───────────────────────────────────
{
  const mockGet = async () => "should_not_be_called";
  const result = await resolveValue("literal_value", mockGet, "TEST");
  assertEq(result, "literal_value", "resolve: literal value passes through");

  const empty = await resolveValue("", mockGet, "TEST");
  assertEq(empty, "", "resolve: empty string passes through");
}

// ── resolveValue: keyring reference happy path ───────────────────────────
{
  let calledService, calledAccount;
  const mockGet = async (svc, acc) => {
    calledService = svc;
    calledAccount = acc;
    return "the-resolved-secret";
  };
  const result = await resolveValue("keyring:loom-myapp/supabase-pat", mockGet, "PAT");
  assertEq(result, "the-resolved-secret", "resolve: keyring ref returns the credential value");
  assertEq(calledService, "loom-myapp", "resolve: service parsed correctly");
  assertEq(calledAccount, "supabase-pat", "resolve: account parsed correctly");
}

// ── resolveValue: account with slash (e.g., GitHub repo path) ────────────
{
  // Account names can contain slashes (e.g., "github-token/myorg") because
  // the SHAPE only requires <service>/<rest>; the rest is the account.
  let captured;
  const mockGet = async (svc, acc) => {
    captured = { svc, acc };
    return "ok";
  };
  await resolveValue("keyring:my-service/account/with/slashes", mockGet, "X");
  assertEq(captured.svc, "my-service", "resolve: service is first segment");
  assertEq(captured.acc, "account/with/slashes", "resolve: account is everything after first /");
}

// ── resolveValue: missing entry ──────────────────────────────────────────
{
  const mockGet = async () => null;
  await assertThrows(
    () => resolveValue("keyring:loom-x/missing", mockGet, "MISSING_VAR"),
    "KEYRING_ENTRY_MISSING",
    "resolve: null credential throws KEYRING_ENTRY_MISSING"
  );
}

// ── resolveValue: malformed reference (no slash) ─────────────────────────
{
  const mockGet = async () => "x";
  await assertThrows(
    () => resolveValue("keyring:no-slash-at-all", mockGet, "BAD_VAR"),
    "MALFORMED_REFERENCE",
    "resolve: missing slash throws MALFORMED_REFERENCE"
  );
}

// ── resolveValue: keyring backend error propagates ───────────────────────
{
  const mockGet = async () => {
    const err = new Error("backend unreachable");
    err.code = "KEYRING_BACKEND_ERROR";
    throw err;
  };
  await assertThrows(
    () => resolveValue("keyring:s/a", mockGet, "VAR"),
    "KEYRING_BACKEND_ERROR",
    "resolve: backend error code propagates"
  );
}

// ── resolveValue: non-string passes through ──────────────────────────────
{
  const mockGet = async () => "x";
  const num = await resolveValue(42, mockGet, "NUM");
  assertEq(num, 42, "resolve: non-string returns unchanged");
}

// ── loadEnv: end-to-end with temp .env.local ─────────────────────────────
{
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loom-loadenv-test-"));
  const envFile = path.join(tmpDir, ".env.local");
  await fs.writeFile(
    envFile,
    `
# Test env
DATABASE_URL=postgresql://localhost:5432/db
SUPABASE_PAT=keyring:loom-test/supabase-pat
EMPTY=
LITERAL_WITH_PREFIX_LOOKALIKE=keyring_but_no_colon
`,
    "utf8"
  );

  // Snapshot + clear the relevant env vars before the test
  const before = {
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_PAT: process.env.SUPABASE_PAT,
  };
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_PAT;

  const mockGet = async (svc, acc) =>
    svc === "loom-test" && acc === "supabase-pat" ? "the-pat-value" : null;
  const result = await loadEnv({ envFile, getCredential: mockGet, overwrite: true });

  assertEq(result.errors, [], "loadEnv: no errors on clean run");
  assert(result.loaded >= 3, "loadEnv: loaded at least 3 vars");
  assertEq(result.resolved, 1, "loadEnv: resolved exactly 1 keyring ref");
  assertEq(
    process.env.DATABASE_URL,
    "postgresql://localhost:5432/db",
    "loadEnv: literal value in process.env"
  );
  assertEq(process.env.SUPABASE_PAT, "the-pat-value", "loadEnv: keyring ref resolved to value");
  assertEq(
    process.env.LITERAL_WITH_PREFIX_LOOKALIKE,
    "keyring_but_no_colon",
    "loadEnv: lookalike is treated as literal (no keyring: prefix)"
  );

  // Restore + cleanup
  if (before.DATABASE_URL !== undefined) process.env.DATABASE_URL = before.DATABASE_URL;
  else delete process.env.DATABASE_URL;
  if (before.SUPABASE_PAT !== undefined) process.env.SUPABASE_PAT = before.SUPABASE_PAT;
  else delete process.env.SUPABASE_PAT;
  await fs.rm(tmpDir, { recursive: true, force: true });
}

// ── loadEnv: missing .env.local is graceful ──────────────────────────────
{
  const result = await loadEnv({ envFile: "/path/that/does/not/exist/.env.local" });
  assertEq(result.loaded, 0, "loadEnv: missing file returns loaded=0");
  assertEq(result.resolved, 0, "loadEnv: missing file returns resolved=0");
  assertEq(result.errors, [], "loadEnv: missing file does not throw");
}

// ── loadEnv: errors don't abort the whole load ───────────────────────────
{
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "loom-loadenv-test-"));
  const envFile = path.join(tmpDir, ".env.local");
  await fs.writeFile(
    envFile,
    `GOOD=literal_ok\nBROKEN=keyring:no-slash\nALSO_GOOD=another_literal\n`,
    "utf8"
  );
  delete process.env.GOOD;
  delete process.env.ALSO_GOOD;
  delete process.env.BROKEN;
  const mockGet = async () => "x";
  const result = await loadEnv({ envFile, getCredential: mockGet, overwrite: true });
  assertEq(result.errors.length, 1, "loadEnv: 1 error for the broken ref");
  assertEq(result.errors[0].key, "BROKEN", "loadEnv: error attributes the right var");
  assertEq(result.errors[0].code, "MALFORMED_REFERENCE", "loadEnv: error has the right code");
  assertEq(
    process.env.GOOD,
    "literal_ok",
    "loadEnv: good var loaded despite broken sibling"
  );
  assertEq(
    process.env.ALSO_GOOD,
    "another_literal",
    "loadEnv: later good var loaded despite earlier broken sibling"
  );
  delete process.env.GOOD;
  delete process.env.ALSO_GOOD;
  await fs.rm(tmpDir, { recursive: true, force: true });
}

// ── report ───────────────────────────────────────────────────────────────
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.stderr.write("\nfailures:\n");
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
process.exit(0);
