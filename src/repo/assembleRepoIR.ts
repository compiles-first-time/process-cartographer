/**
 * assembleRepoIR — RawFiles → validated tier-0 RepoIR (ADR-0055, U0).
 *
 * Pure over its inputs (no fs, no network) so the browser ingest paths, the
 * future companion CLI, and tests share the exact same assembly. Deterministic:
 * same input set (any order) → byte-identical IR.
 *
 * Tier-0 facts only: inventory, bytes, LOC (declared rule), language, hygiene.
 * parseStatus is "not-analyzed" for included files until the U1 syntax tier
 * runs; "skipped" files stay in the IR — visible, never silently dropped.
 */
import { validateRepoIR, type FileNode, type RepoIR, type RepoMeta, type ExcludedDir } from "../ir/repoSchema.ts";
import { detectLanguage } from "./detectLanguage.ts";
import { classifyFile, excludedDirOf, looksBinary, hygieneAssumptions } from "./hygiene.ts";
import type { FileSyntax } from "./syntax/facts.ts";
import { resolveImportEdges, RESOLUTION_ASSUMPTIONS } from "./resolveImports.ts";

export const LOC_RULE =
  "lines = physical newline-delimited lines; linesNonEmpty = lines with at least one non-whitespace character; no comment/blank semantics applied";

/** A file as delivered by any ingest adapter. Text present iff it was fetched. */
export interface RepoRawFile {
  path: string; // forward-slashed, repo-relative
  text?: string;
  /** Byte size when known without content (GitHub tree, File API); else derived from text. */
  bytes?: number;
  /** Adapter-level skip (e.g. "not fetched: over size cap") — recorded verbatim. */
  skipReason?: string;
}

function countLines(text: string): { lines: number; linesNonEmpty: number } {
  if (text.length === 0) return { lines: 0, linesNonEmpty: 0 };
  const parts = text.split("\n");
  // A trailing newline does not create a phantom last line.
  const lines = parts[parts.length - 1] === "" ? parts.length - 1 : parts.length;
  let linesNonEmpty = 0;
  for (let i = 0; i < lines; i++) if (/\S/.test(parts[i])) linesNonEmpty++;
  return { lines, linesNonEmpty };
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export interface AssembleOptions {
  /** U1 syntax-tier facts by path (absent → files stay "not-analyzed"). */
  syntax?: Map<string, FileSyntax>;
  extraWarnings?: string[];
  /** User-granted "parse this directory" overrides (exclusion bypass). */
  includeDirs?: string[];
}

export function assembleRepoIR(
  repo: RepoMeta,
  rawFiles: RepoRawFile[],
  opts: AssembleOptions = {},
): RepoIR {
  const { syntax, extraWarnings = [], includeDirs = [] } = opts;
  const warnings: string[] = [...extraWarnings];

  // 1. Prune excluded directories wholesale, summarizing per dir (rule + count).
  const excludedDirCounts = new Map<string, number>();
  const surviving: RepoRawFile[] = [];
  for (const f of rawFiles) {
    const path = f.path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "");
    const ex = excludedDirOf(path, includeDirs);
    if (ex) {
      excludedDirCounts.set(ex, (excludedDirCounts.get(ex) ?? 0) + 1);
      continue;
    }
    surviving.push({ ...f, path });
  }

  // 2. Per-file tier-0 facts (deterministic order).
  surviving.sort((a, b) => a.path.localeCompare(b.path));
  const seen = new Set<string>();
  const files: FileNode[] = [];
  const languages = new Map<string, { files: number; loc: number }>();
  let bytesTotal = 0;
  let locTotal = 0;
  let filesSkipped = 0;

  for (const f of surviving) {
    if (seen.has(f.path)) {
      warnings.push(`duplicate path ignored: ${f.path}`);
      continue;
    }
    seen.add(f.path);

    const bytes = f.bytes ?? (f.text != null ? byteLength(f.text) : 0);
    const firstLine = f.text != null ? f.text.slice(0, 200).split("\n", 1)[0] : undefined;
    const det = detectLanguage(f.path, firstLine);

    // Hygiene: adapter-declared skip > extension/size verdict > content sniff.
    let skipReason = f.skipReason;
    if (!skipReason) {
      const verdict = classifyFile(f.path, bytes);
      if (!verdict.included) skipReason = verdict.reason;
    }
    if (!skipReason && f.text != null && det.language === "unknown" && looksBinary(f.text.slice(0, 8000))) {
      skipReason = "binary content (NUL byte)";
    }
    if (!skipReason && f.text == null) {
      skipReason = "content not fetched";
    }

    if (skipReason) {
      filesSkipped++;
      files.push({
        path: f.path,
        bytes,
        lines: 0,
        linesNonEmpty: 0,
        language: det.language,
        languageEvidence: det.evidence,
        parseStatus: "skipped",
        skipReason,
        symbols: [],
        imports: [],
      });
      bytesTotal += bytes;
      continue;
    }

    const { lines, linesNonEmpty } = countLines(f.text!);
    const fx = syntax?.get(f.path);
    files.push({
      path: f.path,
      bytes,
      lines,
      linesNonEmpty,
      language: det.language,
      languageEvidence: det.evidence,
      parseStatus: fx ? (fx.parseClean ? "parse-clean" : "parse-errors") : "not-analyzed",
      symbols: fx?.symbols ?? [],
      imports: fx?.imports ?? [],
    });
    bytesTotal += bytes;
    locTotal += lines;
    const agg = languages.get(det.language) ?? { files: 0, loc: 0 };
    agg.files++;
    agg.loc += lines;
    languages.set(det.language, agg);
  }

  const excludedDirs: ExcludedDir[] = [...excludedDirCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dir, entries]) => ({
      dir,
      rule: `excluded directory name: ${dir.split("/").pop()}`,
      entries,
    }));

  if (files.length === 0) warnings.push("No files survived ingestion — nothing to render.");

  // Parse-clean % over syntax-tier-analyzed files (null until the tier runs).
  const analyzed = files.filter((f) => f.parseStatus === "parse-clean" || f.parseStatus === "parse-errors");
  const parseCleanPct =
    analyzed.length > 0
      ? (files.filter((f) => f.parseStatus === "parse-clean").length / analyzed.length) * 100
      : null;

  // Cross-file import edges from as-written facts (only when the syntax tier ran).
  const edges = syntax ? resolveImportEdges(files) : [];
  const edgesByResolution: Record<string, number> = {};
  for (const e of edges) edgesByResolution[e.resolution] = (edgesByResolution[e.resolution] ?? 0) + 1;

  const assumptions = [...hygieneAssumptions()];
  if (syntax) assumptions.push(...RESOLUTION_ASSUMPTIONS);
  if (includeDirs.length > 0) assumptions.push(`User-included directories (exclusion overridden): ${includeDirs.join(", ")}`);

  const ir: RepoIR = {
    version: "0.1.0",
    irKind: "repo",
    repo,
    files,
    edges,
    diagnostics: {
      filesTotal: files.length,
      filesSkipped,
      excludedDirs,
      bytesTotal,
      locTotal,
      locRule: LOC_RULE,
      languages: Object.fromEntries([...languages.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
      edgesByResolution,
      parseCleanPct,
      assumptions,
      warnings,
    },
  };

  // Boundary enforcement — the IR is validated at birth (RISK-02 discipline).
  return validateRepoIR(ir);
}
