#!/usr/bin/env node
// Smoke tests for wait-for-deploy.mjs (the wait-for-terminal-state primitive
// introduced by ADR-0032 §A — deployment hardening).
//
// Run: node scripts/lib/wait-for-deploy.test.mjs
// Exit 0 on pass, 1 on any failure.
//
// Hits all four outcomes against synthetic Vercel-shaped event streams:
//   1. succeeded             — stream transitions BUILDING → READY
//   2. failed                — stream transitions BUILDING → ERROR
//   3. non_progressing       (explicit_state) — stream goes BUILDING → UNKNOWN
//   4. non_progressing       (in_progress_timeout) — stream stays in BUILDING past the threshold
//   5. non_progressing       (stall) — stream produces no events for stallMs
//   6. raw_line extraction   — stream provides only raw_line; matcher extracts state

import { waitForDeploy, extractStateFromLine, TERMINAL_STATES } from "./wait-for-deploy.mjs";

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

// Synthetic clock so tests run in milliseconds, not minutes.
function makeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => { t += ms; },
  };
}

// Synthetic events generator with explicit tick timestamps.
async function* scriptedEvents(ticks) {
  for (const tick of ticks) {
    yield tick;
  }
}

// ── Test 1: succeeded ────────────────────────────────────────────────────
{
  const clock = makeClock(0);
  const events = scriptedEvents([
    { state: "BUILDING", at: 0 },
    { state: "BUILDING", at: 1000 },
    { state: "READY", at: 2000 },
  ]);
  const r = await waitForDeploy({
    platform: "vercel",
    events,
    clock: clock.now,
    maxInProgressMs: 10 * 60 * 1000,
    stallMs: 10 * 60 * 1000,
  });
  assert(r.outcome === "succeeded", `test 1 succeeded: outcome was ${r.outcome}`);
  assert(r.state === "READY", `test 1 succeeded: state was ${r.state}`);
  assert(r.transitions.length === 2, `test 1 succeeded: ${r.transitions.length} transitions (expected 2)`);
}

// ── Test 2: failed ───────────────────────────────────────────────────────
{
  const clock = makeClock(0);
  const events = scriptedEvents([
    { state: "BUILDING", at: 0 },
    { state: "ERROR", at: 1500, body: { reason: "deploy_failed" } },
  ]);
  const r = await waitForDeploy({
    platform: "vercel",
    events,
    clock: clock.now,
    maxInProgressMs: 10 * 60 * 1000,
    stallMs: 10 * 60 * 1000,
  });
  assert(r.outcome === "failed", `test 2 failed: outcome was ${r.outcome}`);
  assert(r.state === "ERROR", `test 2 failed: state was ${r.state}`);
  assert(r.body?.reason === "deploy_failed", `test 2 failed: body not propagated`);
}

// ── Test 3: non_progressing (explicit_state UNKNOWN) ─────────────────────
{
  const events = scriptedEvents([
    { state: "BUILDING", at: 0 },
    { state: "UNKNOWN", at: 1000 },
  ]);
  let progressNonProgressing = null;
  const r = await waitForDeploy({
    platform: "vercel",
    events,
    maxInProgressMs: 10 * 60 * 1000,
    stallMs: 10 * 60 * 1000,
    onProgress: (e) => { if (e.event === "non_progressing") progressNonProgressing = e; },
  });
  assert(r.outcome === "non_progressing", `test 3: outcome was ${r.outcome}`);
  assert(r.reason === "explicit_state", `test 3: reason was ${r.reason}`);
  assert(r.state === "UNKNOWN", `test 3: state was ${r.state}`);
  assert(!!progressNonProgressing, `test 3: onProgress non_progressing event not fired`);
  assert(!!progressNonProgressing?.message, `test 3: non_progressing event lacked .message`);
}

// ── Test 4: non_progressing (in_progress_timeout) ────────────────────────
{
  const events = scriptedEvents([
    { state: "BUILDING", at: 0 },
    { state: "BUILDING", at: 500 },
    { state: "BUILDING", at: 1500 },  // > maxInProgressMs of 1000
  ]);
  const r = await waitForDeploy({
    platform: "vercel",
    events,
    maxInProgressMs: 1000,
    stallMs: 10 * 60 * 1000,
  });
  assert(r.outcome === "non_progressing", `test 4: outcome was ${r.outcome}`);
  assert(r.reason === "in_progress_timeout", `test 4: reason was ${r.reason}`);
  assert(r.state === "BUILDING", `test 4: state was ${r.state}`);
}

// ── Test 5: non_progressing (stall — no events for stallMs) ──────────────
{
  // Generator that yields once then sleeps long enough for stall to fire.
  async function* slowEvents() {
    yield { state: "BUILDING", at: Date.now() };
    await new Promise((r) => setTimeout(r, 300));
  }
  const r = await waitForDeploy({
    platform: "vercel",
    events: slowEvents(),
    maxInProgressMs: 10 * 60 * 1000,
    stallMs: 100,
  });
  assert(r.outcome === "non_progressing", `test 5: outcome was ${r.outcome}`);
  assert(r.reason === "stall" || r.reason === "stream_ended_without_terminal_state",
    `test 5: reason was ${r.reason}`);
}

// ── Test 6: raw_line extraction ──────────────────────────────────────────
{
  const events = scriptedEvents([
    { raw_line: "Deployment QUEUED ... starting", at: 0 },
    { raw_line: "Status: BUILDING", at: 1000 },
    { raw_line: "Production: READY in 4.2s", at: 2000 },
  ]);
  const r = await waitForDeploy({
    platform: "vercel",
    events,
    maxInProgressMs: 10 * 60 * 1000,
    stallMs: 10 * 60 * 1000,
  });
  assert(r.outcome === "succeeded", `test 6 raw_line: outcome was ${r.outcome}`);
  assert(r.state === "READY", `test 6 raw_line: state was ${r.state}`);
}

// ── Test 7: extractStateFromLine boundary correctness ────────────────────
{
  const reg = TERMINAL_STATES.vercel;
  // ALREADY contains "READY" but should NOT match (word-boundary).
  assert(extractStateFromLine(reg, "App is ALREADY in production") === null,
    "test 7a: 'ALREADY' incorrectly matched READY");
  // "Ready" word in a sentence matches READY.
  assert(extractStateFromLine(reg, "deploy reports state: Ready") === "READY",
    "test 7b: 'Ready' not matched as READY");
  // ERROR inside a longer compound state - should NOT cross-match Vercel's "ERROR" with Render's "BUILD_FAILED"
  assert(extractStateFromLine(reg, "MIRRORED to backup") === null,
    "test 7c: 'MIRRORED' incorrectly matched ERROR");
}

// ── Test 8: unknown platform raises ──────────────────────────────────────
{
  let threw = false;
  try {
    await waitForDeploy({ platform: "unknown_xyz", events: scriptedEvents([]) });
  } catch (e) {
    threw = e.message.includes("unknown platform");
  }
  assert(threw, "test 8: did not throw on unknown platform");
}

// ── Test 9: Render BUILD_FAILED matches before FAILED ────────────────────
{
  const reg = TERMINAL_STATES.render;
  assert(extractStateFromLine(reg, "Status: BUILD_FAILED at step 3") === "BUILD_FAILED",
    "test 9: did not prefer BUILD_FAILED over FAILED");
}

// ── Report ───────────────────────────────────────────────────────────────
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.stderr.write("\nfailures:\n");
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
process.exit(0);
