/**
 * Ingest from a folder picked via `<input type="file" webkitdirectory>`.
 * Reads only `.xaml` and `project.json` (skips binaries / large assets).
 */
import type { IngestedProject, RawFile } from "./types.ts";
import { normalizeProject } from "./normalize.ts";

function relPath(file: File): string {
  // webkitRelativePath is "PickedFolder/sub/File.xaml"; fall back to name.
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function isRelevant(path: string): boolean {
  return /\.xaml$/i.test(path) || /(^|\/)project\.json$/i.test(path);
}

export async function ingestFromFolder(files: FileList | File[]): Promise<IngestedProject> {
  const list = Array.from(files);
  const relevant = list.filter((f) => isRelevant(relPath(f)));
  const raw: RawFile[] = await Promise.all(
    relevant.map(async (f) => ({ path: relPath(f), text: await f.text() })),
  );
  const norm = normalizeProject(raw);
  const label = list.length ? relPath(list[0]).split("/")[0] || norm.rootName : norm.rootName;
  return {
    rootName: norm.rootName,
    xamlFiles: norm.xamlFiles,
    projectJson: norm.projectJson,
    sourceLabel: `folder: ${label}`,
    notes: norm.notes,
  };
}
