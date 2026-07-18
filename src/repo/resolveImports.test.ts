/**
 * U2-lite resolver tests (ADR-0055): relative edges are spec-resolved against
 * the ingested set; everything else is honestly tiered — never invented.
 */
import { describe, it, expect } from "vitest";
import { resolveRelative } from "./resolveImports.ts";
import { assembleRepoIR, type RepoRawFile } from "./assembleRepoIR.ts";
import type { FileSyntax } from "./syntax/facts.ts";
import { buildRepoCityModel } from "../model/repoCityModel.ts";

const fileSet = new Set([
  "src/app.ts",
  "src/util.ts",
  "src/lib/index.ts",
  "src/data.json",
  "deep/a/b/mod.js",
]);

describe("resolveRelative (Node/TS order: exact → +ext → /index.*)", () => {
  it("resolves extensionless siblings and parent paths", () => {
    expect(resolveRelative("src/app.ts", "./util", fileSet)).toBe("src/util.ts");
    expect(resolveRelative("src/lib/index.ts", "../util", fileSet)).toBe("src/util.ts");
  });
  it("resolves directory imports to index files", () => {
    expect(resolveRelative("src/app.ts", "./lib", fileSet)).toBe("src/lib/index.ts");
  });
  it("resolves exact paths (extension included)", () => {
    expect(resolveRelative("src/app.ts", "./data.json", fileSet)).toBe("src/data.json");
  });
  it("returns null for missing targets and root escapes", () => {
    expect(resolveRelative("src/app.ts", "./missing", fileSet)).toBeNull();
    expect(resolveRelative("src/app.ts", "../../../etc/passwd", fileSet)).toBeNull();
  });
});

// Hand-built syntax facts (independent of tree-sitter) to drive edge assembly.
function fx(imports: { specifier: string; line: number; dynamic: boolean }[]): FileSyntax {
  return { symbols: [], imports, parseClean: true };
}

const RAW: RepoRawFile[] = [
  { path: "src/app.ts", text: "x\n" },
  { path: "src/util.ts", text: "y\n" },
  { path: "lib/other.ts", text: "z\n" },
];
const SYNTAX = new Map<string, FileSyntax>([
  [
    "src/app.ts",
    fx([
      { specifier: "./util", line: 1, dynamic: false }, // → resolved-static
      { specifier: "../lib/other", line: 2, dynamic: false }, // → resolved-static (cross-district)
      { specifier: "react", line: 3, dynamic: false }, // → external (bare)
      { specifier: "./missing", line: 4, dynamic: false }, // → external (not in set)
      { specifier: "cfg.plugin", line: 5, dynamic: true }, // → unresolved-dynamic
    ]),
  ],
]);

describe("resolveImportEdges → IR", () => {
  const ir = assembleRepoIR({ name: "edges", source: "test" }, RAW, { syntax: SYNTAX });

  it("tiers every edge honestly and counts by resolution", () => {
    const by = (r: string) => ir.edges.filter((e) => e.resolution === r);
    expect(by("resolved-static").map((e) => e.to).sort()).toEqual(["lib/other.ts", "src/util.ts"]);
    expect(by("external").map((e) => e.to).sort()).toEqual(["./missing", "react"]);
    expect(by("unresolved-dynamic").map((e) => e.to)).toEqual(["cfg.plugin"]);
    expect(ir.diagnostics.edgesByResolution).toEqual({
      "resolved-static": 2,
      external: 2,
      "unresolved-dynamic": 1,
    });
    // Every edge carries evidence anchored in the importing file.
    for (const e of ir.edges) {
      expect(e.evidence.path).toBe("src/app.ts");
      expect(e.evidence.startLine).toBeGreaterThan(0);
    }
    // Resolution assumptions are disclosed on the scorecard.
    expect(ir.diagnostics.assumptions.some((a) => a.includes("Relative import edges"))).toBe(true);
  });

  it("draws each pipe at the level where its endpoints diverge", () => {
    const city = buildRepoCityModel(ir);
    // src/app.ts → lib/other.ts diverges at ROOT: pipe between districts src and lib.
    expect(city.edges).toContainEqual({ from: "dir:src", to: "dir:lib" });
    // src/app.ts → src/util.ts diverges INSIDE src: pipe between the two file buildings.
    const src = city.children.find((z) => z.id === "dir:src")!;
    expect(src.edges).toContainEqual({ from: "file:src/app.ts", to: "file:src/util.ts" });
    // No pipes for external/dynamic edges (RISK-09: only computed structure draws roads).
    const allEdgeIds = [...city.edges, ...src.edges].flatMap((e) => [e.from, e.to]);
    expect(allEdgeIds.every((id) => id.startsWith("dir:") || id.startsWith("file:"))).toBe(true);
  });
});

describe("includeDirs override (on-demand 'parse this directory')", () => {
  const WITH_EXCLUDED: RepoRawFile[] = [
    { path: "src/a.ts", text: "a\n" },
    { path: "node_modules/dep/index.js", text: "dep\n" },
  ];

  it("excluded by default, included as real files when overridden — and disclosed", () => {
    const before = assembleRepoIR({ name: "x", source: "t" }, WITH_EXCLUDED);
    expect(before.files.map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(before.diagnostics.excludedDirs[0].dir).toBe("node_modules");

    const after = assembleRepoIR({ name: "x", source: "t" }, WITH_EXCLUDED, { includeDirs: ["node_modules"] });
    expect(after.files.map((f) => f.path).sort()).toEqual(["node_modules/dep/index.js", "src/a.ts"]);
    expect(after.diagnostics.excludedDirs).toEqual([]);
    expect(after.diagnostics.assumptions.some((a) => a.includes("User-included directories"))).toBe(true);
  });

  it("packages/ is NOT excluded (first-party code in JS monorepos)", () => {
    const ir = assembleRepoIR({ name: "x", source: "t" }, [{ path: "packages/core/index.ts", text: "core\n" }]);
    expect(ir.files.map((f) => f.path)).toEqual(["packages/core/index.ts"]);
    expect(ir.diagnostics.excludedDirs).toEqual([]);
  });

  it("excluded dirs appear as ghost districts in the city (visible, expandable)", () => {
    const ir = assembleRepoIR({ name: "x", source: "t" }, WITH_EXCLUDED);
    const city = buildRepoCityModel(ir);
    const ghost = city.children.find((z) => z.id === "xdir:node_modules")!;
    expect(ghost).toBeDefined();
    expect(ghost.excludedDir).toEqual({ dir: "node_modules", entries: 1 });
    expect(ghost.children.length).toBe(0);
    expect(ghost.summary).toContain("excluded by hygiene policy");
  });
});
