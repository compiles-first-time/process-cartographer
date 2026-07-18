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
import { annotateZone, type Annotation } from "./annotate/annotate.ts";
import type { IngestedProject } from "./ingest/types.ts";

type ViewMode = "3d" | "list";

export type AnnotationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; result: Annotation }
  | { status: "error"; error: string };

export default function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [ingested, setIngested] = useState<IngestedProject | null>(null);
  const [includeDirs, setIncludeDirs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [stack, setStack] = useState<Zone[]>([]); // drill path; stack[0] = city root
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>("3d");
  const [reducedMotion, setReducedMotion] = useState(false);
  // AI annotation overlay (ADR-0056): interpretation, never structure.
  const [apiKey, setApiKey] = useState(""); // memory-only, never persisted
  const [annotations, setAnnotations] = useState<Map<string, AnnotationState>>(new Map());

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

  function cityOf(next: Loaded): Zone {
    return next.kind === "uipath" ? buildCityModel(next.ir) : buildRepoCityModel(next.ir);
  }

  /** Rebuild the drill stack in a NEW city by following the old stack's zone ids. */
  function restoreStack(root: Zone, oldIds: string[]): Zone[] {
    const out = [root];
    for (const id of oldIds.slice(1)) {
      const next = out[out.length - 1].children.find((c) => c.id === id);
      if (!next || next.children.length === 0) break;
      out.push(next);
    }
    return out;
  }

  function present(next: Loaded, source: IngestedProject | null, preserveStack = false) {
    const root = cityOf(next);
    setLoaded(next);
    if (source) setIngested(source);
    setError(null);
    if (preserveStack && stack.length > 0) {
      const restored = restoreStack(root, stack.map((z) => z.id));
      setStack(restored);
      setSelectedId(null);
    } else {
      setStack([root]);
      setSelectedId(null);
      setQuery("");
    }
  }

  async function handleResult(next: IngestedProject) {
    setBusy(true);
    setIncludeDirs([]);
    setAnnotations(new Map());
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
      setIncludeDirs([]);
      setAnnotations(new Map());
      present(loadFromIRJson(jsonText), null);
      setIngested(null);
    } catch (err) {
      setError(`IR JSON rejected: ${(err as Error).message}`);
    }
  }

  /** On-demand inclusion: fetch/read an excluded directory and re-map (ADR-0055). */
  async function expandDirectory(dir: string) {
    if (!ingested) return;
    if (!ingested.expandDir) {
      setError("This source cannot be expanded on demand (IR-JSON loads carry no fetch capability). Re-ingest from GitHub, zip, or folder.");
      return;
    }
    setBusy(true);
    setProgress(`loading ${dir}…`);
    try {
      const extra = await ingested.expandDir(dir);
      const byPath = new Map((ingested.allFiles ?? []).map((f) => [f.path, f]));
      for (const f of extra) byPath.set(f.path, f); // text now present for expanded paths
      const nextIngested: IngestedProject = { ...ingested, allFiles: [...byPath.values()] };
      const nextInclude = [...includeDirs, dir];
      setIncludeDirs(nextInclude);
      const { browserSyntaxEnv } = await import("./repo/syntax/browserEnv.ts");
      present(await buildLoadedWithSyntax(nextIngested, browserSyntaxEnv, setProgress, nextInclude), nextIngested, true);
    } catch (err) {
      setError(`Could not include "${dir}": ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  /** Navigate the drill stack directly to a file building (import click-through). */
  function jumpToFile(path: string) {
    if (!loaded || stack.length === 0) return;
    const root = stack[0];
    const chain: Zone[] = [root];
    let cursor = root;
    for (;;) {
      const fileChild = cursor.children.find((c) => c.id === `file:${path}`);
      if (fileChild) {
        setStack(chain);
        setSelectedId(fileChild.id);
        return;
      }
      const next = cursor.children.find(
        (c) => c.kind === "district" && !c.excludedDir && c.id.startsWith("dir:") && (path === c.id.slice(4) || path.startsWith(c.id.slice(4) + "/")),
      );
      if (!next) return; // not in the rendered set (excluded/skipped)
      chain.push(next);
      cursor = next;
    }
  }

  /** AI annotation (ADR-0056): interpretation over computed facts — never structure. */
  async function annotate(zone: Zone) {
    if (!apiKey.trim()) return;
    if (loaded?.kind !== "repo") return;
    setAnnotations((m) => new Map(m).set(zone.id, { status: "loading" }));
    try {
      const result = await annotateZone({
        zone,
        ir: loaded.ir,
        allFiles: ingested?.allFiles ?? [],
        apiKey: apiKey.trim(),
      });
      setAnnotations((m) => new Map(m).set(zone.id, { status: "done", result }));
    } catch (err) {
      setAnnotations((m) => new Map(m).set(zone.id, { status: "error", error: (err as Error).message }));
    }
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
            <button className={`crumb${i === stack.length - 1 ? " current" : ""}`} onClick={() => {
              setStack((s) => s.slice(0, i + 1));
              setSelectedId(null);
              setQuery("");
            }} disabled={i === stack.length - 1}>
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
            onEnter={(id) => {
              const child = current.children.find((c) => c.id === id);
              if (child && child.children.length > 0) {
                setStack((s) => [...s, child]);
                setSelectedId(null);
                setQuery("");
              }
            }}
          />
        ) : (
          <ZoneList
            layout={layout}
            matchedIds={matchedIds}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onEnter={(id) => {
              const child = current.children.find((c) => c.id === id);
              if (child && child.children.length > 0) {
                setStack((s) => [...s, child]);
                setSelectedId(null);
                setQuery("");
              }
            }}
          />
        )}

        {view === "3d" && <Legend layout={layout} />}

        {selectedZone && (
          <DetailPanel
            zone={selectedZone}
            ir={loaded.kind === "uipath" ? loaded.ir : null}
            repoIr={loaded.kind === "repo" ? loaded.ir : null}
            onClose={() => setSelectedId(null)}
            onEnter={
              selectedZone.children.length > 0
                ? () => {
                    setStack((s) => [...s, selectedZone]);
                    setSelectedId(null);
                    setQuery("");
                  }
                : undefined
            }
            onExpandDir={ingested?.expandDir ? expandDirectory : undefined}
            onJumpFile={jumpToFile}
            annotation={annotations.get(selectedZone.id) ?? { status: "idle" }}
            onAnnotate={() => annotate(selectedZone)}
            apiKey={apiKey}
            onApiKey={setApiKey}
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
