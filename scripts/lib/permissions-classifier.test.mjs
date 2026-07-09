#!/usr/bin/env node
// Smoke tests for permissions-classifier.mjs — v0.3.2 extensions wiring
// pre-flight quota recognition into the LR-04 classifier (ADR-0032 §B).
//
// Run: node scripts/lib/permissions-classifier.test.mjs
// Exit 0 on pass, 1 on any failure.
//
// Scope:
//   - KNOWN_BILLABLE_PLATFORMS / isBillablePlatform() / requiresPreFlightQuota()
//   - parsePermissionsYaml accepts new billable_* sub-keys (no parser change
//     was needed — generic-subkey behavior — but this asserts it)
//   - classifyToolCall returns the new hit shape with matched_via +
//     requires_pre_flight_quota
//   - Billable patterns checked BEFORE generic patterns within the same
//     category (precedence guarantee for ADR-0032 §B)
//   - Existing classifier behavior preserved (regression coverage on
//     destructive_actions + credentials categories)
//   - Real .claude/loom-permissions.yaml: vercel deploy / fly apps create /
//     vercel env add classify as expected

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyToolCall,
  parsePermissionsYaml,
  loadPermissions,
  KNOWN_BILLABLE_PLATFORMS,
  isBillablePlatform,
  requiresPreFlightQuota,
} from "./permissions-classifier.mjs";

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
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

// ── KNOWN_BILLABLE_PLATFORMS / isBillablePlatform ────────────────────────
{
  assert(Array.isArray(KNOWN_BILLABLE_PLATFORMS), "KNOWN_BILLABLE_PLATFORMS exported as array");
  assert(KNOWN_BILLABLE_PLATFORMS.length >= 10, "KNOWN_BILLABLE_PLATFORMS has at least 10 entries");
  assert(Object.isFrozen(KNOWN_BILLABLE_PLATFORMS), "KNOWN_BILLABLE_PLATFORMS is frozen");
  assert(KNOWN_BILLABLE_PLATFORMS.includes("vercel"), "vercel is in KNOWN_BILLABLE_PLATFORMS");
  assert(KNOWN_BILLABLE_PLATFORMS.includes("supabase"), "supabase is in KNOWN_BILLABLE_PLATFORMS");

  assert(isBillablePlatform("vercel"), "isBillablePlatform: vercel");
  assert(isBillablePlatform("VERCEL"), "isBillablePlatform: case-insensitive uppercase");
  assert(isBillablePlatform("  Vercel  ") === false, "isBillablePlatform: does NOT auto-trim (input contract is exact lowercase)");
  assert(!isBillablePlatform("local"), "isBillablePlatform: unknown returns false");
  assert(!isBillablePlatform(""), "isBillablePlatform: empty string false");
  assert(!isBillablePlatform(null), "isBillablePlatform: null safe");
  assert(!isBillablePlatform(undefined), "isBillablePlatform: undefined safe");
  assert(!isBillablePlatform(123), "isBillablePlatform: non-string false");
}

// ── requiresPreFlightQuota predicate ─────────────────────────────────────
{
  assert(requiresPreFlightQuota({ requires_pre_flight_quota: true }), "predicate: true branch");
  assert(!requiresPreFlightQuota({ requires_pre_flight_quota: false }), "predicate: false branch");
  assert(!requiresPreFlightQuota({}), "predicate: missing field → false");
  assert(!requiresPreFlightQuota(null), "predicate: null safe");
  assert(!requiresPreFlightQuota(undefined), "predicate: undefined safe");
}

// ── parsePermissionsYaml: new billable_* sub-keys round-trip ─────────────
{
  const yaml = `
version: "1.0"
categories:
  external_service_setup:
    triggers:
      billable_command_patterns:
        - "\\\\bvercel\\\\s+deploy\\\\b"
        - "\\\\bfly\\\\s+deploy\\\\b"
      billable_mcp_patterns:
        - "mcp__.*__deploy_vercel"
      command_patterns:
        - "\\\\bvercel\\\\s+env\\\\b"
      mcp_patterns:
        - "mcp__.*__configure_.*"
    required_protocol:
      - present_action: "test"
    enforcement: "soft"
`;
  const parsed = parsePermissionsYaml(yaml);
  const cat = parsed.categories.external_service_setup;
  assert(!!cat, "parse: external_service_setup category present");
  assertEq(cat.triggers.billable_command_patterns?.length, 2, "parse: 2 billable_command_patterns");
  assertEq(cat.triggers.billable_mcp_patterns?.length, 1, "parse: 1 billable_mcp_pattern");
  assertEq(cat.triggers.command_patterns?.length, 1, "parse: 1 command_pattern");
  assertEq(cat.triggers.mcp_patterns?.length, 1, "parse: 1 mcp_pattern");
}

