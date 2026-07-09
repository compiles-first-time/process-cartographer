// Loom specialist-registry loader.
//
// Reads agents/specialists/_registry/manifest.yaml and the project-local
// overrides at agents/specialists/<name>/SKILL.md (per ADR-0023). Returns
// a merged list of specialists the intent classifier can suggest.
//
// Project-local SKILL.md with `extends: _registry/<name>` in frontmatter
// overrides the registry version field-by-field.
//
// Node only; no external deps. Targeted YAML parser for the known schema.

import { promises as fs, existsSync, statSync } from "node:fs";
import path from "node:path";

const ROOT_DEFAULT = process.cwd();

export async function loadRegistry(root = ROOT_DEFAULT) {
  const manifestPath = path.join(root, "agents", "specialists", "_registry", "manifest.yaml");
  if (!existsSync(manifestPath)) return [];
  const text = await fs.readFile(manifestPath, "utf8");
  const registry = parseManifest(text);
  return mergeProjectOverrides(registry, root);
}

// ── Manifest parser (narrow YAML for the known schema) ───────────────────

export function parseManifest(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let i = 0;
  // Skip to `specialists:` key
  while (i < lines.length && !/^specialists\s*:/.test(lines[i])) i++;
  if (i >= lines.length) return out;
  // Empty list?  `specialists: []`
  if (/specialists\s*:\s*\[\]\s*$/.test(lines[i])) return out;
  i++; // past the `specialists:` line

  let current = null;
  let subKey = null;
  let subList = null;
  while (i < lines.length) {
    const raw = lines[i];
    const stripped = raw.replace(/\s+$/, "");
    i++;
    if (!stripped.trim() || stripped.trim().startsWith("#")) continue;

    // New entry marker `  - name: <name>`
    const itemMatch = stripped.match(/^\s\s-\s+(\w+):\s*(.*)$/);
    if (itemMatch) {
      if (current) out.push(current);
      current = {};
      current[itemMatch[1]] = parseScalar(itemMatch[2]);
      subKey = null;
      subList = null;
      continue;
    }

    // End-of-block heuristic: zero indentation (back to top-level keys)
    if (!/^\s/.test(stripped)) {
      if (current) {
        out.push(current);
        current = null;
      }
      break;
    }

    if (!current) continue;

    // Sub-key with value: `    summary: "..."`
    const subMatch = stripped.match(/^\s{4}(\w+):\s*(.*)$/);
    if (subMatch) {
      subKey = subMatch[1];
      const val = subMatch[2];
      if (val === "") {
        // Block follows on next indented lines.
        current[subKey] = {};
        subList = null;
      } else if (val.startsWith("[") && val.endsWith("]")) {
        const inner = val.slice(1, -1).trim();
        current[subKey] = inner ? inner.split(",").map((s) => unquote(s.trim())) : [];
        subList = null;
      } else {
        current[subKey] = parseScalar(val);
        subList = null;
      }
      continue;
    }

    // Triggers sub-block fields: `      patterns:`
    const triggerKey = stripped.match(/^\s{6}(\w+):\s*(.*)$/);
    if (triggerKey && subKey === "triggers") {
      const tk = triggerKey[1];
      const val = triggerKey[2];
      if (val === "" || val === "[]") {
        current.triggers[tk] = [];
        subList = current.triggers[tk];
      } else if (val.startsWith("[") && val.endsWith("]")) {
        const inner = val.slice(1, -1).trim();
        current.triggers[tk] = inner ? inner.split(",").map((s) => unquote(s.trim())) : [];
        subList = null;
      }
      continue;
    }

    // List entry: `        - "value"`
    const listItem = stripped.match(/^\s{8}-\s+(.+)$/);
    if (listItem && subList) {
      subList.push(unquote(listItem[1].trim()));
      continue;
    }

    // Evidence-basis or other nested map fields under a sub-key.
    const nestedMap = stripped.match(/^\s{6}(\w+):\s*(.*)$/);
    if (nestedMap && current[subKey] && typeof current[subKey] === "object" && !Array.isArray(current[subKey])) {
      current[subKey][nestedMap[1]] = parseScalar(nestedMap[2]);
      continue;
    }
  }
  if (current) out.push(current);
  return out;
}

function parseScalar(raw) {
  // Strip inline `# comment` (outside quotes).
  let s = raw;
  let inQuote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      if (c === inQuote && s[i - 1] !== "\\") inQuote = null;
      continue;
    }
    if (c === '"' || c === "'") inQuote = c;
    else if (c === "#") {
      s = s.slice(0, i);
      break;
    }
  }
  const t = s.trim();
  if (t === "" || t === "~" || t === "null") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+$/.test(t)) return Number(t);
  return unquote(t);
}

function unquote(s) {
  if (s.startsWith('"') && s.endsWith('"')) {
    // Double-quoted YAML: unescape backslash sequences. For our regex-bearing
    // manifest, `\\b` (two chars in YAML source) means literal `\b` (one
    // backslash + b — i.e., the regex word-boundary).
    return s.slice(1, -1).replace(/\\(.)/g, (_, c) => {
      switch (c) {
        case "n": return "\n";
        case "t": return "\t";
        case "r": return "\r";
        case "\\": return "\\";
        case "\"": return "\"";
        default: return "\\" + c; // keep regex escapes like \b, \d, \s untouched
      }
    });
  }
  if (s.startsWith("'") && s.endsWith("'")) {
    // Single-quoted YAML: no escape processing per the spec; just strip quotes.
    return s.slice(1, -1);
  }
  return s;
}

// ── Project-local override merge ─────────────────────────────────────────
//
// For each registry entry, look for agents/specialists/<name>/SKILL.md.
// If it exists with `extends: _registry/<name>` in frontmatter, merge:
// project-local fields win; registry fields fill remaining gaps.

async function mergeProjectOverrides(registry, root) {
  const merged = [];
  for (const entry of registry) {
    const localPath = path.join(root, "agents", "specialists", entry.name || "", "SKILL.md");
    if (!entry.name || !existsSync(localPath)) {
      merged.push({ ...entry, source: "registry" });
      continue;
    }
    try {
      const text = await fs.readFile(localPath, "utf8");
      const fm = parseFrontmatter(text);
      if (fm.extends && fm.extends === `_registry/${entry.name}`) {
        merged.push({ ...entry, ...fm, source: "project-local-override" });
        continue;
      }
      // No `extends:` declared — project-local file is independent, not an override.
      merged.push({ ...entry, source: "registry" });
    } catch {
      merged.push({ ...entry, source: "registry" });
    }
  }
  return merged;
}

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]+?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) out[kv[1]] = unquote(kv[2].trim());
  }
  return out;
}

// ── Match a user prompt against the registry ─────────────────────────────

export function matchRegistry(text, specialists) {
  if (!text || typeof text !== "string" || !Array.isArray(specialists)) return [];
  const hits = [];
  for (const s of specialists) {
    const patterns = s.triggers?.patterns || [];
    for (const p of patterns) {
      let re;
      try {
        re = new RegExp(p, "i");
      } catch {
        continue;
      }
      const m = text.match(re);
      if (m) {
        hits.push({
          intent: `specialist:${s.name}`,
          suggest: [s.name],
          rationale: s.summary || `specialist match for ${s.name}`,
          matched: m[0],
          source: s.source || "registry",
        });
        break;
      }
    }
  }
  return hits;
}
