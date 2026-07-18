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
import { annotateZone, buildContext, DEFAULT_MODEL, DEEPEN_MODEL, PROMPT_VERSION, type Annotation } from "./annotate/annotate.ts";
import { annotationKey, cacheGet, cachePut } from "./annotate/cache.ts";
import { blastRadius, shortestImportPath, type BlastRadius, type ImportPath } from "./model/graph.ts";
import { parseCoverage, type CoverageOverlay } from "./overlay/coverage.ts";
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
  // AI annotation overlay (ADR-0056): interpretation, never structure. Key is
  // memory-only by default; persistence is OPT-IN (ADR-0056 amendment).
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("pc-anthropic-key") ?? "");
  const [keyRemembered, setKeyRemembered] = useState(() => localStorage.getItem("pc-anthropic-key") != null);
  const [annotations, setAnnotations] = useState<Map<string, AnnotationState>>(new Map());
  // Blast radius (roadmap A1) + execution coverage overlay (E1).
  const [radius, setRadius] = useState<BlastRadius | null>(null);
  const [coverage, setCoverage] = useState<CoverageOverlay | null>(null);
  // Path A→B lighting (A3): arm an anchor file, then selecting a destination
  // lights the shortest resolved-import path between them.
  const [pathFrom, setPathFrom] = useState<string | null>(null);
  const [litPath, setLitPath] = useState<ImportPath | null>(null);

  function rememberKey(remember: boolean) {
    setKeyRemembered(remember);
    if (remember && apiKey.trim()) localStorage.setItem("pc-anthropic-key", apiKey.trim());
    else localStorage.removeItem("pc-anthropic-key");
  }

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

  // Blast-radius roles for the buildings at the CURRENT level (A1).
  const radiusByZone = useMemo(() => {
    if (!radius || !current) return null;
    const m = new Map<string, "self" | "up" | "down" | "both">();
    for (const z of current.children) {
      if (z.file) {
        const p = z.file.path;
        if (p === radius.file) m.set(z.id, "self");
        else {
          const u = radius.upstream.has(p);
          const d = radius.downstream.has(p);
          if (u && d) m.set(z.id, "both");
          else if (u) m.set(z.id, "up");
          else if (d) m.set(z.id, "down");
        }
      } else if (z.kind === "district" && !z.excludedDir && z.id.startsWith("dir:")) {
        const prefix = z.id.slice(4) + "/";
        const hasSelf = radius.file.startsWith(prefix);
        let u = false;
        let d = false;
        for (const p of radius.upstream) if (p.startsWith(prefix)) { u = true; break; }
        for (const p of radius.downstream) if (p.startsWith(prefix)) { d = true; break; }
        if (hasSelf) m.set(z.id, "self");
        else if (u && d) m.set(z.id, "both");
        else if (u) m.set(z.id, "up");
        else if (d) m.set(z.id, "down");
      }
    }
    return m;
  }, [radius, current]);

  // Path roles for zones at the CURRENT level (A3) — endpoints vs hops;
  // districts containing any path node light so the corridor reads from city level.
  const pathByZone = useMemo(() => {
    if (!litPath?.nodes || !current) return null;
    const nodes = new Set(litPath.nodes);
    const endpoints = new Set([litPath.nodes[0], litPath.nodes[litPath.nodes.length - 1]]);
    const m = new Map<string, "endpoint" | "hop">();
    for (const z of current.children) {
      if (z.file) {
        if (endpoints.has(z.file.path)) m.set(z.id, "endpoint");
        else if (nodes.has(z.file.path)) m.set(z.id, "hop");
      } else if (z.kind === "district" && !z.excludedDir && z.id.startsWith("dir:")) {
        const prefix = z.id.slice(4) + "/";
        let hasEndpoint = false;
        let hasHop = false;
        for (const p of nodes) {
          if (p.startsWith(prefix)) {
            if (endpoints.has(p)) hasEndpoint = true;
            else hasHop = true;
          }
        }
        if (hasEndpoint) m.set(z.id, "endpoint");
        else if (hasHop) m.set(z.id, "hop");
      }
    }
    return m;
  }, [litPath, current]);

  // A3: an armed anchor consumes the NEXT file selection as the destination.
  useEffect(() => {
    if (!pathFrom || loaded?.kind !== "repo") return;
    const dest = selectedZone?.file?.path;
    if (!dest || dest === pathFrom) return;
    setLitPath(shortestImportPath(loaded.ir, pathFrom, dest));
    setPathFrom(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedZone, pathFrom, loaded]);

  /** A3: arm/disarm the path anchor on the selected file. */
  function armPath(zone: Zone) {
    if (loaded?.kind !== "repo" || !zone.file) return;
    if (pathFrom === zone.file.path) {
      setPathFrom(null);
      return;
    }
    setPathFrom(zone.file.path);
    setLitPath(null);
    setRadius(null); // both lenses dim non-members — one at a time
  }

  // Coverage fraction (0..1) per zone at the current level (E1).
  const coverageByZone = useMemo(() => {
    if (!coverage || !current) return null;
    const m = new Map<string, number>();
    for (const z of current.children) {
      if (z.file) {
        const c = coverage.byFile.get(z.file.path);
        if (c) m.set(z.id, c.total > 0 ? c.covered / c.total : 0);
      } else if (z.kind === "district" && !z.excludedDir && z.id.startsWith("dir:")) {
        const prefix = z.id.slice(4) + "/";
        let cov = 0;
        let tot = 0;
        for (const [p, c] of coverage.byFile) {
          if (p.startsWith(prefix)) {
            cov += c.covered;
            tot += c.total;
          }
        }
        if (tot > 0) m.set(z.id, cov / tot);
      }
    }
    return m;
  }, [coverage, current]);

  // Global search across ALL levels (A2) — top 20, jump-to-zone on click.
  const globalResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || stack.length === 0) return [];
    const out: { id: string; label: string; kind: string; hint: string }[] = [];
    const walk = (z: Zone, depth: number) => {
      if (out.length >= 20 || depth > 8) return;
      for (const c of z.children) {
        if (out.length >= 20) return;
        const hay = [c.label, c.file?.path ?? "", ...(c.file?.symbols.map((s) => s.name) ?? [])]
          .join(" ")
          .toLowerCase();
        if (hay.includes(q)) {
          out.push({
            id: c.id,
            label: c.label,
            kind: c.kind,
            hint: c.file?.path ?? (c.id.startsWith("dir:") ? c.id.slice(4) : ""),
          });
        }
        walk(c, depth + 1);
      }
    };
    walk(stack[0], 0);
    return out;
  }, [query, stack]);

  function findAncestors(z: Zone, id: string, acc: Zone[]): Zone[] | null {
    for (const c of z.children) {
      if (c.id === id) return [...acc, z];
      const r = findAncestors(c, id, [...acc, z]);
      if (r) return r;
    }
    return null;
  }

  /** Jump the drill view to ANY zone (global search / symbol → its file). */
  function jumpToZone(id: string) {
    const root = stack[0];
    if (!root) return;
    let targetId = id;
    if (id.startsWith("sym:")) {
      const rest = id.slice(4);
      const lineSep = rest.lastIndexOf(":");
      const nameSep = rest.lastIndexOf(":", lineSep - 1);
      targetId = "file:" + rest.slice(0, nameSep);
    }
    const ancestors = findAncestors(root, targetId, []);
    if (!ancestors) return;
    setStack(ancestors);
    setSelectedId(targetId);
    setQuery("");
  }

  // Keyboard completion (A7): Esc = deselect/up, Enter = enter selected.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") {
        if (selectedId) setSelectedId(null);
        else if (stack.length > 1) {
          setStack((s) => s.slice(0, -1));
          setQuery("");
        }
      } else if (e.key === "Enter" && selectedZone && selectedZone.children.length > 0) {
        setStack((s) => [...s, selectedZone]);
        setSelectedId(null);
        setQuery("");
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectedZone, stack.length]);

  /** Toggle blast radius for the selected file (A1). */
  function toggleRadius(zone: Zone) {
    if (loaded?.kind !== "repo" || !zone.file) return;
    if (radius?.file === zone.file.path) setRadius(null);
    else {
      setRadius(blastRadius(loaded.ir, zone.file.path));
      setLitPath(null); // one dimming lens at a time (see armPath)
      setPathFrom(null);
    }
  }

  /** Load a coverage artifact (E1) — real execution data, painted on the city. */
  async function loadCoverage(file: File) {
    if (loaded?.kind !== "repo") return;
    try {
      const overlay = parseCoverage(await file.text(), loaded.ir.files.map((f) => f.path), file.name);
      setCoverage(overlay);
      setError(null);
    } catch (err) {
      setError("Coverage rejected: " + (err as Error).message);
    }
  }


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
    setRadius(null);
    setCoverage(null);
    setPathFrom(null);
    setLitPath(null);
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
      setRadius(null);
      setCoverage(null);
      setPathFrom(null);
      setLitPath(null);
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
    setRadius(null); // edges change after expansion — recompute on demand
    setPathFrom(null);
    setLitPath(null);
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

  /** AI annotation (ADR-0056): interpretation over computed facts — never structure.
   *  Cost discipline (roadmap C1-C3): content-hash cache; Haiku default; Sonnet
   *  on explicit "deepen"; the system prompt carries cache_control. */
  async function annotate(zone: Zone, deep = false) {
    if (!apiKey.trim()) return;
    if (loaded?.kind !== "repo") return;
    const model = deep ? DEEPEN_MODEL : DEFAULT_MODEL;
    setAnnotations((m) => new Map(m).set(zone.id, { status: "loading" }));
    try {
      const context = buildContext(zone, loaded.ir, ingested?.allFiles ?? []);
      const key = await annotationKey(model, PROMPT_VERSION, context);
      let result: Annotation | null = cacheGet(key);
      if (!result) {
        result = await annotateZone({
          zone,
          ir: loaded.ir,
          allFiles: ingested?.allFiles ?? [],
          apiKey: apiKey.trim(),
          model,
        });
        cachePut(key, result);
      }
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
          <div className="search-wrap">
            <input
              type="search"
              className="search"
              placeholder={loaded.kind === "repo" ? "Search the whole city — files, dirs, symbols…" : "Search this level — states, systems, workflows…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search"
            />
            {globalResults.length > 0 && (
              <div className="search-results" role="listbox">
                {globalResults.map((r) => (
                  <button key={r.id} className="search-result" onClick={() => jumpToZone(r.id)}>
                    <span className="sr-label">{r.label}</span>
                    <span className="sr-kind">{r.kind}</span>
                    {r.hint && <span className="sr-hint mono">{r.hint}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          {query && <span className="match-count">{matchCount}/{layout.buildings.length}</span>}
          {loaded.kind === "repo" && pathFrom && (
            <span className="pill cov-chip" title={pathFrom}>
              ◇ path from {pathFrom.split("/").pop()} — select the destination…
              <button className="icon-btn" onClick={() => setPathFrom(null)} aria-label="Cancel path anchor">✕</button>
            </span>
          )}
          {loaded.kind === "repo" && litPath && (
            <span
              className="pill cov-chip"
              title={litPath.nodes ? litPath.nodes.join(" → ") : `No resolved-import chain connects ${litPath.a} and ${litPath.b} in either direction`}
            >
              {litPath.nodes
                ? `◇ ${litPath.nodes[0].split("/").pop()} → ${litPath.nodes[litPath.nodes.length - 1].split("/").pop()} · ${litPath.nodes.length - 1} hop${litPath.nodes.length !== 2 ? "s" : ""}${litPath.direction === "b-imports-a" ? " (reverse: B imports A)" : ""}`
                : `◇ no static import path ${litPath.a.split("/").pop()} ↮ ${litPath.b.split("/").pop()}`}
              <button className="icon-btn" onClick={() => setLitPath(null)} aria-label="Clear lit path">✕</button>
            </span>
          )}
          {loaded.kind === "repo" &&
            (coverage ? (
              <span className="pill cov-chip" title={coverage.unmatched ? coverage.unmatched + " artifact entries matched no ingested file" : "all entries matched"}>
                ▦ {coverage.label} · {coverage.matched} files
                <button className="icon-btn" onClick={() => setCoverage(null)} aria-label="Clear coverage overlay">✕</button>
              </span>
            ) : (
              <label className="cov-btn" title="Load a coverage artifact (c8/Jest coverage-final.json or coverage.py JSON) — real execution data painted on the city">
                ▦ Coverage…
                <input
                  type="file"
                  accept=".json"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void loadCoverage(f);
                    e.target.value = "";
                  }}
                />
              </label>
            ))}
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
            radiusByZone={radiusByZone}
            pathByZone={pathByZone}
            coverageByZone={coverageByZone}
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
            onAnnotateDeep={() => annotate(selectedZone, true)}
            radiusActive={radius != null && selectedZone.file?.path === radius.file}
            radiusCounts={
              radius && selectedZone.file?.path === radius.file
                ? { upstream: radius.upstream.size, downstream: radius.downstream.size }
                : null
            }
            onToggleRadius={selectedZone.file ? () => toggleRadius(selectedZone) : undefined}
            pathArmed={pathFrom != null && selectedZone.file?.path === pathFrom}
            onArmPath={loaded.kind === "repo" && selectedZone.file ? () => armPath(selectedZone) : undefined}
            coverageInfo={
              coverage && selectedZone.file ? coverage.byFile.get(selectedZone.file.path) ?? null : null
            }
            apiKey={apiKey}
            onApiKey={setApiKey}
            keyRemembered={keyRemembered}
            onRememberKey={rememberKey}
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
