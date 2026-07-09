/**
 * assembleIR — build a validated IR from already-loaded source files. Pure (no
 * filesystem, no network) so the Node loader, the browser ingest paths (folder
 * / .nupkg / GitHub), and tests all share the exact same graph-building logic.
 */
import { parseXamlWorkflow } from "./xamlParser.ts";
import { normalizeId } from "./projectMeta.ts";
import {
  validateIR,
  type Edge,
  type IRGraph,
  type ProjectMeta,
  type WorkflowNode,
  IR_SCHEMA_VERSION,
} from "../ir/schema.ts";

export { normalizeId };

/** An ingested workflow file: normalized forward-slashed id + raw XML. */
export interface SourceFile {
  id: string;
  xml: string;
}

/**
 * Assemble an IR from loaded source files. Resolves the InvokeWorkflowFile
 * graph against the file set; dynamic (runtime-expression) invokes are marked
 * unresolved rather than faked (RISK-01). Throws (via validateIR) only on an
 * internal shape bug — the boundary contract (RISK-02).
 */
export function assembleIR(project: ProjectMeta, files: SourceFile[]): IRGraph {
  const ordered = [...files].sort((a, b) => a.id.localeCompare(b.id)); // determinism
  const idSet = new Set(ordered.map((f) => f.id));
  const workflows: WorkflowNode[] = [];
  const edges: Edge[] = [];
  const warnings: string[] = [];
  let activitiesParsed = 0;
  let unresolvedInvokes = 0;
  let unknownTargets = 0;

  for (const file of ordered) {
    const parsed = parseXamlWorkflow(file.xml, file.id);
    activitiesParsed += parsed.activityCount;
    warnings.push(...parsed.warnings);
    unknownTargets += parsed.targets.filter((t) => t.system === "unknown").length;

    workflows.push({
      id: file.id,
      displayName: parsed.displayName,
      filePath: file.id,
      kind: parsed.kind,
      arguments: parsed.arguments,
      states: parsed.states,
      activityCounts: parsed.activityCounts,
      targets: parsed.targets,
    });

    for (const inv of parsed.rawInvokes) {
      const raw = inv.raw;
      if (raw.trim().startsWith("[")) {
        // Dynamic invoke — target only known at runtime (a real REFramework edge case).
        edges.push({ from: file.id, to: raw, kind: "invoke", resolved: false, raw, expression: raw });
        unresolvedInvokes++;
        continue;
      }
      const candidate = normalizeId(raw);
      if (idSet.has(candidate)) {
        edges.push({ from: file.id, to: candidate, kind: "invoke", resolved: true, raw });
      } else {
        edges.push({ from: file.id, to: candidate, kind: "invoke", resolved: false, raw });
        unresolvedInvokes++;
        warnings.push(`${file.id}: invoke target not found in project — "${raw}"`);
      }
    }
  }

  const ir: IRGraph = {
    version: IR_SCHEMA_VERSION,
    project,
    workflows,
    edges,
    diagnostics: {
      workflowsParsed: workflows.length,
      activitiesParsed,
      invokeEdges: edges.length,
      unresolvedInvokes,
      unknownTargets,
      warnings,
    },
  };

  return validateIR(ir);
}
