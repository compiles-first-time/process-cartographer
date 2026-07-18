/**
 * Roadmap-lane tests: blast radius (A1), coverage overlay (E1), and
 * district intelligence (D1/D2) — all computed, all deterministic.
 */
import { describe, it, expect } from "vitest";
import { blastRadius, buildImportAdjacency, reachableFrom, shortestImportPath } from "../model/graph.ts";
import { parseCoverage, matchPath } from "./coverage.ts";
import { assembleRepoIR, type RepoRawFile } from "../repo/assembleRepoIR.ts";
import type { FileSyntax } from "../repo/syntax/facts.ts";
import { buildRepoCityModel } from "../model/repoCityModel.ts";

// A small diamond + tail dependency graph via hand-built syntax facts:
//   a → b → d ;  a → c → d ;  e → a   (all TS relative imports)
const RAW: RepoRawFile[] = [
  { path: "src/a.ts", text: "x\n" },
  { path: "src/b.ts", text: "x\n" },
  { path: "src/c.ts", text: "x\n" },
  { path: "src/d.ts", text: "x\n" },
  { path: "src/e.ts", text: "x\n" },
  { path: "docs/readme.md", text: "see src/a.ts\n" },
];
const imp = (spec: string, line: number) => ({ specifier: spec, line, dynamic: false });
const SYNTAX = new Map<string, FileSyntax>([
  ["src/a.ts", { symbols: [], imports: [imp("./b", 1), imp("./c", 2)], parseClean: true }],
  ["src/b.ts", { symbols: [], imports: [imp("./d", 1)], parseClean: true }],
  ["src/c.ts", { symbols: [], imports: [imp("./d", 1)], parseClean: true }],
  ["src/d.ts", { symbols: [], imports: [], parseClean: true }],
  ["src/e.ts", { symbols: [], imports: [imp("./a", 1)], parseClean: true }],
]);
const ir = assembleRepoIR({ name: "graph", source: "t" }, RAW, { syntax: SYNTAX });

