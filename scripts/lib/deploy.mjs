#!/usr/bin/env node
// `loom deploy` — Loom's deploy primitive.
//
// Per ADR-0019, extended by ADR-0032 §A (wait-for-terminal-state integration).
// Wraps a runtime-specific deploy command with:
//   1. loom doctor must pass (override with --force)
//   2. session_start event must exist for this session (sanity that hooks ran)
//   3. Constitution-service consultation prompt (Y/n) (skip with --yes)
//   4. Run the deploy command — stdout/stderr also feed waitForDeploy() so
//      `non_progressing` deploys (stuck BUILDING, explicit UNKNOWN, stalled
//      stream) are surfaced loudly instead of hanging silently.
//   5. Extract deployment URL via configured regex; emit deployment_started,
//      deployment_completed, and (when applicable) deployment_non_progressing
//      events to the JSONL log.
//
// Configured by tools/runtime.yaml. Platform identifier (`deploy.platform`)
// drives which TERMINAL_STATES registry waitForDeploy uses; auto-detected
// from `deploy.command` basename when not set explicitly.
//
// Flags:
//   --force            skip loom doctor + hook-coverage sanity
//   --yes / -y         skip constitution-service consultation prompt
//   --abort-on-stall   kill the deploy subprocess if waitForDeploy reports
//                      non_progressing (default: observe + log, do not kill)

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { checkDiscoveryGate } from "./discovery-gate.mjs";
import { waitForDeploy, lineStreamEvents, TERMINAL_STATES } from "./wait-for-deploy.mjs";

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const FORCE = args.has("--force");
const YES = args.has("--yes") || args.has("-y");
const ABORT_ON_STALL = args.has("--abort-on-stall");

const RUNTIME_YAML = path.join(ROOT, "tools", "runtime.yaml");
const EVENT_LOG_DIR = path.join(ROOT, "memory", "event-log");

// Run main() only when executed directly. Without this guard, importing any
// named export (createLineQueue, resolvePlatform, computeHealth, etc.) would
// trigger a full deploy flow on module load. This file is intentionally a
// library + script hybrid as of v0.3.2 — deploy.test.mjs depends on the
// imports staying side-effect-free.
const isMain = (() => {
  try {
    const here = fileURLToPath(import.meta.url);
    const invoked = process.argv[1] ? path.resolve(process.argv[1]) : null;
    return invoked != null && path.resolve(here) === invoked;
  } catch {
    return false;
  }
})();
if (isMain) await main();

