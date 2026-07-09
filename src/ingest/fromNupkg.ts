/**
 * Ingest from a `.nupkg` (or plain `.zip`) — a NuGet package is just a zip.
 * Unzips in-browser with fflate, extracting only `.xaml` + `project.json`.
 * RISK-06: bounded to relevant entries; we never execute anything, only read.
 */
import { unzipSync, strFromU8 } from "fflate";
import type { IngestedProject, RawFile } from "./types.ts";
import { normalizeProject } from "./normalize.ts";

/** NuGet package metadata we never want to treat as project files. */
function isPackagePlumbing(name: string): boolean {
  return (
    name.startsWith("_rels/") ||
    name.startsWith("package/") ||
    name === "[Content_Types].xml" ||
    name.endsWith(".nuspec") ||
    name.endsWith(".psmdcp")
  );
}

function isRelevant(name: string): boolean {
  if (isPackagePlumbing(name)) return false;
  return /\.xaml$/i.test(name) || /(^|\/)project\.json$/i.test(name);
}

export function ingestFromNupkgBytes(bytes: Uint8Array, fileName: string): IngestedProject {
  const notes: string[] = [];
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter: (f) => isRelevant(f.name) });
  } catch (err) {
    return {
      rootName: fileName.replace(/\.(nupkg|zip)$/i, ""),
      xamlFiles: [],
      projectJson: undefined,
      sourceLabel: `nupkg: ${fileName}`,
      notes: [`Failed to unzip "${fileName}": ${(err as Error).message}`],
    };
  }

  const raw: RawFile[] = Object.entries(entries).map(([name, data]) => ({
    // NuGet zips percent-encode some path chars; decode for readable ids.
    path: safeDecode(name),
    text: strFromU8(data),
  }));

  const norm = normalizeProject(raw);
  notes.push(...norm.notes);
  return {
    rootName: norm.rootName,
    xamlFiles: norm.xamlFiles,
    projectJson: norm.projectJson,
    sourceLabel: `nupkg: ${fileName}`,
    notes,
  };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export async function ingestFromNupkg(file: File): Promise<IngestedProject> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return ingestFromNupkgBytes(bytes, file.name);
}
