import { useEffect, useMemo, useState } from "react";
import CityScene from "./scene/CityScene.tsx";
import IngestPanel from "./ui/IngestPanel.tsx";
import DiagnosticsBar from "./ui/DiagnosticsBar.tsx";
import DetailPanel from "./ui/DetailPanel.tsx";
import Legend from "./ui/Legend.tsx";
import WorkflowList from "./ui/WorkflowList.tsx";
import { buildIR } from "./ingest/buildIR.ts";
import { computeCityLayout } from "./layout/cityLayout.ts";
import { matchWorkflows } from "./ui/search.ts";
import type { IngestedProject } from "./ingest/types.ts";
import type { IRGraph } from "./ir/schema.ts";

type ViewMode = "3d" | "list";

export default function App() {
  const [ir, setIr] = useState<IRGraph | null>(null);
  const [ingested, setIngested] = useState<IngestedProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>("3d");
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (mq) {
      setReducedMotion(mq.matches);
      const on = () => setReducedMotion(mq.matches);
      mq.addEventListener?.("change", on);
      return () => mq.removeEventListener?.("change", on);
    }
  }, []);

  const layout = useMemo(() => (ir ? computeCityLayout(ir) : null), [ir]);
  const matchedIds = useMemo(() => (ir ? matchWorkflows(ir, query) : null), [ir, query]);
  const selectedBuilding = useMemo(
    () => layout?.buildings.find((b) => b.id === selectedId) ?? null,
    [layout, selectedId],
  );

  function handleResult(next: IngestedProject) {
    setIngested(next);
    setError(null);
    setSelectedId(null);
    setQuery("");
    try {
      setIr(buildIR(next));
    } catch (err) {
      setIr(null);
      setError(`Failed to build the graph: ${(err as Error).message}`);
    }
  }

  if (!ir || !layout) {
    return (
      <div className="app hero-wrap">
        <IngestPanel onResult={handleResult} onError={setError} onBusy={setBusy} busy={busy} />
        {error && <div className="error-banner" role="alert">{error}</div>}
        <footer className="hero-foot">
          Static v1 · parses every path, system, and requirement/exception coverage. Runtime overlay is v2.
        </footer>
      </div>
    );
  }

  const matchCount = matchedIds ? matchedIds.size : layout.buildings.length;

  return (
    <div className="app">
      <header className="toolbar">
        <IngestPanel compact onResult={handleResult} onError={setError} onBusy={setBusy} busy={busy} />
        <div className="toolbar-controls">
          <input
            type="search"
            className="search"
            placeholder="Search systems, files, arguments, activities…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the map"
          />
          {query && (
            <span className="match-count">
              {matchCount}/{layout.buildings.length}
            </span>
          )}
          <div className="seg" role="group" aria-label="View mode">
            <button className={view === "3d" ? "active" : ""} onClick={() => setView("3d")}>
              3D map
            </button>
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
              List
            </button>
          </div>
          <label className="toggle" title="Reduce motion (disables auto-rotate)">
            <input type="checkbox" checked={reducedMotion} onChange={(e) => setReducedMotion(e.target.checked)} />
            Reduce motion
          </label>
        </div>
      </header>

      <DiagnosticsBar ir={ir} ingested={ingested} />
      {error && <div className="error-banner" role="alert">{error}</div>}

      <div className="stage">
        {view === "3d" ? (
          <CityScene
            layout={layout}
            selectedId={selectedId}
            matchedIds={matchedIds}
            reducedMotion={reducedMotion}
            onSelect={setSelectedId}
          />
        ) : (
          <WorkflowList layout={layout} matchedIds={matchedIds} selectedId={selectedId} onSelect={setSelectedId} />
        )}

        {view === "3d" && <Legend layout={layout} />}

        {selectedBuilding && (
          <DetailPanel building={selectedBuilding} ir={ir} onClose={() => setSelectedId(null)} onSelect={setSelectedId} />
        )}
      </div>

      {busy && <div className="busy-overlay">Loading…</div>}
    </div>
  );
}