async function main() {
  const config = await loadRuntimeConfig();
  const sessionId = process.env.CLAUDE_SESSION_ID || `local-${Date.now()}`;

  // ── Step 0: discovery gate (v0.5, ADR-0026) ────────────────────────────
  process.stdout.write("Step 0/5: discovery gate\n");
  const gate = await checkDiscoveryGate(ROOT);
  if (gate.warnings.length > 0) {
    for (const w of gate.warnings) process.stdout.write(`  ! ${w}\n`);
  }
  if (!gate.ok) {
    process.stderr.write("\n  ✗ discovery is not 'good enough' to deploy:\n");
    for (const m of gate.missing) process.stderr.write(`    - ${m}\n`);
    if (!FORCE) {
      process.stderr.write(
        "\n  Fill in the missing discovery artifacts (see discovery/README.md \"When is discovery done?\"),\n" +
          "  or rerun with --force to deploy anyway. Deploying without a complete risk register\n" +
          "  is the v0.3 finding (B) — surfacing NFR gaps post-deploy is expensive.\n"
      );
      process.exit(1);
    }
    process.stderr.write("  (proceeding because --force was passed.)\n\n");
  } else {
    process.stdout.write("  ✓ discovery artifacts present and good-enough\n\n");
  }

  // ── Step 1: loom doctor ────────────────────────────────────────────────
  if (!FORCE) {
    process.stdout.write("Step 1/5: loom doctor\n");
    const doctor = spawnSync("node", ["scripts/lib/doctor.mjs"], {
      cwd: ROOT,
      stdio: ["ignore", "inherit", "inherit"],
    });
    if (doctor.status !== 0) {
      process.stderr.write("\nloom doctor failed. Fix the hard failures or rerun with --force.\n");
      process.exit(1);
    }
    process.stdout.write("\n");
  } else {
    process.stdout.write("Step 1/5: SKIPPED (--force)\n\n");
  }

  // ── Step 2: session_start sanity ───────────────────────────────────────
  process.stdout.write("Step 2/5: hook coverage check\n");
  if (!(await hasSessionStartToday(sessionId))) {
    process.stderr.write(
      `  warning: no session_start event for session ${sessionId} in today's log. Hooks may be disabled.\n`
    );
    if (!FORCE) {
      process.stderr.write("  rerun with --force to deploy anyway.\n");
      process.exit(1);
    }
  } else {
    process.stdout.write("  ✓ session_start present\n");
  }
  process.stdout.write("\n");

  // ── Step 3: constitution-service prompt ────────────────────────────────
  if (!YES) {
    process.stdout.write("Step 3/5: constitution-service consultation\n");
    process.stdout.write(
      "  Before deploying, invoke the constitution-service subagent\n" +
        "    Agent(subagent_type=\"constitution-service\", ...)\n" +
        "  and emit a `claim` event confirming the deploy is permitted (LR-02).\n\n"
    );
    const ok = await prompt("  Has constitution-service been consulted? [y/N] ");
    if (!/^y(es)?$/i.test(ok.trim())) {
      process.stdout.write("\nDeploy aborted — consult constitution-service first.\n");
      process.exit(2);
    }
    process.stdout.write("\n");
  } else {
    process.stdout.write("Step 3/5: SKIPPED (--yes)\n\n");
  }

  // ── Step 4: deploy ─────────────────────────────────────────────────────
  process.stdout.write("Step 4/5: deploy\n");
  await checkEnvRequired(config);
  const command = String(config?.deploy?.command || "").trim();
  const argv = Array.isArray(config?.deploy?.args) ? config.deploy.args : [];
  if (!command || command === "<DEPLOY_COMMAND>") {
    process.stderr.write(
      "  tools/runtime.yaml deploy.command is not set. Fill it in (e.g., 'vercel', 'netlify', 'fly').\n"
    );
    process.exit(1);
  }

  // Resolve platform for waitForDeploy. Explicit `deploy.platform` wins;
  // auto-detect from the command basename otherwise. Unknown platform is
  // not a hard fail — we fall back to plain runCapturing() behavior so
  // projects on custom runners stay functional. (ADR-0032 §A.)
  const platform = resolvePlatform(config);
  if (platform) {
    process.stdout.write(`  ✓ platform: ${platform} (waitForDeploy active)\n`);
  } else {
    const reqRaw = String(config?.deploy?.platform ?? "").trim();
    if (reqRaw) {
      process.stdout.write(
        `  warn: deploy.platform '${reqRaw}' not in TERMINAL_STATES registry ` +
          `(known: ${Object.keys(TERMINAL_STATES).join(", ")}). ` +
          `Falling back to plain capture; non_progressing detection disabled.\n`
      );
    } else {
      process.stdout.write(
        `  info: no platform match for command '${command}'. ` +
          `Set deploy.platform in tools/runtime.yaml to enable non_progressing detection.\n`
      );
    }
  }

  await appendEvent({
    event_type: "deployment_started",
    session_id: sessionId,
    deploy_command: `${command} ${argv.join(" ")}`.trim(),
    platform: platform || null,
  });

  process.stdout.write(`  $ ${command} ${argv.join(" ")}\n\n`);
  const startTs = Date.now();
  const out = await runDeployWithWatch({
    command,
    argv,
    cwd: ROOT,
    platform,
    abortOnStall: ABORT_ON_STALL,
    onProgress: async (e) => {
      if (e.event === "non_progressing") {
        // LOUD surfacing per ADR-0032 §A — silence is the bug.
        process.stderr.write(
          `\n  ⚠ NON-PROGRESSING DEPLOY: ${e.message}\n` +
            (ABORT_ON_STALL
              ? `  (--abort-on-stall set → killing subprocess.)\n\n`
              : `  (informational — continuing to wait for subprocess. ` +
                `Pass --abort-on-stall to kill on stall.)\n\n`)
        );
        await appendEvent({
          event_type: "deployment_non_progressing",
          session_id: sessionId,
          reason: e.reason,
          state: e.state ?? null,
          message: e.message,
          aborted: ABORT_ON_STALL,
        });
      }
    },
  });
  const durationMs = Date.now() - startTs;

  // ── Step 5: URL extraction + completed event ───────────────────────────
  process.stdout.write("\nStep 5/5: record deployment\n");
  const urlPattern = config?.deploy?.post_deploy_url_pattern;
  let url = null;
  if (urlPattern) {
    try {
      const re = new RegExp(urlPattern);
      const m = (out.stdout + "\n" + out.stderr).match(re);
      if (m) url = m[1] || m[0];
    } catch (err) {
      process.stderr.write(
        `  warn: post_deploy_url_pattern is not valid regex: ${err.message}\n`
      );
    }
  }

  // Composite health: exit code alone is unsafe (ADR-0032 §C "trust response
  // bodies over exit codes"). waitForDeploy's outcome is the second signal.
  // Without a platform we have only exit code to go on.
  const wait = out.waitOutcome;
  const health = computeHealth(out.exitCode, wait);

  await appendEvent({
    event_type: "deployment_completed",
    session_id: sessionId,
    exit_code: out.exitCode,
    duration_ms: durationMs,
    deployment_url: url,
    platform: platform || null,
    wait_for_deploy_outcome: wait?.outcome ?? null,
    wait_for_deploy_state: wait?.state ?? null,
    wait_for_deploy_reason: wait?.reason ?? null,
    health,
  });

  if (health === "succeeded") {
    process.stdout.write(`  ✓ deploy completed in ${(durationMs / 1000).toFixed(1)}s\n`);
    if (url) process.stdout.write(`  ✓ deployment URL: ${url}\n`);
    process.exit(0);
  } else if (health === "degraded") {
    process.stderr.write(
      `  ⚠ deploy reached a degraded outcome (exit=${out.exitCode}, ` +
        `wait=${wait?.outcome ?? "n/a"}). Investigate before treating as live.\n`
    );
    process.exit(out.exitCode === 0 ? 3 : out.exitCode);
  } else {
    process.stderr.write(`  ✗ deploy failed (exit ${out.exitCode}, wait=${wait?.outcome ?? "n/a"})\n`);
    process.exit(out.exitCode === 0 ? 1 : out.exitCode);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function loadRuntimeConfig() {
  if (!existsSync(RUNTIME_YAML)) {
    process.stderr.write(
      "tools/runtime.yaml is missing. Run scripts/bootstrap.{sh,ps1} first.\n"
    );
    process.exit(1);
  }
  // Minimal YAML parser for our known schema.
  const text = await fs.readFile(RUNTIME_YAML, "utf8");
  return parseRuntimeYaml(text);
}

export function parseRuntimeYaml(text) {
  const result = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  let inDeploy = false;
  const deploy = {};
  while (i < lines.length) {
    const raw = lines[i++];
    const stripped = raw.replace(/\s+$/, "");
    if (!stripped.trim() || stripped.trim().startsWith("#")) continue;
    const indent = stripped.length - stripped.trimStart().length;
    const line = stripStripInlineComment(stripped.trim());

    if (indent === 0) {
      if (line === "deploy:") {
        inDeploy = true;
        continue;
      }
      inDeploy = false;
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) result[m[1]] = parseScalar(m[2]);
      continue;
    }

    if (inDeploy && indent === 2) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) deploy[m[1]] = parseScalar(m[2]);
    }
  }
  result.deploy = deploy;
  return result;
}

