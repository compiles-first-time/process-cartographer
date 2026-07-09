/**
 * loadProject — the Node/filesystem ingest path (tests + a potential CLI).
 * The graph-building core lives in `assembleIR.ts` (browser-safe) so the
 * browser ingest adapters reuse it without pulling `node:fs` into the bundle.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { assembleIR, normalizeId, type SourceFile } from "./assembleIR.ts";
import { parseProjectMeta } from "./projectMeta.ts";
import type { IRGraph } from "../ir/schema.ts";

export { assembleIR, normalizeId, type SourceFile };

/** Recursively collect every `.xaml` under rootDir as forward-slashed ids. */
export function collectXamlFiles(rootDir: string): SourceFile[] {
  const entries = readdirSync(rootDir, { recursive: true, withFileTypes: true });
  const files: SourceFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".xaml")) continue;
    const parent =
      (entry as unknown as { parentPath?: string; path?: string }).parentPath ??
      (entry as unknown as { path?: string }).path ??
      rootDir;
    const abs = path.join(parent, entry.name);
    const id = normalizeId(path.relative(rootDir, abs));
    files.push({ id, xml: readFileSync(abs, "utf8") });
  }
  files.sort((a, b) => a.id.localeCompare(b.id));
  return files;
}

function readProjectJson(rootDir: string): string | undefined {
  try {
    return readFileSync(path.join(rootDir, "project.json"), "utf8");
  } catch {
    return undefined;
  }
}

/** Full pipeline: read a project directory from disk → validated IR. */
export function loadProject(rootDir: string): IRGraph {
  const project = parseProjectMeta(readProjectJson(rootDir), path.basename(rootDir));
  const files = collectXamlFiles(rootDir);
  return assembleIR(project, files);
}
