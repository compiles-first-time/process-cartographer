/**
 * The Intermediate Representation (IR) — the versioned contract between the
 * XAML parser and the 3D renderer. Per the M0 architecture (handoff
 * 2026-07-08) this is "independently testable": parse the REFramework, assert
 * the graph. Boundary validation here is the RISK-02 mitigation (parser and
 * renderer must not silently disagree on shape).
 *
 * Versioning (OQ-02): `IR_SCHEMA_VERSION` is major.minor. The renderer should
 * REJECT on a major mismatch and WARN on a minor one.
 */
import { z } from "zod";

export const IR_SCHEMA_VERSION = "0.2.0";

/** Which system + area an activity touches (M0: best-effort; M2/M3 deepen it). */
export const SystemKind = z.enum([
  "web", // UI automation against a browser/desktop app with a selector
  "browser", // explicitly a browser activity
  "database", // ExecuteQuery / connection string
  "api", // HTTP Request / HttpClient
  "excel", // Excel activities / workbook path
  "file", // generic file read/write/move
  "login", // credential / secure-credential activities
  "orchestrator", // Orchestrator asset / queue
  "unknown", // could not classify from static evidence (RISK-04: surfaced, not hidden)
]);
export type SystemKind = z.infer<typeof SystemKind>;

export const Target = z.object({
  system: SystemKind,
  /** e.g. a URL, window title, table name, or file path — best-effort. */
  area: z.string().optional(),
  /** The activity local name that produced this target (e.g. "Click", "HttpClient"). */
  activityType: z.string(),
  /** 0..1 — RISK-04: low-confidence classifications are shown as uncertain, never hidden. */
  confidence: z.number().min(0).max(1),
  /** Human-readable justification for the classification (Rule 22 provenance). */
  evidence: z.string(),
});
export type Target = z.infer<typeof Target>;

export const ArgumentDirection = z.enum(["In", "Out", "InOut", "Property"]);
export type ArgumentDirection = z.infer<typeof ArgumentDirection>;

export const Argument = z.object({
  name: z.string(),
  direction: ArgumentDirection,
  /** The declared .NET type, verbatim (e.g. "InArgument(x:String)"). */
  type: z.string(),
});
export type Argument = z.infer<typeof Argument>;

export const StateNode = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  isFinal: z.boolean(),
  /** Resolved workflow ids invoked in this state's body (State.Entry/Exit), in order. */
  invokes: z.array(z.string()),
  /** Non-plumbing activity occurrences within this state's body. */
  activityCount: z.number(),
});
export type StateNode = z.infer<typeof StateNode>;

export const WorkflowKind = z.enum([
  "stateMachine",
  "flowchart",
  "sequence",
  "unknown",
]);
export type WorkflowKind = z.infer<typeof WorkflowKind>;

export const WorkflowNode = z.object({
  /** Normalized, forward-slashed path relative to the project root — the graph key. */
  id: z.string(),
  displayName: z.string().optional(),
  /** Provenance: the source file this node was parsed from. */
  filePath: z.string(),
  kind: WorkflowKind,
  arguments: z.array(Argument),
  states: z.array(StateNode),
  /** Structural summary: activity local name -> count. */
  activityCounts: z.record(z.string(), z.number()),
  targets: z.array(Target),
});
export type WorkflowNode = z.infer<typeof WorkflowNode>;

export const EdgeKind = z.enum(["invoke"]);
export type EdgeKind = z.infer<typeof EdgeKind>;

export const Edge = z.object({
  /** Source workflow id. */
  from: z.string(),
  /** Target workflow id when `resolved`, else the raw expression/path. */
  to: z.string(),
  kind: EdgeKind,
  /** True when `to` resolves to a known workflow file; false for dynamic invokes. */
  resolved: z.boolean(),
  /** The raw WorkflowFileName value, verbatim. */
  raw: z.string(),
  /** When unresolved because the target is a runtime expression (e.g. `[Row("WorkflowFile")...]`). */
  expression: z.string().optional(),
});
export type Edge = z.infer<typeof Edge>;

export const Diagnostics = z.object({
  workflowsParsed: z.number(),
  activitiesParsed: z.number(),
  invokeEdges: z.number(),
  unresolvedInvokes: z.number(),
  unknownTargets: z.number(),
  /** Files that failed to parse or activities we could not interpret — RISK-01: surfaced loudly. */
  warnings: z.array(z.string()),
});
export type Diagnostics = z.infer<typeof Diagnostics>;

export const ProjectMeta = z.object({
  name: z.string(),
  main: z.string().optional(),
  version: z.string().optional(),
  description: z.string().optional(),
});
export type ProjectMeta = z.infer<typeof ProjectMeta>;

export const IRGraph = z.object({
  version: z.literal(IR_SCHEMA_VERSION),
  project: ProjectMeta,
  workflows: z.array(WorkflowNode),
  edges: z.array(Edge),
  diagnostics: Diagnostics,
});
export type IRGraph = z.infer<typeof IRGraph>;

/**
 * Validate an IR object at the parser↔renderer boundary (RISK-02).
 * Throws a ZodError on shape mismatch — fail loud, never silently mis-render.
 */
export function validateIR(candidate: unknown): IRGraph {
  return IRGraph.parse(candidate);
}

/** Non-throwing variant for the renderer's version-gating (OQ-02). */
export function safeValidateIR(candidate: unknown) {
  return IRGraph.safeParse(candidate);
}
