import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "../parser/loadProject.ts";
import { matchWorkflows } from "./search.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../../fixtures/reframework");

describe("matchWorkflows", () => {
  const ir = loadProject(FIXTURE);

  it("returns null for an empty query (everything shown)", () => {
    expect(matchWorkflows(ir, "")).toBeNull();
    expect(matchWorkflows(ir, "   ")).toBeNull();
  });

  it("matches by workflow id / name", () => {
    const m = matchWorkflows(ir, "GetTransactionData");
    expect(m).not.toBeNull();
    expect([...m!].some((id) => id.includes("GetTransactionData"))).toBe(true);
  });

  it("matches by touched system (e.g. excel, credential)", () => {
    const excel = matchWorkflows(ir, "excel");
    expect(excel!.size).toBeGreaterThan(0);
  });

  it("matches by argument name", () => {
    const m = matchWorkflows(ir, "in_OrchestratorQueueName");
    expect(m!.has("Main.xaml")).toBe(true);
  });

  it("is case-insensitive and narrows the set", () => {
    const all = ir.workflows.length;
    const some = matchWorkflows(ir, "MAIN")!;
    expect(some.size).toBeGreaterThan(0);
    expect(some.size).toBeLessThanOrEqual(all);
  });
});
