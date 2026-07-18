/**
 * oracles — the independent opinions the differential votes over (B2).
 *
 *  - dependency-cruiser: independent extraction + enhanced-resolve resolution.
 *  - madge: independent extraction (precinct) + filing-cabinet resolution.
 *  - tsc: the TypeScript compiler over the REAL filesystem. Disclosed bias:
 *    it shares the typescript library with the shipped resolver, but uses
 *    independent extraction (the TS scanner via preProcessFile, not
 *    tree-sitter) and an independent host (ts.sys on disk, not the in-memory
 *    ingested set). The 2-of-3 vote with the two fully-independent tools
 *    bounds any shared-library bias.
 *  - grimp (Python): separate process, separate ecosystem — see grimp_oracle.py.
 *
 * All oracles run over the SAME materialized tree and their edges are filtered
 * to the same universe as ours, so visibility differences (files we skipped,
 * files they can't parse) surface as triageable disagreements, not silent skew.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ts from "typescript";
import { EXCLUDED_DIR_NAMES } from "../../src/repo/hygiene.ts";
import type { Edge } from "./diff.ts";

const execFileAsync = promisify(execFile);

/** Mirror of the shipped excluded-dir policy, as a regex for oracle configs. */
const EXCLUDED_DIR_RE_SOURCE = `(^|/)(${[...EXCLUDED_DIR_NAMES].map((d) => d.replace(".", "\\.")).join("|")})(/|$)`;

const toPosix = (p: string): string => p.split(path.sep).join("/");

/** Make an oracle-reported path repo-relative (defensive against cwd-relative output). */
function relToRoot(root: string, p: string): string {
  const posix = toPosix(p);
  const rootPosix = toPosix(path.resolve(root)) + "/";
  if (posix.startsWith(rootPosix)) return posix.slice(rootPosix.length);
  return posix.replace(/^\.\//, "");
}

// ── dependency-cruiser ──────────────────────────────────────────────────────

export async function oracleDepcruise(root: string, tsconfigRel: string | null): Promise<Edge[]> {
  const { cruise } = await import("dependency-cruiser");
  const result = await cruise(["."], {
    baseDir: path.resolve(root),
    doNotFollow: { path: "node_modules" },
    exclude: { path: EXCLUDED_DIR_RE_SOURCE },
    ...(tsconfigRel ? { tsConfig: { fileName: path.resolve(root, tsconfigRel) } } : {}),
  });
  const output = typeof result.output === "string" ? (JSON.parse(result.output) as { modules: unknown[] }) : result.output;
  const edges: Edge[] = [];
  for (const m of output.modules as Array<{
    source: string;
    dependencies: Array<{ resolved: string; coreModule: boolean; couldNotResolve: boolean; dependencyTypes: string[] }>;
  }>) {
    const from = relToRoot(root, m.source);
    if (from.includes("node_modules/")) continue;
    for (const d of m.dependencies) {
      if (d.coreModule || d.couldNotResolve) continue;
      const to = relToRoot(root, d.resolved);
      if (to.includes("node_modules/") || to.startsWith("..")) continue;
      edges.push({ from, to });
    }
  }
  return edges;
}

// ── madge ───────────────────────────────────────────────────────────────────

export async function oracleMadge(root: string, tsconfigRel: string | null): Promise<Edge[]> {
  const { default: madge } = await import("madge");
  const res = await madge(path.resolve(root), {
    baseDir: path.resolve(root),
    fileExtensions: ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"],
    includeNpm: false,
    excludeRegExp: [new RegExp(EXCLUDED_DIR_RE_SOURCE), /\.min\.(js|mjs)$/],
    ...(tsconfigRel ? { tsConfig: path.resolve(root, tsconfigRel) } : {}),
  });
  const obj = res.obj();
  const edges: Edge[] = [];
  for (const [from, deps] of Object.entries(obj)) {
    for (const to of deps) edges.push({ from: toPosix(from), to: toPosix(to) });
  }
  return edges;
}

// ── TypeScript compiler over the real filesystem ────────────────────────────

export function oracleTsc(root: string, analyzedTsJs: Iterable<string>, tsconfigRel: string | null): Edge[] {
  let options: ts.CompilerOptions;
  if (tsconfigRel) {
    const absConfig = path.resolve(root, tsconfigRel);
    const read = ts.readConfigFile(absConfig, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, ts.sys, path.dirname(absConfig));
    options = parsed.options;
  } else {
    // No tsconfig (plain-JS repo): classic Node CJS resolution.
    options = { moduleResolution: ts.ModuleResolutionKind.NodeJs };
  }
  options.allowJs = options.allowJs ?? true;
  options.resolveJsonModule = options.resolveJsonModule ?? true;

  const rootAbs = path.resolve(root);
  const edges: Edge[] = [];
  for (const rel of analyzedTsJs) {
    const abs = path.join(rootAbs, rel);
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue; // file in IR but not on disk — will show as recall loss, visibly
    }
    // Independent extraction: the TS scanner (imports, exports, require, import()).
    const pre = ts.preProcessFile(text, true, true);
    for (const imp of pre.importedFiles) {
      const r = ts.resolveModuleName(imp.fileName, abs, options, ts.sys);
      const rm = r.resolvedModule;
      if (!rm || rm.isExternalLibraryImport) continue;
      const to = relToRoot(rootAbs, rm.resolvedFileName);
      if (to.startsWith("..") || to.includes("node_modules/")) continue;
      edges.push({ from: rel, to });
    }
  }
  return edges;
}

// ── grimp (Python, out-of-process) ──────────────────────────────────────────

export interface GrimpResult {
  /** [from, to] file-path pairs as the Python script prints them. */
  edges: Array<[string, string]>;
  /** Top-level package prefixes grimp scanned. */
  packages: string[];
  /** Grimp's model scope: files it models as importable modules — the fair comparison universe. */
  module_files: string[];
}

export const grimpEdges = (r: GrimpResult): Edge[] => r.edges.map(([from, to]) => ({ from, to }));

/** Returns null with a reason when Python/grimp isn't available — skipped, visibly. */
export async function oracleGrimp(root: string): Promise<{ result: GrimpResult | null; skipped?: string }> {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "grimp_oracle.py");
  let skipped = "no python interpreter found on PATH";
  for (const py of ["python", "python3", "py"]) {
    try {
      const { stdout } = await execFileAsync(py, [script, path.resolve(root)], { maxBuffer: 64 * 1024 * 1024 });
      return { result: JSON.parse(stdout) as GrimpResult };
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string; code?: number | string };
      const out = `${e.stderr ?? ""}${e.stdout ?? ""}`;
      // Windows Store alias: exists on PATH but is not a real interpreter — try next.
      if (e.code === "ENOENT" || out.includes("Python was not found")) continue;
      if (out.includes("GRIMP_NOT_INSTALLED")) {
        skipped = `grimp not installed for "${py}" (pip install grimp)`;
        continue; // another launcher may have it
      }
      return { result: null, skipped: `grimp oracle failed: ${out.slice(0, 500) || String(e)}` };
    }
  }
  return { result: null, skipped };
}
