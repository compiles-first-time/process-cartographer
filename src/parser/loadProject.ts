/**
 * loadProject — the ingest orchestrator. Reads a UiPath project directory
 * (`project.json` + `*.xaml`), parses each workflow, resolves the invoke graph,
 * and assembles a schema-validated IR (FR-01/FR-02/FR-04).
 *
 * This is the Node/filesystem layer. The browser ingest path (File System
 * Access API / drag-drop / .nupkg unzip) will reuse `parseXamlWorkflow` and
 * `assembleIR` with an in-memory file map — so the graph-building logic stays
 * shared and testable.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseXamlWorkflow } from "./xamlParser.ts";
import {
  validateIR,
  type Edge,
  type IRGraph,
  type ProjectMeta,
  type WorkflowNode,
  IR_SCHEMA_VERSION,
} from "../ir/schema.ts";

/** An ingested file: normalized forward-slashed id + raw contents. */
export interface SourceFile {
  id: string;
  xml: string;
}

/** Normalize a project-relative path to the graph id form (forward slashes). */
export function normalizeId(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

function readProjectMeta(rootDir: string): ProjectMeta {
  const projectJsonPath = path.join(rootDir, "project.json");
  try {
    const raw = JSON.parse(readFileSync(projectJsonPath, "utf8")) as Record<string, unknown>;
    return {
      name: typeof raw.id === "string" && raw.id ? raw.id : path.basename(rootDir),
      main: typeof raw.main === "string" ? normalizeId(raw.main) : undefined,
      version: typeof raw.version === "string" ? raw.version : undefined,
      description: typeof raw.description === "string" ? raw.description : undefined,
    };
  } catch {
    return { name: path.basename(rootDir) };
  }
}

/** Recursively collect every `.xaml` under rootDir as forward-slashed ids. */
export function collectXamlFiles(rootDir: string): SourceFile[] {
  const entries = readdirSync(rootDir, { recursive: true, withFileTypes: true });
  const files: SourceFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".xaml")) continue;
    // Node's recursive readdir puts the subdir in `parentPath` (Node 20.12+) / `path`.
    const parent = (entry as unknown as { parentPath?: string; path?: string }).parentPath
      ?? (entry as unknown as { path?: string }).path
      ?? rootDir;
    const abs = path.join(parent, entry.name);
    const id = normalizeId(path.relative(rootDir, abs));
    files.push({ id, xml: readFileSync(abs, "utf8") });
  }
  files.sort((a, b) => a.id.localeCompare(b.id)); // determinism (RISK: stable IR)
  return files;
}

/**
 * Assemble an IR from already-loaded source files. Pure over its inputs
 * (no fs) so the browser path and tests share it.
 */
export function assembleIR(project: ProjectMeta, files: SourceFile[]): IRGraph {
  const idSet = new Set(files.map((f) => f.id));
  const workflows: WorkflowNode[] = [];
  const edges: Edge[] = [];
  const warnings: string[] = [];
  let activitiesParsed = 0;
  let unresolvedInvokes = 0;
  let unknownTargets = 0;

  for (const file of files) {
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
      const isExpression = raw.trim().startsWith("[");
      if (isExpression) {
        // Dynamic invoke — target only known at runtime (RISK-01 real edge case).
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

  // Boundary enforcement (RISK-02): throws on any shape mismatch.
  return validateIR(ir);
}

/** Full pipeline: read a project directory from disk → validated IR. */
export function loadProject(rootDir: string): IRGraph {
  const project = readProjectMeta(rootDir);
  const files = collectXamlFiles(rootDir);
  return assembleIR(project, files);
}
