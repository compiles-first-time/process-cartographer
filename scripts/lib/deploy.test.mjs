#!/usr/bin/env node
// Smoke tests for deploy.mjs — the v0.3.2 integration of waitForDeploy()
// into the deploy primitive (ADR-0019 + ADR-0032 §A).
//
// Run: node scripts/lib/deploy.test.mjs
// Exit 0 on pass, 1 on any failure.
//
// Scope:
//   - createLineQueue() chunk/line/close semantics
//   - resolvePlatform() explicit wins; auto-detect from command basename;
//     aliases; unknown
//   - computeHealth() composite of exit code + wait outcome (ADR-0032 §C)
//   - runDeployWithWatch() with a stubbed spawn that emulates child_process —
//     succeeded, failed (exit nonzero), failed (exit zero with ERROR token
//     in output — the §C "exit code lies" case), non_progressing (explicit
//     UNKNOWN state), and the no-platform fallback path
//
// Stubbed spawn pattern: returns an object with .stdout/.stderr that are
// EventEmitter-like, plus .on("close"|"error", fn) and .kill(). The test
// drives chunks into the streams on a microtask to simulate real-time arrival.

import { EventEmitter } from "node:events";
import {
  createLineQueue,
  resolvePlatform,
  computeHealth,
  runDeployWithWatch,
} from "./deploy.mjs";

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

// ── createLineQueue ──────────────────────────────────────────────────────
{
  const q = createLineQueue();
  q.pushChunk("hello\nworld\npartial");
  q.pushChunk(" line\nfinal");
  q.close();
  const collected = [];
  for await (const line of q) collected.push(line);
  assertEq(
    collected,
    ["hello", "world", "partial line", "final"],
    "createLineQueue: chunk-split + partial-line + close-flush"
  );
}

// Line queue strips trailing \r (handles CRLF cleanly)
{
  const q = createLineQueue();
  q.pushChunk("ready\r\nbuilding\r\n");
  q.close();
  const collected = [];
  for await (const line of q) collected.push(line);
  assertEq(collected, ["ready", "building"], "createLineQueue: CRLF stripping");
}

// Line queue: consumer-before-producer pattern
{
  const q = createLineQueue();
  const consumed = [];
  const consumer = (async () => {
    for await (const line of q) consumed.push(line);
  })();
  // Push after consumer started waiting
  setImmediate(() => {
    q.pushChunk("a\nb\n");
    q.close();
  });
  await consumer;
  assertEq(consumed, ["a", "b"], "createLineQueue: consumer-before-producer pattern");
}

// ── resolvePlatform ──────────────────────────────────────────────────────
{
  assertEq(
    resolvePlatform({ deploy: { platform: "vercel", command: "anything" } }),
    "vercel",
    "resolvePlatform: explicit wins over command"
  );
  assertEq(
    resolvePlatform({ deploy: { platform: "  NETLIFY  " } }),
    "netlify",
    "resolvePlatform: explicit is trimmed and lowercased"
  );
  assertEq(
    resolvePlatform({ deploy: { platform: "unknownland" } }),
    null,
    "resolvePlatform: explicit but unknown returns null"
  );
  assertEq(
    resolvePlatform({ deploy: { command: "vercel" } }),
    "vercel",
    "resolvePlatform: auto-detect bare command"
  );
  assertEq(
    resolvePlatform({ deploy: { command: "C:\\bin\\netlify.exe" } }),
    "netlify",
    "resolvePlatform: strips path + .exe"
  );
  assertEq(
    resolvePlatform({ deploy: { command: "flyctl" } }),
    "fly",
    "resolvePlatform: flyctl alias → fly"
  );
  assertEq(
    resolvePlatform({ deploy: { command: "bash" } }),
    null,
    "resolvePlatform: wrapper command returns null"
  );
  assertEq(resolvePlatform({}), null, "resolvePlatform: empty config returns null");
}

// ── computeHealth ────────────────────────────────────────────────────────
{
  assertEq(
    computeHealth(0, { outcome: "succeeded" }),
    "succeeded",
    "health: exit=0 + wait=succeeded → succeeded"
  );
  assertEq(
    computeHealth(1, { outcome: "failed" }),
    "failed",
    "health: exit=1 + wait=failed → failed"
  );
  assertEq(
    computeHealth(0, { outcome: "failed" }),
    "failed",
    "health: exit=0 + wait=failed → failed (§C — wait beats exit)"
  );
  assertEq(
    computeHealth(1, { outcome: "succeeded" }),
    "degraded",
    "health: exit=1 + wait=succeeded → degraded (CLI lied post-success)"
  );
  assertEq(
    computeHealth(0, { outcome: "non_progressing" }),
    "degraded",
    "health: wait=non_progressing → degraded"
  );
  assertEq(
    computeHealth(0, null),
    "succeeded",
    "health: no wait outcome + exit=0 → succeeded (no platform fallback)"
  );
  assertEq(
    computeHealth(2, null),
    "failed",
    "health: no wait outcome + exit nonzero → failed"
  );
}

// ── runDeployWithWatch (stubbed spawn) ───────────────────────────────────

