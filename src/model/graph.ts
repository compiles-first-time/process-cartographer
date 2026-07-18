/**
 * graph — pure reachability over the computed import edges (ADR-0055 tiers:
 * only `kind: "import"` + `resolution: "resolved-static"` participate — the
 * blast radius is a statement about PROVEN dependencies, never references or
 * guesses).
 */
import type { RepoIR } from "../ir/repoSchema.ts";

export interface ImportAdjacency {
  /** file → files it imports (downstream: what I depend on). */
  fwd: Map<string, string[]>;
  /** file → files that import it (upstream: who depends on me). */
  rev: Map<string, string[]>;
}

export function buildImportAdjacency(ir: RepoIR): ImportAdjacency {
  const fwd = new Map<string, string[]>();
  const rev = new Map<string, string[]>();
  for (const e of ir.edges) {
    if (e.kind !== "import" || e.resolution !== "resolved-static") continue;
    (fwd.get(e.from) ?? fwd.set(e.from, []).get(e.from)!).push(e.to);
    (rev.get(e.to) ?? rev.set(e.to, []).get(e.to)!).push(e.from);
  }
  return { fwd, rev };
}

/** BFS transitive closure from `start` (start itself excluded). */
export function reachableFrom(start: string, adj: Map<string, string[]>): Set<string> {
  const out = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (next !== start && !out.has(next)) {
        out.add(next);
        queue.push(next);
      }
    }
  }
  return out;
}

export interface BlastRadius {
  file: string;
  /** Files that (transitively) depend on `file` — change here may break them. */
  upstream: Set<string>;
  /** Files `file` (transitively) depends on. */
  downstream: Set<string>;
}

export function blastRadius(ir: RepoIR, file: string): BlastRadius {
  const adj = buildImportAdjacency(ir);
  return {
    file,
    upstream: reachableFrom(file, adj.rev),
    downstream: reachableFrom(file, adj.fwd),
  };
}
