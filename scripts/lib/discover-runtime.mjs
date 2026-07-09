#!/usr/bin/env node
// `loom discover-runtime` — writes tools/discovered-runtime.md describing
// what's actually available to Claude Code in this session:
//   - MCP servers configured in the user's Claude Code MCP config
//   - Subagents present at .claude/agents/ and whether they're STALE
//     (newer than the .last-discovered-at sentinel)
//
// Per ADR-0020.
//
// Limitations:
//   - We can read static MCP config files. Marketplace / runtime-injected
//     MCPs may not appear. Document the limitation; user can hand-edit
//     tools/discovered-runtime.md below the auto-generated marker.
//   - Subagent staleness uses file mtime vs. a sentinel mtime — accurate
//     enough for the "you just `git pull`ed; restart Claude Code" case.

import { promises as fs, existsSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = process.cwd();
const SUBAGENT_DIR = path.join(ROOT, ".claude", "agents");
const SENTINEL = path.join(SUBAGENT_DIR, ".last-discovered-at");
const OUT = path.join(ROOT, "tools", "discovered-runtime.md");

const args = new Set(process.argv.slice(2));
const QUIET = args.has("--quiet");

await main();

async function main() {
  const mcps = await discoverMcps();
  const subagents = await discoverSubagents();

  await writeReport({ mcps, subagents });

  if (!QUIET) {
    process.stdout.write(`wrote tools/discovered-runtime.md\n`);
    process.stdout.write(`  MCPs found: ${mcps.servers.length} (source: ${mcps.source || "none"})\n`);
    process.stdout.write(`  Subagents: ${subagents.files.length} (stale: ${subagents.stale.length})\n`);
    if (subagents.stale.length > 0) {
      process.stdout.write(`\n  ⚠ STALE SUBAGENTS DETECTED\n`);
      process.stdout.write(`  ${subagents.stale.length} subagent file(s) are newer than the discovery sentinel.\n`);
      process.stdout.write(`  Claude Code builds the subagent registry at session start — these will\n`);
      process.stdout.write(`  NOT be invokable in the current session. Restart Claude Code to load them,\n`);
      process.stdout.write(`  then run \`touch .claude/agents/.last-discovered-at\` to suppress this nag.\n`);
    }
  }

  // Exit code: 0 always. The nag is the message; we don't fail discovery
  // just because the subagents are stale (that's user-resolved).
  process.exit(0);
}

// ── MCP discovery ────────────────────────────────────────────────────────

async function discoverMcps() {
  // Standard Claude Code MCP config locations, in priority order.
  const home = os.homedir();
  const candidates = [
    process.env.LOOM_MCP_CONFIG_PATH,
    path.join(home, ".claude", "mcp.json"),
    process.env.XDG_CONFIG_HOME && path.join(process.env.XDG_CONFIG_HOME, "claude", "mcp.json"),
    path.join(home, ".config", "claude", "mcp.json"),
    process.platform === "win32" && process.env.APPDATA && path.join(process.env.APPDATA, "Claude", "mcp.json"),
    process.platform === "darwin" && path.join(home, "Library", "Application Support", "Claude", "mcp.json"),
  ].filter(Boolean);

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const text = await fs.readFile(p, "utf8");
        const parsed = JSON.parse(text);
        const servers = Object.entries(parsed?.mcpServers || {}).map(([name, def]) => ({
          name,
          command: def.command || "(none)",
        }));
        return { source: p, servers };
      } catch {
        // Fall through to next candidate
      }
    }
  }
  return { source: null, servers: [] };
}

// ── Subagent staleness ───────────────────────────────────────────────────

async function discoverSubagents() {
  if (!existsSync(SUBAGENT_DIR)) {
    return { files: [], stale: [], sentinelMtime: null };
  }
  // First-run UX: if the sentinel doesn't exist, create it at NOW so a fresh
  // clone doesn't falsely report every subagent as stale. The assumption is
  // that "you're running this for the first time => Claude Code, if running,
  // started with these files visible." After this, real staleness is
  // detected against THIS NOW.
  if (!existsSync(SENTINEL)) {
    await fs.writeFile(SENTINEL, "", "utf8");
  }
  const all = (await fs.readdir(SUBAGENT_DIR)).filter((f) => f.endsWith(".md"));
  const sentinelMtime = statSync(SENTINEL).mtimeMs;
  const files = [];
  const stale = [];
  for (const name of all) {
    const p = path.join(SUBAGENT_DIR, name);
    const mtime = statSync(p).mtimeMs;
    const entry = { name, mtime, sentinelMtime };
    files.push(entry);
    if (mtime > sentinelMtime) stale.push(entry);
  }
  return { files, stale, sentinelMtime };
}

