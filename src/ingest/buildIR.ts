import type { IngestedProject } from "./types.ts";
import { assembleIR } from "../parser/assembleIR.ts";
import { parseProjectMeta } from "../parser/projectMeta.ts";
import { assembleRepoIR } from "../repo/assembleRepoIR.ts";
import { validateIR, type IRGraph } from "../ir/schema.ts";
import { validateRepoIR, type RepoIR } from "../ir/repoSchema.ts";

/** What an ingest resolves to — either pipeline, one renderer (the Zone seam). */
export type Loaded =
  | { kind: "uipath"; ir: IRGraph }
  | { kind: "repo"; ir: RepoIR };

/** Ingested source files → validated UiPath IR (the original pipeline, unchanged). */
export function buildIR(ingested: IngestedProject): IRGraph {
  const project = parseProjectMeta(ingested.projectJson, ingested.rootName);
  return assembleIR(project, ingested.xamlFiles);
}

/**
 * UiPath-project detection (deterministic, documented):
 *  - no .xaml files → not UiPath;
 *  - project.json whose `main` ends in .xaml (or has UiPath-specific keys) → UiPath;
 *  - no project.json: UiPath only if the source is essentially a pure automation
 *    folder (xaml ≥ half of the text files) — a loose-xaml legacy layout.
 * (Nx monorepos also use project.json — the `main: *.xaml` check disambiguates.)
 */
export function isUiPathProject(ingested: IngestedProject): boolean {
  if (ingested.xamlFiles.length === 0) return false;
  if (ingested.projectJson) {
    try {
      const j = JSON.parse(ingested.projectJson) as Record<string, unknown>;
      if (typeof j.main === "string" && j.main.toLowerCase().endsWith(".xaml")) return true;
      if ("studioVersion" in j || "uiPathVersion" in j || "designOptions" in j) return true;
    } catch {
      /* unparseable project.json — fall through to the ratio rule */
    }
  }
  const textFiles = (ingested.allFiles ?? []).filter((f) => f.text != null).length;
  if (textFiles === 0) return true; // legacy adapters carried only the xaml view
  return ingested.xamlFiles.length >= textFiles / 2;
}

/** Route an ingest to the right pipeline (ADR-0055 U0). */
export function buildLoaded(ingested: IngestedProject): Loaded {
  if (isUiPathProject(ingested)) {
    return { kind: "uipath", ir: buildIR(ingested) };
  }
  const files = ingested.allFiles ?? [];
  return {
    kind: "repo",
    ir: assembleRepoIR({ name: ingested.rootName, source: ingested.sourceLabel }, files),
  };
}

/**
 * U1: route + run the syntax tier for repo ingests (async — parses JS/TS with
 * web-tree-sitter via the provided environment). Degrades honestly: if the
 * grammar/wasm layer fails, the tier-0 city renders with an explicit warning
 * and every eligible file stays "not-analyzed" — never a silent downgrade.
 */
export async function buildLoadedWithSyntax(
  ingested: IngestedProject,
  syntaxEnv: import("../repo/syntax/analyze.ts").SyntaxEnv,
): Promise<Loaded> {
  if (isUiPathProject(ingested)) {
    return { kind: "uipath", ir: buildIR(ingested) };
  }
  const files = ingested.allFiles ?? [];
  const meta = { name: ingested.rootName, source: ingested.sourceLabel };
  try {
    const { analyzeFiles } = await import("../repo/syntax/analyze.ts");
    const { grammarFor } = await import("../repo/syntax/facts.ts");
    const eligible = files.filter(
      (f): f is typeof f & { text: string } => f.text != null && grammarFor(f.path) != null && !excludedLike(f),
    );
    const { facts, warnings } = await analyzeFiles(eligible.map((f) => ({ path: f.path, text: f.text })), syntaxEnv);
    return { kind: "repo", ir: assembleRepoIR(meta, files, facts, warnings) };
  } catch (err) {
    return {
      kind: "repo",
      ir: assembleRepoIR(meta, files, undefined, [
        `Syntax tier unavailable (${(err as Error).message}) — rendering tier-0 inventory only; JS/TS files remain "not-analyzed".`,
      ]),
    };
  }
}

function excludedLike(f: { path: string; skipReason?: string }): boolean {
  return f.skipReason != null;
}

/**
 * "Load IR JSON" path (U0 — the companion-CLI/CI interop seam): accepts either
 * IR kind, discriminated then boundary-validated. Throws with a precise message
 * on anything else — never renders unvalidated structure.
 */
export function loadFromIRJson(jsonText: string): Loaded {
  let obj: unknown;
  try {
    obj = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Not valid JSON: ${(err as Error).message}`);
  }
  const rec = obj as Record<string, unknown>;
  if (rec && rec.irKind === "repo") {
    return { kind: "repo", ir: validateRepoIR(obj) };
  }
  if (rec && typeof rec.version === "string" && Array.isArray(rec.workflows)) {
    return { kind: "uipath", ir: validateIR(obj) };
  }
  throw new Error(
    "Unrecognized IR JSON — expected a RepoIR (irKind: \"repo\") or a UiPath IRGraph (version + workflows).",
  );
}

export { ingestFromFolder } from "./fromFolder.ts";
export { ingestFromNupkg } from "./fromNupkg.ts";
export { ingestFromGithub, parseGithubUrl } from "./fromGithub.ts";
export type { IngestedProject } from "./types.ts";
