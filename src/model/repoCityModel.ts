/**
 * repoCityModel — derive the explorable Zone tree for a UNIVERSAL repo city
 * (ADR-0055, U0): repo root = city, directories = districts (recursive,
 * single-child chains collapsed), files = buildings (weight = LOC, category =
 * detected language), skipped files = visible "skipped" buildings. U1 adds
 * symbols as file interiors; U2 adds resolved import pipes as zone edges.
 *
 * Consumes RepoIR only; the renderer stack (CityScene, layout, search, list,
 * detail) works on Zones and needs no changes — the seam the whole extension
 * rides on.
 */
import type { RepoIR, FileNode } from "../ir/repoSchema.ts";
import type { Zone } from "./cityModel.ts";

interface DirNode {
  name: string; // display segment ("src" — or "src/lib" after collapsing)
  path: string; // full dir path ("" for root)
  dirs: Map<string, DirNode>;
  files: FileNode[];
}

function buildDirTree(files: FileNode[]): DirNode {
  const root: DirNode = { name: "", path: "", dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      let next = cur.dirs.get(seg);
      if (!next) {
        next = {
          name: seg,
          path: cur.path ? `${cur.path}/${seg}` : seg,
          dirs: new Map(),
          files: [],
        };
        cur.dirs.set(seg, next);
      }
      cur = next;
    }
    cur.files.push(f);
  }
  return root;
}

/** Collapse chains: a dir with exactly one subdir and no files merges downward. */
function collapse(dir: DirNode): DirNode {
  for (const [key, child] of [...dir.dirs.entries()]) {
    let c = collapse(child);
    while (c.dirs.size === 1 && c.files.length === 0) {
      const inner = collapse([...c.dirs.values()][0]);
      c = { ...inner, name: `${c.name}/${inner.name}` };
    }
    if (c !== child) {
      dir.dirs.delete(key);
      dir.dirs.set(c.name, c);
    }
  }
  return dir;
}

function locOf(f: FileNode): number {
  return f.lines;
}

interface Totals {
  loc: number;
  files: number;
  skipped: number;
}

function totalsOf(dir: DirNode): Totals {
  const t: Totals = { loc: 0, files: 0, skipped: 0 };
  for (const f of dir.files) {
    t.loc += locOf(f);
    t.files++;
    if (f.parseStatus === "skipped") t.skipped++;
  }
  for (const d of dir.dirs.values()) {
    const s = totalsOf(d);
    t.loc += s.loc;
    t.files += s.files;
    t.skipped += s.skipped;
  }
  return t;
}

function fileZone(f: FileNode): Zone {
  const skipped = f.parseStatus === "skipped";
  // U1: symbols become interior zones; U0 files are leaves.
  const children: Zone[] = f.symbols.map((s) => ({
    id: `sym:${f.path}:${s.name}:${s.startLine}`,
    kind: "symbol",
    label: s.name,
    category: f.language,
    weight: Math.max(1, s.endLine - s.startLine + 1),
    children: [],
    edges: [],
    summary: `${s.kind} · lines ${s.startLine}–${s.endLine}`,
  }));
  return {
    id: `file:${f.path}`,
    kind: "file",
    label: f.path.slice(f.path.lastIndexOf("/") + 1),
    category: skipped ? "file" : f.language,
    weight: Math.max(1, locOf(f)),
    children,
    edges: [],
    summary: skipped
      ? `skipped — ${f.skipReason}`
      : `${f.lines} lines · ${f.language}${children.length ? ` · ${children.length} symbols` : ""}`,
    file: f,
  };
}

function dirZone(dir: DirNode): Zone {
  const t = totalsOf(dir);
  const childDirs = [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).map(dirZone);
  const childFiles = [...dir.files].sort((a, b) => a.path.localeCompare(b.path)).map(fileZone);
  return {
    id: `dir:${dir.path}`,
    kind: "district",
    label: dir.name || "/",
    category: "district",
    weight: Math.max(1, t.loc),
    children: [...childDirs, ...childFiles],
    edges: [], // U2: aggregated import pipes between children
    summary: `${t.files} file${t.files === 1 ? "" : "s"} · ${t.loc.toLocaleString()} lines${t.skipped ? ` · ${t.skipped} skipped` : ""}`,
  };
}

export function buildRepoCityModel(ir: RepoIR): Zone {
  const root = collapse(buildDirTree(ir.files));
  const d = ir.diagnostics;
  const rootZone = dirZone(root);
  return {
    ...rootZone,
    id: "city",
    kind: "city",
    label: ir.repo.name,
    summary: `${d.filesTotal} files · ${d.locTotal.toLocaleString()} lines · ${Object.keys(d.languages).length} languages${d.filesSkipped ? ` · ${d.filesSkipped} skipped` : ""}`,
  };
}
