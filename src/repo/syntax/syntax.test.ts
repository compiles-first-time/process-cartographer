/**
 * U1 acceptance tests: the tree-sitter syntax tier (ADR-0055).
 * Runs the REAL web-tree-sitter WASM in Node against the SAME pinned grammar
 * packages the browser bundles — this suite IS the RISK-10 ABI smoke test.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { analyzeFiles, type SyntaxEnv } from "./analyze.ts";
import { grammarFor } from "./facts.ts";
import { assembleRepoIR, type RepoRawFile } from "../assembleRepoIR.ts";
import { buildRepoCityModel } from "../../model/repoCityModel.ts";

const nodeEnv: SyntaxEnv = {
  grammarSource: async (g) => {
    const file =
      g === "javascript"
        ? "tree-sitter-javascript/tree-sitter-javascript.wasm"
        : g === "typescript"
          ? "tree-sitter-typescript/tree-sitter-typescript.wasm"
          : "tree-sitter-typescript/tree-sitter-tsx.wasm";
    return path.resolve("node_modules", file);
  },
};

const TS_SAMPLE = `import { helper } from "./helper";
import type { Config } from "../config";
export * from "./reexported";

export function processAll(items: string[]): number {
  return items.length;
}

export const arrowFn = (x: number) => x * 2;

export class Engine {
  private state = 0;
  start(): void { this.state = 1; }
  stop(): void { this.state = 0; }
}

export interface Options { verbose: boolean; }
export type Mode = "fast" | "safe";
export enum Level { Low, High }

async function lazy() {
  const mod = await import("./lazy-literal");
  const dyn = await import(process.env.PLUGIN_PATH!);
  const legacy = require("./legacy");
  return { mod, dyn, legacy };
}
`;

const BROKEN_SAMPLE = `function unclosed( {\nconst x = ;\n`;

describe("syntax tier — fact extraction (real WASM, pinned grammars)", () => {
  it("grammarFor routes extensions correctly", () => {
    expect(grammarFor("a.ts")).toBe("typescript");
    expect(grammarFor("a.tsx")).toBe("tsx");
    expect(grammarFor("a.mjs")).toBe("javascript");
    expect(grammarFor("a.py")).toBeNull();
    expect(grammarFor("noext")).toBeNull();
  });

  it("extracts declarations with names, kinds, and line spans", async () => {
    const { facts, warnings } = await analyzeFiles([{ path: "sample.ts", text: TS_SAMPLE }], nodeEnv);
    expect(warnings).toEqual([]);
    const fx = facts.get("sample.ts")!;
    expect(fx.parseClean).toBe(true);

    const byName = new Map(fx.symbols.map((s) => [s.name, s]));
    expect(byName.get("processAll")?.kind).toBe("function");
    expect(byName.get("arrowFn")?.kind).toBe("function");
    expect(byName.get("Engine")?.kind).toBe("class");
    expect(byName.get("Engine.start")?.kind).toBe("method");
    expect(byName.get("Engine.stop")?.kind).toBe("method");
    expect(byName.get("Options")?.kind).toBe("interface");
    expect(byName.get("Mode")?.kind).toBe("type");
    expect(byName.get("Level")?.kind).toBe("enum");
    expect(byName.get("lazy")?.kind).toBe("function");
    // Line spans are real (processAll starts at line 5 of the sample).
    expect(byName.get("processAll")!.startLine).toBe(5);
    expect(byName.get("processAll")!.endLine).toBeGreaterThanOrEqual(5);
  });

  it("records imports AS WRITTEN — literal ones static, non-literal ones dynamic (never guessed)", async () => {
    const { facts } = await analyzeFiles([{ path: "sample.ts", text: TS_SAMPLE }], nodeEnv);
    const fx = facts.get("sample.ts")!;
    const bySpec = new Map(fx.imports.map((i) => [i.specifier, i]));

    expect(bySpec.get("./helper")?.dynamic).toBe(false);
    expect(bySpec.get("../config")?.dynamic).toBe(false);
    expect(bySpec.get("./reexported")?.dynamic).toBe(false); // re-export = import fact
    expect(bySpec.get("./lazy-literal")?.dynamic).toBe(false); // literal dynamic import
    expect(bySpec.get("./legacy")?.dynamic).toBe(false); // literal require
    // The non-literal import(expr) is honestly dynamic, specifier = expression text.
    const dyn = fx.imports.filter((i) => i.dynamic);
    expect(dyn.length).toBe(1);
    expect(dyn[0].specifier).toContain("process.env.PLUGIN_PATH");
  });

  it("flags files with syntax errors as parse-errors, still extracting nothing false", async () => {
    const { facts } = await analyzeFiles([{ path: "broken.js", text: BROKEN_SAMPLE }], nodeEnv);
    expect(facts.get("broken.js")!.parseClean).toBe(false);
  });

  it("is deterministic across runs", async () => {
    const a = await analyzeFiles([{ path: "sample.ts", text: TS_SAMPLE }], nodeEnv);
    const b = await analyzeFiles([{ path: "sample.ts", text: TS_SAMPLE }], nodeEnv);
    expect(a.facts.get("sample.ts")).toEqual(b.facts.get("sample.ts"));
  });
});

describe("syntax tier — IR integration (U1)", () => {
  const RAW: RepoRawFile[] = [
    { path: "src/sample.ts", text: TS_SAMPLE },
    { path: "src/broken.js", text: BROKEN_SAMPLE },
    { path: "README.md", text: "# hi\n" },
  ];

  it("stamps parseStatus + symbols/imports into the IR and computes parseCleanPct", async () => {
    const { facts, warnings } = await analyzeFiles(
      RAW.filter((f) => grammarFor(f.path)).map((f) => ({ path: f.path, text: f.text! })),
      nodeEnv,
    );
    const ir = assembleRepoIR({ name: "u1", source: "test" }, RAW, facts, warnings);

    const sample = ir.files.find((f) => f.path === "src/sample.ts")!;
    expect(sample.parseStatus).toBe("parse-clean");
    expect(sample.symbols.length).toBeGreaterThanOrEqual(9);
    expect(sample.imports.length).toBe(6);

    const broken = ir.files.find((f) => f.path === "src/broken.js")!;
    expect(broken.parseStatus).toBe("parse-errors");

    const readme = ir.files.find((f) => f.path === "README.md")!;
    expect(readme.parseStatus).toBe("not-analyzed"); // no grammar — honestly so

    expect(ir.diagnostics.parseCleanPct).toBe(50); // 1 of 2 analyzed files clean
  });

  it("file buildings expose symbols as enterable interiors in the city", async () => {
    const { facts } = await analyzeFiles([{ path: "src/sample.ts", text: TS_SAMPLE }], nodeEnv);
    const ir = assembleRepoIR({ name: "u1", source: "test" }, RAW, facts);
    const city = buildRepoCityModel(ir);
    const src = city.children.find((z) => z.label === "src")!;
    const fileZone = src.children.find((z) => z.id === "file:src/sample.ts")!;
    expect(fileZone.children.length).toBe(fileZone.file!.symbols.length);
    expect(fileZone.children.every((c) => c.kind === "symbol")).toBe(true);
  });
});
