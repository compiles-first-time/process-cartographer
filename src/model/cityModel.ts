/**
 * cityModel — derive an explorable, drill-down "city" from the IR.
 *
 * The city is a tree of Zones. Level 0 reflects the REFramework's *structure*:
 *   - one building per **state** (Initialization, Get Transaction Data, …),
 *   - the **Orchestrator** as a data hub, and
 *   - one building per external **system** (Excel, credentials, web, …).
 * A building's weight (→ height) is how much it contains. You "enter" a building
 * to see its children: a state → the workflows invoked in it; a workflow → the
 * workflows IT invokes; a leaf workflow → its activities grouped (decisions,
 * loops, code/script calls, logging, and each system it touches).
 *
 * Non-REFramework projects (no StateMachine entry) fall back to a flat city of
 * workflow buildings — the same recursive drill-down still applies.
 */
import type { IRGraph, WorkflowNode, StateNode, SystemKind } from "../ir/schema.ts";

export type ZoneKind = "city" | "state" | "orchestrator" | "system" | "workflow" | "activity";

/** Color/geometry category. Systems come from SystemKind; states/workflows are structural. */
export type BuildingCategory = SystemKind | "workflow" | "state";

export interface ZoneEdge {
  from: string; // child zone id
  to: string; // child zone id
}

export interface Zone {
  id: string;
  kind: ZoneKind;
  label: string;
  category: BuildingCategory;
  /** Relative size driver (children count / activity mass); layout maps it to height. */
  weight: number;
  children: Zone[];
  /** Relationships among children, drawn as pipes when this zone is entered. */
  edges: ZoneEdge[];
  summary: string;
  workflow?: WorkflowNode;
  state?: StateNode;
}

// ── Palette (shared by scene, legend, panels) ──────────────────────────────

export const CATEGORY_COLORS: Record<BuildingCategory, string> = {
  state: "#818cf8", // indigo — lifecycle phases
  orchestrator: "#fb7185", // rose — the data hub
  web: "#38bdf8",
  browser: "#22d3ee",
  api: "#a78bfa",
  database: "#f59e0b",
  excel: "#34d399",
  file: "#94a3b8",
  login: "#f472b6",
  unknown: "#64748b",
  workflow: "#7dd3fc", // light sky — a workflow building
};

