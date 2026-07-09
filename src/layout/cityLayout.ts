/**
 * cityLayout — turn an IR graph into a positioned 3D "city".
 *
 * A layered graph layout (dagre) over the *resolved* InvokeWorkflowFile edges
 * gives each workflow a ground position; the building's height encodes its
 * activity mass and its color encodes the dominant system it touches. Dynamic /
 * unresolved invokes can't be drawn as pipes (no target node) — they're
 * surfaced per-building as `danglingInvokes` and rendered as a beacon instead.
 */
import dagre from "@dagrejs/dagre";
import type { IRGraph, WorkflowNode, SystemKind } from "../ir/schema.ts";

/** Color category: a touched system, or "workflow" for purely-structural nodes. */
export type BuildingCategory = SystemKind | "workflow";

export interface PlacedBuilding {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  category: BuildingCategory;
  activityMass: number;
  danglingInvokes: number;
  workflow: WorkflowNode;
}

export interface PlacedPipe {
  id: string;
  from: string;
  to: string;
  fromPos: [number, number, number];
  toPos: [number, number, number];
}

export interface CityLayout {
  buildings: PlacedBuilding[];
  pipes: PlacedPipe[];
  bounds: { width: number; depth: number };
}

const FOOTPRINT = 22; // building base size (world units)
const NODE_SIZE = 46; // dagre node box (leaves gaps between buildings)
const RANKSEP = 70;
const NODESEP = 46;
const MIN_HEIGHT = 8;
const HEIGHT_PER_ACTIVITY = 1.6;
const MAX_HEIGHT = 120;

function activityMass(wf: WorkflowNode): number {
  return Object.values(wf.activityCounts).reduce((a, b) => a + b, 0);
}

function dominantCategory(wf: WorkflowNode): BuildingCategory {
  if (wf.targets.length === 0) return "workflow";
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

export function computeCityLayout(ir: IRGraph): CityLayout {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: RANKSEP, nodesep: NODESEP, marginx: NODE_SIZE, marginy: NODE_SIZE });
  g.setDefaultEdgeLabel(() => ({}));

  const nodeIds = new Set(ir.workflows.map((w) => w.id));
  for (const wf of ir.workflows) {
    g.setNode(wf.id, { width: NODE_SIZE, height: NODE_SIZE });
  }
  const resolvedEdges = ir.edges.filter((e) => e.resolved && nodeIds.has(e.to));
  for (const e of resolvedEdges) {
    if (e.from !== e.to) g.setEdge(e.from, e.to);
  }

  dagre.layout(g);

  // Center the layout at the origin.
  const gg = g.graph();
  const cx = (gg.width ?? 0) / 2;
  const cz = (gg.height ?? 0) / 2;

  const danglingByFrom = new Map<string, number>();
  for (const e of ir.edges) {
    if (!e.resolved || !nodeIds.has(e.to)) {
      danglingByFrom.set(e.from, (danglingByFrom.get(e.from) ?? 0) + 1);
    }
  }

  const posOf = new Map<string, { x: number; z: number; height: number }>();
  const buildings: PlacedBuilding[] = ir.workflows.map((wf) => {
    const n = g.node(wf.id);
    const mass = activityMass(wf);
    const height = Math.min(MAX_HEIGHT, MIN_HEIGHT + mass * HEIGHT_PER_ACTIVITY);
    const x = (n?.x ?? 0) - cx;
    const z = (n?.y ?? 0) - cz;
    posOf.set(wf.id, { x, z, height });
    return {
      id: wf.id,
      x,
      z,
      width: FOOTPRINT,
      depth: FOOTPRINT,
      height,
      category: dominantCategory(wf),
      activityMass: mass,
      danglingInvokes: danglingByFrom.get(wf.id) ?? 0,
      workflow: wf,
    };
  });

  const pipes: PlacedPipe[] = resolvedEdges
    .filter((e) => e.from !== e.to)
    .map((e, i) => {
      const a = posOf.get(e.from)!;
      const b = posOf.get(e.to)!;
      return {
        id: `${e.from}->${e.to}#${i}`,
        from: e.from,
        to: e.to,
        fromPos: [a.x, a.height, a.z],
        toPos: [b.x, b.height, b.z],
      };
    });

  return {
    buildings,
    pipes,
    bounds: { width: gg.width ?? 0, depth: gg.height ?? 0 },
  };
}

// ── Shared color palette (scene + legend) ──────────────────────────────────

export const CATEGORY_COLORS: Record<BuildingCategory, string> = {
  web: "#38bdf8", // sky
  browser: "#22d3ee", // cyan
  api: "#a78bfa", // violet
  database: "#f59e0b", // amber
  excel: "#34d399", // emerald
  file: "#94a3b8", // slate
  login: "#f472b6", // pink
  orchestrator: "#fb7185", // rose
  unknown: "#64748b", // muted slate
  workflow: "#475569", // structural (no external system)
};

export const CATEGORY_LABELS: Record<BuildingCategory, string> = {
  web: "Web / UI app",
  browser: "Browser",
  api: "API / HTTP",
  database: "Database",
  excel: "Excel",
  file: "File",
  login: "Credentials / login",
  orchestrator: "Orchestrator (queue/asset)",
  unknown: "Unclassified target",
  workflow: "Workflow (no external system)",
};
