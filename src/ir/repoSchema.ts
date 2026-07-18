/**
 * RepoIR — the versioned contract for UNIVERSAL repo cartography (ADR-0055).
 *
 * Parallel to the UiPath IRGraph (src/ir/schema.ts), sharing the accuracy
 * conventions from sharedCore.ts. Deliberately a separate schema: the tested
 * UiPath pipeline stays untouched; the renderer's Zone tree is the common seam.
 *
 * v0.1.0 = tier-0 provable facts (inventory, LOC, language, hygiene) with the
 * U1/U2 fields (symbols, imports, edges) already specified so those milestones
 * are additive-minor, not breaking.
 */
import { z } from "zod";
import { Resolution, Confidence, EvidenceSpan, ParseStatus } from "./sharedCore.ts";

export const REPO_IR_VERSION = "0.1.0";

/** A declared symbol inside a file (U1 — tree-sitter tags-level facts). */
export const SymbolInfo = z.object({
  name: z.string(),
  /** e.g. function | class | method | interface | type | enum | const | module */
  kind: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  signature: z.string().optional(),
});
export type SymbolInfo = z.infer<typeof SymbolInfo>;

/** An import/using/require statement AS WRITTEN (U1 syntactic fact — no resolution implied). */
export const ImportFact = z.object({
  /** The literal specifier text (e.g. "./util", "react", "pkg.module") — verbatim. */
  specifier: z.string(),
  line: z.number().int().positive(),
  /** True when the specifier is NOT a string literal (dynamic) — a Tier-3 signal. */
  dynamic: z.boolean(),
});
export type ImportFact = z.infer<typeof ImportFact>;

export const FileNode = z.object({
  /** Project-relative forward-slashed path — the graph id. */
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  /** Physical line count (see diagnostics.locRule for the declared counting rule). */
  lines: z.number().int().nonnegative(),
  linesNonEmpty: z.number().int().nonnegative(),
  /** Detected language id (lowercase; "unknown" when the cascade found nothing). */
  language: z.string(),
  /** How the language was determined — Rule-22 provenance (e.g. "extension:.ts"). */
  languageEvidence: z.string(),
  parseStatus: ParseStatus,
  /** Present iff parseStatus === "skipped". */
  skipReason: z.string().optional(),
  /** U1+: syntactic facts (empty until the syntax tier runs on this file). */
  symbols: z.array(SymbolInfo),
  imports: z.array(ImportFact),
});
export type FileNode = z.infer<typeof FileNode>;

/** A cross-file edge. U0 emits none; U2+ populate under the accuracy contract. */
export const RepoEdge = z.object({
  from: z.string(), // FileNode.path
  /** Target: a FileNode.path when resolved into the set, else the raw specifier. */
  to: z.string(),
  kind: z.literal("import"),
  resolution: Resolution,
  confidence: Confidence,
  evidence: EvidenceSpan,
});
export type RepoEdge = z.infer<typeof RepoEdge>;

/** A hygiene exclusion applied wholesale to a directory subtree. */
export const ExcludedDir = z.object({
  dir: z.string(),
  rule: z.string(),
  /** Entry count pruned under this dir when known (GitHub tree gives us this). */
  entries: z.number().int().nonnegative().optional(),
});
export type ExcludedDir = z.infer<typeof ExcludedDir>;

export const RepoDiagnostics = z.object({
  filesTotal: z.number().int().nonnegative(), // rendered files (incl. skipped-but-visible)
  filesSkipped: z.number().int().nonnegative(),
  excludedDirs: z.array(ExcludedDir),
  bytesTotal: z.number().int().nonnegative(),
  locTotal: z.number().int().nonnegative(),
  /** The declared counting rule LOC was computed under (OQ-09). */
  locRule: z.string(),
  /** language -> { files, loc } aggregate. */
  languages: z.record(z.string(), z.object({ files: z.number().int(), loc: z.number().int() })),
  edgesByResolution: z.record(z.string(), z.number().int()),
  /** % of syntax-tier-eligible files that parsed clean (null until U1 runs). */
  parseCleanPct: z.number().min(0).max(100).nullable(),
  /** Assumptions in force for this extraction (rendered in the scorecard). */
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type RepoDiagnostics = z.infer<typeof RepoDiagnostics>;

export const RepoMeta = z.object({
  name: z.string(),
  /** Human source label ("github: owner/repo@ref", "zip: x.zip", "folder: y"). */
  source: z.string(),
  ref: z.string().optional(),
});
export type RepoMeta = z.infer<typeof RepoMeta>;

export const RepoIR = z.object({
  version: z.literal(REPO_IR_VERSION),
  /** Discriminant vs the UiPath IRGraph for the "load IR JSON" path. */
  irKind: z.literal("repo"),
  repo: RepoMeta,
  files: z.array(FileNode),
  edges: z.array(RepoEdge),
  diagnostics: RepoDiagnostics,
});
export type RepoIR = z.infer<typeof RepoIR>;

/** Boundary validation (RISK-02 discipline): throws on shape mismatch — fail loud. */
export function validateRepoIR(candidate: unknown): RepoIR {
  return RepoIR.parse(candidate);
}

export function safeValidateRepoIR(candidate: unknown) {
  return RepoIR.safeParse(candidate);
}