export const CATEGORY_LABELS: Record<BuildingCategory, string> = {
  state: "State (lifecycle phase)",
  orchestrator: "Orchestrator (queue / asset)",
  web: "Web / UI app",
  browser: "Browser",
  api: "API / HTTP",
  database: "Database",
  excel: "Excel",
  file: "File",
  login: "Credentials / login",
  unknown: "Unclassified target",
  workflow: "Workflow",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function activityMass(wf: WorkflowNode): number {
  return Object.values(wf.activityCounts).reduce((a, b) => a + b, 0);
}

function dominantCategory(wf: WorkflowNode | undefined): BuildingCategory {
  if (!wf || wf.targets.length === 0) return "workflow";
  const score = new Map<SystemKind, number>();
  for (const t of wf.targets) score.set(t.system, (score.get(t.system) ?? 0) + t.confidence);
  let best: SystemKind = "unknown";
  let bestScore = -1;
  for (const [sys, s] of score) {
    if (s > bestScore) {
      best = sys;
      bestScore = s;
    }
  }
  return best;
}

/** Systems a workflow's activities touch (deduped). */
function systemsOf(wf: WorkflowNode): Set<SystemKind> {
  return new Set(wf.targets.map((t) => t.system));
}

// ── Leaf interior: a workflow's activities grouped into small structures ────

interface Bucket {
  label: string;
  category: BuildingCategory;
  test: RegExp;
}
const ACTIVITY_BUCKETS: Bucket[] = [
  { label: "Decisions", category: "workflow", test: /^(FlowDecision|FlowSwitch|Switch|If)$/ },
  { label: "Loops", category: "workflow", test: /^(While|DoWhile|ForEach|ForEachRow|ParallelForEach)$/ },
  { label: "Code / script calls", category: "api", test: /^(InvokeCode|InvokeMethod|InvokePowerShell|RunScript|StartProcess|InvokeVBA)$/ },
  { label: "Logging", category: "workflow", test: /^(LogMessage|WriteLine|AddLogFields|RemoveLogFields)$/ },
  { label: "Assignments", category: "workflow", test: /^(Assign|MultipleAssign)$/ },
];

function activityZones(wf: WorkflowNode): Zone[] {
  const zones: Zone[] = [];
  for (const b of ACTIVITY_BUCKETS) {
    let count = 0;
    for (const [name, n] of Object.entries(wf.activityCounts)) if (b.test.test(name)) count += n;
    if (count > 0) {
      zones.push({
        id: `act:${wf.id}:${b.label}`,
        kind: "activity",
        label: `${b.label} (${count})`,
        category: b.category,
        weight: count,
        children: [],
        edges: [],
        summary: `${count} ${b.label.toLowerCase()} in this workflow`,
      });
    }
  }
  // One structure per external system the workflow touches.
  const sysCount = new Map<SystemKind, number>();
  for (const t of wf.targets) sysCount.set(t.system, (sysCount.get(t.system) ?? 0) + 1);
  for (const [sys, count] of sysCount) {
    zones.push({
      id: `act:${wf.id}:sys:${sys}`,
      kind: "activity",
      label: `${CATEGORY_LABELS[sys]} (${count})`,
      category: sys,
      weight: count,
      children: [],
      edges: [],
      summary: `${count} activity(ies) touching ${CATEGORY_LABELS[sys]}`,
    });
  }
  return zones;
}

// ── Workflow zones (recursive; cycle-guarded) ───────────────────────────────

function workflowZone(
  id: string,
  wfById: Map<string, WorkflowNode>,
  invokesFrom: Map<string, string[]>,
  path: Set<string>,
): Zone {
  const wf = wfById.get(id);
  const label = wf?.displayName || id;
  const nextPath = new Set(path).add(id);
  const targets = (invokesFrom.get(id) ?? []).filter((t) => wfById.has(t) && !nextPath.has(t));

  let children: Zone[];
  let summary: string;
  if (targets.length > 0) {
    children = targets.map((t) => workflowZone(t, wfById, invokesFrom, nextPath));
    summary = `${targets.length} invoked workflow(s)`;
  } else {
    children = wf ? activityZones(wf) : [];
    summary = wf ? `${activityMass(wf)} activities` : "unresolved workflow";
  }

  // Sibling invoke relationships among the children (usually sparse).
  const childIds = new Set(targets.map((t) => `wf:${t}`));
  const edges: ZoneEdge[] = [];
  for (const t of targets) {
    for (const u of invokesFrom.get(t) ?? []) {
      if (childIds.has(`wf:${u}`)) edges.push({ from: `wf:${t}`, to: `wf:${u}` });
    }
  }

  return {
    id: `wf:${id}`,
    kind: "workflow",
    label,
    category: dominantCategory(wf),
    weight: wf ? Math.max(1, activityMass(wf)) : 1,
    children,
    edges,
    summary,
    workflow: wf,
  };
}

// ── Top-level model ──────────────────────────────────────────────────────────

export function buildCityModel(ir: IRGraph): Zone {
  const wfById = new Map(ir.workflows.map((w) => [w.id, w]));
  const invokesFrom = new Map<string, string[]>();
  for (const e of ir.edges) {
    if (e.resolved && wfById.has(e.to)) {
      const arr = invokesFrom.get(e.from) ?? [];
      arr.push(e.to);
      invokesFrom.set(e.from, arr);
    }
  }

  const entry =
    ir.workflows.find((w) => w.id === ir.project.main) ||
    ir.workflows.find((w) => w.id === "Main.xaml") ||
    ir.workflows[0];

  const children: Zone[] = [];
  const edges: ZoneEdge[] = [];

  const hasStates = !!entry && entry.states.length > 0;

  // Systems present across the whole project (landmark buildings).
  const systemsPresent = new Set<SystemKind>();
  for (const w of ir.workflows) for (const t of w.targets) if (t.system !== "unknown") systemsPresent.add(t.system);

  if (hasStates && entry) {
    // State buildings.
    const stateZones: Zone[] = entry.states.map((s) => {
      const kids = s.invokes.map((id) => workflowZone(id, wfById, invokesFrom, new Set([entry.id])));
      return {
        id: `state:${s.name}`,
        kind: "state" as ZoneKind,
        label: s.displayName || s.name,
        category: "state" as BuildingCategory,
        weight: Math.max(1, s.invokes.length),
        children: kids,
        edges: [],
        summary: `${s.invokes.length} workflow(s) · ${s.activityCount} activities${s.isFinal ? " · final" : ""}`,
        state: s,
      };
    });
    children.push(...stateZones);

    // Lifecycle spine (states in nesting order = the happy path).
    for (let i = 0; i < stateZones.length - 1; i++) {
      edges.push({ from: stateZones[i].id, to: stateZones[i + 1].id });
    }

    // System/Orchestrator landmark buildings.
    const systemZones = buildSystemZones(ir, systemsPresent, wfById, invokesFrom);
    children.push(...systemZones);

    // Data pipes: state → each system its directly-invoked workflows touch.
    const sysZoneId = (s: SystemKind) => (s === "orchestrator" ? "sys:orchestrator" : `sys:${s}`);
    const presentSysIds = new Set(systemZones.map((z) => z.id));
    for (const s of entry.states) {
      const touched = new Set<SystemKind>();
      for (const id of s.invokes) {
        const wf = wfById.get(id);
        if (wf) for (const sys of systemsOf(wf)) if (sys !== "unknown") touched.add(sys);
      }
      for (const sys of touched) {
        const target = sysZoneId(sys);
        if (presentSysIds.has(target)) edges.push({ from: `state:${s.name}`, to: target });
      }
    }
  } else {
    // Fallback: a flat city of workflow buildings.
    for (const w of ir.workflows) children.push(workflowZone(w.id, wfById, invokesFrom, new Set()));
    for (const e of ir.edges) {
      if (e.resolved && wfById.has(e.to) && e.from !== e.to) edges.push({ from: `wf:${e.from}`, to: `wf:${e.to}` });
    }
  }

  return {
    id: "city",
    kind: "city",
    label: ir.project.name,
    category: "workflow",
    weight: children.length,
    children,
    edges,
    summary: hasStates ? "REFramework lifecycle" : "workflow graph",
  };
}

function buildSystemZones(
  ir: IRGraph,
  systemsPresent: Set<SystemKind>,
  wfById: Map<string, WorkflowNode>,
  invokesFrom: Map<string, string[]>,
): Zone[] {
  const zones: Zone[] = [];
  for (const sys of systemsPresent) {
    const touchingWfIds = ir.workflows.filter((w) => w.targets.some((t) => t.system === sys)).map((w) => w.id);
    const interactionCount = ir.workflows.reduce(
      (n, w) => n + w.targets.filter((t) => t.system === sys).length,
      0,
    );
    zones.push({
      id: sys === "orchestrator" ? "sys:orchestrator" : `sys:${sys}`,
      kind: sys === "orchestrator" ? "orchestrator" : "system",
      label: CATEGORY_LABELS[sys],
      category: sys,
      weight: Math.max(1, touchingWfIds.length),
      children: touchingWfIds.map((id) => workflowZone(id, wfById, invokesFrom, new Set())),
      edges: [],
      summary: `${interactionCount} interaction(s) across ${touchingWfIds.length} workflow(s)`,
    });
  }
  return zones;
}
