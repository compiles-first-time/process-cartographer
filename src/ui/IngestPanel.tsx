import { useState } from "react";
import { ingestFromFolder } from "../ingest/fromFolder.ts";
import { ingestFromNupkg } from "../ingest/fromNupkg.ts";
import { ingestFromGithub } from "../ingest/fromGithub.ts";
import type { IngestedProject, IngestSource } from "../ingest/types.ts";

interface Props {
  onResult: (ingested: IngestedProject) => void;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
  busy: boolean;
  compact?: boolean; // toolbar mode (after first load) vs hero mode (initial)
}

const SAMPLE_REPO = "https://github.com/UiPath/ReFrameWork";

export default function IngestPanel({ onResult, onError, onBusy, busy, compact }: Props) {
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
            Map a UiPath REFramework automation as a 3D city — from a folder, a <code>.nupkg</code>, or a GitHub repo.
          </p>
        </>
      )}

      <div className="ingest-tabs" role="tablist" aria-label="Source type">
        {(["github", "nupkg", "folder"] as IngestSource[]).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={source === s}
            className={source === s ? "active" : ""}
            onClick={() => setSource(s)}
            disabled={busy}
          >
            {s === "github" ? "GitHub repo" : s === "nupkg" ? ".nupkg / .zip" : "Folder"}
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
              placeholder="GitHub token (optional — for private repos / higher rate limit)"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={busy}
              aria-label="GitHub token (optional)"
            />
            <div className="row">
              <button className="primary" disabled={busy || !url.trim()} onClick={() => run(() => ingestFromGithub(url, { token: token || undefined }))}>
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
              aria-label="Choose a .nupkg or .zip file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) run(() => ingestFromNupkg(f));
              }}
            />
            <p className="hint">A UiPath <code>.nupkg</code> is a zip — unpacked entirely in your browser.</p>
          </div>
        )}

        {source === "folder" && (
          <div className="stack">
            <input
              ref={setWebkitDir}
              type="file"
              multiple
              disabled={busy}
              aria-label="Choose a UiPath project folder"
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length) run(() => ingestFromFolder(files));
              }}
            />
            <p className="hint">Pick the folder that contains <code>project.json</code>. Files stay on your machine.</p>
          </div>
        )}
      </div>
    </div>
  );
}
