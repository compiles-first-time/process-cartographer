#!/usr/bin/env node
// Loom test runner — runs the project's test suite and bridges results into
// the observatory event log so the Testing panel populates (observatory
// live-data fix, item 2).
//
// Why a wrapper rather than raw `node --test`: the project's *.test.mjs files
// use a self-reporting harness (manual `N passed, M failed` + process.exit),
// not the node:test API, so `node --test` only sees file-level pass/fail. This
// runner executes the same files (one child process each — honoring their
// exit codes), parses each file's self-reported assert counts, and emits
// structured events:
//
//   event_type: test_result        (one per test file)
//     { timestamp, session_id, suite, name, status: "pass"|"fail",
//       asserts_passed, asserts_failed, duration_ms, error_preview }
//
//   event_type: test_run_summary   (one per run)
//     { timestamp, session_id, total, passed, failed, skipped, todo,
//       files, duration_ms }
//
// Usage:  node scripts/test.mjs   |   npm test
// Exit code is non-zero if any file failed (CI-friendly).

import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { appendEvent, mechanicalRecord, PROJECT_ROOT } from "./hooks/_lib.mjs";

const SKIP_DIRS = new Set(["node_modules", ".git"]);
const TEST_RE = /\.test\.(mjs|js|cjs)$/;

async function findTestFiles(root) {
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (TEST_RE.test(e.name)) out.push(full);
    }
  }
  await walk(root);
  return out.sort();
}

function relPath(f) {
  return path.relative(PROJECT_ROOT, f).split(path.sep).join("/");
}

const sessionId = process.env.CLAUDE_SESSION_ID || `test-run-${new Date().toISOString()}`;
const files = await findTestFiles(PROJECT_ROOT);

if (files.length === 0) {
  console.error(`[loom test] no *.test.{mjs,js,cjs} files found under ${PROJECT_ROOT}`);
  process.exit(0);
}

console.log(`[loom test] running ${files.length} test file(s)…\n`);

const runStart = Date.now();
let filesPassed = 0;
let filesFailed = 0;
let assertsPassed = 0;
let assertsFailed = 0;
let anyAsserts = false;

for (const file of files) {
  const rel = relPath(file);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [file], { cwd: PROJECT_ROOT, encoding: "utf8" });
  const durationMs = Date.now() - t0;

  const combined = `${r.stdout || ""}\n${r.stderr || ""}`;
  const m = combined.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  const ap = m ? parseInt(m[1], 10) : null;
  const af = m ? parseInt(m[2], 10) : null;
  const status = r.status === 0 ? "pass" : "fail";

  if (status === "pass") filesPassed++;
  else filesFailed++;
  if (m) {
    anyAsserts = true;
    assertsPassed += ap;
    assertsFailed += af;
  }

  let errorPreview = null;
  if (status === "fail") {
    const tail = (r.stderr || r.stdout || "").trim().split("\n").slice(-6).join("\n");
    errorPreview = tail.slice(0, 240) || `exit code ${r.status}`;
  }

  appendEvent(
    mechanicalRecord("test_result", {
      session_id: sessionId,
      suite: rel,
      name: path.basename(file),
      status,
      asserts_passed: ap,
      asserts_failed: af,
      duration_ms: durationMs,
      error_preview: errorPreview,
    })
  );

  const mark = status === "pass" ? "✓" : "✗";
  const detail = m ? `${ap} passed, ${af} failed` : `exit ${r.status}`;
  console.log(`  ${mark} ${rel}  (${detail}, ${(durationMs / 1000).toFixed(2)}s)`);
  if (status === "fail" && errorPreview) console.log(`      ${errorPreview.split("\n").join("\n      ")}`);
}

const durationMs = Date.now() - runStart;
const total = anyAsserts ? assertsPassed + assertsFailed : files.length;
const passed = anyAsserts ? assertsPassed : filesPassed;
const failed = anyAsserts ? assertsFailed : filesFailed;

appendEvent(
  mechanicalRecord("test_run_summary", {
    session_id: sessionId,
    total,
    passed,
    failed,
    skipped: 0,
    todo: 0,
    files: files.length,
    files_passed: filesPassed,
    files_failed: filesFailed,
    duration_ms: durationMs,
  })
);

console.log(
  `\n[loom test] ${passed}/${total} ${anyAsserts ? "asserts" : "files"} passed` +
    (failed ? `, ${failed} failed` : "") +
    `  •  ${filesPassed}/${files.length} files  •  ${(durationMs / 1000).toFixed(1)}s`
);

process.exit(filesFailed > 0 ? 1 : 0);