// Resolve which TERMINAL_STATES key applies. Explicit `deploy.platform` in
// runtime.yaml wins; auto-detect from `deploy.command` basename otherwise.
// Returns a key from TERMINAL_STATES or null when no match.
export function resolvePlatform(config) {
  const explicit = String(config?.deploy?.platform ?? "").trim().toLowerCase();
  if (explicit && TERMINAL_STATES[explicit]) return explicit;
  if (explicit) return null; // explicit but unknown — caller surfaces the warning
  const cmd = String(config?.deploy?.command ?? "").trim().toLowerCase();
  if (!cmd) return null;
  // Strip path + extension; treat the basename as the platform key candidate.
  // Examples: "vercel" → "vercel"; "C:\\bin\\netlify.exe" → "netlify";
  //   "flyctl" → "fly" (alias); "bash" → null (no match — user must declare).
  const base = cmd.split(/[/\\]/).pop().replace(/\.(exe|sh|ps1|cmd|bat)$/, "");
  if (TERMINAL_STATES[base]) return base;
  // Aliases for tools whose binary name doesn't match the platform key.
  const aliases = { flyctl: "fly", "vercel-cli": "vercel" };
  if (aliases[base] && TERMINAL_STATES[aliases[base]]) return aliases[base];
  return null;
}

