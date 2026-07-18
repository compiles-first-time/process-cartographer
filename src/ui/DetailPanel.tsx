import type { IRGraph } from "../ir/schema.ts";
import type { RepoIR } from "../ir/repoSchema.ts";
import { colorFor, labelFor } from "../layout/cityLayout.ts";
import type { Zone } from "../model/cityModel.ts";
import type { AnnotationState } from "../App.tsx";

interface Props {
  zone: Zone;
  /** Present in UiPath mode only (invoke-edge listing); repo zones carry their own facts. */
  ir?: IRGraph | null;
  /** Present in repo mode — powers computed imports / imported-by. */
  repoIr?: RepoIR | null;
  onClose: () => void;
  onEnter?: () => void;
  /** On-demand inclusion of an excluded directory (absent when source can't expand). */
  onExpandDir?: (dir: string) => void;
  /** Jump the drill view to another file building. */
  onJumpFile?: (path: string) => void;
  annotation?: AnnotationState;
  onAnnotate?: () => void;
  apiKey?: string;
  onApiKey?: (key: string) => void;
}

export default function DetailPanel({
  zone,
  ir,
  repoIr,
  onClose,
  onEnter,
  onExpandDir,
  onJumpFile,
  annotation,
  onAnnotate,
  apiKey,
  onApiKey,
}: Props) {
  const wf = zone.workflow;
  const file = zone.file;
  const outgoing = wf && ir ? ir.edges.filter((e) => e.from === wf.id) : [];

  // Computed cross-file relationships (repo mode; ADR-0055 tiers).
  const repoEdgesOut = file && repoIr ? repoIr.edges.filter((e) => e.from === file.path) : [];
  const resolvedOut = repoEdgesOut.filter((e) => e.resolution === "resolved-static");
  const externalOut = repoEdgesOut.filter((e) => e.resolution === "external");
  const dynamicOut = repoEdgesOut.filter((e) => e.resolution === "unresolved-dynamic");
  const importedBy =
    file && repoIr
      ? repoIr.edges.filter((e) => e.resolution === "resolved-static" && e.to === file.path)
      : [];

  return (
    <aside className="detail" aria-label={`Details for ${zone.label}`}>
      <div className="detail-head">
        <span className="swatch" style={{ background: colorFor(zone.category) }} />
        <h2>{zone.label}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close details">✕</button>
      </div>
      <div className="detail-sub">
        <span className="tag">{labelFor(zone.category)}</span>
        <span className="tag ghosttag">{zone.excludedDir ? "excluded directory" : zone.kind}</span>
      </div>
      <p className="detail-summary">{zone.summary}</p>

      {/* ── Excluded ghost district: the on-demand inclusion flow ── */}
      {zone.excludedDir && (
        <Section title="Excluded by hygiene policy">
          <p className="muted">
            This directory was pruned at ingest ({zone.excludedDir.entries?.toLocaleString() ?? "?"} entries).
            You can include and parse it now — per-file rules (binary/size) still apply inside.
          </p>
          {onExpandDir ? (
            <button className="enter-btn" onClick={() => onExpandDir(zone.excludedDir!.dir)}>
              Parse this directory ⤵
            </button>
          ) : (
            <p className="dynamic">Not expandable for this source (IR-JSON loads carry no fetch capability) — re-ingest from GitHub/zip/folder.</p>
          )}
        </Section>
      )}

      {onEnter && !zone.excludedDir && (
        <button className="enter-btn" onClick={onEnter}>
          Enter {zone.label} ⤵
        </button>
      )}

      {/* ── Repo file facts (tier-0/1 provenance) ── */}
      {file && (
        <Section title="File">
          <table className="mini">
            <tbody>
              <tr><td className="muted">Path</td><td className="mono">{file.path}</td></tr>
              <tr><td className="muted">Language</td><td>{labelFor(file.language)} <span className="muted">({file.languageEvidence})</span></td></tr>
              <tr><td className="muted">Size</td><td>{file.bytes.toLocaleString()} bytes</td></tr>
              {file.parseStatus !== "skipped" && (
                <tr><td className="muted">Lines</td><td>{file.lines.toLocaleString()} ({file.linesNonEmpty.toLocaleString()} non-empty)</td></tr>
              )}
              <tr><td className="muted">Parse status</td><td>{file.parseStatus}{file.skipReason ? ` — ${file.skipReason}` : ""}</td></tr>
            </tbody>
          </table>
        </Section>
      )}

      {/* ── Computed relationships: who invokes this / what it invokes ── */}
      {file && importedBy.length > 0 && (
        <Section title={`Imported by (${importedBy.length}) — computed`}>
          <ul className="links">
            {importedBy.map((e, i) => (
              <li key={i}>
                {onJumpFile ? (
                  <button className="linkish" onClick={() => onJumpFile(e.from)}>{e.from}</button>
                ) : (
                  <span className="mono">{e.from}</span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {file && repoEdgesOut.length > 0 && (
        <Section title={`Imports (${repoEdgesOut.length}) — computed`}>
          {resolvedOut.length > 0 && (
            <ul className="links">
              {resolvedOut.map((e, i) => (
                <li key={i}>
                  {onJumpFile ? (
                    <button className="linkish" onClick={() => onJumpFile(e.to)}>{e.to}</button>
                  ) : (
                    <span className="mono">{e.to}</span>
                  )}
                  <span className="muted"> :{e.evidence.startLine}</span>
                </li>
              ))}
            </ul>
          )}
          {externalOut.length > 0 && (
            <>
              <h4 className="mini-h">External / outside the ingested set</h4>
              <ul className="links">
                {externalOut.map((e, i) => (
                  <li key={i}><span className="mono muted">{e.to}</span></li>
                ))}
              </ul>
            </>
          )}
          {dynamicOut.length > 0 && (
            <>
              <h4 className="mini-h">Dynamic — target known only at runtime</h4>
              <ul className="links">
                {dynamicOut.map((e, i) => (
                  <li key={i}><span className="dynamic">⚡ {e.to}</span></li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}

      {zone.children.length > 0 && (
        <Section title={`Contains (${zone.children.length})`}>
          <ul className="contains">
            {zone.children.slice(0, 60).map((c) => (
              <li key={c.id}>
                <span className="swatch sm" style={{ background: colorFor(c.category) }} />
                <span className="c-label">{c.label}</span>
                <span className="c-kind">{c.kind}</span>
              </li>
            ))}
            {zone.children.length > 60 && (
              <li className="muted">… and {zone.children.length - 60} more</li>
            )}
          </ul>
        </Section>
      )}

      {/* ── AI interpretation overlay (ADR-0056) — repo zones only ── */}
      {repoIr && !zone.excludedDir && (zone.file || zone.kind === "district" || zone.kind === "city") && (
        <Section title="AI interpretation">
          <p className="ai-disclaimer">
            Generated, not computed — an AI reading of the real source and computed facts. The map itself never
            uses this.
          </p>
          {(!apiKey || apiKey.length === 0) && onApiKey ? (
            <div className="stack">
              <input
                type="password"
                placeholder="Anthropic API key (memory-only, never stored)"
                aria-label="Anthropic API key"
                onChange={(e) => onApiKey(e.target.value)}
              />
              <p className="hint">Paste a key, then press Explain. Calls go directly from your browser to the Anthropic API.</p>
            </div>
          ) : null}
          {annotation?.status === "idle" && apiKey && (
            <button className="enter-btn ai-btn" onClick={onAnnotate}>
              Explain: what · why · how
            </button>
          )}
          {annotation?.status === "loading" && <p className="muted">Interpreting…</p>}
          {annotation?.status === "error" && <p className="dynamic">⚠ {annotation.error}</p>}
          {annotation?.status === "done" && (
            <div className="ai-result">
              <h4 className="mini-h">What</h4>
              <p>{annotation.result.what}</p>
              <h4 className="mini-h">Why (inferred intent)</h4>
              <p>{annotation.result.why}</p>
              <h4 className="mini-h">How</h4>
              <p>{annotation.result.how}</p>
              <p className="muted small">model: {annotation.result.model} · line refs point into the file's source</p>
            </div>
          )}
        </Section>
      )}

      {zone.state && (
        <Section title="State">
          <p className="muted">
            {zone.state.invokes.length} invoked workflow(s) · {zone.state.activityCount} activities
            {zone.state.isFinal ? " · final state" : ""}
          </p>
        </Section>
      )}

      {wf && wf.arguments.length > 0 && (
        <Section title={`Arguments (${wf.arguments.length})`}>
          <table className="mini">
            <tbody>
              {wf.arguments.map((a) => (
                <tr key={a.name}>
                  <td><span className={`dir dir-${a.direction.toLowerCase()}`}>{a.direction}</span></td>
                  <td className="mono">{a.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {wf && wf.targets.length > 0 && (
        <Section title={`Systems touched (${wf.targets.length})`}>
          <ul className="targets">
            {wf.targets.map((t, i) => (
              <li key={i}>
                <span className="swatch sm" style={{ background: colorFor(t.system) }} />
                <span className="mono">{t.activityType}</span>
                {t.area && <span className="area">→ {t.area}</span>}
                <span className="conf" title={t.evidence}>{Math.round(t.confidence * 100)}%</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {wf && outgoing.length > 0 && (
        <Section title={`Invokes out (${outgoing.length})`}>
          <ul className="links">
            {outgoing.map((e, i) => (
              <li key={i}>
                {e.resolved ? (
                  <span className="mono">{e.to}</span>
                ) : (
                  <span className="dynamic" title="Target resolved at runtime — not statically knowable">
                    ⚡ {e.raw} <em>(dynamic)</em>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
