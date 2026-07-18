/**
 * hygiene — the include/skip policy for repo ingestion (ADR-0055; RISK-11).
 *
 * Two hard rules from the accuracy contract:
 *  1. Nothing is dropped silently. Excluded DIRS are pruned wholesale but
 *     summarized (dir + rule + entry count); individually skipped FILES are
 *     recorded with a reason and rendered as "skipped" buildings.
 *  2. The policy is deterministic and disclosed (it feeds diagnostics.assumptions).
 */

/** Directory names pruned wholesale at any depth (generated/vendored content). */
export const EXCLUDED_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "vendor",
  "target",
  "bin",
  "obj",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".idea",
  ".vs",
  // NOTE: "packages" is deliberately NOT excluded — in JS monorepos (pnpm/lerna/
  // nx) packages/ is FIRST-PARTY code. NuGet packages dirs are mostly binaries,
  // which the per-file binary/size rules skip individually anyway. (User report
  // 2026-07-18: "it did not parse everything".)
]);

/** File extensions treated as binary — never fetched/parsed; rendered as skipped. */
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "svgz", "tiff",
  "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "odt",
  "zip", "gz", "tar", "tgz", "rar", "7z", "nupkg", "jar", "war",
  "exe", "dll", "so", "dylib", "bin", "dat", "db", "sqlite",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "avi", "mov", "wav", "flac", "webm",
  "class", "pyc", "pyd", "o", "a", "lib", "pdb",
  "wasm", "onnx", "pt", "pb", "parquet",
]);

/** Max text-file size we ingest in-browser; larger files render as skipped. */
export const MAX_FILE_BYTES = 1_500_000;

/** Minified-asset patterns — parse noise, not human structure. */
const MINIFIED_RE = /\.min\.(js|css|mjs)$/i;
const SOURCEMAP_RE = /\.(map)$/i;

export interface HygieneVerdict {
  included: boolean;
  /** Set when included === false. */
  reason?: string;
}

export function excludedDirOf(path: string, includeDirs?: readonly string[]): string | null {
  // User-granted inclusion overrides (on-demand "parse this directory"): a path
  // under an included prefix is never excluded, whatever its dir names.
  if (includeDirs && includeDirs.some((d) => path === d || path.startsWith(d + "/"))) {
    return null;
  }
  const parts = path.split("/");
  for (let i = 0; i < parts.length - 1; i++) {
    if (EXCLUDED_DIR_NAMES.has(parts[i].toLowerCase())) {
      return parts.slice(0, i + 1).join("/");
    }
  }
  return null;
}

/** Verdict for a single file path (+ size when known before fetching content). */
export function classifyFile(path: string, bytes?: number): HygieneVerdict {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1) : "";

  if (BINARY_EXTENSIONS.has(ext)) return { included: false, reason: `binary (.${ext})` };
  if (MINIFIED_RE.test(name)) return { included: false, reason: "minified asset" };
  if (SOURCEMAP_RE.test(name)) return { included: false, reason: "source map" };
  if (bytes != null && bytes > MAX_FILE_BYTES) {
    return { included: false, reason: `over size cap (${(bytes / 1e6).toFixed(1)} MB > ${(MAX_FILE_BYTES / 1e6).toFixed(1)} MB)` };
  }
  return { included: true };
}

/** Content sniff for extensionless/unknown files already fetched: NUL byte ⇒ binary. */
export function looksBinary(sample: string): boolean {
  return sample.includes(String.fromCharCode(0));
}

/** The policy, stated for the scorecard (diagnostics.assumptions). */
export function hygieneAssumptions(): string[] {
  return [
    `Excluded directory names (pruned wholesale, summarized): ${[...EXCLUDED_DIR_NAMES].join(", ")}`,
    `Per-file size cap ${(MAX_FILE_BYTES / 1e6).toFixed(1)} MB; binary/minified/sourcemap files skipped — all skips are rendered, never silent`,
  ];
}
