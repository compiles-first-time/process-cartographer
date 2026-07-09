/**
 * Search over the IR (FR-06). Matches a query against every meaningful facet of
 * a workflow — id, name, kind, arguments, target systems/areas, states, and
 * activity types — so "excel", "credential", "Click", or an argument name all
 * narrow the map. Returns the set of matching workflow ids, or null for an
 * empty query (meaning "everything"; the scene dims nothing).
 */
import type { IRGraph } from "../ir/schema.ts";

export function matchWorkflows(ir: IRGraph, query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const matched = new Set<string>();
  for (const wf of ir.workflows) {
    const haystack: string[] = [
      wf.id,
      wf.displayName ?? "",
      wf.kind,
      ...wf.arguments.flatMap((a) => [a.name, a.type, a.direction]),
      ...wf.targets.flatMap((t) => [t.system, t.area ?? "", t.activityType]),
      ...wf.states.flatMap((s) => [s.name, s.displayName ?? ""]),
      ...Object.keys(wf.activityCounts),
    ];
    if (haystack.some((h) => h.toLowerCase().includes(q))) matched.add(wf.id);
  }
  return matched;
}
