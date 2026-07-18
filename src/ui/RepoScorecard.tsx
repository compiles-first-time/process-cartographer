import { useState } from "react";
import type { RepoIR } from "../ir/repoSchema.ts";
import { colorFor, labelFor } from "../layout/cityLayout.ts";
import accuracy from "../generated/accuracy.json";

/**
 * The extraction-honesty scorecard (ADR-0055 / FR-11) — the soundiness
 * disclosure made a product surface. Everything the pipeline did NOT analyze
 * is stated here; the city never pretends completeness it doesn't have.
 *
 * B2: the resolver's oracle-measured precision/recall (src/generated/
 * accuracy.json, written by `npm run oracle`) ships here as the published
 * confidence — measured on the pinned corpus, labeled as such, never implied
 * to be a property of the currently loaded repo.
 */
const pct = (x: number | null): string => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
export default function RepoScorecard({ ir }: { ir: RepoIR }) {
  const [open, setOpen] = useState(false);
  const d = ir.diagnostics;
  const langs = Object.entries(d.languages)
    .sort((a, b) => b[1].loc - a[1].loc)
    .slice(0, 8);
  const excludedEntries = d.excludedDirs.reduce((n, e) => n + (e.entries ?? 0), 0);
  const detailCount = d.warnings.length + d.excludedDirs.length + d.assumptions.length;

  return (
    <div className="diagnostics">
      <div className="diag-stats">
        <strong>{ir.repo.name}</strong>
        <span className="pill">{d.filesTotal.toLocaleString()} files</span>
        <span className="pill">{d.locTotal.toLocaleString()} lines</span>
        {langs.slice(0, 5).map(([lang, agg]) => (
          <span className="pill" key={lang} title={`${agg.files} files · ${agg.loc.toLocaleString()} lines`}>
            <span className="swatch sm" style={{ background: colorFor(lang), marginRight: 4 }} />
            {labelFor(lang)}
          </span>
        ))}
        {d.filesSkipped > 0 && <span className="pill warn">{d.filesSkipped} skipped</span>}
        {excludedEntries > 0 && (
          <span className="pill" title={d.excludedDirs.map((e) => `${e.dir} (${e.entries ?? "?"})`).join(", ")}>
            {excludedEntries.toLocaleString()} excluded ({d.excludedDirs.length} dirs)
          </span>
        )}
        {d.parseCleanPct != null && <span className="pill">{d.parseCleanPct.toFixed(1)}% parse-clean</span>}
        {d.parseCleanPct == null && <span className="pill ghost-pill">syntax tier: not run</span>}
        {accuracy.entries.length > 0 && (
          <span
            className="pill"
            title={`Import-edge resolver, oracle-measured on a pinned corpus (NOT this repo): ${accuracy.entries
              .map((e) => `${e.language} P ${pct(e.precision)} / R ${pct(e.recall)} (${e.repo}@${e.sha})`)
              .join(" · ")} — see docs/accuracy.md`}
          >
            resolver oracle-measured ✓
          </span>
        )}
        <span className="muted src">· {ir.repo.source}</span>
      </div>
      {detailCount > 0 && (
        <button className="diag-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Extraction honesty — {d.filesSkipped} skips · {d.excludedDirs.length} exclusions · {d.assumptions.length} assumptions {open ? "▲" : "▼"}
        </button>
      )}
      {open && (
        <div className="diag-detail">
          {d.warnings.length > 0 && (
            <ul className="diag-list">
              {d.warnings.map((w, i) => (
                <li key={`w${i}`}>⚠ {w}</li>
              ))}
            </ul>
          )}
          {d.excludedDirs.length > 0 && (
            <>
              <h4 className="mini-h">Excluded directories (pruned wholesale, disclosed)</h4>
              <ul className="diag-list">
                {d.excludedDirs.map((e, i) => (
                  <li key={`e${i}`}>
                    <span className="mono">{e.dir}</span> — {e.rule}
                    {e.entries != null ? ` (${e.entries.toLocaleString()} entries)` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
          <h4 className="mini-h">Assumptions in force</h4>
          <ul className="diag-list">
            {d.assumptions.map((a, i) => (
              <li key={`a${i}`}>{a}</li>
            ))}
            <li>LOC rule: {d.locRule}</li>
          </ul>
          {accuracy.entries.length > 0 && (
            <>
              <h4 className="mini-h">Measured resolver accuracy (pinned oracle corpus — not this repo)</h4>
              <ul className="diag-list">
                {accuracy.entries.map((e) => (
                  <li key={e.id}>
                    <span className="mono">{e.language}</span> — precision {pct(e.precision)} · recall {pct(e.recall)} on{" "}
                    <span className="mono">
                      {e.repo}@{e.sha}
                    </span>{" "}
                    ({e.ours} edges) — {e.method}
                  </li>
                ))}
                <li>Differential re-run and gated in CI (`oracle:assert`); full disagreement triage in docs/accuracy.md.</li>
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
