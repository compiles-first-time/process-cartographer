/**
 * repoCityModel — derive the explorable Zone tree for a UNIVERSAL repo city
 * (ADR-0055): repo root = city, directories = districts (chains collapsed),
 * files = buildings (weight = LOC, category = language), symbols = interiors.
 *
 * U2 additions:
 *  - resolved import edges become PIPES, each drawn at exactly one drill level —
 *    the district where its endpoints diverge (city level shows district↔district
 *    roads; entering a district shows its internal roads);
 *  - excluded directories appear as GHOST districts (visible, enterable-via-panel
 *    "parse this directory" — the on-demand inclusion flow), never invisible.
 */
import type { RepoIR, FileNode } from "../ir/repoSchema.ts";
import type { Zone, ZoneEdge, DistrictIntel } from "./cityModel.ts";

interface DirNode {
  name: string; // display segment ("src" — or "src/lib" after collapsing)
  path: string; // full dir path ("" for root)
  dirs: Map<string, DirNode>;
  files: FileNode[];
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
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

interface Totals {
  loc: number;
  files: number;
  skipped: number;
}

function totalsOf(dir: DirNode): Totals {
  const t: Totals = { loc: 0, files: 0, skipped: 0 };
  for (const f of dir.files) {
    t.loc += f.lines;
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
    weight: Math.max(1, f.lines),
    children,
    edges: [],
    summary: skipped
      ? `skipped — ${f.skipReason}`
      : `${f.lines} lines · ${f.language}${children.length ? ` · ${children.length} symbols` : ""}`,
    file: f,
  };
}

/**
 * Assign each resolved-static edge to the district where its endpoints diverge.
 * Because chain-collapsing only merges single-child dirs, the divergence dir is
 * always a real district (or the root).
 */
function buildEdgeIndex(ir: RepoIR): Map<string, { from: string; to: string; kind?: "reference" }[]> {
  const byDistrict = new Map<string, { from: string; to: string; kind?: "reference" }[]>();
  for (const e of ir.edges) {
    // Pipes: compiler/spec-resolved imports (solid) + doc references (dashed).
    const isImportPipe = e.kind === "import" && e.resolution === "resolved-static";
    const isRefPipe = e.kind === "reference" && e.resolution === "resolved-heuristic";
    if (!isImportPipe && !isRefPipe) continue;
    if (e.from === e.to) continue;
    const a = e.from.split("/");
    const b = e.to.split("/");
    let i = 0;
    while (i < a.length - 1 && i < b.length - 1 && a[i] === b[i]) i++;
    const district = a.slice(0, i).join("/");
    const arr = byDistrict.get(district) ?? [];
    arr.push(isRefPipe ? { from: e.from, to: e.to, kind: "reference" } : { from: e.from, to: e.to });
    byDistrict.set(district, arr);
  }
  return byDistrict;
}

/** The direct child of district `dirPath` that contains file `p` (id form). */
function childZoneIdFor(dirPath: string, p: string, childDirs: DirNode[]): string | null {
  if (dirname(p) === dirPath) return `file:${p}`;
  for (const d of childDirs) {
    if (p.startsWith(d.path + "/")) return `dir:${d.path}`;
  }
  return null;
}

const ENTRY_POINT_RE = /^(index|main|app|cli|server).[a-z]+$|^__init__.py$|^__main__.py$/i;
const TEST_FILE_RE = /(.test.|.spec.|^test_|_test.)/i;
const CONFIG_LANGS = new Set(["json", "yaml", "toml", "ini", "config", "dotenv"]);

/** LLM-free computed district facts (roadmap D1/D2) — every claim has evidence. */
function computeIntel(
  dir: DirNode,
  allEdges: { from: string; to: string }[],
): DistrictIntel {
  // Dominant language by LOC across the subtree.
  const langLoc = new Map<string, number>();
  const subtreeFiles: FileNode[] = [];
  (function collect(d: DirNode) {
    for (const f of d.files) {
      subtreeFiles.push(f);
      if (f.parseStatus !== "skipped") langLoc.set(f.language, (langLoc.get(f.language) ?? 0) + f.lines);
    }
    for (const c of d.dirs.values()) collect(c);
  })(dir);
  let dominantLanguage: string | null = null;
  let best = 0;
  for (const [lang, loc] of langLoc) {
    if (loc > best && lang !== "unknown") {
      best = loc;
      dominantLanguage = lang;
    }
  }

  const entryPoints = dir.files
    .filter((f) => ENTRY_POINT_RE.test(f.path.slice(f.path.lastIndexOf("/") + 1)))
    .map((f) => f.path);

  const roles: { role: string; evidence: string }[] = [];
  const name = (dir.name.split("/").pop() ?? "").toLowerCase();
  if (["test", "tests", "__tests__", "spec", "specs"].includes(name)) {
    roles.push({ role: "tests", evidence: `directory name "${name}"` });
  } else {
    const testFiles = subtreeFiles.filter((f) => TEST_FILE_RE.test(f.path.slice(f.path.lastIndexOf("/") + 1))).length;
    if (subtreeFiles.length >= 3 && testFiles / subtreeFiles.length > 0.5) {
      roles.push({ role: "tests", evidence: `${testFiles}/${subtreeFiles.length} files match test naming` });
    }
  }
  if (dir.path.startsWith(".github/workflows") || dir.path === ".github") roles.push({ role: "CI", evidence: dir.path });
  if (["docs", "doc"].includes(name)) roles.push({ role: "docs", evidence: `directory name "${name}"` });
  const cfgFiles = subtreeFiles.filter((f) => CONFIG_LANGS.has(f.language)).length;
  if (subtreeFiles.length >= 3 && cfgFiles / subtreeFiles.length > 0.6) {
    roles.push({ role: "config", evidence: `${cfgFiles}/${subtreeFiles.length} files are config formats` });
  }
  if (entryPoints.length > 0) roles.push({ role: "entry point", evidence: entryPoints.map((p) => p.slice(p.lastIndexOf("/") + 1)).join(", ") });

  // Cohesion over resolved-import edges.
  const prefix = dir.path ? dir.path + "/" : "";
  const inside = (p: string) => (prefix ? p.startsWith(prefix) : true);
  let internalEdges = 0;
  let fanOut = 0;
  let fanIn = 0;
  for (const e of allEdges) {
    const a = inside(e.from);
    const b = inside(e.to);
    if (a && b) internalEdges++;
    else if (a && !b) fanOut++;
    else if (!a && b) fanIn++;
  }
  const denom = internalEdges + fanOut;
  return {
    dominantLanguage,
    entryPoints,
    roles,
    internalEdges,
    fanOut,
    fanIn,
    cohesionPct: denom > 0 ? Math.round((internalEdges / denom) * 100) : null,
  };
}

function dirZone(
  dir: DirNode,
  edgeIndex: Map<string, { from: string; to: string; kind?: "reference" }[]>,
  ghostsByParent: Map<string, Zone[]>,
  resolvedEdges: { from: string; to: string }[],
): Zone {
  const t = totalsOf(dir);
  const childDirNodes = [...dir.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const childDirs = childDirNodes.map((d) => dirZone(d, edgeIndex, ghostsByParent, resolvedEdges));
  const childFiles = [...dir.files].sort((a, b) => a.path.localeCompare(b.path)).map(fileZone);
  const ghosts = ghostsByParent.get(dir.path) ?? [];

  // Pipes at THIS level: edges whose endpoints diverge here, mapped to child zones.
  const edges: ZoneEdge[] = [];
  const seen = new Set<string>();
  for (const e of edgeIndex.get(dir.path) ?? []) {
    const fromId = childZoneIdFor(dir.path, e.from, childDirNodes);
    const toId = childZoneIdFor(dir.path, e.to, childDirNodes);
    if (!fromId || !toId || fromId === toId) continue;
    const key = `${fromId}->${toId}:${e.kind ?? "import"}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push(e.kind ? { from: fromId, to: toId, kind: e.kind } : { from: fromId, to: toId });
    }
  }

  return {
    id: `dir:${dir.path}`,
    kind: "district",
    label: dir.name || "/",
    category: "district",
    weight: Math.max(1, t.loc),
    children: [...childDirs, ...childFiles, ...ghosts],
    edges,
    summary: `${t.files} file${t.files === 1 ? "" : "s"} · ${t.loc.toLocaleString()} lines${t.skipped ? ` · ${t.skipped} skipped` : ""}`,
    district: computeIntel(dir, resolvedEdges),
  };
}

export function buildRepoCityModel(ir: RepoIR): Zone {
  const root = collapse(buildDirTree(ir.files));
  const edgeIndex = buildEdgeIndex(ir);

  // Ghost districts for excluded dirs, attached at the deepest EXISTING district.
  const districtPaths = new Set<string>([""]);
  (function walk(d: DirNode) {
    if (d.path) districtPaths.add(d.path);
    for (const c of d.dirs.values()) walk(c);
  })(root);
  const ghostsByParent = new Map<string, Zone[]>();
  for (const ex of ir.diagnostics.excludedDirs) {
    let parent = dirname(ex.dir);
    while (parent && !districtPaths.has(parent)) parent = dirname(parent);
    const label = parent ? ex.dir.slice(parent.length + 1) : ex.dir;
    const zone: Zone = {
      id: `xdir:${ex.dir}`,
      kind: "district",
      label: `${label} ⊘`,
      category: "district",
      weight: 1,
      children: [],
      edges: [],
      summary: `excluded by hygiene policy${ex.entries != null ? ` — ${ex.entries.toLocaleString()} entries` : ""} · select to parse on demand`,
      excludedDir: { dir: ex.dir, entries: ex.entries },
    };
    const arr = ghostsByParent.get(parent) ?? [];
    arr.push(zone);
    ghostsByParent.set(parent, arr);
  }

  const d = ir.diagnostics;
  const resolvedEdges = ir.edges
    .filter((e) => e.kind === "import" && e.resolution === "resolved-static")
    .map((e) => ({ from: e.from, to: e.to }));
  const rootZone = dirZone(root, edgeIndex, ghostsByParent, resolvedEdges);
  return {
    ...rootZone,
    id: "city",
    kind: "city",
    label: ir.repo.name,
    summary: `${d.filesTotal} files · ${d.locTotal.toLocaleString()} lines · ${Object.keys(d.languages).length} languages${d.filesSkipped ? ` · ${d.filesSkipped} skipped` : ""}`,
  };
}