// Compute composite health from exit code + waitForDeploy outcome.
// Per ADR-0032 §C: never trust exit code alone. When wait outcome is
// available it's the second signal; when absent (no platform), exit code
// stands alone.
//
// Truth table:
//   exit=0,  wait=succeeded        → succeeded
//   exit=0,  wait=failed           → failed (§C — wait beats exit)
//   exit=0,  wait=non_progressing  → degraded
//   exit=0,  wait=aborted          → degraded
//   exit=0,  wait=null             → succeeded (no-platform fallback)
//   exit≠0,  wait=succeeded        → degraded (CLI crashed post-success)
//   exit≠0,  wait=failed           → failed
//   exit≠0,  wait=non_progressing  → degraded
//   exit≠0,  wait=aborted          → degraded
//   exit≠0,  wait=null             → failed (no-platform fallback)
export function computeHealth(exitCode, waitOutcome) {
  const wait = waitOutcome?.outcome;
  if (wait == null) return exitCode === 0 ? "succeeded" : "failed";
  if (wait === "failed") return "failed";
  if (wait === "succeeded" && exitCode === 0) return "succeeded";
  return "degraded";
}

function stripStripInlineComment(s) {
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

function parseScalar(raw) {
  const t = stripStripInlineComment(raw).trim();
  if (t === "") return "";
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "[]") return [];
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => unquote(s.trim()));
  }
  return unquote(t);
}

function unquote(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

async function checkEnvRequired(config) {
  const required = Array.isArray(config?.deploy?.env_required)
    ? config.deploy.env_required
    : [];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    process.stderr.write(`  ✗ required env var(s) missing: ${missing.join(", ")}\n`);
    process.exit(1);
  }
  if (required.length) {
    process.stdout.write(`  ✓ env required: ${required.join(", ")}\n`);
  }
}

async function hasSessionStartToday(sessionId) {
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  const d = String(today.getUTCDate()).padStart(2, "0");
  const p = path.join(EVENT_LOG_DIR, `${y}-${m}-${d}.jsonl`);
  if (!existsSync(p)) return false;
  try {
    const text = await fs.readFile(p, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (rec.event_type === "session_start" && rec.session_id === sessionId) {
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

async function appendEvent(rec) {
  if (!existsSync(EVENT_LOG_DIR)) {
    await fs.mkdir(EVENT_LOG_DIR, { recursive: true });
  }
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  const d = String(today.getUTCDate()).padStart(2, "0");
  const p = path.join(EVENT_LOG_DIR, `${y}-${m}-${d}.jsonl`);
  const enriched = {
    timestamp: new Date().toISOString(),
    cwd: ROOT,
    kernel_version: "v6",
    loom_version: "0.3.0",
    ...rec,
  };
  await fs.appendFile(p, JSON.stringify(enriched) + "\n", "utf8");
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans);
    });
  });
}

