/** Unit tests for the B2 differential math (pure — no network, no corpus). */
import { describe, it, expect } from "vitest";
import { normalizeEdges, voteTruth, score, oracleBreakdown, edgeKey, type Edge } from "./diff.ts";

const E = (from: string, to: string): Edge => ({ from, to });
const keys = (m: ReadonlyMap<string, Edge>) => [...m.keys()].sort();

describe("oracle differential — normalizeEdges", () => {
  const universe = new Set(["a.ts", "b.ts", "c.ts"]);

  it("dedupes, drops self-edges, and enforces the universe on both endpoints", () => {
    const m = normalizeEdges(
      [E("a.ts", "b.ts"), E("a.ts", "b.ts"), E("a.ts", "a.ts"), E("a.ts", "node_modules/x.js"), E("zz.ts", "b.ts")],
      universe,
      universe,
    );
    expect(keys(m)).toEqual(["a.ts → b.ts"]);
  });

  it("supports asymmetric universes (from = analyzed TS/JS, to = any included file)", () => {
    const toUniverse = new Set([...universe, "d.json"]);
    const m = normalizeEdges([E("a.ts", "d.json"), E("d.json", "a.ts")], universe, toUniverse);
    expect(keys(m)).toEqual(["a.ts → d.json"]);
  });
});

describe("oracle differential — voteTruth", () => {
  const asMap = (edges: Edge[]) => new Map(edges.map((e) => [edgeKey(e), e]));

  it("2-of-3: an edge needs two oracles; unanimity not required, singletons rejected", () => {
    const oracles = new Map([
      ["depcruise", asMap([E("a", "b"), E("a", "c"), E("x", "y")])],
      ["madge", asMap([E("a", "b"), E("a", "c")])],
      ["tsc", asMap([E("a", "b"), E("q", "r")])],
    ]);
    const truth = voteTruth(oracles, 2);
    expect(keys(truth)).toEqual(["a → b", "a → c"]);
  });

  it("1-of-1 (the Python/Grimp case): the single oracle IS the truth set", () => {
    const oracles = new Map([["grimp", asMap([E("p.py", "q.py")])]]);
    expect(keys(voteTruth(oracles, 1))).toEqual(["p.py → q.py"]);
  });
});

describe("oracle differential — score", () => {
  const asMap = (edges: Edge[]) => new Map(edges.map((e) => [edgeKey(e), e]));

  it("computes precision/recall with disagreement lists sorted for triage", () => {
    const ours = asMap([E("a", "b"), E("a", "c"), E("a", "phantom")]);
    const truth = asMap([E("a", "b"), E("a", "c"), E("missed", "edge")]);
    const s = score(ours, truth);
    expect(s.agreed).toBe(2);
    expect(s.precision).toBeCloseTo(2 / 3);
    expect(s.recall).toBeCloseTo(2 / 3);
    expect(s.oursOnly).toEqual(["a → phantom"]);
    expect(s.truthOnly).toEqual(["missed → edge"]);
  });

  it("returns null (not 1 or 0) when a denominator is empty — honesty over flattery", () => {
    const s = score(asMap([]), asMap([]));
    expect(s.precision).toBeNull();
    expect(s.recall).toBeNull();
  });

  it("oracleBreakdown reports per-oracle size and overlap with ours", () => {
    const ours = asMap([E("a", "b")]);
    const oracles = new Map([
      ["depcruise", asMap([E("a", "b"), E("a", "c")])],
      ["madge", asMap([E("q", "r")])],
    ]);
    expect(oracleBreakdown(ours, oracles)).toEqual({
      depcruise: { edges: 2, agreedWithOurs: 1 },
      madge: { edges: 1, agreedWithOurs: 0 },
    });
  });
});
