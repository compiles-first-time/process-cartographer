import type { IRGraph } from "../ir/schema.ts";
import { colorFor, labelFor } from "../layout/cityLayout.ts";
import type { Zone } from "../model/cityModel.ts";

interface Props {
  zone: Zone;
  /** Present in UiPath mode only (invoke-edge listing); repo zones carry their own facts. */
  ir?: IRGraph | null;
  onClose: () => void;
  onEnter?: () => void;
}

export default function DetailPanel({ zone, ir, onClose, onEnter }: Props) {
  const wf = zone.workflow;
  const file = zone.file;
  const outgoing = wf && ir ? ir.edges.filter((e) => e.from === wf.id) : [];

  return (
    <aside className="detail" aria-label={`Details for ${zone.label}`}>
      <div className="detail-head">
        <span className="swatch" style={{ background: colorFor(zone.category) }} />
        <h2>{zone.label}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close details">✕</button>
      </div>
      <div className="detail-sub">
        <span className="tag">{labelFor(zone.category)}</span>
        <span className="tag ghosttag">{zone.kind}</span>
      </div>
      <p className="detail-summary">{zone.summary}</p>

      {onEnter && (
        <button className="enter-btn" onClick={onEnter}>
          Enter {zone.label} ⤵
        </button>
      )}

      {/* ── Repo file facts (tier-0 provenance; ADR-0055) ── */}
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
          {file.imports.length > 0 && (
            <>
              <h4 className="mini-h">Imports as written ({file.imports.length})</h4>
              <ul className="links">
                {file.imports.map((imp, i) => (
                  <li key={i}>
                    <span className={imp.dynamic ? "dynamic" : "mono"}>
                      {imp.dynamic ? "⚡ " : ""}{imp.specifier}
                    </span>
                    <span className="muted"> :{imp.line}</span>
                  </li>
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