// Buffered line queue — chunk data in, complete lines out (async iterable).
// Used to fan stdout/stderr to BOTH process.stdout/stderr (live display) AND
// waitForDeploy's event stream (state detection). Handles partial lines and
// signals end-of-stream to consumers when close() is called.
export function createLineQueue() {
  const lines = [];
  const waiters = [];
  let buf = "";
  let closed = false;

  function pushChunk(chunk) {
    if (closed) return;
    buf += String(chunk);
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      deliver({ done: false, value: line });
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    if (buf.length) {
      deliver({ done: false, value: buf.replace(/\r$/, "") });
      buf = "";
    }
    while (waiters.length) waiters.shift()({ done: true, value: undefined });
  }

  function deliver(result) {
    const w = waiters.shift();
    if (w) w(result);
    else lines.push(result);
  }

  return {
    pushChunk,
    close,
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (lines.length) return Promise.resolve(lines.shift());
          if (closed) return Promise.resolve({ done: true, value: undefined });
          return new Promise((resolve) => waiters.push(resolve));
        },
        return() {
          close();
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };
}

// Run the deploy subprocess while feeding its line output to waitForDeploy.
// Returns { stdout, stderr, exitCode, waitOutcome }. waitOutcome is null
// when platform is unknown (waitForDeploy is skipped).
//
// `spawnFn` is injectable for tests; defaults to node:child_process spawn.
export async function runDeployWithWatch({
  command,
  argv = [],
  cwd,
  platform,
  onProgress,
  abortOnStall = false,
  spawnFn = spawn,
  maxInProgressMs,
  stallMs,
  echo = true,
}) {
  const proc = spawnFn(command, argv, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const queue = createLineQueue();

  if (proc.stdout) {
    proc.stdout.on("data", (chunk) => {
      const s = chunk.toString();
      stdout += s;
      if (echo) process.stdout.write(s);
      queue.pushChunk(s);
    });
  }
  if (proc.stderr) {
    proc.stderr.on("data", (chunk) => {
      const s = chunk.toString();
      stderr += s;
      if (echo) process.stderr.write(s);
      queue.pushChunk(s);
    });
  }

  const procPromise = new Promise((resolve) => {
    proc.on("error", (err) => {
      queue.close();
      resolve({ exitCode: 1, errorMessage: String(err) });
    });
    proc.on("close", (code) => {
      queue.close();
      resolve({ exitCode: code ?? 0 });
    });
  });

  // Drive waitForDeploy in parallel when platform is known. The wait
  // primitive returns when it observes a terminal outcome; we keep the
  // subprocess running unless abortOnStall is set and a non_progressing
  // event fires (handled inside onProgress wrapper below).
  let waitPromise = Promise.resolve(null);
  let abortRequested = false;
  if (platform && TERMINAL_STATES[platform]) {
    const wrappedOnProgress = async (e) => {
      try {
        await onProgress?.(e);
      } catch {
        /* onProgress is observational — never let it block the wait loop */
      }
      if (abortOnStall && e?.event === "non_progressing" && !abortRequested) {
        abortRequested = true;
        try {
          proc.kill("SIGTERM");
        } catch {
          /* best-effort */
        }
      }
    };
    const events = lineStreamEvents(queue);
    waitPromise = waitForDeploy({
      platform,
      events,
      onProgress: wrappedOnProgress,
      maxInProgressMs,
      stallMs,
    }).catch((err) => ({
      outcome: "error",
      state: null,
      reason: "wait_for_deploy_threw",
      error_message: String(err?.message ?? err),
    }));
  }

  const [procResult, waitResult] = await Promise.all([procPromise, waitPromise]);
  return {
    stdout,
    stderr: stderr + (procResult.errorMessage ?? ""),
    exitCode: procResult.exitCode,
    waitOutcome: waitResult,
  };
}
