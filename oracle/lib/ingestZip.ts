/**
 * ingestZip — turn a GitHub codeload zip (bytes) into the same IngestedProject
 * shape the browser adapters produce, with repo-relative paths (the single
 * top-level wrapper folder GitHub adds is stripped, exactly as the GitHub-URL
 * adapter yields repo-relative paths). Hygiene decisions are made by the SAME
 * shipped functions (classifyFile / excludedDirOf / strFromU8 decode) as
 * src/ingest/fromNupkg.ts — the harness measures the shipped policy, it does
 * not reimplement it.
 */
import { unzipSync, strFromU8 } from "fflate";
import type { IngestedProject } from "../../src/ingest/types.ts";
import type { RepoRawFile } from "../../src/repo/assembleRepoIR.ts";
import { classifyFile, excludedDirOf } from "../../src/repo/hygiene.ts";

export interface ZipIngest {
  ingested: IngestedProject;
  /** repo-relative path → raw bytes, for materializing the tree for oracles. */
  entryBytes: Map<string, Uint8Array>;
}

export function ingestFromGithubZip(bytes: Uint8Array, label: string): ZipIngest {
  const entries = unzipSync(bytes);
  const names = Object.keys(entries).filter((n) => !n.endsWith("/"));
  if (names.length === 0) throw new Error(`zip "${label}" contains no files`);

  // GitHub archives wrap everything in "<repo>-<sha>/" — strip that single root.
  const firstSeg = names[0].split("/")[0] + "/";
  const wrapped = names.every((n) => n.startsWith(firstSeg));

  const all: RepoRawFile[] = [];
  const entryBytes = new Map<string, Uint8Array>();
  for (const name of names) {
    const path = wrapped ? name.slice(firstSeg.length) : name;
    if (path === "") continue;
    const data = entries[name];
    entryBytes.set(path, data);
    if (excludedDirOf(path)) {
      all.push({ path, bytes: data.length });
      continue;
    }
    const verdict = classifyFile(path, data.length);
    if (!verdict.included) {
      all.push({ path, bytes: data.length, skipReason: verdict.reason });
      continue;
    }
    all.push({ path, text: strFromU8(data), bytes: data.length });
  }

  return {
    ingested: { rootName: label, xamlFiles: [], allFiles: all, sourceLabel: `oracle corpus: ${label}`, notes: [] },
    entryBytes,
  };
}