// ── classifyToolCall with synthetic config ───────────────────────────────

// Build a minimal config for deterministic testing
const synth = parsePermissionsYaml(`
version: "1.0"
categories:
  external_service_setup:
    triggers:
      billable_command_patterns:
        - "\\\\bvercel\\\\s+deploy\\\\b"
        - "\\\\bfly\\\\s+apps\\\\s+create\\\\b"
      billable_mcp_patterns:
        - "mcp__.*__deploy_vercel"
      command_patterns:
        - "\\\\bvercel\\\\s+env\\\\b"
        - "\\\\bgh\\\\s+repo\\\\s+create\\\\b"
      mcp_patterns:
        - "mcp__.*__configure_.*"
    required_protocol:
      - present_action: "test"
    enforcement: "soft"

  destructive_actions:
    triggers:
      command_patterns:
        - "\\\\bvercel\\\\s+deploy\\\\b"
        - "\\\\brm\\\\s+-rf\\\\b"
    required_protocol:
      - constitution_service: "required"
    enforcement: "hard"
`);

// Test: vercel deploy → external_service_setup hit with quota flag
{
  const hits = classifyToolCall({
    tool: "Bash",
    input: { command: "vercel deploy --prod" },
    permissions: synth,
  });
  const ess = hits.find((h) => h.category === "external_service_setup");
  assert(!!ess, "vercel deploy: external_service_setup hit present");
  assertEq(ess?.requires_pre_flight_quota, true, "vercel deploy: requires_pre_flight_quota = true");
  assertEq(ess?.matched_via, "billable_command_patterns", "vercel deploy: matched_via = billable_command_patterns");
  assert(requiresPreFlightQuota(ess), "vercel deploy: predicate agrees");

  const da = hits.find((h) => h.category === "destructive_actions");
  assert(!!da, "vercel deploy: also triggers destructive_actions (existing pattern)");
}

// Test: fly apps create (no destructive_actions overlap in synth config) →
// only external_service_setup with quota flag
{
  const hits = classifyToolCall({
    tool: "Bash",
    input: { command: "fly apps create my-app" },
    permissions: synth,
  });
  assertEq(hits.length, 1, "fly apps create: exactly one hit");
  assertEq(hits[0].category, "external_service_setup", "fly apps create: external_service_setup");
  assertEq(hits[0].requires_pre_flight_quota, true, "fly apps create: quota flag set");
  assertEq(hits[0].matched_via, "billable_command_patterns", "fly apps create: matched_via");
}

// Test: vercel env add → external_service_setup hit WITHOUT quota flag
// (config-only op on external service)
{
  const hits = classifyToolCall({
    tool: "Bash",
    input: { command: "vercel env add MY_SECRET production" },
    permissions: synth,
  });
  const ess = hits.find((h) => h.category === "external_service_setup");
  assert(!!ess, "vercel env add: external_service_setup hit present");
  assertEq(ess?.requires_pre_flight_quota, false, "vercel env add: quota flag NOT set");
  assertEq(ess?.matched_via, "command_patterns", "vercel env add: matched_via = command_patterns");
  assert(!requiresPreFlightQuota(ess), "vercel env add: predicate agrees");
}

// Test: precedence — when a command would match BOTH billable and generic
// patterns in the same category, billable wins.
{
  const precConfig = parsePermissionsYaml(`
version: "1.0"
categories:
  external_service_setup:
    triggers:
      billable_command_patterns:
        - "\\\\bvercel\\\\b"
      command_patterns:
        - "\\\\bvercel\\\\s+env\\\\b"
    enforcement: "soft"
`);
  const hits = classifyToolCall({
    tool: "Bash",
    input: { command: "vercel env add FOO" },
    permissions: precConfig,
  });
  assertEq(hits.length, 1, "precedence: one hit even though both patterns match");
  assertEq(
    hits[0].matched_via,
    "billable_command_patterns",
    "precedence: billable wins over generic"
  );
  assertEq(hits[0].requires_pre_flight_quota, true, "precedence: quota flag set");
}

