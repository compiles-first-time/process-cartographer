/**
 * harness — B2 oracle differential (ADR-0055 §B.5, roadmap B2).
 *
 * For each pinned-SHA corpus entry:
 *   1. fetch + cache the GitHub zip (codeload, cached under oracle/.cache/)
 *   2. run the SHIPPED pipeline (buildLoadedWithSyntax) over the ingested set
 *   3. run independent oracles over the same materialized tree
 *   4. vote truth (2-of-3 for TS/JS; single-oracle grimp for Python, disclosed)
 *   5. score precision/recall + disagreement lists for triage
 *
 * Publishes: oracle/results/latest.json (full detail), docs/accuracy.md
 * (human-readable), src/generated/accuracy.json (the number the scorecard
 * ships). With --assert, exits 1 when any entry falls below its corpus.json
 * thresholds — the CI accuracy gate.
 *
 * Run: node oracle/harness.ts [--only id[,id]] [--assert]
 * (Node ≥ 23.6 for native TS type-stripping; this repo pins Node 24 in CI.)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestFromGithubZip } from "./lib/ingestZip.ts";
import { runShippedPipeline } from "./lib/pipeline.ts";
import { oracleDepcruise, oracleMadge, oracleTsc, oracleGrimp, grimpEdges } from "./lib/oracles.ts";
import { normalizeEdges, voteTruth, score, oracleBreakdown, type Edge, type Score } from "./lib/diff.ts";

const ORACLE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(ORACLE_DIR, "..");
const CACHE_DIR = path.join(ORACLE_DIR, ".cache");
const DISAGREEMENT_CAP = 200;

interface CorpusEntry {
  id: string;
  repo: string;
  sha: string;
  language: "js" | "ts" | "python";
  why: string;
  thresholds: { precision: number; recall: number };
  /** Human-authored triage record for the pinned SHA — rendered into docs/accuracy.md. */
  triage?: string;
}

interface EntryReport {
  id: string;
  repo: string;
  sha: string;
  language: string;
  method: string;
  files: { total: number; analyzed: number; parseCleanPct: number | null };
  precision: number | null;
  recall: number | null;
  ours: number;
  truth: number;
  agreed: number;
  oracles: Record<string, { edges: number; agreedWithOurs: number }>;
  disagreements: { oursOnly: string[]; oursOnlyTotal: number; truthOnly: string[]; truthOnlyTotal: number };
  /** Our resolved edges whose endpoints fall outside the oracle's model scope (disclosed, not scored). */
  outOfScope?: number;
  skipped?: string;
  warnings: string[];
  ms: number;
}

