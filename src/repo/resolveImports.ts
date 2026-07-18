/**
 * resolveImports — turn per-file imports-AS-WRITTEN (U1 facts) into cross-file
 * edges under the ADR-0055 accuracy contract:
 *
 *  - RELATIVE specifiers ("./x", "../y") resolve against the ingested file set
 *    using the documented Node/TypeScript relative resolution order (exact →
 *    +extension → /index.*). Deterministic given the set ⇒ `resolved-static`,
 *    with the assumption disclosed.
 *  - Relative specifiers whose target is NOT in the set ⇒ `external` at reduced
 *    confidence, evidence noting the target may be excluded/skipped — never a
 *    guessed node.
 *  - BARE specifiers ("react", "lodash/get") ⇒ `external` (assumption: not a
 *    path alias; tsconfig-paths/workspace aliasing is the U2 compiler upgrade).
 *  - DYNAMIC (non-literal) imports ⇒ `unresolved-dynamic` — first-class unknowns.
 *
 * Under-approximation by design: every emitted `resolved-static` edge points at
 * a real file; anything else is visibly tiered, never invented.
 */
import type { FileNode, RepoEdge } from "../ir/repoSchema.ts";

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];

export const RESOLUTION_ASSUMPTIONS = [
  "Relative import edges resolved by the documented Node/TS order (exact path → +extension → /index.*) against the ingested file set only",
  "Bare specifiers are treated as external packages (tsconfig path aliases / workspace links are not yet resolved — planned compiler-grade upgrade)",
  "Python imports resolved by the documented module algorithm (relative dots from the importing package; absolute dotted paths from the repo root, src/, and the importing file's ancestor dirs — script-execution sys.path semantics; pkg → pkg/__init__.py) against the ingested set; unmatched modules are external (stdlib/pip)",
  "Reference edges (dashed) are literal repo-file paths appearing in docs/config text — a computed mention, not an execution relationship",
];

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

/** Normalize "a/b/../c" → "a/c"; null when it escapes the repo root. */
function normalize(p: string): string | null {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null; // escapes the ingested root
      out.pop();
    } else {
      out.push(seg);
    }
  }
  return out.join("/");
}

