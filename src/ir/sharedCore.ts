/**
 * sharedCore — conventions shared by BOTH IR schemas (the UiPath IRGraph and
 * the universal RepoIR), extracted so the two cannot drift on the semantics
 * that carry the accuracy contract (ADR-0055 §A):
 *   - every edge is tier-stamped with a `resolution` kind,
 *   - confidence is always a probability,
 *   - provenance/evidence is always present and span-anchored where possible.
 *
 * The contract's load-bearing property: there is NO representation here for
 * LLM- or embedding-derived structure. Structure is computed or it is absent.
 */
import { z } from "zod";

/**
 * How an edge's target was determined (ADR-0055 §A.3). Under-approximation by
 * design: `unresolved-dynamic` is a first-class citizen, never a guessed target.
 */
export const Resolution = z.enum([
  "resolved-static", // spec/compiler-grade resolution to a file in the ingested set
  "resolved-heuristic", // deterministic but convention-based (e.g. C# namespace index)
  "inferred", // name-match / similarity-class candidates — toggle-gated in UI
  "unresolved-dynamic", // target only knowable at runtime (import(expr), reflection, [Row(...)])
  "external", // resolves outside the ingested set (npm package, BCL, etc.)
]);
export type Resolution = z.infer<typeof Resolution>;

/** Probability, not vibes: 1.0 is reserved for parser-proved facts. */
export const Confidence = z.number().min(0).max(1);

/** Where in the source a fact comes from. Line numbers are 1-based. */
export const EvidenceSpan = z.object({
  path: z.string(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});
export type EvidenceSpan = z.infer<typeof EvidenceSpan>;

/** Per-file parse outcome — every file has one; silence is not an option. */
export const ParseStatus = z.enum([
  "parse-clean", // parsed, zero ERROR/MISSING nodes
  "parse-errors", // parsed with error nodes; facts extracted from clean regions only
  "not-analyzed", // included in the city but no syntax tier ran (U0 default / unsupported language)
  "skipped", // excluded by hygiene policy (size cap, binary, exclude rule) — reason recorded
]);
export type ParseStatus = z.infer<typeof ParseStatus>;
