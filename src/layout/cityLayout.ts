/**
 * cityLayout — position the children of the current Zone as a 3D block of
 * buildings. A layered graph layout (dagre) over the zone's edges gives ground
 * positions; height is scaled *relative to the siblings* at this level so every
 * drill-down view is well-proportioned regardless of absolute weights.
 */
import dagre from "@dagrejs/dagre";
import type { Zone, ZoneEdge, ZoneKind, BuildingCategory } from "../model/cityModel.ts";

export type { BuildingCategory } from "../model/cityModel.ts";
export { CATEGORY_COLORS, CATEGORY_LABELS } from "../model/cityModel.ts";

export interface PlacedBuilding {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  category: BuildingCategory;
  kind: ZoneKind;
  enterable: boolean;
  zone: Zone;
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

const FOOTPRINT = 24;
const NODE_SIZE = 52;
const RANKSEP = 78;
const NODESEP = 50;
const MIN_HEIGHT = 10;
const HEIGHT_RANGE = 62;

export function computeLayout(children: Zone[], edges: ZoneEdge[]): CityLayout {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: RANKSEP, nodesep: NODESEP, marginx: NODE_SIZE, marginy: NODE_SIZE });
  g.setDefaultEdgeLabel(() => ({}));

  const ids = new Set(children.map((c) => c.id));
  for (const c of children) g.setNode(c.id, { width: NODE_SIZE, height: NODE_SIZE });
  const validEdges = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  for (const e of validEdges) g.setEdge(e.from, e.to);

  dagre.layout(g);
  const gg = g.graph();
  const cx = (gg.width ?? 0) / 2;
  const cz = (gg.height ?? 0) / 2;

  const maxWeight = Math.max(1, ...children.map((c) => c.weight));

  const posOf = new Map<string, { x: number; z: number; height: number }>();
  const buildings: PlacedBuilding[] = children.map((zone) => {
    const n = g.node(zone.id);
    const height = MIN_HEIGHT + (zone.weight / maxWeight) * HEIGHT_RANGE;
    const x = (n?.x ?? 0) - cx;
    const z = (n?.y ?? 0) - cz;
    posOf.set(zone.id, { x, z, height });
    // Landmarks get a slightly larger footprint so they read as hubs.
    const footprint = zone.kind === "orchestrator" || zone.kind === "system" ? FOOTPRINT * 1.25 : FOOTPRINT;
    return {
      id: zone.id,
      x,
      z,
      width: footprint,
      depth: footprint,
      height,
      category: zone.category,
      kind: zone.kind,
      enterable: zone.children.length > 0,
      zone,
    };
  });

  const pipes: PlacedPipe[] = validEdges.map((e, i) => {
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

  return { buildings, pipes, bounds: { width: gg.width ?? 0, depth: gg.height ?? 0 } };
}
