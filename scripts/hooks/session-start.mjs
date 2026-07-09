#!/usr/bin/env node
// Loom SessionStart hook.
//
// Fired when a Claude Code session begins. Writes a session header to
// today's JSONL event log and — if placeholders like <PROJECT_NAME> are
// still present in stamped files — runs the bootstrap script idempotently
// with derived defaults.

import {
  appendEvent,
  mechanicalRecord,
  readStdinJson,
  findPlaceholders,
  deriveProjectName,
  deriveUserName,
  validateProjectRoot,
  warn,
  PROJECT_ROOT,
} from "./_lib.mjs";
import { spawnSync, spawn } from "node:child_process";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";

const event = await readStdinJson();

// ── CWD validation (ADR-0034 §C + ADR-0038 hook-capture-gap detection) ──
//
// Check that the session's CWD looks like a Loom project before doing
// anything else. If it doesn't, the entire hook system is running against
// the wrong directory — the event log, bootstrap, and runtime discovery
// all write to the wrong paths. Surface this LOUDLY.
const cwdCheck = validateProjectRoot();
if (!cwdCheck.valid) {
  // Still emit the session_start event (to whatever path we can) so the
  // gap is at least recorded somewhere. Tag it as misrooted.
  appendEvent(
    mechanicalRecord("session_start", {
      session_id: event.session_id || process.env.CLAUDE_SESSION_ID || `local-${Date.now()}`,
      source: event.source || "claude-code",
      transcript_path: event.transcript_path || null,
      hook_capture_gap: true,
      hook_capture_gap_reason: cwdCheck.reason,
    })
  );
  // Emit a separate warning event so doctor / audit can grep for it.
  appendEvent(
    mechanicalRecord("hook_capture_gap_detected", {
      session_id: event.session_id || process.env.CLAUDE_SESSION_ID || `local-${Date.now()}`,
      cwd: PROJECT_ROOT,
      indicators_found: cwdCheck.found,
      reason: cwdCheck.reason,
    })
  );
  // Loud stderr warning — this shows up in Claude Code's hook output.
  warn("╔══════════════════════════════════════════════════════════════╗");
  warn("║  ⚠ HOOK CAPTURE GAP DETECTED (ADR-0034 §C)                ║");
  warn("║                                                            ║");
  warn("║  This session's CWD does not appear to be a Loom project.  ║");
  warn("║  Hooks are running against the wrong directory.            ║");
  warn("║  The audit trail will be SILENT or MISPLACED.              ║");
  warn("║                                                            ║");
  warn("║  To fix: open Claude Code IN the project directory:        ║");
  warn("║    cd <project-root> && claude                             ║");
  warn("║  Then restart this session.                                ║");
  warn("╚══════════════════════════════════════════════════════════════╝");
  warn(`  Reason: ${cwdCheck.reason}`);
} else {
  appendEvent(
    mechanicalRecord("session_start", {
      session_id: event.session_id || process.env.CLAUDE_SESSION_ID || `local-${Date.now()}`,
      source: event.source || "claude-code",
      transcript_path: event.transcript_path || null,
    })
  );
}

