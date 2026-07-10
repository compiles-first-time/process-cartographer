import { CATEGORY_COLORS, CATEGORY_LABELS, type CityLayout } from "../layout/cityLayout.ts";

interface Props {
  layout: CityLayout;
  matchedIds: Set<string> | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEnter: (id: string) => void;
}

/**
 * Accessible, non-3D view of the current drill level (WCAG: the map is a lens,
 * not the only way in). Keyboard-operable rows; Enter/Space selects, and an
 * explicit Enter button drills into enterable buildings.
 */
export default function ZoneList({ layout, matchedIds, selectedId, onSelect, onEnter }: Props) {
  const rows = layout.buildings
    .filter((b) => matchedIds == null || matchedIds.has(b.id))
    .sort((a, b) => a.zone.label.localeCompare(b.zone.label));

  return (
    <div className="list-view" role="region" aria-label="Buildings at this level">
      <table className="wf-table">
        <thead>
          <tr>
            <th>Building</th>
            <th>Category</th>
            <th>Kind</th>
            <th>Contains</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr
              key={b.id}
              className={selectedId === b.id ? "selected" : ""}
              tabIndex={0}
              onClick={() => onSelect(b.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(b.id);
                }
              }}
            >
              <td>
                <span className="swatch sm" style={{ background: CATEGORY_COLORS[b.category] }} />
                {b.zone.label}
                <div className="muted mono small">{b.zone.summary}</div>
              </td>
              <td>{CATEGORY_LABELS[b.category]}</td>
              <td>{b.kind}</td>
              <td>{b.zone.children.length || "—"}</td>
              <td>
                {b.enterable && (
                  <button
                    className="linkish"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEnter(b.id);
                    }}
                  >
                    Enter ⤵
                  </button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">No buildings match the current search.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
