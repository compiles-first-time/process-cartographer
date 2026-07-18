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
