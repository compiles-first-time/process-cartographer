import { CATEGORY_COLORS, CATEGORY_LABELS, type CityLayout } from "../layout/cityLayout.ts";

interface Props {
  layout: CityLayout;
  matchedIds: Set<string> | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Accessible, non-3D view of the same graph (WCAG: the map is a lens, not the
 * only way in). A keyboard-navigable table; the tree/list is the screen-reader
 * path into the data.
 */
export default function WorkflowList({ layout, matchedIds, selectedId, onSelect }: Props) {
  const rows = layout.buildings
    .filter((b) => matchedIds == null || matchedIds.has(b.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  return (
    <div className="list-view" role="region" aria-label="Workflow list">
      <table className="wf-table">
        <thead>
          <tr>
            <th>Workflow</th>
            <th>Kind</th>
            <th>System</th>
            <th>Activities</th>
            <th>Invokes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const outgoing = b.workflow.activityCounts["InvokeWorkflowFile"] ?? 0;
            return (
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
                  {b.workflow.displayName || b.id}
                  <div className="muted mono small">{b.id}</div>
                </td>
                <td>{b.workflow.kind}</td>
                <td>{CATEGORY_LABELS[b.category]}</td>
                <td>{b.activityMass}</td>
                <td>
                  {outgoing}
                  {b.danglingInvokes > 0 && <span className="warn"> ⚡{b.danglingInvokes}</span>}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No workflows match the current search.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
