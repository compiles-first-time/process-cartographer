/**
 * Ingest from a folder picked via `<input type="file" webkitdirectory>`.
 * Universal (ADR-0055 U0): carries ALL files. Hygiene is applied BEFORE
 * reading content (excluded dirs / binaries / oversize are never read — their
 * paths+sizes still flow through so the IR can surface them honestly).
 */
import type { IngestedProject, RawFile } from "./types.ts";
import type { RepoRawFile } from "../repo/assembleRepoIR.ts";
import { normalizeProject } from "./normalize.ts";
import { classifyFile, excludedDirOf } from "../repo/hygiene.ts";

function relPath(file: File): string {
  // webkitRelativePath is "PickedFolder/sub/File.xaml"; fall back to name.
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function isUiPathRelevant(path: string): boolean {
  return /\.xaml$/i.test(path) || /(^|\/)project\.json$/i.test(path);
}

/** Strip the single picked-folder wrapper segment if every path shares it. */
function stripWrapper(paths: string[]): (p: string) => string {
  const firstSeg = new Set(paths.map((p) => p.split("/")[0]));
  if (firstSeg.size === 1 && paths.every((p) => p.includes("/"))) {
    const w = [...firstSeg][0] + "/";
    return (p) => p.slice(w.length);
  }
  return (p) => p;
}

export async function ingestFromFolder(files: FileList | File[]): Promise<IngestedProject> {
  const list = Array.from(files);
  const strip = stripWrapper(list.map(relPath));

  const all: RepoRawFile[] = [];
  const uipathRaw: RawFile[] = [];
  // Retained for on-demand "parse this directory": File handles of unread paths.
  const unread = new Map<string, File>();

  for (const f of list) {
    const path = strip(relPath(f));
    if (!path) continue;

    // Excluded dirs: pass path+size only — pruned+summarized downstream, never read.
    if (excludedDirOf(path)) {
      all.push({ path, bytes: f.size });
      unread.set(path, f);
      continue;
    }
    const verdict = classifyFile(path, f.size);
    if (!verdict.included) {
      all.push({ path, bytes: f.size, skipReason: verdict.reason });
      continue;
    }
    const text = await f.text();
    all.push({ path, text, bytes: f.size });
    if (isUiPathRelevant(path)) uipathRaw.push({ path, text });
  }

  const norm = normalizeProject(uipathRaw);
  const label = list.length ? relPath(list[0]).split("/")[0] || norm.rootName : norm.rootName;
  return {
    rootName: norm.rootName !== "uipath-project" ? norm.rootName : label,
    xamlFiles: norm.xamlFiles,
    projectJson: norm.projectJson,
    allFiles: all,
    sourceLabel: `folder: ${label}`,
    // UiPath-centric normalize notes are only meaningful when xaml is present.
    notes: norm.xamlFiles.length > 0 ? norm.notes : [],
    expandDir: async (dirPrefix: string) => {
      const out: RepoRawFile[] = [];
      for (const [path, file] of unread) {
        if (path !== dirPrefix && !path.startsWith(dirPrefix + "/")) continue;
        const verdict = classifyFile(path, file.size);
        if (!verdict.included) {
          out.push({ path, bytes: file.size, skipReason: verdict.reason });
          continue;
        }
        out.push({ path, text: await file.text(), bytes: file.size });
      }
      return out;
    },
  };
}