describe("blast radius (A1)", () => {
  it("computes transitive upstream/downstream over resolved imports only", () => {
    const r = blastRadius(ir, "src/a.ts");
    expect([...r.downstream].sort()).toEqual(["src/b.ts", "src/c.ts", "src/d.ts"]);
    expect([...r.upstream].sort()).toEqual(["src/e.ts"]);
    // d: everything upstream, nothing downstream.
    const rd = blastRadius(ir, "src/d.ts");
    expect([...rd.upstream].sort()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/e.ts"]);
    expect(rd.downstream.size).toBe(0);
    // Reference edges (docs) do NOT participate.
    expect(rd.upstream.has("docs/readme.md")).toBe(false);
  });

  it("handles cycles without hanging", () => {
    const adj = new Map([
      ["x", ["y"]],
      ["y", ["x"]],
    ]);
    expect([...reachableFrom("x", adj)].sort()).toEqual(["y"]);
    const { fwd } = buildImportAdjacency(ir);
    expect(fwd.get("src/a.ts")!.length).toBe(2);
  });
});

describe("path A→B lighting (A3)", () => {
  it("finds the shortest path along import direction (e → a → b → d beats no 3-hop alternative)", () => {
    const p = shortestImportPath(ir, "src/e.ts", "src/d.ts");
    expect(p.direction).toBe("a-imports-b");
    // Diamond: e→a→{b,c}→d — shortest is 4 nodes; BFS is deterministic, b comes first in edge order.
    expect(p.nodes).toEqual(["src/e.ts", "src/a.ts", "src/b.ts", "src/d.ts"]);
  });

  it("falls back to the reverse direction and says so", () => {
    const p = shortestImportPath(ir, "src/d.ts", "src/a.ts");
    expect(p.direction).toBe("b-imports-a");
    expect(p.nodes).toEqual(["src/a.ts", "src/b.ts", "src/d.ts"]);
  });

  it("returns an honest null when no static path exists (b and c are siblings)", () => {
    const p = shortestImportPath(ir, "src/b.ts", "src/c.ts");
    expect(p.nodes).toBeNull();
    expect(p.direction).toBeNull();
  });

  it("A→A is the trivial single-node path", () => {
    expect(shortestImportPath(ir, "src/a.ts", "src/a.ts").nodes).toEqual(["src/a.ts"]);
  });
});

describe("coverage overlay (E1)", () => {
  const irPaths = ir.files.map((f) => f.path);

  it("parses Istanbul/c8 coverage-final.json with suffix path matching", () => {
    const artifact = JSON.stringify({
      "C:\\work\\repo\\src\\a.ts": { path: "irrelevant", statementMap: {}, s: { 0: 3, 1: 0, 2: 5 } },
      "/home/ci/repo/src/d.ts": { path: "x", statementMap: {}, s: { 0: 0, 1: 0 } },
      "/somewhere/else/not-in-repo.ts": { path: "y", statementMap: {}, s: { 0: 1 } },
    });
    const ov = parseCoverage(artifact, irPaths, "coverage-final.json");
    expect(ov.format).toBe("istanbul");
    expect(ov.byFile.get("src/a.ts")).toEqual({ covered: 2, total: 3 });
    expect(ov.byFile.get("src/d.ts")).toEqual({ covered: 0, total: 2 });
    expect(ov.matched).toBe(2);
    expect(ov.unmatched).toBe(1); // disclosed, never silent
  });

  it("parses coverage.py json output", () => {
    const artifact = JSON.stringify({
      meta: { version: "7.0" },
      files: {
        "src/a.ts": { summary: { covered_lines: 4, num_statements: 10 } },
      },
      totals: {},
    });
    const ov = parseCoverage(artifact, irPaths, "coverage.json");
    expect(ov.format).toBe("coverage.py");
    expect(ov.byFile.get("src/a.ts")).toEqual({ covered: 4, total: 10 });
  });

  it("rejects unrecognized shapes and zero-match artifacts loudly", () => {
    expect(() => parseCoverage('{"hello": 1}', irPaths, "x")).toThrow(/Unrecognized coverage format/);
    const foreign = JSON.stringify({ "/other/app.ts": { statementMap: {}, s: { 0: 1 } } });
    expect(() => parseCoverage(foreign, irPaths, "x")).toThrow(/NO entries matched/);
  });

  it("matchPath prefers exact then longest suffix", () => {
    const set = new Set(["src/a.ts", "a.ts"]);
    expect(matchPath("src/a.ts", set)).toBe("src/a.ts");
    expect(matchPath("/ci/build/src/a.ts", set)).toBe("src/a.ts");
    expect(matchPath("weird/nope.ts", set)).toBeNull();
  });
});

describe("district intelligence (D1/D2)", () => {
  it("computes dominant language, cohesion, and roles with evidence", () => {
    const city = buildRepoCityModel(ir);
    const src = city.children.find((z) => z.id === "dir:src")!;
    expect(src.district).toBeDefined();
    expect(src.district!.dominantLanguage).toBe("typescript");
    // All 5 resolved edges are internal to src/ → cohesion 100%.
    expect(src.district!.internalEdges).toBe(5);
    expect(src.district!.fanOut).toBe(0);
    expect(src.district!.cohesionPct).toBe(100);
  });

  it("badges tests dirs and entry points deterministically", () => {
    const raw: RepoRawFile[] = [
      { path: "pkg/index.ts", text: "x\n" },
      { path: "tests/foo.test.ts", text: "x\n" },
      { path: "tests/bar.test.ts", text: "x\n" },
      { path: "tests/baz.test.ts", text: "x\n" },
    ];
    const city = buildRepoCityModel(assembleRepoIR({ name: "r", source: "t" }, raw));
    const tests = city.children.find((z) => z.id === "dir:tests")!;
    expect(tests.district!.roles.some((r) => r.role === "tests")).toBe(true);
    const pkg = city.children.find((z) => z.id === "dir:pkg")!;
    expect(pkg.district!.roles.some((r) => r.role === "entry point")).toBe(true);
    expect(pkg.district!.entryPoints).toEqual(["pkg/index.ts"]);
  });
});
