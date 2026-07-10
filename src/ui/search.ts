/**
 * Search over the IR (FR-06). Matches a query against every meaningful facet of
 * a workflow — id, name, kind, arguments, target systems/areas, states, and
 * activity types — so "excel", "credential", "Click", or an argument name all
 * narrow the map. Returns the set of matching workflow ids, or null for an
 * empty query (meaning "everything"; the scene dims nothing).
 */
import type { IRGraph } from "../ir/schema.ts";
import type { Zone } from "../model/cityModel.ts";

/**
 * Search over the buildings at the current drill level (FR-06). Matches label,
 * summary, kind/category, and — for workflow/state zones — the underlying
 * workflow's id/arguments/systems and the state's invoked workflows. Returns
 * matching zone ids, or null for an empty query.
 */
export function matchZones(zones: Zone[], query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const set = new Set<string>();
  for (const z of zones) {
    const hay: string[] = [
      z.label,
      z.summary,
      z.kind,
      z.category,
      z.workflow?.id ?? "",
      ...(z.workflow?.arguments.map((a) => a.name) ?? []),
      ...(z.workflow?.targets.flatMap((t) => [t.system, t.area ?? "", t.activityType]) ?? []),
      ...(z.workflow ? Object.keys(z.workflow.activityCounts) : []),
      ...(z.state ? [z.state.displayName ?? "", z.state.name, ...z.state.invokes] : []),
    ];
    if (hay.some((h) => h.toLowerCase().includes(q))) set.add(z.id);
  }
  return set;
}

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