/** Node/TS relative resolution against the ingested set. */
export function resolveRelative(fromFile: string, specifier: string, fileSet: Set<string>): string | null {
  const base = normalize(`${dirname(fromFile)}/${specifier}`);
  if (base == null) return null;
  if (fileSet.has(base)) return base; // exact (specifier included the extension)
  for (const ext of EXTENSIONS) if (fileSet.has(base + ext)) return base + ext;
  for (const ext of EXTENSIONS) if (fileSet.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
  return null;
}

export function resolveImportEdges(files: FileNode[]): RepoEdge[] {
  const fileSet = new Set(files.map((f) => f.path));
  const edges: RepoEdge[] = [];
  const seen = new Set<string>();

  const push = (e: RepoEdge) => {
    const key = `${e.from}${e.to}${e.resolution}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push(e);
    }
  };

  for (const f of files) {
    const isPython = f.language === "python";
    for (const imp of f.imports) {
      const evidence = { path: f.path, startLine: imp.line, endLine: imp.line };
      if (imp.dynamic) {
        push({
          from: f.path,
          to: imp.specifier,
          kind: "import",
          resolution: "unresolved-dynamic",
          confidence: 1, // that it is dynamic is parser-proved
          evidence,
        });
        continue;
      }
      if (isPython) {
        const target = resolvePython(f.path, imp.specifier, fileSet);
        if (target && target !== f.path) {
          push({ from: f.path, to: target, kind: "import", resolution: "resolved-static", confidence: 1, evidence });
        } else if (!target) {
          // stdlib / pip package / outside the set - external, never guessed.
          push({ from: f.path, to: imp.specifier, kind: "import", resolution: "external", confidence: 0.9, evidence });
        }
        continue;
      }
      if (imp.specifier.startsWith("./") || imp.specifier.startsWith("../")) {
        const target = resolveRelative(f.path, imp.specifier, fileSet);
        if (target) {
          push({ from: f.path, to: target, kind: "import", resolution: "resolved-static", confidence: 1, evidence });
        } else {
          // Real reference, target outside the ingested set (excluded/skipped/absent).
          push({ from: f.path, to: imp.specifier, kind: "import", resolution: "external", confidence: 0.7, evidence });
        }
      } else {
        // Bare specifier — a package (assumption disclosed above).
        push({ from: f.path, to: imp.specifier, kind: "import", resolution: "external", confidence: 0.9, evidence });
      }
    }
  }
  // Deterministic order.
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.resolution.localeCompare(b.resolution));
  return edges;
}

/**
 * Python module resolution (documented algorithm, assumptions disclosed):
 *  - relative: N leading dots ascend N−1 packages from the importing file's dir;
 *  - absolute dotted paths are tried from the repo root and `src/`;
 *  - a module M resolves to M.py or M/__init__.py in the ingested set.
 */
export function resolvePython(fromFile: string, specifier: string, fileSet: Set<string>): string | null {
  const tryModule = (base: string): string | null => {
    const p = base.replace(/^\/+|\/+$/g, "");
    if (p === "") return null;
    if (fileSet.has(`${p}.py`)) return `${p}.py`;
    if (fileSet.has(`${p}/__init__.py`)) return `${p}/__init__.py`;
    return null;
  };

  const dots = /^(\.+)/.exec(specifier)?.[1].length ?? 0;
  if (dots > 0) {
    let base = dirname(fromFile);
    for (let i = 1; i < dots; i++) base = dirname(base);
    const rest = specifier.slice(dots);
    if (rest === "") {
      // `from . import x` → the package itself.
      return fileSet.has(`${base}/__init__.py`) ? `${base}/__init__.py` : null;
    }
    return tryModule(`${base}/${rest.split(".").join("/")}`);
  }
  // Absolute dotted path from the disclosed roots: repo root, src/, then the
  // importing file's ancestor dirs nearest-first (Python script-execution
  // semantics: sys.path[0] is the script's own directory).
  const segs = specifier.split(".").join("/");
  const direct = tryModule(segs) ?? tryModule(`src/${segs}`);
  if (direct) return direct;
  let anc = dirname(fromFile);
  while (anc) {
    const hit = tryModule(`${anc}/${segs}`);
    if (hit) return hit;
    anc = dirname(anc);
  }
  return null;
}

// ── Reference edges: literal repo-path mentions in docs/config (dashed pipes) ──

/** Doc/config languages scanned for literal path mentions. */
const REFERENCE_SOURCE_LANGUAGES = new Set([
  "markdown",
  "yaml",
  "json",
  "toml",
  "ini",
  "text",
  "restructuredtext",
  "dotenv",
  "config",
]);

const PATH_TOKEN_RE = /(?:\.\/)?[A-Za-z0-9_][A-Za-z0-9_.\-]*(?:\/[A-Za-z0-9_.\-]+)+\.[A-Za-z0-9]{1,8}/g;

/**
 * Scan doc/config text for literal mentions of ingested file paths. The
 * MENTION is a computed fact (the string really occurs, at that line); the
 * edge is `resolved-heuristic` — a documented reference, not an execution
 * relationship. This is how markdown/YAML-wired systems (agent registries,
 * skill catalogs, config manifests) surface their wiring honestly.
 */
export function referenceEdges(files: FileNode[], textByPath: Map<string, string>): RepoEdge[] {
  const fileSet = new Set(files.map((f) => f.path));
  const edges: RepoEdge[] = [];
  const seen = new Set<string>();

  for (const f of files) {
    if (!REFERENCE_SOURCE_LANGUAGES.has(f.language)) continue;
    const text = textByPath.get(f.path);
    if (!text) continue;
    const dir = dirname(f.path);
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(PATH_TOKEN_RE)) {
        const raw = m[0].replace(/^\.\//, "");
        // Repo-root-relative first, then relative to the mentioning file.
        let target: string | null = fileSet.has(raw) ? raw : null;
        if (!target && dir) {
          const rel = `${dir}/${raw}`;
          if (fileSet.has(rel)) target = rel;
        }
        if (!target || target === f.path) continue;
        const key = `${f.path}→${target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({
          from: f.path,
          to: target,
          kind: "reference",
          resolution: "resolved-heuristic",
          confidence: 0.85,
          evidence: { path: f.path, startLine: i + 1, endLine: i + 1 },
        });
      }
    }
  }
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return edges;
}
