import type { IRGraph } from "../ir/schema.ts";
import { CATEGORY_COLORS, CATEGORY_LABELS, type PlacedBuilding } from "../layout/cityLayout.ts";

interface Props {
  building: PlacedBuilding;
  ir: IRGraph;
  onClose: () => void;
  onSelect: (id: string) => void;
}

/** Details for the selected workflow: kind, states, arguments, targets, invokes. */
export default function DetailPanel({ building, ir, onClose, onSelect }: Props) {
  const wf = building.workflow;
  const outgoing = ir.edges.filter((e) => e.from === wf.id);
  const incoming = ir.edges.filter((e) => e.resolved && e.to === wf.id);

  return (
    <aside className="detail" aria-label={`Details for ${wf.displayName || wf.id}`}>
      <div className="detail-head">
        <span className="swatch" style={{ background: CATEGORY_COLORS[building.category] }} />
        <h2>{wf.displayName || wf.id}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close details">
          ✕
        </button>
      </div>
      <div className="detail-sub">
        <code>{wf.id}</code>
        <span className="tag">{wf.kind}</span>
        <span className="tag">{CATEGORY_LABELS[building.category]}</span>
      </div>

      {wf.states.length > 0 && (
        <Section title={`States (${wf.states.length})`}>
          <ul className="chips">
            {wf.states.map((s) => (
              <li key={s.name} className={`chip${s.isFinal ? " final" : ""}`}>
                {s.displayName || s.name}
                {s.isFinal && " ⏹"}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {wf.arguments.length > 0 && (
        <Section title={`Arguments (${wf.arguments.length})`}>
          <table className="mini">
            <tbody>
              {wf.arguments.map((a) => (
                <tr key={a.name}>
                  <td>
                    <span className={`dir dir-${a.direction.toLowerCase()}`}>{a.direction}</span>
                  </td>
                  <td className="mono">{a.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {wf.targets.length > 0 && (
        <Section title={`Systems touched (${wf.targets.length})`}>
          <ul className="targets">
            {wf.targets.map((t, i) => (
              <li key={i}>
                <span className="swatch sm" style={{ background: CATEGORY_COLORS[t.system] }} />
                <span className="mono">{t.activityType}</span>
                {t.area && <span className="area">→ {t.area}</span>}
                <span className="conf" title={t.evidence}>
                  {Math.round(t.confidence * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={`Invokes out (${outgoing.length})`}>
        {outgoing.length === 0 ? (
          <p className="muted">None.</p>
        ) : (
          <ul className="links">
            {outgoing.map((e, i) => (
              <li key={i}>
                {e.resolved ? (
                  <button className="linkish" onClick={() => onSelect(e.to)}>
                    {e.to}
                  </button>
                ) : (
                  <span className="dynamic" title="Target resolved at runtime — not statically knowable">
                    ⚡ {e.raw} <em>(dynamic)</em>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {incoming.length > 0 && (
        <Section title={`Invoked by (${incoming.length})`}>
          <ul className="links">
            {incoming.map((e, i) => (
              <li key={i}>
                <button className="linkish" onClick={() => onSelect(e.from)}>
                  {e.from}
                </button>
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