// ── Report ───────────────────────────────────────────────────────────────

async function writeReport({ mcps, subagents }) {
  const lines = [];
  lines.push("# Discovered runtime");
  lines.push("");
  lines.push("> **Auto-generated** by `scripts/discover-runtime.{sh,ps1}` at SessionStart and at bootstrap. Per [ADR-0020](../adr/0020-runtime-discovery.md).");
  lines.push("");
  lines.push("> Manual additions: write below the `<!-- end-of-generated -->` marker. The auto-generated section above will be overwritten on next run; your manual section will be preserved.");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## MCP servers available to this Claude Code installation");
  lines.push("");
  if (mcps.servers.length === 0) {
    lines.push("_No MCP servers discovered._ Loom checked these locations:");
    lines.push("");
    lines.push("- `$LOOM_MCP_CONFIG_PATH` (env override)");
    lines.push("- `~/.claude/mcp.json`");
    lines.push("- `$XDG_CONFIG_HOME/claude/mcp.json`");
    lines.push("- `~/.config/claude/mcp.json`");
    lines.push("- `$APPDATA/Claude/mcp.json` (Windows)");
    lines.push("- `~/Library/Application Support/Claude/mcp.json` (macOS)");
    lines.push("");
    lines.push("Marketplace / runtime-injected MCPs may not appear in static config files. Add them manually below the marker.");
  } else {
    lines.push(`Source: \`${mcps.source}\``);
    lines.push("");
    lines.push("| Server | Command |");
    lines.push("|---|---|");
    for (const s of mcps.servers) {
      lines.push(`| \`${s.name}\` | \`${s.command}\` |`);
    }
  }
  lines.push("");
  lines.push("## Subagents at `.claude/agents/`");
  lines.push("");
  if (subagents.files.length === 0) {
    lines.push("_No subagents present._");
  } else {
    lines.push("| File | Status |");
    lines.push("|---|---|");
    for (const f of subagents.files) {
      const stale = f.mtime > subagents.sentinelMtime;
      lines.push(`| \`${f.name}\` | ${stale ? "**STALE** — newer than discovery sentinel; not invokable until Claude Code restart" : "✓ in registry (assumed loaded at session start)"} |`);
    }
    if (subagents.stale.length > 0) {
      lines.push("");
      lines.push("**Action:** Restart Claude Code so the Agent tool can see the newer subagent files. After restarting and confirming the agents work (try `Agent(subagent_type=\"critic\", ...)`), run:");
      lines.push("");
      lines.push("```bash");
      lines.push("touch .claude/agents/.last-discovered-at");
      lines.push("```");
      lines.push("");
      lines.push("to update the sentinel and suppress this nag.");
    }
  }
  lines.push("");
  lines.push("<!-- end-of-generated -->");
  lines.push("");
  lines.push("## Manual additions");
  lines.push("");
  lines.push("_(add marketplace MCPs / project-specific runtime details below)_");
  lines.push("");

  // Preserve manual additions if the file exists.
  let preserved = "";
  if (existsSync(OUT)) {
    const existing = await fs.readFile(OUT, "utf8");
    const idx = existing.indexOf("## Manual additions");
    if (idx >= 0) {
      preserved = existing.slice(idx + "## Manual additions\n".length);
    }
  }
  let report = lines.join("\n");
  if (preserved && !/^\s*_/.test(preserved.split("\n")[1] || "")) {
    // User has manual content (not the placeholder). Preserve it.
    report = report.replace(
      "## Manual additions\n\n_(add marketplace MCPs / project-specific runtime details below)_\n",
      "## Manual additions\n" + preserved
    );
  }

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, report, "utf8");
}