// Test: MCP billable pattern → tool name match, quota flag set
{
  const hits = classifyToolCall({
    tool: "mcp__vercel__deploy_vercel",
    input: {},
    permissions: synth,
  });
  const ess = hits.find((h) => h.category === "external_service_setup");
  assert(!!ess, "MCP deploy: hit present");
  assertEq(ess?.requires_pre_flight_quota, true, "MCP deploy: quota flag set");
  assertEq(ess?.matched_via, "billable_mcp_patterns", "MCP deploy: matched_via");
  assertEq(ess?.matched_on, "mcp__vercel__deploy_vercel", "MCP deploy: matched_on = tool name");
}

// Test: MCP non-billable pattern (configure) → no quota flag
{
  const hits = classifyToolCall({
    tool: "mcp__vercel__configure_project",
    input: {},
    permissions: synth,
  });
  const ess = hits.find((h) => h.category === "external_service_setup");
  assert(!!ess, "MCP configure: hit present");
  assertEq(ess?.requires_pre_flight_quota, false, "MCP configure: quota flag NOT set");
  assertEq(ess?.matched_via, "mcp_patterns", "MCP configure: matched_via = mcp_patterns");
}

// Test: completely unrelated command → no hits
{
  const hits = classifyToolCall({
    tool: "Bash",
    input: { command: "ls -la" },
    permissions: synth,
  });
  assertEq(hits.length, 0, "unrelated command: zero hits");
}

// Test: empty config / no permissions → empty hits
{
  assertEq(classifyToolCall({ tool: "Bash", input: { command: "vercel deploy" } }), [],
    "no permissions arg: empty hits");
  assertEq(
    classifyToolCall({ tool: "Bash", input: { command: "vercel deploy" }, permissions: {} }),
    [],
    "empty permissions: empty hits"
  );
}

// Test: regression — destructive_actions still works as before
{
  const hits = classifyToolCall({
    tool: "Bash",
    input: { command: "rm -rf node_modules" },
    permissions: synth,
  });
  const da = hits.find((h) => h.category === "destructive_actions");
  assert(!!da, "regression: rm -rf hits destructive_actions");
  assertEq(da?.requires_pre_flight_quota, false, "regression: destructive without billable flag");
  assertEq(da?.enforcement, "hard", "regression: enforcement preserved");
}

// ── Integration: real .claude/loom-permissions.yaml ──────────────────────
{
  // Use fileURLToPath (not a hand-rolled regex on URL.pathname) so Windows
  // drive-letter casing + URL-encoding resolve correctly and deterministically
  // (the old regex only matched an UPPERCASE drive → intermittently produced a
  // malformed path → existsSync false → this whole block silently skipped). OB-X-05.
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const yamlPath = path.join(repoRoot, ".claude", "loom-permissions.yaml");
  if (existsSync(yamlPath)) {
    const real = await loadPermissions(repoRoot);
    assert(!!real.categories?.external_service_setup, "real config: external_service_setup present");
    assert(
      (real.categories.external_service_setup.triggers.billable_command_patterns || []).length > 0,
      "real config: billable_command_patterns populated"
    );

    // vercel deploy should hit billable
    const deployHits = classifyToolCall({
      tool: "Bash",
      input: { command: "vercel deploy --prod" },
      permissions: real,
    });
    const ess = deployHits.find((h) => h.category === "external_service_setup");
    assert(!!ess, "real config: vercel deploy classified as external_service_setup");
    assertEq(ess?.requires_pre_flight_quota, true, "real config: vercel deploy → quota required");

    // vercel env (without deploy) should classify but NOT require quota
    const envHits = classifyToolCall({
      tool: "Bash",
      input: { command: "vercel env add MY_KEY production" },
      permissions: real,
    });
    const envEss = envHits.find((h) => h.category === "external_service_setup");
    assert(!!envEss, "real config: vercel env add classified as external_service_setup");
    assertEq(envEss?.requires_pre_flight_quota, false, "real config: vercel env add → quota NOT required");

    // fly apps create should hit billable
    const flyHits = classifyToolCall({
      tool: "Bash",
      input: { command: "fly apps create my-app" },
      permissions: real,
    });
    const flyEss = flyHits.find((h) => h.category === "external_service_setup");
    assert(!!flyEss, "real config: fly apps create classified");
    assertEq(flyEss?.requires_pre_flight_quota, true, "real config: fly apps create → quota required");
  } else {
    process.stdout.write("  skip: real loom-permissions.yaml not present\n");
  }
}

// ── Report ───────────────────────────────────────────────────────────────
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.stderr.write("\nfailures:\n");
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
process.exit(0);
