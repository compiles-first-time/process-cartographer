/**
 * Ingest from a `.nupkg` / `.zip` — a NuGet package is just a zip.
 * Universal (ADR-0055 U0): extracts ALL entries; hygiene decides which get
 * text-decoded vs recorded as skipped. RISK-06: we only read, never execute.
 */
import { unzipSync, strFromU8 } from "fflate";
import type { IngestedProject, RawFile } from "./types.ts";
import type { RepoRawFile } from "../repo/assembleRepoIR.ts";
import { normalizeProject } from "./normalize.ts";
import { classifyFile, excludedDirOf } from "../repo/hygiene.ts";

/** NuGet package metadata — plumbing for UiPath view; ordinary files for repo view. */
function isPackagePlumbing(name: string): boolean {
  return (
    name.startsWith("_rels/") ||
    name.startsWith("package/") ||
    name === "[Content_Types].xml" ||
    name.endsWith(".nuspec") ||
    name.endsWith(".psmdcp")
  );
}

function isUiPathRelevant(name: string): boolean {
  if (isPackagePlumbing(name)) return false;
  return /\.xaml$/i.test(name) || /(^|\/)project\.json$/i.test(name);
}

export function ingestFromNupkgBytes(bytes: Uint8Array, fileName: string): IngestedProject {
  const notes: string[] = [];
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (err) {
    return {
      rootName: fileName.replace(/\.(nupkg|zip)$/i, ""),
      xamlFiles: [],
      allFiles: [],
      sourceLabel: `archive: ${fileName}`,
      notes: [`Failed to unzip "${fileName}": ${(err as Error).message}`],
    };
  }

  const all: RepoRawFile[] = [];
  const uipathRaw: RawFile[] = [];
  // Retained for on-demand "parse this directory": undecoded entry bytes.
  const undecoded = new Map<string, Uint8Array>();

  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith("/")) continue; // directory entry
    const path = safeDecode(name);
    if (excludedDirOf(path)) {
      all.push({ path, bytes: data.length });
      undecoded.set(path, data);
      continue;
    }
    const verdict = classifyFile(path, data.length);
    if (!verdict.included) {
      all.push({ path, bytes: data.length, skipReason: verdict.reason });
      continue;
    }
    const text = strFromU8(data);
    all.push({ path, text, bytes: data.length });
    if (isUiPathRelevant(path)) uipathRaw.push({ path, text });
  }

  const norm = normalizeProject(uipathRaw);
  if (norm.xamlFiles.length > 0) notes.push(...norm.notes);
  return {
    rootName: norm.rootName !== "uipath-project" ? norm.rootName : fileName.replace(/\.(nupkg|zip)$/i, ""),
    xamlFiles: norm.xamlFiles,
    projectJson: norm.projectJson,
    allFiles: all,
    sourceLabel: `archive: ${fileName}`,
    notes,
    expandDir: async (dirPrefix: string) => {
      const out: RepoRawFile[] = [];
      for (const [path, data] of undecoded) {
        if (path !== dirPrefix && !path.startsWith(dirPrefix + "/")) continue;
        const verdict = classifyFile(path, data.length);
        if (!verdict.included) {
          out.push({ path, bytes: data.length, skipReason: verdict.reason });
          continue;
        }
        out.push({ path, text: strFromU8(data), bytes: data.length });
      }
      return out;
    },
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
