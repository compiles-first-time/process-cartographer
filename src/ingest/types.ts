import type { SourceFile } from "../parser/assembleIR.ts";

/** A raw file pulled from any source, before project-rooting. */
export interface RawFile {
  /** Full path as the source reported it (may include a wrapper folder). */
  path: string;
  text: string;
}

/** The normalized result of any ingest adapter — feeds parseProjectMeta + assembleIR. */
export interface IngestedProject {
  /** Best-guess project name (folder name; overridden by project.json id downstream). */
  rootName: string;
  /** `.xaml` files, re-rooted so ids are project-relative (Main.xaml, Framework/X.xaml). */
  xamlFiles: SourceFile[];
  /** Raw `project.json` text, if present. */
  projectJson?: string;
  /** Human label of where this came from (shown in the UI). */
  sourceLabel: string;
  /** Ingest-level notes/warnings (skipped files, truncated trees, missing project.json). */
  notes: string[];
}

export type IngestSource = "folder" | "nupkg" | "github";
