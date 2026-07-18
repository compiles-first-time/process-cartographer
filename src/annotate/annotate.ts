/**
 * annotate — the AI interpretation overlay (ADR-0056, within the ADR-0055 §A.5
 * confinement): answers WHAT a building is (business/technical purpose), WHY it
 * may be structured this way, and HOW it works — grounded in the file's ACTUAL
 * source and the parser-computed facts we hand it.
 *
 * Hard boundaries (governance-enforced, see ADR-0056):
 *  - Output is INTERPRETATION. It never touches the IR, draws edges, or alters
 *    the map. It renders in a visually distinct, explicitly-labeled section.
 *  - The model receives only real source + computed facts; the prompt requires
 *    line-anchored grounding and permits "not determinable from source".
 *  - The API key lives in memory only; calls go directly to the Anthropic API
 *    from the browser (CORS-enabled); nothing is proxied or persisted.
 */
import type { Zone } from "../model/cityModel.ts";
import type { RepoIR } from "../ir/repoSchema.ts";
import type { RepoRawFile } from "../repo/assembleRepoIR.ts";

export interface Annotation {
  what: string;
  why: string;
  how: string;
  model: string;
}

// Model tiering (roadmap C3): Haiku by default, Sonnet on explicit "deepen".
// Both current per spec/policy/model-ids.json.
export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
export const DEEPEN_MODEL = "claude-sonnet-5";
export const PROMPT_VERSION = "annotate-v2"; // bump to invalidate the cache
const MAX_SOURCE_CHARS = 48_000;
const MAX_DISTRICT_FILES = 60;

const SYSTEM = `You annotate buildings on a 3D map of a codebase. You receive PARSER-COMPUTED facts and REAL source text. Answer three questions, concisely (2-5 sentences each):
- "what": What this file/directory IS — its business or technical purpose in the system.
- "why": Why it is plausibly structured/organized this way. You are inferring intent — hedge accordingly ("likely", "appears to"). Note if the structure seems suboptimal, without inventing history.
- "how": How it does its work — the mechanism, naming real functions/classes and anchoring claims to line numbers like (L42).

Hard rules: every claim must be grounded in the provided source or facts; if something cannot be determined from what you were given, say "not determinable from the provided source". Never invent files, symbols, imports, or behavior. Do not speculate about code you were not shown. Output STRICT JSON only: {"what": string, "why": string, "how": string} — no markdown fences, no extra keys.`;

function numberLines(text: string): string {
  return text
    .split("\n")
    .map((l, i) => `${i + 1}| ${l}`)
    .join("\n");
}

function fileContext(zone: Zone, ir: RepoIR, allFiles: RepoRawFile[]): string {
  const f = zone.file!;
  const raw = allFiles.find((r) => r.path === f.path);
  const src = raw?.text ? raw.text.slice(0, MAX_SOURCE_CHARS) : null;
  const truncated = raw?.text && raw.text.length > MAX_SOURCE_CHARS;

  const importedBy = ir.edges.filter((e) => e.resolution === "resolved-static" && e.to === f.path).map((e) => e.from);
  const importsOut = ir.edges.filter((e) => e.from === f.path);

  return [
    `FILE: ${f.path} (${f.language}, ${f.lines} lines, parse status: ${f.parseStatus})`,
    f.symbols.length
      ? `COMPUTED DECLARATIONS:\n${f.symbols.map((s) => `- ${s.kind} ${s.name} (L${s.startLine}-L${s.endLine})`).join("\n")}`
      : "COMPUTED DECLARATIONS: none extracted",
    importsOut.length
      ? `COMPUTED IMPORTS:\n${importsOut.map((e) => `- ${e.to} [${e.resolution}]`).join("\n")}`
      : "COMPUTED IMPORTS: none",
    importedBy.length
      ? `IMPORTED BY (computed): ${importedBy.join(", ")}`
      : "IMPORTED BY (computed): no in-repo importers found",
    src
      ? `SOURCE${truncated ? " (truncated)" : ""}:\n${numberLines(src)}`
      : "SOURCE: not available (file content not retained for this load)",
  ].join("\n\n");
}

function districtContext(zone: Zone, ir: RepoIR, allFiles: RepoRawFile[]): string {
  const dirPath = zone.id.startsWith("dir:") ? zone.id.slice(4) : "";
  const inDir = (p: string) => (dirPath ? p.startsWith(dirPath + "/") : true);
  const files = ir.files.filter((f) => inDir(f.path)).slice(0, MAX_DISTRICT_FILES);
  const readme = allFiles.find(
    (r) => inDir(r.path) && /(^|\/)readme\.md$/i.test(r.path) && r.text,
  );
  return [
    `DIRECTORY: ${dirPath || "(repo root)"} — ${zone.summary}`,
    `CONTAINED FILES (computed):\n${files
      .map((f) => `- ${f.path} (${f.language}, ${f.lines} lines${f.symbols.length ? `, ${f.symbols.length} symbols: ${f.symbols.slice(0, 6).map((s) => s.name).join(", ")}${f.symbols.length > 6 ? "…" : ""}` : ""})`)
      .join("\n")}`,
    readme?.text ? `README (${readme.path}):\n${readme.text.slice(0, 12_000)}` : "README: none found in this directory",
  ].join("\n\n");
}

/** The exact grounding context sent to the model — also the cache-key input (C1). */
export function buildContext(zone: Zone, ir: RepoIR, allFiles: RepoRawFile[]): string {
  return zone.file ? fileContext(zone, ir, allFiles) : districtContext(zone, ir, allFiles);
}

export async function annotateZone(args: {
  zone: Zone;
  ir: RepoIR;
  allFiles: RepoRawFile[];
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<Annotation> {
  const { zone, ir, allFiles, apiKey } = args;
  const model = args.model ?? DEFAULT_MODEL;
  const doFetch = args.fetchImpl ?? fetch;

  const context = buildContext(zone, ir, allFiles);

  const res = await doFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      // Prompt caching (roadmap C2): the invariant system prompt is cached
      // across calls — ~90% input-token discount on cache hits.
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Repo: ${ir.repo.name}\n\n${context}` }],
    }),
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("Anthropic API: invalid key (401).");
    if (res.status === 429) throw new Error("Anthropic API: rate limited (429) — try again shortly.");
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API error (HTTP ${res.status})${body ? `: ${body.slice(0, 200)}` : ""}`);
  }

  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  const parsed = parseStrictJson(text);
  return {
    what: String(parsed.what ?? "").trim() || "not determinable from the provided source",
    why: String(parsed.why ?? "").trim() || "not determinable from the provided source",
    how: String(parsed.how ?? "").trim() || "not determinable from the provided source",
    model,
  };
}

/** Tolerant strict-JSON extraction: the first {...} block in the reply. */
export function parseStrictJson(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Annotation reply was not JSON.");
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("Annotation reply had malformed JSON.");
  }
}
