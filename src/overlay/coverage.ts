/**
 * coverage — the E1 execution overlay (docs/roadmap-improvements.md).
 *
 * Parses REAL coverage artifacts produced by the repo's own test/tooling runs:
 *  - Istanbul/c8/Jest `coverage-final.json` ({ absPath: { statementMap, s } })
 *  - coverage.py `coverage json` output ({ files: { relPath: { summary } } })
 *
 * Accuracy contract: this is an OVERLAY keyed to file paths — observed execution
 * facts painted onto computed structure. It never creates or removes nodes or
 * edges. Entries that match no ingested file are counted and disclosed, never
 * silently dropped.
 */

export interface FileCoverage {
  /** Covered statement/line count. */
  covered: number;
  /** Total statements/lines instrumented. */
  total: number;
}

export interface CoverageOverlay {
  label: string;
  format: "istanbul" | "coverage.py";
  byFile: Map<string, FileCoverage>;
  matched: number;
  unmatched: number;
  unmatchedSamples: string[];
}

/** Longest-suffix match of an artifact path against the ingested file set. */
export function matchPath(artifactPath: string, filePaths: Set<string>): string | null {
  const norm = artifactPath.replace(/\\/g, "/");
  if (filePaths.has(norm)) return norm;
  // Try progressively shorter suffixes of the artifact path.
  const parts = norm.split("/");
  for (let i = 1; i < parts.length; i++) {
    const suffix = parts.slice(i).join("/");
    if (filePaths.has(suffix)) return suffix;
  }
  return null;
}

export function parseCoverage(jsonText: string, irFilePaths: string[], label: string): CoverageOverlay {
  let obj: unknown;
  try {
    obj = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Not valid JSON: ${(err as Error).message}`);
  }
  const rec = obj as Record<string, unknown>;
  const fileSet = new Set(irFilePaths);

  // coverage.py: { meta: {...}, files: { path: { summary: {...} } } }
  const filesRec = rec.files as Record<string, unknown> | undefined;
  if (filesRec && typeof filesRec === "object" && rec.meta != null) {
    return parseEntries(
      Object.entries(filesRec).map(([p, v]) => {
        const f = v as { summary?: { covered_lines?: number; num_statements?: number }; executed_lines?: number[] };
        const covered = f.summary?.covered_lines ?? f.executed_lines?.length ?? 0;
        const total = f.summary?.num_statements ?? Math.max(covered, 1);
        return [p, { covered, total }] as const;
      }),
      fileSet,
      label,
      "coverage.py",
    );
  }

  // Istanbul/c8/Jest: { absPath: { path, statementMap, s: { id: hits } } }
  const entries = Object.entries(rec).filter(
    ([, v]) => v != null && typeof v === "object" && "statementMap" in (v as object) && "s" in (v as object),
  );
  if (entries.length > 0) {
    return parseEntries(
      entries.map(([p, v]) => {
        const s = (v as { s: Record<string, number> }).s;
        const hits = Object.values(s);
        return [p, { covered: hits.filter((h) => h > 0).length, total: Math.max(hits.length, 1) }] as const;
      }),
      fileSet,
      label,
      "istanbul",
    );
  }

  throw new Error(
    "Unrecognized coverage format — expected Istanbul/c8/Jest coverage-final.json or `coverage json` (coverage.py) output.",
  );
}

function parseEntries(
  entries: readonly (readonly [string, FileCoverage])[],
  fileSet: Set<string>,
  label: string,
  format: CoverageOverlay["format"],
): CoverageOverlay {
  const byFile = new Map<string, FileCoverage>();
  let unmatched = 0;
  const unmatchedSamples: string[] = [];
  for (const [p, cov] of entries) {
    const target = matchPath(p, fileSet);
    if (target) {
      const prev = byFile.get(target);
      byFile.set(
        target,
        prev ? { covered: prev.covered + cov.covered, total: prev.total + cov.total } : cov,
      );
    } else {
      unmatched++;
      if (unmatchedSamples.length < 5) unmatchedSamples.push(p);
    }
  }
  if (byFile.size === 0) {
    throw new Error(
      `Coverage parsed (${format}) but NO entries matched the ingested files — is this artifact from the same repo?${unmatchedSamples.length ? ` Sample paths: ${unmatchedSamples.join(", ")}` : ""}`,
    );
  }
  return { label, format, byFile, matched: byFile.size, unmatched, unmatchedSamples };
}
