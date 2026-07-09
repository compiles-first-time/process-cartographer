/**
 * normalizeProject — given the raw files from any source, find the UiPath
 * project root (the directory containing `project.json`) and re-root every
 * `.xaml` to it, so InvokeWorkflowFile paths like `Framework\X.xaml` resolve
 * regardless of whether the source wrapped the project in a folder (folder
 * pickers, `.nupkg`, and GitHub tarballs all do this differently).
 */
import type { RawFile } from "./types.ts";
import type { SourceFile } from "../parser/assembleIR.ts";
import { normalizeId } from "../parser/projectMeta.ts";

const PROJECT_JSON = "project.json";

function depth(p: string): number {
  return normalizeId(p).split("/").length;
}

function isXaml(p: string): boolean {
  return /\.xaml$/i.test(p);
}

function basename(p: string): string {
  const norm = normalizeId(p);
  return norm.slice(norm.lastIndexOf("/") + 1);
}

function dirname(p: string): string {
  const norm = normalizeId(p);
  const i = norm.lastIndexOf("/");
  return i < 0 ? "" : norm.slice(0, i);
}

/** Longest common directory prefix of a set of paths (forward-slashed). */
function commonDir(paths: string[]): string {
  if (paths.length === 0) return "";
  const split = paths.map((p) => normalizeId(p).split("/").slice(0, -1));
  let prefix = split[0];
  for (const parts of split.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < parts.length && prefix[i] === parts[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix.join("/");
}

export interface NormalizeResult {
  rootName: string;
  base: string;
  xamlFiles: SourceFile[];
  projectJson?: string;
  notes: string[];
}

export function normalizeProject(rawFiles: RawFile[]): NormalizeResult {
  const notes: string[] = [];

  // 1. Pick the shallowest project.json as the project root marker.
  const projectJsons = rawFiles
    .filter((f) => basename(f.path).toLowerCase() === PROJECT_JSON)
    .sort((a, b) => depth(a.path) - depth(b.path));

  let base: string;
  let projectJson: string | undefined;

  if (projectJsons.length > 0) {
    base = dirname(projectJsons[0].path);
    projectJson = projectJsons[0].text;
    if (projectJsons.length > 1) {
      notes.push(`Multiple project.json found; used the shallowest at "${normalizeId(projectJsons[0].path)}".`);
    }
  } else {
    // No project.json: fall back to the common directory of the .xaml files.
    const xamlPaths = rawFiles.filter((f) => isXaml(f.path)).map((f) => f.path);
    base = commonDir(xamlPaths);
    notes.push("No project.json found — treating the common folder of the .xaml files as the project root.");
  }

  const basePrefix = base ? base + "/" : "";

  // 2. Re-root .xaml files under `base`.
  const xamlFiles: SourceFile[] = [];
  let skipped = 0;
  for (const f of rawFiles) {
    if (!isXaml(f.path)) continue;
    const norm = normalizeId(f.path);
    if (basePrefix && !norm.startsWith(basePrefix)) {
      skipped++;
      continue; // outside the project root (e.g. a sibling folder in the zip)
    }
    const id = basePrefix ? norm.slice(basePrefix.length) : norm;
    if (id) xamlFiles.push({ id, xml: f.text });
  }
  if (skipped > 0) notes.push(`Skipped ${skipped} .xaml file(s) outside the project root.`);
  if (xamlFiles.length === 0) notes.push("No .xaml workflows were found in this source.");

  const rootName = base ? basename(base) : "uipath-project";
  return { rootName, base, xamlFiles, projectJson, notes };
}
