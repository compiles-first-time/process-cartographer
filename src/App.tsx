import { useEffect, useMemo, useState } from "react";
import CityScene from "./scene/CityScene.tsx";
import IngestPanel from "./ui/IngestPanel.tsx";
import DiagnosticsBar from "./ui/DiagnosticsBar.tsx";
import RepoScorecard from "./ui/RepoScorecard.tsx";
import DetailPanel from "./ui/DetailPanel.tsx";
import Legend from "./ui/Legend.tsx";
import ZoneList from "./ui/WorkflowList.tsx";
import { buildLoadedWithSyntax, loadFromIRJson, type Loaded } from "./ingest/buildIR.ts";
import { buildCityModel, type Zone } from "./model/cityModel.ts";
import { buildRepoCityModel } from "./model/repoCityModel.ts";
import { computeLayout } from "./layout/cityLayout.ts";
import { matchZones } from "./ui/search.ts";
import type { IngestedProject } from "./ingest/types.ts";

type ViewMode = "3d" | "list";

export default function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [ingested, setIngested] = useState<IngestedProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
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

  function present(next: Loaded, source: IngestedProject | null) {
    setLoaded(next);
    setIngested(source);
    setError(null);
    setSelectedId(null);
    setQuery("");
    setStack([next.kind === "uipath" ? buildCityModel(next.ir) : buildRepoCityModel(next.ir)]);
  }

  async function handleResult(next: IngestedProject) {
    setBusy(true);
    try {
      // Syntax tier env is code-split — wasm loads only for repo ingests.
      const { browserSyntaxEnv } = await import("./repo/syntax/browserEnv.ts");
      present(await buildLoadedWithSyntax(next, browserSyntaxEnv, setProgress), next);
    } catch (err) {
      setLoaded(null);
      setStack([]);
      setError(`Failed to build the graph: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function handleIRJson(jsonText: string) {
    try {
      present(loadFromIRJson(jsonText), null);
    } catch (err) {
      setError(`IR JSON rejected: ${(err as Error).message}`);
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

  if (!loaded || !current || !layout) {
    return (
      <div className="app hero-wrap">
        <IngestPanel onResult={handleResult} onIRJson={handleIRJson} onError={setError} onBusy={setBusy} onProgress={setProgress} busy={busy} />
        {error && <div className="error-banner" role="alert">{error}</div>}
        {busy && (
          <div className="busy-overlay" role="status">
            <div className="busy-box">
              <div className="spinner" aria-hidden="true" />
              {progress ?? "Loading…"}
            </div>
          </div>
        )}
        <footer className="hero-foot">
          Structure is computed by real parsers — never generated. Anything unresolved is shown as unresolved (ADR-0055).
        </footer>
      </div>
    );
  }

  const matchCount = matchedIds ? matchedIds.size : layout.buildings.length;

  return (
    <div className="app">
      <header className="toolbar">
        <IngestPanel compact onResult={handleResult} onIRJson={handleIRJson} onError={setError} onBusy={setBusy} onProgress={setProgress} busy={busy} />
        <div className="toolbar-controls">
          <input
            type="search"
            className="search"
            placeholder={loaded.kind === "repo" ? "Search this level — files, dirs, languages…" : "Search this level — states, systems, workflows…"}
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

      {loaded.kind === "uipath" ? (
        <DiagnosticsBar ir={loaded.ir} ingested={ingested} />
      ) : (
        <RepoScorecard ir={loaded.ir} />
      )}

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
            ir={loaded.kind === "uipath" ? loaded.ir : null}
            onClose={() => setSelectedId(null)}
            onEnter={selectedZone.children.length > 0 ? () => enter(selectedZone.id) : undefined}
          />
        )}
      </div>

      {busy && (
        <div className="busy-overlay" role="status">
          <div className="busy-box">
            <div className="spinner" aria-hidden="true" />
            {progress ?? "Loading…"}
          </div>
        </div>
      )}
    </div>
  );
}