// Stub: emit chunks on microtask, then "close" with a configurable exit code.
// Each chunk is delivered via setImmediate so async consumers race correctly.
function makeStubSpawn({ chunks = [], exitCode = 0, stderrChunks = [], emitError = null }) {
  return function stubSpawn() {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => proc.emit("close", 143); // SIGTERM exit
    setImmediate(async () => {
      for (const c of chunks) {
        proc.stdout.emit("data", Buffer.from(c));
        await new Promise((r) => setImmediate(r));
      }
      for (const c of stderrChunks) {
        proc.stderr.emit("data", Buffer.from(c));
        await new Promise((r) => setImmediate(r));
      }
      if (emitError) {
        proc.emit("error", new Error(emitError));
      } else {
        proc.emit("close", exitCode);
      }
    });
    return proc;
  };
}

// Test: vercel succeeded path
{
  const r = await runDeployWithWatch({
    command: "vercel",
    argv: ["--prod"],
    cwd: process.cwd(),
    platform: "vercel",
    spawnFn: makeStubSpawn({
      chunks: ["Status: BUILDING\n", "Production: READY in 3s\n"],
      exitCode: 0,
    }),
    echo: false,
  });
  assertEq(r.exitCode, 0, "runDeployWithWatch: succeeded exit code");
  assertEq(r.waitOutcome?.outcome, "succeeded", "runDeployWithWatch: wait outcome = succeeded");
  assertEq(r.waitOutcome?.state, "READY", "runDeployWithWatch: terminal state = READY");
  assert(r.stdout.includes("READY"), "runDeployWithWatch: stdout captured");
}

// Test: §C — exit zero with ERROR token in output (the lying CLI case)
{
  let nonProgressingFired = false;
  const r = await runDeployWithWatch({
    command: "vercel",
    argv: [],
    cwd: process.cwd(),
    platform: "vercel",
    spawnFn: makeStubSpawn({
      chunks: ["BUILDING\n", 'Status: ERROR — reason: "deploy_failed"\n'],
      exitCode: 0, // CLI lies
    }),
    onProgress: (e) => {
      if (e.event === "non_progressing") nonProgressingFired = true;
    },
    echo: false,
  });
  assertEq(r.exitCode, 0, "lying-exit: process exit is 0");
  assertEq(r.waitOutcome?.outcome, "failed", "lying-exit: wait outcome catches the ERROR");
  assertEq(
    computeHealth(r.exitCode, r.waitOutcome),
    "failed",
    "lying-exit: composite health = failed (ADR-0032 §C honored)"
  );
  assert(!nonProgressingFired, "lying-exit: non_progressing should NOT fire (terminal failure)");
}

// Test: non_progressing via explicit UNKNOWN
{
  let nonProgressingEvent = null;
  const r = await runDeployWithWatch({
    command: "vercel",
    argv: [],
    cwd: process.cwd(),
    platform: "vercel",
    spawnFn: makeStubSpawn({
      chunks: ["BUILDING\n", "Status: UNKNOWN\n"],
      exitCode: 0,
    }),
    onProgress: (e) => {
      if (e.event === "non_progressing") nonProgressingEvent = e;
    },
    echo: false,
  });
  assertEq(r.waitOutcome?.outcome, "non_progressing", "unknown-state: wait outcome");
  assertEq(r.waitOutcome?.reason, "explicit_state", "unknown-state: reason");
  assert(nonProgressingEvent !== null, "unknown-state: onProgress fired non_progressing");
  assert(
    !!nonProgressingEvent?.message,
    "unknown-state: non_progressing carries a human-readable message"
  );
  assertEq(
    computeHealth(r.exitCode, r.waitOutcome),
    "degraded",
    "unknown-state: composite health = degraded"
  );
}

// Test: --abort-on-stall kills subprocess on non_progressing
{
  let killed = false;
  function killTrackingSpawn() {
    const base = makeStubSpawn({
      chunks: ["BUILDING\n", "Status: UNKNOWN\n"],
      exitCode: 0,
    })();
    const realKill = base.kill;
    base.kill = (sig) => {
      killed = true;
      return realKill(sig);
    };
    return base;
  }
  await runDeployWithWatch({
    command: "vercel",
    argv: [],
    cwd: process.cwd(),
    platform: "vercel",
    abortOnStall: true,
    spawnFn: killTrackingSpawn,
    echo: false,
  });
  assert(killed, "abort-on-stall: subprocess kill() invoked on non_progressing");
}

// Test: no-platform fallback (waitOutcome stays null, no error)
{
  const r = await runDeployWithWatch({
    command: "bash",
    argv: ["my-deploy.sh"],
    cwd: process.cwd(),
    platform: null,
    spawnFn: makeStubSpawn({ chunks: ["doing things\n", "done\n"], exitCode: 0 }),
    echo: false,
  });
  assertEq(r.exitCode, 0, "no-platform: exit code preserved");
  assertEq(r.waitOutcome, null, "no-platform: waitOutcome stays null");
  assertEq(
    computeHealth(r.exitCode, r.waitOutcome),
    "succeeded",
    "no-platform: composite health falls back to exit code"
  );
}

// Test: subprocess emits 'error' event — onProgress should not be required, exit reported as 1
{
  const r = await runDeployWithWatch({
    command: "ghost-binary",
    argv: [],
    cwd: process.cwd(),
    platform: "vercel",
    spawnFn: makeStubSpawn({ emitError: "spawn ENOENT" }),
    echo: false,
  });
  assertEq(r.exitCode, 1, "spawn-error: exit code = 1");
  assert(r.stderr.includes("ENOENT"), "spawn-error: error surfaces in stderr capture");
}

// ── Report ───────────────────────────────────────────────────────────────
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.stderr.write("\nfailures:\n");
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
process.exit(0);
