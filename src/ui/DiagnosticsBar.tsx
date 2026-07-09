import { useState } from "react";
import type { IRGraph } from "../ir/schema.ts";
import type { IngestedProject } from "../ingest/types.ts";

interface Props {
  ir: IRGraph;
  ingested: IngestedProject | null;
}

/** Project summary + parse diagnostics; warnings are surfaced loudly (RISK-01). */
export default function DiagnosticsBar({ ir, ingested }: Props) {
  const [open, setOpen] = useState(false);
  const d = ir.diagnostics;
  const notes = ingested?.notes ?? [];
  const totalWarnings = d.warnings.length + notes.length;

  return (
    <div className="diagnostics">
      <div className="diag-stats">
        <strong>{ir.project.name}</strong>
        {ir.project.version && <span className="muted"> v{ir.project.version}</span>}
        <span className="pill">{d.workflowsParsed} workflows</span>
        <span className="pill">{d.invokeEdges} invokes</span>
        <span className="pill">{d.activitiesParsed} activities</span>
        {d.unresolvedInvokes > 0 && <span className="pill warn">{d.unresolvedInvokes} dynamic/unresolved</span>}
        {ingested && <span className="muted src">· {ingested.sourceLabel}</span>}
      </div>
      {totalWarnings > 0 && (
        <button className="diag-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          ⚠ {totalWarnings} note{totalWarnings === 1 ? "" : "s"} {open ? "▲" : "▼"}
        </button>
      )}
      {open && (
        <ul className="diag-list">
          {notes.map((n, i) => (
            <li key={`n${i}`}>{n}</li>
          ))}
          {d.warnings.map((w, i) => (
            <li key={`w${i}`}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