async function ensureCorpus(entry: CorpusEntry): Promise<{ treeRoot: string; zipBytes: Uint8Array }> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const zipPath = path.join(CACHE_DIR, `${entry.id}-${entry.sha}.zip`);
  if (!fs.existsSync(zipPath)) {
    const url = `https://codeload.github.com/${entry.repo}/zip/${entry.sha}`;
    process.stdout.write(`  fetching ${url}\n`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} for ${url}`);
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  }
  const zipBytes = new Uint8Array(fs.readFileSync(zipPath));

  const treeRoot = path.join(CACHE_DIR, `${entry.id}-${entry.sha}`);
  const marker = path.join(treeRoot, ".materialized");
  if (!fs.existsSync(marker)) {
    process.stdout.write(`  materializing tree at ${path.relative(REPO_ROOT, treeRoot)}\n`);
    const { entryBytes } = ingestFromGithubZip(zipBytes, entry.id);
    for (const [rel, data] of entryBytes) {
      const abs = path.join(treeRoot, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, data);
    }
    fs.writeFileSync(marker, entry.sha);
  }
  return { treeRoot, zipBytes };
}

async function measureEntry(entry: CorpusEntry): Promise<EntryReport> {
  const t0 = Date.now();
  const { treeRoot, zipBytes } = await ensureCorpus(entry);
  const { ingested } = ingestFromGithubZip(zipBytes, entry.id);
  const p = await runShippedPipeline(ingested);
  const warnings: string[] = [];

  let ours: Map<string, Edge>;
  let truth: Map<string, Edge>;
  let oracles = new Map<string, Map<string, Edge>>();
  let method: string;
  let analyzed: number;
  let skipped: string | undefined;
  let outOfScope: number | undefined;

  if (entry.language === "python") {
    method =
      "single-oracle differential vs grimp (disclosed: 1 oracle, no vote; scope = files grimp models as importable modules — script files without __init__ chains are outside it, disclosed as outOfScope)";
    const g = await oracleGrimp(treeRoot);
    if (!g.result) {
      skipped = g.skipped;
      warnings.push(`python oracle skipped: ${g.skipped}`);
      ours = new Map();
      truth = new Map();
      analyzed = p.analyzedPy.size;
    } else {
      // Fair universe: the files grimp actually models (its package-module
      // scope). Our edges outside it were triaged 2026-07-18 — spot-verified
      // real (script-execution sys.path resolution grimp cannot see) — so
      // they are DISCLOSED, never counted for or against.
      const universe = new Set(g.result.module_files.filter((f) => p.analyzedPy.has(f)));
      analyzed = universe.size;
      ours = normalizeEdges(p.oursPy, universe, universe);
      const allOurs = normalizeEdges(p.oursPy, p.analyzedPy, p.includedFiles);
      outOfScope = allOurs.size - ours.size;
      oracles = new Map([["grimp", normalizeEdges(grimpEdges(g.result), universe, universe)]]);
      truth = voteTruth(oracles, 1);
    }
  } else {
    method = "2-of-3 oracle vote (dependency-cruiser, madge, TypeScript compiler over real FS)";
    analyzed = p.analyzedTsJs.size;
    const [dc, mg] = await Promise.all([
      oracleDepcruise(treeRoot, p.tsconfigPath),
      oracleMadge(treeRoot, p.tsconfigPath),
    ]);
    const tsc = oracleTsc(treeRoot, p.analyzedTsJs, p.tsconfigPath);
    // from = analyzed TS/JS; to = any included file (JSON etc. are valid targets).
    oracles = new Map([
      ["depcruise", normalizeEdges(dc, p.analyzedTsJs, p.includedFiles)],
      ["madge", normalizeEdges(mg, p.analyzedTsJs, p.includedFiles)],
      ["tsc", normalizeEdges(tsc, p.analyzedTsJs, p.includedFiles)],
    ]);
    ours = normalizeEdges(p.oursTsJs, p.analyzedTsJs, p.includedFiles);
    truth = voteTruth(oracles, 2);
  }

  const s: Score = score(ours, truth);
  return {
    id: entry.id,
    repo: entry.repo,
    sha: entry.sha,
    language: entry.language,
    method,
    files: { total: p.ir.diagnostics.filesTotal, analyzed, parseCleanPct: p.ir.diagnostics.parseCleanPct },
    precision: s.precision,
    recall: s.recall,
    ours: s.ours,
    truth: s.truth,
    agreed: s.agreed,
    oracles: oracleBreakdown(ours, oracles),
    disagreements: {
      oursOnly: s.oursOnly.slice(0, DISAGREEMENT_CAP),
      oursOnlyTotal: s.oursOnly.length,
      truthOnly: s.truthOnly.slice(0, DISAGREEMENT_CAP),
      truthOnlyTotal: s.truthOnly.length,
    },
    ...(outOfScope != null && outOfScope > 0 ? { outOfScope } : {}),
    ...(skipped ? { skipped } : {}),
    warnings,
    ms: Date.now() - t0,
  };
}

const fmt = (x: number | null): string => (x == null ? "—" : (x * 100).toFixed(2) + "%");

function publish(reports: EntryReport[], corpus: CorpusEntry[]): void {
  const generatedAt = new Date().toISOString();

  fs.mkdirSync(path.join(ORACLE_DIR, "results"), { recursive: true });
  fs.writeFileSync(
    path.join(ORACLE_DIR, "results", "latest.json"),
    JSON.stringify({ generatedAt, reports }, null, 2) + "\n",
  );

  const compact = {
    generatedAt,
    note: "Measured on the pinned oracle corpus (oracle/corpus.json), NOT on the currently loaded repo. See docs/accuracy.md.",
    entries: reports.map((r) => ({
      id: r.id,
      repo: r.repo,
      sha: r.sha.slice(0, 7),
      language: r.language,
      method: r.method,
      precision: r.precision,
      recall: r.recall,
      ours: r.ours,
      truth: r.truth,
      ...(r.skipped ? { skipped: r.skipped } : {}),
    })),
  };
  fs.mkdirSync(path.join(REPO_ROOT, "src", "generated"), { recursive: true });
  fs.writeFileSync(path.join(REPO_ROOT, "src", "generated", "accuracy.json"), JSON.stringify(compact, null, 2) + "\n");

  const lines: string[] = [
    "# Measured resolver accuracy (B2 oracle differential)",
    "",
    "> **Generated by `node oracle/harness.ts` — do not edit by hand.**",
    `> Last run: ${generatedAt}`,
    "",
    "Per [ADR-0055](../adr/0055-universal-repo-cartography-computed-not-generated.md) the product refuses scalar",
    "accuracy claims; what it publishes instead is this **measured differential**: the shipped resolver's",
    "resolved-static import edges compared against independent oracle tools on a pinned-SHA corpus.",
    "\"Truth\" for TS/JS is a 2-of-3 vote (dependency-cruiser, madge, the TypeScript compiler over the real",
    "filesystem — the tsc oracle shares the typescript library with the shipped resolver but uses independent",
    "extraction and host; the two fully-independent tools bound that bias). Python is a single-oracle",
    "differential vs grimp, disclosed as such. Disagreements are evidence for triage, not noise:",
    "see `oracle/results/latest.json`.",
    "",
    "| corpus | language | precision | recall | ours | truth | oracle edge counts | time |",
    "|---|---|---|---|---|---|---|---|",
    ...reports.map((r) => {
      const oc = Object.entries(r.oracles)
        .map(([n, o]) => `${n}: ${o.edges}`)
        .join(" · ");
      const status = r.skipped ? ` ⚠ skipped: ${r.skipped}` : "";
      return `| ${r.repo}@${r.sha.slice(0, 7)} | ${r.language} | ${fmt(r.precision)} | ${fmt(r.recall)} | ${r.ours} | ${r.truth} | ${oc}${status} | ${(r.ms / 1000).toFixed(1)}s |`;
    }),
    "",
    "**Fact class measured:** intra-repo file→file static import edges (`kind: import`,",
    "`resolution: resolved-static`), endpoints restricted to files the pipeline analyzed — so",
    "hygiene differences surface as disagreements, never as silent skew. Reference edges, external",
    "edges, and unresolved-dynamic edges are OUT of scope for this differential (they carry their",
    "own tiers and disclosures in the IR).",
    "",
    "**CI gate:** `node oracle/harness.ts --assert` fails when any corpus entry drops below the",
    "floors in `oracle/corpus.json` (`thresholds`). Raise floors deliberately after triaging a run;",
    "never lower them silently.",
    "",
    "## Thresholds in force",
    "",
    "| corpus | min precision | min recall |",
    "|---|---|---|",
    ...corpus.map((c) => `| ${c.id} | ${(c.thresholds.precision * 100).toFixed(1)}% | ${(c.thresholds.recall * 100).toFixed(1)}% |`),
    "",
    "## Triage record (per pinned SHA — from oracle/corpus.json)",
    "",
    ...corpus.filter((c) => c.triage).map((c) => `- **${c.id}** (${c.repo}@${c.sha.slice(0, 7)}): ${c.triage}`),
    "",
  ];
  fs.writeFileSync(path.join(REPO_ROOT, "docs", "accuracy.md"), lines.join("\n"));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const assert = args.includes("--assert");
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(",")) : null;

  const corpus = (JSON.parse(fs.readFileSync(path.join(ORACLE_DIR, "corpus.json"), "utf8")) as { entries: CorpusEntry[] })
    .entries;
  const selected = corpus.filter((e) => !only || only.has(e.id));
  if (selected.length === 0) throw new Error("no corpus entries selected");

  const reports: EntryReport[] = [];
  for (const entry of selected) {
    process.stdout.write(`▶ ${entry.id} (${entry.repo}@${entry.sha.slice(0, 7)}, ${entry.language})\n`);
    const r = await measureEntry(entry);
    reports.push(r);
    process.stdout.write(
      `  precision ${fmt(r.precision)} · recall ${fmt(r.recall)} · ours ${r.ours} · truth ${r.truth}` +
        ` · disagreements ${r.disagreements.oursOnlyTotal}+${r.disagreements.truthOnlyTotal}` +
        (r.outOfScope ? ` · out-of-scope ${r.outOfScope}` : "") +
        ` · ${(r.ms / 1000).toFixed(1)}s\n`,
    );
    for (const w of r.warnings) process.stdout.write(`  ⚠ ${w}\n`);
  }

  // Publish only on full-corpus runs — a --only run must not shrink the published record.
  if (!only) publish(reports, corpus);
  else process.stdout.write("(partial run — results not published)\n");

  if (assert) {
    const failures: string[] = [];
    for (const r of reports) {
      const t = selected.find((e) => e.id === r.id)!.thresholds;
      if (r.skipped && (t.precision > 0 || t.recall > 0)) {
        failures.push(`${r.id}: oracle skipped (${r.skipped}) but thresholds are set — CI must measure`);
        continue;
      }
      if (t.precision > 0 && (r.precision == null || r.precision < t.precision)) {
        failures.push(`${r.id}: precision ${fmt(r.precision)} below floor ${(t.precision * 100).toFixed(1)}%`);
      }
      if (t.recall > 0 && (r.recall == null || r.recall < t.recall)) {
        failures.push(`${r.id}: recall ${fmt(r.recall)} below floor ${(t.recall * 100).toFixed(1)}%`);
      }
    }
    if (failures.length > 0) {
      process.stderr.write("ORACLE GATE FAILED:\n" + failures.map((f) => `  ✗ ${f}\n`).join(""));
      process.exit(1);
    }
    process.stdout.write("oracle gate: all corpus entries at or above their floors ✓\n");
  }
}

main().catch((err) => {
  process.stderr.write(`harness failed: ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
