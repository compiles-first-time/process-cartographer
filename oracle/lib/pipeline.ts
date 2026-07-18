/**
 * pipeline — run the SHIPPED extraction pipeline (buildLoadedWithSyntax: the
 * exact code path the app executes — tree-sitter facts → B1 compiler overrides
 * → resolveImportEdges → assembleRepoIR) under Node, and project out the edge
 * sets + universes the differential compares. Nothing here re-derives edges;
 * the harness measures what ships.
 */
import path from "node:path";
import { buildLoadedWithSyntax } from "../../src/ingest/buildIR.ts";
import type { IngestedProject } from "../../src/ingest/types.ts";
import type { RepoIR } from "../../src/ir/repoSchema.ts";
import type { SyntaxEnv } from "../../src/repo/syntax/analyze.ts";
import type { Edge } from "./diff.ts";

/** Same pinned grammar packages the browser bundles (RISK-10 single-source). */
export const nodeSyntaxEnv: SyntaxEnv = {
  grammarSource: async (g) =>
    path.resolve(
      "node_modules",
      g === "javascript"
        ? "tree-sitter-javascript/tree-sitter-javascript.wasm"
        : g === "typescript"
          ? "tree-sitter-typescript/tree-sitter-typescript.wasm"
          : g === "python"
            ? "tree-sitter-python/tree-sitter-python.wasm"
            : "tree-sitter-typescript/tree-sitter-tsx.wasm",
    ),
};

const TS_JS_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;

export interface PipelineProjection {
  ir: RepoIR;
  /** Analyzed (parse-clean or parse-errors) TS/JS file paths. */
  analyzedTsJs: Set<string>;
  /** Analyzed Python file paths. */
  analyzedPy: Set<string>;
  /** Every non-skipped file in the IR (valid edge targets). */
  includedFiles: Set<string>;
  /** Our measured fact class: resolved-static import edges, by source language. */
  oursTsJs: Edge[];
  oursPy: Edge[];
  /** Shallowest tsconfig/jsconfig in the included set (the one the shipped resolver honors). */
  tsconfigPath: string | null;
}

export async function runShippedPipeline(ingested: IngestedProject): Promise<PipelineProjection> {
  const loaded = await buildLoadedWithSyntax(ingested, nodeSyntaxEnv);
  if (loaded.kind !== "repo") throw new Error("corpus entry unexpectedly routed to the UiPath pipeline");
  const ir = loaded.ir;

  const analyzedTsJs = new Set<string>();
  const analyzedPy = new Set<string>();
  const includedFiles = new Set<string>();
  for (const f of ir.files) {
    if (f.parseStatus === "skipped") continue;
    includedFiles.add(f.path);
    if (f.parseStatus !== "parse-clean" && f.parseStatus !== "parse-errors") continue;
    if (TS_JS_RE.test(f.path)) analyzedTsJs.add(f.path);
    else if (f.path.endsWith(".py")) analyzedPy.add(f.path);
  }

  const oursTsJs: Edge[] = [];
  const oursPy: Edge[] = [];
  for (const e of ir.edges) {
    if (e.kind !== "import" || e.resolution !== "resolved-static") continue;
    if (analyzedTsJs.has(e.from)) oursTsJs.push({ from: e.from, to: e.to });
    else if (analyzedPy.has(e.from)) oursPy.push({ from: e.from, to: e.to });
  }

  const tsconfigPath =
    [...includedFiles]
      .filter((p) => /(^|\/)(tsconfig|jsconfig)\.json$/.test(p))
      .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0] ?? null;

  return { ir, analyzedTsJs, analyzedPy, includedFiles, oursTsJs, oursPy, tsconfigPath };
}
