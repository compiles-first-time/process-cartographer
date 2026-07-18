/**
 * diff — the pure differential math of the B2 oracle harness (ADR-0055 §B.5).
 *
 * Measured fact class: intra-repo file→file static import edges. "Truth" is
 * never a single tool's opinion: for TS/JS it is the 2-of-3 vote among
 * independent oracles (dependency-cruiser, madge, the TypeScript compiler over
 * the real filesystem); for Python it is Grimp alone, disclosed as 1-oracle.
 *
 * Precision = |ours ∩ truth| / |ours|   (are our pipes real?)
 * Recall    = |ours ∩ truth| / |truth|  (do we draw every real pipe?)
 *
 * Everything here is pure over edge sets — no I/O — so it is unit-tested
 * exactly, and disagreements come out as evidence lists for triage, per the
 * disagreement→triage→golden-fixture discipline.
 */

export interface Edge {
  from: string;
  to: string;
}

export const edgeKey = (e: Edge): string => `${e.from} → ${e.to}`;

/** Dedupe + drop self-edges + keep only edges whose endpoints pass the universe filters. */
export function normalizeEdges(
  edges: Edge[],
  fromUniverse: ReadonlySet<string>,
  toUniverse: ReadonlySet<string>,
): Map<string, Edge> {
  const out = new Map<string, Edge>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    if (!fromUniverse.has(e.from) || !toUniverse.has(e.to)) continue;
    out.set(edgeKey(e), e);
  }
  return out;
}

/** Edges affirmed by at least `minVotes` of the given oracle edge sets. */
export function voteTruth(oracles: ReadonlyMap<string, ReadonlyMap<string, Edge>>, minVotes: number): Map<string, Edge> {
  const votes = new Map<string, { edge: Edge; count: number }>();
  for (const edgeMap of oracles.values()) {
    for (const [key, edge] of edgeMap) {
      const v = votes.get(key);
      if (v) v.count++;
      else votes.set(key, { edge, count: 1 });
    }
  }
  const truth = new Map<string, Edge>();
  for (const [key, { edge, count }] of votes) {
    if (count >= minVotes) truth.set(key, edge);
  }
  return truth;
}

export interface Score {
  precision: number | null; // null when |ours| = 0
  recall: number | null; // null when |truth| = 0
  ours: number;
  truth: number;
  agreed: number;
  /** In ours but not truth — candidate false pipes (or oracle blind spots). */
  oursOnly: string[];
  /** In truth but not ours — real pipes we failed to draw. */
  truthOnly: string[];
}

export function score(ours: ReadonlyMap<string, Edge>, truth: ReadonlyMap<string, Edge>): Score {
  let agreed = 0;
  const oursOnly: string[] = [];
  const truthOnly: string[] = [];
  for (const key of ours.keys()) {
    if (truth.has(key)) agreed++;
    else oursOnly.push(key);
  }
  for (const key of truth.keys()) {
    if (!ours.has(key)) truthOnly.push(key);
  }
  oursOnly.sort();
  truthOnly.sort();
  return {
    precision: ours.size > 0 ? agreed / ours.size : null,
    recall: truth.size > 0 ? agreed / truth.size : null,
    ours: ours.size,
    truth: truth.size,
    agreed,
    oursOnly,
    truthOnly,
  };
}

/** Per-oracle sizes + overlap with ours — context for reading the vote. */
export function oracleBreakdown(
  ours: ReadonlyMap<string, Edge>,
  oracles: ReadonlyMap<string, ReadonlyMap<string, Edge>>,
): Record<string, { edges: number; agreedWithOurs: number }> {
  const out: Record<string, { edges: number; agreedWithOurs: number }> = {};
  for (const [name, edgeMap] of oracles) {
    let agreed = 0;
    for (const key of edgeMap.keys()) if (ours.has(key)) agreed++;
    out[name] = { edges: edgeMap.size, agreedWithOurs: agreed };
  }
  return out;
}
