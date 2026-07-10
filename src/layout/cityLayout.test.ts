import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "../parser/loadProject.ts";
import { buildCityModel } from "../model/cityModel.ts";
import { computeLayout } from "./cityLayout.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../../fixtures/reframework");

describe("computeLayout", () => {
  const city = buildCityModel(loadProject(FIXTURE));
  const layout = computeLayout(city.children, city.edges);

  it("places one building per child with finite positions and positive height", () => {
    expect(layout.buildings.length).toBe(city.children.length);
    for (const b of layout.buildings) {
      expect(Number.isFinite(b.x)).toBe(true);
      expect(Number.isFinite(b.z)).toBe(true);
      expect(b.height).toBeGreaterThan(0);
    }
  });

  it("marks state/system buildings enterable and carries the zone through", () => {
    const state = layout.buildings.find((b) => b.kind === "state")!;
    expect(state.enterable).toBe(true);
    expect(state.zone.children.length).toBeGreaterThan(0);
  });

  it("scales height relative to sibling weight (tallest == max weight)", () => {
    const maxW = Math.max(...city.children.map((c) => c.weight));
    const tallest = layout.buildings.reduce((a, b) => (b.height > a.height ? b : a));
    expect(tallest.zone.weight).toBe(maxW);
  });

  it("only draws pipes between real sibling buildings", () => {
    const ids = new Set(layout.buildings.map((b) => b.id));
    for (const p of layout.pipes) {
      expect(ids.has(p.from)).toBe(true);
      expect(ids.has(p.to)).toBe(true);
    }
  });

  it("re-layouts a drilled level (entering a state)", () => {
    const stateZone = city.children.find((c) => c.kind === "state" && c.children.length > 0)!;
    const inner = computeLayout(stateZone.children, stateZone.edges);
    expect(inner.buildings.length).toBe(stateZone.children.length);
    expect(inner.buildings.every((b) => b.kind === "workflow")).toBe(true);
  });
});
