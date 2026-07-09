#!/usr/bin/env node
// One-way generator: tools/mcp-servers/config.yaml → .claude/settings.json (mcpServers block).
//
// The YAML is the human-friendly source of truth; the JSON is the Claude Code runtime
// artifact. Per ADR-0013.
//
// Usage:
//   node scripts/lib/mcp-yaml-to-settings.mjs           # apply
//   node scripts/lib/mcp-yaml-to-settings.mjs --check   # exit 1 if regen would change anything
//
// Constraint: Node only, no external deps. The YAML has a known schema (see the file's
// header), so a small targeted parser handles it deterministically.

import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const YAML_PATH = path.join(ROOT, "tools", "mcp-servers", "config.yaml");
const JSON_PATH = path.join(ROOT, ".claude", "settings.json");

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");

main().catch((err) => {
  process.stderr.write(`[mcp-yaml-to-settings] ${err.message}\n`);
  process.exit(1);
});

async function main() {
  const yamlText = await fs.readFile(YAML_PATH, "utf8");
  const parsed = parseMcpYaml(yamlText);
  const mcpServers = toClaudeMcpServers(parsed.servers);

  const settings = await readJsonOrEmpty(JSON_PATH);
  const updated = mergeSettings(settings, mcpServers);

  const expected = JSON.stringify(updated, null, 2) + "\n";
  let actual = "";
  try {
    actual = await fs.readFile(JSON_PATH, "utf8");
  } catch {
    actual = "";
  }

  if (checkOnly) {
    if (actual === expected) {
      process.stdout.write("ok: .claude/settings.json mcpServers matches tools/mcp-servers/config.yaml\n");
      process.exit(0);
    }
    process.stderr.write(
      "drift: .claude/settings.json mcpServers does not match tools/mcp-servers/config.yaml — run `node scripts/lib/mcp-yaml-to-settings.mjs` (without --check) to regenerate\n"
    );
    process.exit(1);
  }

  if (actual === expected) {
    process.stdout.write("no change: .claude/settings.json mcpServers already up to date\n");
    return;
  }

  await fs.writeFile(JSON_PATH, expected, "utf8");
  process.stdout.write(`wrote .claude/settings.json (mcpServers block regenerated from tools/mcp-servers/config.yaml)\n`);
}

// ── YAML parser for the known schema ─────────────────────────────────────
//
// The MCP config YAML has a fixed shape:
//
//   version: "1.0"
//   project: "..."
//   servers:
//     <name>:
//       enabled: true|false
//       transport: stdio
//       command: "..."
//       args: ["...", "..."]
//       env:
//         KEY: "value"
//       description: "..."
//
// We parse only what we need. Comments (lines starting with #) and blank lines are skipped.

export function parseMcpYaml(text) {
  const result = { servers: {} };
  const lines = text.split(/\r?\n/);

  let i = 0;
  let inServers = false;
  let currentServer = null;
  let inEnv = false;

  while (i < lines.length) {
    const raw = lines[i];
    const stripped = raw.replace(/\s+$/, "");
    i++;

    if (!stripped.trim() || stripped.trim().startsWith("#")) continue;

    const indent = stripped.length - stripped.trimStart().length;
    const line = stripped.trim();

    // Top-level keys (indent 0)
    if (indent === 0) {
      inServers = false;
      currentServer = null;
      inEnv = false;
      if (line === "servers:") {
        inServers = true;
        continue;
      }
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) result[m[1]] = parseScalar(m[2]);
      continue;
    }

    if (!inServers) continue;

    // Server name (indent 2)
    if (indent === 2 && /^[\w-]+:\s*$/.test(line)) {
      currentServer = line.replace(":", "").trim();
      result.servers[currentServer] = {};
      inEnv = false;
      continue;
    }

    if (!currentServer) continue;

    // Server fields (indent 4)
    if (indent === 4) {
      inEnv = false;
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const valueRaw = m[2];

      if (key === "env" && valueRaw === "") {
        inEnv = true;
        result.servers[currentServer].env = {};
        continue;
      }
      result.servers[currentServer][key] = parseScalar(valueRaw);
      continue;
    }

    // Env entries (indent 6)
    if (indent === 6 && inEnv) {
      const m = line.match(/^([A-Z0-9_]+):\s*(.*)$/);
      if (m) {
        result.servers[currentServer].env[m[1]] = parseScalar(m[2]);
      }
      continue;
    }
  }

  return result;
}

function parseScalar(raw) {
  // Strip inline `# comment` (but not `#` inside quotes). The YAML uses
  // patterns like `enabled: false  # set true to enable` — without this
  // strip, `false  # ...` was being captured as a string, defeating the
  // `enabled: false` skip in toClaudeMcpServers. Carried in PR-G as a
  // PR-3 bug fix.
  let value = raw;
  let inQuote = null;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (inQuote) {
      if (c === inQuote && value[i - 1] !== "\\") inQuote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inQuote = c;
      continue;
    }
    if (c === "#") {
      value = value.slice(0, i);
      break;
    }
  }
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~") return null;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    // Split on commas not inside quotes.
    return splitArgs(inner).map(unquote);
  }
  return unquote(trimmed);
}

function splitArgs(s) {
  const out = [];
  let buf = "";
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      buf += c;
      if (c === q && s[i - 1] !== "\\") q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      buf += c;
      continue;
    }
    if (c === ",") {
      out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function unquote(s) {
  s = s.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

// ── Convert parsed config → Claude Code's mcpServers shape ───────────────

export function toClaudeMcpServers(servers) {
  const out = {};
  for (const [name, def] of Object.entries(servers || {})) {
    if (def && def.enabled === false) continue;
    const entry = {};
    if (def.command) entry.command = def.command;
    if (Array.isArray(def.args) && def.args.length) entry.args = def.args;
    if (def.env && Object.keys(def.env).length) entry.env = def.env;
    if (def.transport && def.transport !== "stdio") entry.type = def.transport;
    out[name] = entry;
  }
  return out;
}

// ── Settings merge (preserve hooks block; replace only mcpServers) ───────

export function mergeSettings(existing, mcpServers) {
  const updated = { ...(existing || {}) };
  updated._generated_mcp = "regenerated from tools/mcp-servers/config.yaml — do not hand-edit the mcpServers block";
  updated.mcpServers = mcpServers;
  return updated;
}

async function readJsonOrEmpty(p) {
  try {
    const text = await fs.readFile(p, "utf8");
    return JSON.parse(text);
  } catch {
    return {};
  }
}
