#!/usr/bin/env node
// Export Loom's event log as OpenTelemetry Logs (OTLP/JSON) — ADR-0051.
// Zero-dep. Pipe to any OTel collector / OTLP-HTTP endpoint:
//   node scripts/otel-export.mjs [YYYY-MM-DD] | <your collector / curl to /v1/logs>
//
// Defaults to today's (UTC) event log.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "./hooks/_lib.mjs";
import { toOtlpLogs } from "../observatory/lib/otel.mjs";

const day = process.argv[2] || new Date().toISOString().slice(0, 10);
const file = path.join(PROJECT_ROOT, "memory", "event-log", `${day}.jsonl`);

const events = existsSync(file)
  ? readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
  : [];

const payload = toOtlpLogs(events, { serviceName: "loom", version: "0.2.0" });
process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
process.stderr.write(`[otel-export] ${events.length} event(s) from ${day} → OTLP logs\n`);
