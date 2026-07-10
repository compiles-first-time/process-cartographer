import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "../parser/loadProject.ts";
import { buildCityModel, type Zone } from "./cityModel.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../../fixtures/reframework");

const child = (z: Zone, pred: (c: Zone) => boolean) => z.children.find(pred);

describe("buildCityModel (REFramework)", () => {
  const ir = loadProject(FIXTURE);
  const city = buildCityModel(ir);

  it("makes states, the orchestrator, and external systems the level-0 buildings", () => {
    expect(city.kind).toBe("city");
    const kinds = new Set(city.children.map((c) => c.kind));
    expect(kinds.has("state")).toBe(true);
    expect(kinds.has("orchestrator")).toBe(true);
    expect(kinds.has("system")).toBe(true);
    const stateLabels = city.children.filter((c) => c.kind === "state").map((c) => c.label);
    expect(stateLabels).toEqual(
      expect.arrayContaining(["Initialization", "Get Transaction Data", "Process Transaction", "End Process"]),
    );
  });

  it("weights a state by the workflows inside it, and lets you enter to find them", () => {
    const init = child(city, (c) => c.label === "Initialization")!;
    expect(init.kind).toBe("state");
    expect(init.weight).toBe(init.children.length);
    expect(init.children.length).toBe(3); // InitAllSettings, KillAllProcesses, InitAllApplications
    // Entering the state reveals workflow buildings.
    expect(init.children.every((c) => c.kind === "workflow")).toBe(true);
    expect(init.children.map((c) => c.id)).toContain("wf:Framework/InitAllSettings.xaml");
  });

  it("connects the lifecycle spine and taps systems with data pipes", () => {
    const ids = new Set(city.children.map((c) => c.id));
    // Lifecycle spine among states.
    const stateEdges = city.edges.filter((e) => e.from.startsWith("state:") && e.to.startsWith("state:"));
    expect(stateEdges.length).toBeGreaterThanOrEqual(1);
    // At least one state → system/orchestrator data pipe.
    const dataEdges = city.edges.filter((e) => e.from.startsWith("state:") && e.to.startsWith("sys:"));
    expect(dataEdges.length).toBeGreaterThanOrEqual(1);
    for (const e of city.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  it("drills workflow → activities at the leaves (decisions/loops/systems)", () => {
    const init = child(city, (c) => c.label === "Initialization")!;
    // Walk down to a leaf workflow and confirm it exposes activity structures.
    const anyWithActivities = (z: Zone, depth = 0): boolean => {
      if (z.children.some((c) => c.kind === "activity")) return true;
      if (depth > 6) return false;
      return z.children.some((c) => anyWithActivities(c, depth + 1));
    };
    expect(anyWithActivities(init)).toBe(true);
  });

  it("is deterministic", () => {
    const again = buildCityModel(ir);
    const shape = (z: Zone): unknown => ({ id: z.id, kind: z.kind, w: z.weight, ch: z.children.map(shape) });
    expect(shape(again)).toEqual(shape(city));
  });
});
