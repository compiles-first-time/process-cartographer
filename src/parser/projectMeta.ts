/** Browser-safe project.json → ProjectMeta parsing (shared by node + browser ingest). */
import type { ProjectMeta } from "../ir/schema.ts";

/** Normalize a project-relative path to the graph id form (forward slashes). */
export function normalizeId(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Parse a UiPath `project.json` string into ProjectMeta. Tolerant: any missing
 * or unparseable field falls back gracefully (RISK-01: never throw on ingest).
 */
export function parseProjectMeta(jsonText: string | undefined, fallbackName: string): ProjectMeta {
  if (!jsonText) return { name: fallbackName };
  try {
    const raw = JSON.parse(jsonText) as Record<string, unknown>;
    return {
      name: typeof raw.id === "string" && raw.id ? raw.id : fallbackName,
      main: typeof raw.main === "string" ? normalizeId(raw.main) : undefined,
      version: typeof raw.version === "string" ? raw.version : undefined,
      description: typeof raw.description === "string" ? raw.description : undefined,
    };
  } catch {
    return { name: fallbackName };
  }
}
