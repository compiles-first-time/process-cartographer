/**
 * M0 acceptance test — the provable base.
 *
 * Parses the vendored vanilla UiPath REFramework (`fixtures/reframework/`) and
 * asserts the IR graph. This is the contract the handoff calls for:
 * "parse REFramework → assert the graph."
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadProject, assembleIR, collectXamlFiles, normalizeId } from "./loadProject.ts";
import { parseXamlWorkflow } from "./xamlParser.ts";
import { validateIR, IR_SCHEMA_VERSION } from "../ir/schema.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../../fixtures/reframework");

describe("M0 parser → IR (vanilla REFramework)", () => {
  const ir = loadProject(FIXTURE);

  it("emits a schema-valid IR at the current version", () => {
    expect(ir.version).toBe(IR_SCHEMA_VERSION);
    // Re-validating must not throw (boundary enforcement, RISK-02).
    expect(() => validateIR(ir)).not.toThrow();
  });

  it("parses every workflow in the project", () => {
    // The vendored project has 13 .xaml (Main + Process + 8 Framework + 3 Tests).
    const files = collectXamlFiles(FIXTURE);
    expect(files.length).toBeGreaterThanOrEqual(13);
    expect(ir.diagnostics.workflowsParsed).toBe(files.length);
    // Every workflow carries provenance.
    for (const wf of ir.workflows) {
      expect(wf.filePath).toBeTruthy();
      expect(wf.id).toBe(normalizeId(wf.filePath));
    }
  });

  it("identifies Main as a StateMachine with the REFramework lifecycle states", () => {
    const main = ir.workflows.find((w) => w.id === "Main.xaml");
    expect(main).toBeDefined();
    expect(main!.kind).toBe("stateMachine");
    const displayNames = main!.states.map((s) => s.displayName);
    expect(displayNames).toEqual(
      expect.arrayContaining([
        "Initialization",
        "Get Transaction Data",
        "Process Transaction",
        "End Process",
      ]),
    );
    // REFramework's Main has a final state ("End Process" is the FinalState).
    expect(main!.states.some((s) => s.isFinal)).toBe(true);
  });

  it("extracts Main's arguments including the Orchestrator queue name", () => {
    const main = ir.workflows.find((w) => w.id === "Main.xaml")!;
    const queueArg = main.arguments.find((a) => a.name === "in_OrchestratorQueueName");
    expect(queueArg).toBeDefined();
    expect(queueArg!.direction).toBe("In");
    expect(queueArg!.type).toContain("String");
  });

  it("builds the InvokeWorkflowFile spine and resolves it to real files", () => {
    const invokeEdges = ir.edges.filter((e) => e.kind === "invoke");
    expect(invokeEdges.length).toBeGreaterThan(10);

    // Known REFramework invocations resolve to vendored files.
    const resolvedTargets = new Set(invokeEdges.filter((e) => e.resolved).map((e) => e.to));
    expect(resolvedTargets).toContain("Framework/GetTransactionData.xaml");
    expect(resolvedTargets).toContain("Framework/InitAllSettings.xaml");
    expect(resolvedTargets).toContain("Framework/SetTransactionStatus.xaml");
    expect(resolvedTargets).toContain("Process.xaml");

    // Every resolved edge points at an actual workflow node.
    const nodeIds = new Set(ir.workflows.map((w) => w.id));
    for (const e of invokeEdges.filter((e) => e.resolved)) {
      expect(nodeIds.has(e.to)).toBe(true);
    }
  });

  it("does NOT fake dynamic (runtime-expression) invoke targets — RISK-01", () => {
    // REFramework's Main dispatches via `[Row("WorkflowFile").ToString]`.
    const dynamic = ir.edges.filter((e) => !e.resolved && e.expression);
    expect(dynamic.length).toBeGreaterThanOrEqual(1);
    expect(dynamic.some((e) => e.raw.includes("Row(") || e.raw.startsWith("["))).toBe(true);
    expect(ir.diagnostics.unresolvedInvokes).toBeGreaterThanOrEqual(1);
  });

  it("classifies activity targets with confidence + evidence (RISK-04)", () => {
    const allTargets = ir.workflows.flatMap((w) => w.targets);
    expect(allTargets.length).toBeGreaterThan(0);
    // Confidence is always a probability; evidence is always present.
    for (const t of allTargets) {
      expect(t.confidence).toBeGreaterThanOrEqual(0);
      expect(t.confidence).toBeLessThanOrEqual(1);
      expect(t.evidence).toBeTruthy();
    }
    // The REFramework touches these systems statically:
    const systems = new Set(allTargets.map((t) => t.system));
    expect(systems.has("login")).toBe(true); // GetSecureCredential / GetRobotCredential
    expect(systems.has("excel")).toBe(true); // Config.xlsx reads
    expect(systems.has("orchestrator")).toBe(true); // GetQueueItem / GetRobotAsset
  });

  it("counts real control-flow structure", () => {
    const main = ir.workflows.find((w) => w.id === "Main.xaml")!;
    expect(main.activityCounts["TryCatch"]).toBeGreaterThanOrEqual(1);
    expect(main.activityCounts["State"]).toBeGreaterThanOrEqual(4);
    expect(ir.diagnostics.activitiesParsed).toBeGreaterThan(0);
  });

  it("is deterministic — same input yields a deep-equal IR", () => {
    const again = loadProject(FIXTURE);
    expect(again).toEqual(ir);
  });
});

describe("xamlParser unit behavior", () => {
  it("degrades gracefully on malformed XAML (RISK-01: fail loud, don't crash)", () => {
    const result = parseXamlWorkflow("<Activity><Unclosed></Activity>", "broken.xaml");
    // Never throws; surfaces the problem instead.
    expect(result).toBeDefined();
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("marks a bracket-expression WorkflowFileName as an unresolved invoke", () => {
    const files = [
      {
        id: "A.xaml",
        xml: `<Activity xmlns="http://schemas.microsoft.com/netfx/2009/xaml/activities" xmlns:ui="http://schemas.uipath.com/workflow/activities" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
          <ui:InvokeWorkflowFile WorkflowFileName="[SomeExpr]" />
          <ui:InvokeWorkflowFile WorkflowFileName="B.xaml" />
        </Activity>`,
      },
      { id: "B.xaml", xml: `<Activity xmlns="http://schemas.microsoft.com/netfx/2009/xaml/activities" />` },
    ];
    const ir = assembleIR({ name: "unit" }, files);
    const edges = ir.edges;
    expect(edges.find((e) => e.raw === "[SomeExpr]")!.resolved).toBe(false);
    expect(edges.find((e) => e.raw === "[SomeExpr]")!.expression).toBe("[SomeExpr]");
    expect(edges.find((e) => e.raw === "B.xaml")!.resolved).toBe(true);
  });
});
