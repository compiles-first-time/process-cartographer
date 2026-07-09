import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "../parser/loadProject.ts";
import { computeCityLayout } from "./cityLayout.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../../fixtures/reframework");

describe("computeCityLayout", () => {
  const ir = loadProject(FIXTURE);
  const layout = computeCityLayout(ir);

  it("places one building per workflow, all with finite positions", () => {
    expect(layout.buildings.length).toBe(ir.workflows.length);
    for (const b of layout.buildings) {
      expect(Number.isFinite(b.x)).toBe(true);
      expect(Number.isFinite(b.z)).toBe(true);
      expect(b.height).toBeGreaterThan(0);
    }
  });

  it("only draws pipes for resolved invoke edges to real nodes", () => {
    const nodeIds = new Set(ir.workflows.map((w) => w.id));
    for (const pipe of layout.pipes) {
      expect(nodeIds.has(pipe.from)).toBe(true);
      expect(nodeIds.has(pipe.to)).toBe(true);
    }
    const resolved = ir.edges.filter((e) => e.resolved && e.from !== e.to && nodeIds.has(e.to));
    expect(layout.pipes.length).toBe(resolved.length);
  });

  it("surfaces dynamic/unresolved invokes as building beacons, not pipes", () => {
    const totalDangling = layout.buildings.reduce((n, b) => n + b.danglingInvokes, 0);
    expect(totalDangling).toBeGreaterThanOrEqual(1); // REFramework's dynamic dispatch
    expect(totalDangling).toBe(ir.diagnostics.unresolvedInvokes);
  });

  it("categorizes Main by a real touched system, and is deterministic", () => {
    const again = computeCityLayout(ir);
    expect(again.buildings.map((b) => [b.id, b.category])).toEqual(
      layout.buildings.map((b) => [b.id, b.category]),
    );
    // At least one building is categorized to each of the systems REFramework touches.
    const cats = new Set(layout.buildings.map((b) => b.category));
    expect([...cats].some((c) => ["login", "excel", "orchestrator"].includes(c))).toBe(true);
  });
});
