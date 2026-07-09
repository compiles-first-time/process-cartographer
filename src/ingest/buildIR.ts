import type { IngestedProject } from "./types.ts";
import { assembleIR } from "../parser/assembleIR.ts";
import { parseProjectMeta } from "../parser/projectMeta.ts";
import type { IRGraph } from "../ir/schema.ts";

/** Ingested source files → validated IR (project.json enriches the metadata). */
export function buildIR(ingested: IngestedProject): IRGraph {
  const project = parseProjectMeta(ingested.projectJson, ingested.rootName);
  return assembleIR(project, ingested.xamlFiles);
}

export { ingestFromFolder } from "./fromFolder.ts";
export { ingestFromNupkg } from "./fromNupkg.ts";
export { ingestFromGithub, parseGithubUrl } from "./fromGithub.ts";
export type { IngestedProject } from "./types.ts";
