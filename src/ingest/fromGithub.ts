/**
 * Ingest from a public GitHub repo URL — browser-only, no backend.
 *
 * Strategy (CORS-safe): api.github.com and raw.githubusercontent.com both send
 * `Access-Control-Allow-Origin: *`, so we (1) resolve the default branch, (2)
 * list the git tree, (3) fetch only the `.xaml` + `project.json` blobs from raw.
 * codeload zipballs are NOT CORS-enabled, so we avoid them.
 *
 * Unauthenticated GitHub allows 60 requests/hour; a small REFramework is ~15
 * requests. An optional token raises the limit and enables private repos.
 */
import type { IngestedProject, RawFile } from "./types.ts";
import type { RepoRawFile } from "../repo/assembleRepoIR.ts";
import { normalizeProject } from "./normalize.ts";
import { classifyFile, excludedDirOf } from "../repo/hygiene.ts";

/** Honest ceiling for per-file browser fetches (RISK-11): refuse loudly, never partially ingest. */
export const MAX_FETCH_FILES = 2000;

export interface GithubRef {
  owner: string;
  repo: string;
  branch?: string;
  /** Optional subdirectory within the repo to treat as the project root. */
  subdir?: string;
}

/** Parse the many shapes of a GitHub URL / shorthand into owner/repo/branch/subdir. */
export function parseGithubUrl(input: string): GithubRef | null {
  const trimmed = input.trim().replace(/\.git$/, "");
  if (!trimmed) return null;

  // Shorthand: owner/repo
  const shorthand = /^([\w.-]+)\/([\w.-]+)$/.exec(trimmed);
  if (shorthand) return { owner: shorthand[1], repo: shorthand[2] };

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (!/(^|\.)github\.com$/i.test(u.hostname)) return null;

  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo, kind, branch, ...rest] = parts;
  const ref: GithubRef = { owner, repo };
  // .../tree/<branch>/<subdir...>  or  .../blob/<branch>/<path...>
  if ((kind === "tree" || kind === "blob") && branch) {
    ref.branch = branch;
    if (rest.length) ref.subdir = rest.join("/");
  }
  return ref;
}

interface FetchOpts {
  token?: string;
  fetchImpl?: typeof fetch;
}