// Idempotent bootstrap: only runs if placeholders remain.
const placeholders = await findPlaceholders();
if (placeholders.length > 0) {
  const projectName = deriveProjectName();
  const userName = deriveUserName();

  appendEvent(
    mechanicalRecord("auto_bootstrap_attempted", {
      placeholders_found: placeholders,
      derived_project_name: projectName,
      derived_user_name: userName,
    })
  );

  // Pick a runner. POSIX: prefer the .sh; Windows: prefer the .ps1.
  const isWindows = process.platform === "win32";
  const shScript = path.join(PROJECT_ROOT, "scripts", "bootstrap.sh");
  const ps1Script = path.join(PROJECT_ROOT, "scripts", "bootstrap.ps1");

  let result;
  if (isWindows && existsSync(ps1Script)) {
    result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        ps1Script,
        "-ProjectName",
        projectName,
        "-UserName",
        userName,
      ],
      { cwd: PROJECT_ROOT, encoding: "utf8" }
    );
  } else if (existsSync(shScript)) {
    result = spawnSync("bash", [shScript, projectName, "", userName], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    });
  } else {
    warn("placeholders present but no bootstrap script found; skipping auto-bootstrap");
  }

  if (result) {
    appendEvent(
      mechanicalRecord("auto_bootstrap_result", {
        exit_code: result.status,
        stdout_preview: (result.stdout || "").slice(0, 500),
        stderr_preview: (result.stderr || "").slice(0, 500),
      })
    );
    if (result.status !== 0) {
      warn(
        `auto-bootstrap exited ${result.status}; placeholders may still be present. Run scripts/bootstrap.{sh,ps1} manually with the right project name.`
      );
    } else {
      warn(`auto-bootstrap stamped project as "${projectName}" (user="${userName}")`);
    }
  }
}

// Observatory auto-launch (L9, ADR-0039)
// Reads auto_start from observatory/config.yaml; probes the port; spawns the
// server as a detached background process if not already running.
{
  const configPath = path.join(PROJECT_ROOT, "observatory", "config.yaml");
  const serverPath = path.join(PROJECT_ROOT, "observatory", "server.mjs");

  if (existsSync(configPath) && existsSync(serverPath)) {
    let autoStart = true;
    let port = 4040;
    try {
      const text = readFileSync(configPath, "utf8");
      const autoMatch = text.match(/auto_start:\s*(true|false)/);
      const portMatch = text.match(/port:\s*(\d+)/);
      if (autoMatch) autoStart = autoMatch[1] === "true";
      if (portMatch) port = parseInt(portMatch[1], 10);
    } catch { /* use defaults */ }

    const listening = await new Promise((resolve) => {
      const sock = net.createConnection({ port, host: "127.0.0.1" });
      sock.setTimeout(300);
      sock.on("connect", () => { sock.destroy(); resolve(true); });
      sock.on("error", () => { sock.destroy(); resolve(false); });
      sock.on("timeout", () => { sock.destroy(); resolve(false); });
    });

    if (listening) {
      warn(`[observatory] already running → http://127.0.0.1:${port}`);
    } else if (autoStart) {
      const child = spawn("node", [serverPath], {
        detached: true,
        stdio: "ignore",
        cwd: PROJECT_ROOT,
        env: { ...process.env, LOOM_PROJECT_ROOT: PROJECT_ROOT },
      });
      child.unref();
      appendEvent(
        mechanicalRecord("observatory_auto_started", {
          session_id: event.session_id || process.env.CLAUDE_SESSION_ID || `local-${Date.now()}`,
          port,
        })
      );
      warn(`[observatory] started → http://127.0.0.1:${port}  (set auto_start: false in observatory/config.yaml to disable)`);
    } else {
      warn(`[observatory] not running — start with: pwsh scripts/observatory.ps1  or  bash scripts/observatory.sh`);
    }
  }
}

// Runtime discovery (PR-J / ADR-0020): regenerate tools/discovered-runtime.md
// so the user sees what MCPs are actually wired up + which subagent files
// are stale (newer than the discovery sentinel — not invokable until restart).
{
  const discoverScript = path.join(PROJECT_ROOT, "scripts", "lib", "discover-runtime.mjs");
  if (existsSync(discoverScript)) {
    const result = spawnSync("node", [discoverScript, "--quiet"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
    });
    appendEvent(
      mechanicalRecord("runtime_discovery_run", {
        session_id: event.session_id || process.env.CLAUDE_SESSION_ID || `local-${Date.now()}`,
        exit_code: result.status,
        stdout_preview: (result.stdout || "").slice(0, 400),
        stderr_preview: (result.stderr || "").slice(0, 400),
      })
    );
  }
}
