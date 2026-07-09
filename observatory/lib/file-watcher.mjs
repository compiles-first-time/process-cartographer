import { watch, promises as fs, existsSync, statSync } from "node:fs";
import path from "node:path";

// Strip a leading UTF-8 BOM (U+FEFF). Windows writers — notably PowerShell's
// Out-File / Set-Content — prepend a BOM by default, which breaks the
// frontmatter regex below (`^---` no longer matches) and JSON.parse of the
// first JSONL line. Update-bus proposals written by such a tool would silently
// fail to appear in the dashboard. (observatory live-data fix)
function stripBom(s) {
  return typeof s === "string" && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function parseMarkdownFrontmatter(text) {
  text = stripBom(text);
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      val = val.slice(1, -1).split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    } else if (val === "true") {
      val = true;
    } else if (val === "false") {
      val = false;
    }
    result[key] = val;
  }
  return Object.keys(result).length ? result : null;
}

export class FileWatcher {
  constructor({ debounceMs = 150 } = {}) {
    this._watchers = [];
    this._debounceMs = debounceMs;
    this._offsets = new Map();
    this._listeners = { jsonl: [], file: [], updateBusItem: [] };
    this._timers = new Map();
  }

  onJsonlAppend(fn) { this._listeners.jsonl.push(fn); }
  onFileChange(fn) { this._listeners.file.push(fn); }
  onUpdateBusItem(fn) { this._listeners.updateBusItem.push(fn); }

  watchJsonlDir(dir) {
    if (!existsSync(dir)) return;
    const w = watch(dir, { persistent: false }, (_event, filename) => {
      if (!filename || !filename.endsWith(".jsonl")) return;
      this._debounce(path.join(dir, filename), () => this._tailJsonl(path.join(dir, filename)));
    });
    this._watchers.push(w);
  }

  watchFile(filePath) {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    if (!existsSync(dir)) return;
    const w = watch(dir, { persistent: false }, (_event, filename) => {
      if (filename !== base) return;
      this._debounce(filePath, () => this._emitFileChange(filePath));
    });
    this._watchers.push(w);
  }

  watchDir(dir, filter) {
    if (!existsSync(dir)) return;
    const w = watch(dir, { persistent: false }, (_event, filename) => {
      if (!filename) return;
      if (filter && !filter(filename)) return;
      const full = path.join(dir, filename);
      this._debounce(full, () => this._emitFileChange(full));
    });
    this._watchers.push(w);
  }

  watchUpdateBusInbox(dir) {
    if (!existsSync(dir)) return;
    const w = watch(dir, { persistent: false }, (_event, filename) => {
      if (!filename || !filename.endsWith(".md")) return;
      const full = path.join(dir, filename);
      this._debounce(full, () => this._parseAndEmitUpdateBusItem(full));
    });
    this._watchers.push(w);
  }

  async replayUpdateBusInbox(dir) {
    if (!existsSync(dir)) return;
    const entries = await fs.readdir(dir);
    for (const file of entries) {
      if (!file.endsWith(".md")) continue;
      await this._parseAndEmitUpdateBusItem(path.join(dir, file));
    }
  }

  async _parseAndEmitUpdateBusItem(filePath) {
    try {
      const text = await fs.readFile(filePath, "utf8");
      const fm = parseMarkdownFrontmatter(text);
      if (!fm) {
        process.stderr.write(
          `[observatory] update-bus: ${path.basename(filePath)} has no YAML frontmatter block (expected ---\\n...\\n---) — item will not appear in dashboard\n`
        );
        return;
      }
      if (!fm.id) {
        process.stderr.write(
          `[observatory] update-bus: ${path.basename(filePath)} is missing the required "id:" field — item will not appear in dashboard\n`
        );
        return;
      }
      const item = { ...fm, _file: filePath };
      for (const fn of this._listeners.updateBusItem) fn(item);
    } catch { /* file deleted or unreadable */ }
  }

  async _tailJsonl(filePath) {
    try {
      const stat = statSync(filePath);
      const prev = this._offsets.get(filePath) || 0;
      if (stat.size <= prev) return;

      const fh = await fs.open(filePath, "r");
      const buf = Buffer.alloc(stat.size - prev);
      await fh.read(buf, 0, buf.length, prev);
      await fh.close();
      this._offsets.set(filePath, stat.size);

      const text = stripBom(buf.toString("utf8"));
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const record = JSON.parse(line);
          for (const fn of this._listeners.jsonl) fn(record, filePath);
        } catch { /* skip malformed lines */ }
      }
    } catch { /* file may have been deleted mid-read */ }
  }

  _emitFileChange(filePath) {
    for (const fn of this._listeners.file) fn(filePath);
  }

  _debounce(key, fn) {
    const existing = this._timers.get(key);
    if (existing) clearTimeout(existing);
    this._timers.set(key, setTimeout(() => {
      this._timers.delete(key);
      fn();
    }, this._debounceMs));
  }

  async replayJsonlFiles(dir, daysBack = 7) {
    if (!existsSync(dir)) return;
    const now = new Date();
    const entries = await fs.readdir(dir);
    const jsonlFiles = entries
      .filter((f) => f.endsWith(".jsonl"))
      .sort();

    const cutoff = new Date(now);
    cutoff.setUTCDate(cutoff.getUTCDate() - daysBack);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    for (const file of jsonlFiles) {
      const dateStr = file.replace(".jsonl", "");
      if (dateStr < cutoffStr) continue;

      const fullPath = path.join(dir, file);
      const text = stripBom(await fs.readFile(fullPath, "utf8"));
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const record = JSON.parse(line);
          for (const fn of this._listeners.jsonl) fn(record, fullPath);
        } catch { /* skip */ }
      }
      const stat = statSync(fullPath);
      this._offsets.set(fullPath, stat.size);
    }
  }

  close() {
    for (const w of this._watchers) w.close();
    for (const t of this._timers.values()) clearTimeout(t);
    this._watchers = [];
    this._timers.clear();
  }
}