function ghHeaders(token?: string): HeadersInit {
  const h: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch with retry/backoff on transient rate-limit/unavailable responses (429/503). */
async function fetchWithRetry(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit | undefined,
  retries = 3,
): Promise<Response> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await doFetch(url, init);
    if (res.status !== 429 && res.status !== 503) return res;
    if (attempt >= retries) return res; // give up; caller surfaces the status
    const retryAfter = Number(res.headers.get("retry-after"));
    const backoff = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 8000)
      : 500 * Math.pow(2, attempt) + 200 * (attempt + 1);
    await sleep(backoff);
    attempt++;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function ingestFromGithub(url: string, opts: FetchOpts = {}): Promise<IngestedProject> {
  const doFetch = opts.fetchImpl ?? fetch;
  const ref = parseGithubUrl(url);
  if (!ref) throw new Error(`Not a recognizable GitHub URL: "${url}"`);
  const { owner, repo } = ref;
  const notes: string[] = [];

  // 1. Resolve the branch.
  let branch = ref.branch;
  if (!branch) {
    const repoRes = await fetchWithRetry(doFetch, `https://api.github.com/repos/${owner}/${repo}`, { headers: ghHeaders(opts.token) });
    if (!repoRes.ok) throw githubError(repoRes.status, `${owner}/${repo}`);
    branch = ((await repoRes.json()) as { default_branch?: string }).default_branch || "main";
  }

  // 2. List the git tree (recursive).
  const treeRes = await fetchWithRetry(
    doFetch,
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers: ghHeaders(opts.token) },
  );
  if (!treeRes.ok) throw githubError(treeRes.status, `${owner}/${repo}@${branch}`);
  const tree = (await treeRes.json()) as { tree?: { path: string; type: string }[]; truncated?: boolean };
  if (tree.truncated) notes.push("Repo tree was truncated by GitHub (very large repo); some files may be missing.");

  const subdirPrefix = ref.subdir ? ref.subdir.replace(/\/$/, "") + "/" : "";
  const inScope = (tree.tree ?? []).filter(
    (n) => n.type === "blob" && (!subdirPrefix || n.path.startsWith(subdirPrefix)),
  );
  if (inScope.length === 0) throw new Error(`No files found in ${owner}/${repo}@${branch}${ref.subdir ? "/" + ref.subdir : ""}.`);

  // 3. Universal hygiene triage from tree metadata (path + size) BEFORE fetching
  //    (ADR-0055 U0): excluded dirs and skipped files never cost a request.
  const stripSubdir = (p: string) => (subdirPrefix ? p.slice(subdirPrefix.length) : p);
  const all: RepoRawFile[] = [];
  const toFetch: { path: string; relPath: string }[] = [];
  for (const n of inScope) {
    const size = (n as { size?: number }).size;
    const relPath = stripSubdir(n.path);
    if (!relPath) continue;
    if (excludedDirOf(relPath)) {
      all.push({ path: relPath, bytes: size ?? 0 });
      continue;
    }
    const verdict = classifyFile(relPath, size);
    if (!verdict.included) {
      all.push({ path: relPath, bytes: size ?? 0, skipReason: verdict.reason });
      continue;
    }
    toFetch.push({ path: n.path, relPath });
  }

  // Honest ceiling (RISK-11): refuse loudly before any partial silent ingest.
  if (toFetch.length > MAX_FETCH_FILES) {
    throw new Error(
      `${owner}/${repo}@${branch} has ${toFetch.length.toLocaleString()} fetchable text files — beyond the browser per-file fetch ceiling (${MAX_FETCH_FILES.toLocaleString()}). Upload the repo as a .zip instead (Code → Download ZIP), which ingests locally without per-file requests.`,
    );
  }

  // 4. Fetch the raw blobs (modest concurrency + backoff; raw.githubusercontent
  //    rate-limits bursts with 429). Path segments must be URI-encoded — real
  //    repos contain names like "% of dogs.txt" (found live in expressjs/express).
  const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");
  const fetched: RepoRawFile[] = await mapLimit(toFetch, 4, async (n) => {
    const rawRes = await fetchWithRetry(doFetch, `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${encodePath(n.path)}`, undefined);
    if (!rawRes.ok) {
      if (rawRes.status === 429) throw new Error(`GitHub raw content rate-limited (HTTP 429) fetching ${n.path}. Try again shortly, or add a token.`);
      throw new Error(`Failed to fetch ${n.path} (HTTP ${rawRes.status}).`);
    }
    const text = await rawRes.text();
    return { path: n.relPath, text };
  });
  all.push(...fetched);

  // 5. UiPath view (unchanged pipeline): xaml + project.json from the fetched set.
  const uipathRaw: RawFile[] = fetched
    .filter((f) => f.text != null && (/\.xaml$/i.test(f.path) || /(^|\/)project\.json$/i.test(f.path)))
    .map((f) => ({ path: f.path, text: f.text! }));
  const norm = normalizeProject(uipathRaw);
  if (norm.xamlFiles.length > 0) notes.push(...norm.notes);

  return {
    rootName: (norm.xamlFiles.length > 0 && norm.rootName !== "uipath-project" ? norm.rootName : "") || repo,
    xamlFiles: norm.xamlFiles,
    projectJson: norm.projectJson,
    allFiles: all,
    sourceLabel: `github: ${owner}/${repo}@${branch}${ref.subdir ? "/" + ref.subdir : ""}`,
    notes,
  };
}

function githubError(status: number, what: string): Error {
  if (status === 404) return new Error(`GitHub: "${what}" not found (private repo or wrong branch? add a token).`);
  if (status === 403) return new Error("GitHub rate limit hit (60 req/hour unauthenticated). Add a personal access token to continue.");
  if (status === 401) return new Error("GitHub: invalid token.");
  return new Error(`GitHub request failed for "${what}" (HTTP ${status}).`);
}
