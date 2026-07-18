import { useState } from "react";
import { ingestFromFolder } from "../ingest/fromFolder.ts";
import { ingestFromNupkg } from "../ingest/fromNupkg.ts";
import { ingestFromGithub } from "../ingest/fromGithub.ts";
import type { IngestedProject, IngestSource } from "../ingest/types.ts";

interface Props {
  onResult: (ingested: IngestedProject) => void;
  onIRJson: (jsonText: string) => void;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
  /** Streaming progress line for the loading overlay (null = clear). */
  onProgress?: (message: string | null) => void;
  busy: boolean;
  compact?: boolean; // toolbar mode (after first load) vs hero mode (initial)
}

const SAMPLE_REPO = "https://github.com/UiPath/ReFrameWork";

export default function IngestPanel({ onResult, onIRJson, onError, onBusy, onProgress, busy, compact }: Props) {
  const [source, setSource] = useState<IngestSource>("github");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");

  async function run(fn: () => Promise<IngestedProject>) {
    onBusy(true);
    try {
      onResult(await fn());
    } catch (err) {
      onError((err as Error).message || "Ingest failed.");
    } finally {
      onBusy(false);
      onProgress?.(null);
    }
  }

  const setWebkitDir = (el: HTMLInputElement | null) => {
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
    }
  };

  return (
    <div className={`ingest ${compact ? "compact" : "hero"}`}>
      {!compact && (
        <>
          <h1>process-cartographer</h1>
          <p className="tagline">
            Map ANY code repository — or a UiPath automation — as an explorable 3D city. From a GitHub URL,
            a <code>.zip</code>/<code>.nupkg</code>, or a local folder. All parsing runs in your browser.
          </p>
        </>
      )}

      <div className="ingest-tabs" role="tablist" aria-label="Source type">
        {(["github", "nupkg", "folder", "ir-json"] as IngestSource[]).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={source === s}
            className={source === s ? "active" : ""}
            onClick={() => setSource(s)}
            disabled={busy}
          >
            {s === "github" ? "GitHub repo" : s === "nupkg" ? ".zip / .nupkg" : s === "folder" ? "Folder" : "IR JSON"}
          </button>
        ))}
      </div>

      <div className="ingest-body">
        {source === "github" && (
          <div className="stack">
            <input
              type="text"
              placeholder="https://github.com/owner/repo  (or owner/repo, /tree/branch/subdir)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
              aria-label="GitHub repository URL"
            />
            <input
              type="password"
              placeholder="GitHub token (optional — private repos / higher rate limit; kept in memory only)"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={busy}
              aria-label="GitHub token (optional)"
            />
            <div className="row">
              <button
                className="primary"
                disabled={busy || !url.trim()}
                onClick={() =>
                  run(() =>
                    ingestFromGithub(url, {
                      token: token || undefined,
                      onProgress: (d, t2) => onProgress?.(`fetching ${d}/${t2} files…`),
                    }),
                  )
                }
              >
                {busy ? "Loading…" : "Map repo"}
              </button>
              <button
                className="ghost"
                disabled={busy}
                onClick={() => {
                  setSource("github");
                  setUrl(SAMPLE_REPO);
                  run(() => ingestFromGithub(SAMPLE_REPO));
                }}
              >
                Try the vanilla REFramework ↗
              </button>
            </div>
          </div>
        )}

        {source === "nupkg" && (
          <div className="stack">
            <input
              type="file"
              accept=".nupkg,.zip"
              disabled={busy}
              aria-label="Choose a .zip or .nupkg file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) run(() => ingestFromNupkg(f));
              }}
            />
            <p className="hint">Any repo zip (GitHub: Code → Download ZIP) or UiPath <code>.nupkg</code> — unpacked entirely in your browser.</p>
          </div>
        )}

        {source === "folder" && (
          <div className="stack">
            <input
              ref={setWebkitDir}
              type="file"
              multiple
              disabled={busy}
              aria-label="Choose a project folder"
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length) run(() => ingestFromFolder(files));
              }}
            />
            <p className="hint">Pick any project folder. Files stay on your machine; vendored dirs (node_modules, .git…) are pruned and disclosed.</p>
          </div>
        )}

        {source === "ir-json" && (
          <div className="stack">
            <input
              type="file"
              accept=".json"
              disabled={busy}
              aria-label="Choose an IR JSON file"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                onBusy(true);
                try {
                  onIRJson(await f.text());
                } catch (err) {
                  onError((err as Error).message);
                } finally {
                  onBusy(false);
                }
              }}
            />
            <p className="hint">A previously exported IR (schema-validated on load) — the interop seam for the companion CLI and CI artifacts.</p>
          </div>
        )}
      </div>
    </div>
  );
}
