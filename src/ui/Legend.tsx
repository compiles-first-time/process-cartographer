import { CATEGORY_COLORS, CATEGORY_LABELS, type CityLayout, type BuildingCategory } from "../layout/cityLayout.ts";

/** Legend of the categories actually present at the current drill level. */
export default function Legend({ layout }: { layout: CityLayout }) {
  const present = Array.from(new Set(layout.buildings.map((b) => b.category))) as BuildingCategory[];
  present.sort((a, b) => CATEGORY_LABELS[a].localeCompare(CATEGORY_LABELS[b]));
  if (present.length === 0) return null;
  return (
    <div className="legend" aria-label="Legend: building colors by category">
      {present.map((c) => (
        <div key={c} className="legend-row">
          <span className="legend-swatch" style={{ background: CATEGORY_COLORS[c] }} />
          <span>{CATEGORY_LABELS[c]}</span>
        </div>
      ))}
      <div className="legend-row legend-hint">
        <span>◎ ring = enterable · double-click to drill in</span>
      </div>
    </div>
  );
}
