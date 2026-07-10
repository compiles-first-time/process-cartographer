import type { IRGraph } from "../ir/schema.ts";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "../layout/cityLayout.ts";
import type { Zone } from "../model/cityModel.ts";

interface Props {
  zone: Zone;
  ir: IRGraph;
  onClose: () => void;
  onEnter?: () => void;
}

export default function DetailPanel({ zone, ir, onClose, onEnter }: Props) {
  const wf = zone.workflow;
  const outgoing = wf ? ir.edges.filter((e) => e.from === wf.id) : [];

  return (
    <aside className="detail" aria-label={`Details for ${zone.label}`}>
      <div className="detail-head">
        <span className="swatch" style={{ background: CATEGORY_COLORS[zone.category] }} />
        <h2>{zone.label}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close details">✕</button>
      </div>
      <div className="detail-sub">
        <span className="tag">{CATEGORY_LABELS[zone.category]}</span>
        <span className="tag ghosttag">{zone.kind}</span>
      </div>
      <p className="detail-summary">{zone.summary}</p>

      {onEnter && (
        <button className="enter-btn" onClick={onEnter}>
          Enter {zone.label} ⤵
        </button>
      )}

      {zone.children.length > 0 && (
        <Section title={`Contains (${zone.children.length})`}>
          <ul className="contains">
            {zone.children.map((c) => (
              <li key={c.id}>
                <span className="swatch sm" style={{ background: CATEGORY_COLORS[c.category] }} />
                <span className="c-label">{c.label}</span>
                <span className="c-kind">{c.kind}</span>
              </li>
            ))}
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
                <span className="swatch sm" style={{ background: CATEGORY_COLORS[t.system] }} />
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
