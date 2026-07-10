import { useEffect, useMemo, useState } from "react";
import CityScene from "./scene/CityScene.tsx";
import IngestPanel from "./ui/IngestPanel.tsx";
import DiagnosticsBar from "./ui/DiagnosticsBar.tsx";
import DetailPanel from "./ui/DetailPanel.tsx";
import Legend from "./ui/Legend.tsx";
import ZoneList from "./ui/WorkflowList.tsx";
import { buildIR } from "./ingest/buildIR.ts";
import { buildCityModel, type Zone } from "./model/cityModel.ts";
import { computeLayout } from "./layout/cityLayout.ts";
import { matchZones } from "./ui/search.ts";
import type { IngestedProject } from "./ingest/types.ts";
import type { IRGraph } from "./ir/schema.ts";

type ViewMode = "3d" | "list";

export default function App() {
  const [ir, setIr] = useState<IRGraph | null>(null);
  const [ingested, setIngested] = useState<IngestedProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stack, setStack] = useState<Zone[]>([]); // drill path; stack[0] = city root
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

  const current = stack[stack.length - 1] ?? null;
  const layout = useMemo(() => (current ? computeLayout(current.children, current.edges) : null), [current]);
  const matchedIds = useMemo(() => (current ? matchZones(current.children, query) : null), [current, query]);
  const selectedZone = useMemo(
    () => current?.children.find((c) => c.id === selectedId) ?? null,
    [current, selectedId],
  );

  function handleResult(next: IngestedProject) {
    setIngested(next);
    setError(null);
    setSelectedId(null);
    setQuery("");
    try {
      const nextIr = buildIR(next);
      setIr(nextIr);
      setStack([buildCityModel(nextIr)]);
    } catch (err) {
      setIr(null);
      setStack([]);
      setError(`Failed to build the graph: ${(err as Error).message}`);
    }
  }

  function enter(id: string) {
    const child = current?.children.find((c) => c.id === id);
    if (child && child.children.length > 0) {
      setStack((s) => [...s, child]);
      setSelectedId(null);
      setQuery("");
    }
  }

  function goToLevel(index: number) {
    setStack((s) => s.slice(0, index + 1));
    setSelectedId(null);
    setQuery("");
  }

  if (!ir || !current || !layout) {
    return (
      <div className="app hero-wrap">
        <IngestPanel onResult={handleResult} onError={setError} onBusy={setBusy} busy={busy} />
        {error && <div className="error-banner" role="alert">{error}</div>}
        <footer className="hero-foot">
          Static v1 · states, the Orchestrator, and external systems as buildings you can enter. Runtime overlay is v2.
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
            placeholder="Search this level — states, systems, workflows, arguments…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the current level"
          />
          {query && <span className="match-count">{matchCount}/{layout.buildings.length}</span>}
          <div className="seg" role="group" aria-label="View mode">
            <button className={view === "3d" ? "active" : ""} onClick={() => setView("3d")}>3D map</button>
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>List</button>
          </div>
          <label className="toggle" title="Reduce motion (disables auto-rotate)">
            <input type="checkbox" checked={reducedMotion} onChange={(e) => setReducedMotion(e.target.checked)} />
            Reduce motion
          </label>
        </div>
      </header>

      <DiagnosticsBar ir={ir} ingested={ingested} />

      <nav className="breadcrumb" aria-label="Drill-down path">
        {stack.map((z, i) => (
          <span key={z.id}>
            {i > 0 && <span className="crumb-sep">›</span>}
            <button className={`crumb${i === stack.length - 1 ? " current" : ""}`} onClick={() => goToLevel(i)} disabled={i === stack.length - 1}>
              {i === 0 ? "City" : z.label}
            </button>
          </span>
        ))}
        <span className="crumb-hint">· double-click a building to enter it</span>
      </nav>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <div className="stage">
        {view === "3d" ? (
          <CityScene
            layout={layout}
            selectedId={selectedId}
            matchedIds={matchedIds}
            reducedMotion={reducedMotion}
            onSelect={setSelectedId}
            onEnter={enter}
          />
        ) : (
          <ZoneList layout={layout} matchedIds={matchedIds} selectedId={selectedId} onSelect={setSelectedId} onEnter={enter} />
        )}

        {view === "3d" && <Legend layout={layout} />}

        {selectedZone && (
          <DetailPanel
            zone={selectedZone}
            ir={ir}
            onClose={() => setSelectedId(null)}
            onEnter={selectedZone.children.length > 0 ? () => enter(selectedZone.id) : undefined}
          />
        )}
      </div>

      {busy && <div className="busy-overlay">Loading…</div>}
    </div>
  );
}
