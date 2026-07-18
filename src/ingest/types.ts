import type { SourceFile } from "../parser/assembleIR.ts";
import type { RepoRawFile } from "../repo/assembleRepoIR.ts";

/** A raw file pulled from any source, before project-rooting. */
export interface RawFile {
  /** Full path as the source reported it (may include a wrapper folder). */
  path: string;
  text: string;
}

/**
 * The normalized result of any ingest adapter. Carries BOTH views:
 * - the UiPath view (xamlFiles + projectJson) for the original pipeline, and
 * - the universal view (allFiles, ADR-0055 U0) for repo cartography.
 * buildLoaded() decides which pipeline renders it.
 */
export interface IngestedProject {
  /** Best-guess project name (folder name; overridden by project.json id downstream). */
  rootName: string;
  /** `.xaml` files, re-rooted so ids are project-relative (Main.xaml, Framework/X.xaml). */
  xamlFiles: SourceFile[];
  /** Raw `project.json` text, if present. */
  projectJson?: string;
  /** Universal file set (paths always present; text present iff fetched/passed hygiene). */
  allFiles?: RepoRawFile[];
  /** Human label of where this came from (shown in the UI). */
  sourceLabel: string;
  /** Ingest-level notes/warnings (skipped files, truncated trees, missing project.json). */
  notes: string[];
  /**
   * On-demand inclusion (ADR-0055 "parse this directory" from inside the map):
   * fetch/read/decode the text of files under `dirPrefix` that were not loaded
   * at ingest (excluded dirs). Per-file hygiene (binary/size) still applies
   * inside. Non-serializable capability — memory-only, absent on IR-JSON loads.
   */
  expandDir?: (dirPrefix: string) => Promise<RepoRawFile[]>;
}

export type IngestSource = "folder" | "nupkg" | "github" | "ir-json";
