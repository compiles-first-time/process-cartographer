/**
 * Generates `schema/ir.schema.json` from the zod IR schema — the single source
 * of truth stays `schema.ts`, so the portable JSON Schema can never drift from
 * the runtime validator. The JSON Schema is the language-agnostic contract the
 * IR promises to any consumer (the 3D renderer now; a future automation
 * generator later). Run: `npm run gen:schema`.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { IRGraph, IR_SCHEMA_VERSION } from "./schema.ts";
import { RepoIR, REPO_IR_VERSION } from "./repoSchema.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../../schema");
mkdirSync(outDir, { recursive: true });

const uipathSchema = zodToJsonSchema(IRGraph, { name: "IRGraph", $refStrategy: "none" });
(uipathSchema as Record<string, unknown>).title = `process-cartographer IR v${IR_SCHEMA_VERSION}`;
const uipathPath = path.join(outDir, "ir.schema.json");
writeFileSync(uipathPath, JSON.stringify(uipathSchema, null, 2) + "\n", "utf8");
process.stdout.write(`wrote ${path.relative(path.resolve(here, "../.."), uipathPath)} (IR v${IR_SCHEMA_VERSION})\n`);

const repoSchema = zodToJsonSchema(RepoIR, { name: "RepoIR", $refStrategy: "none" });
(repoSchema as Record<string, unknown>).title = `process-cartographer RepoIR v${REPO_IR_VERSION} (ADR-0055)`;
const repoPath = path.join(outDir, "repo-ir.schema.json");
writeFileSync(repoPath, JSON.stringify(repoSchema, null, 2) + "\n", "utf8");
process.stdout.write(`wrote ${path.relative(path.resolve(here, "../.."), repoPath)} (RepoIR v${REPO_IR_VERSION})\n`);
