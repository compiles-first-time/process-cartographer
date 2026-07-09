// OTLP mapper (ADR-0051): Loom event-log records → OpenTelemetry Logs (OTLP/JSON).
//
// Zero-dependency, pure functions. Any OTel backend/collector can ingest Loom's
// audit trail via scripts/otel-export.mjs. The full OTel SDK / live push exporter
// is a deferred adopt-on-trigger (ADR-0049 pattern). Accurate to the OTLP Logs
// data model: BigInt-precise timeUnixNano, severity bands, typed AnyValue attrs.

// Severity bands (OTel spec): INFO 9-12, WARN 13-16, ERROR 17-20.
const SEV_INFO = [9, "INFO"];
const SEV_WARN = [13, "WARN"];
const SEV_ERROR = [17, "ERROR"];

// Non-payload envelope keys already represented elsewhere (or as resource attrs).
const SKIP_KEYS = new Set(["timestamp", "event_type", "kernel_version", "loom_version"]);

export function severityFor(ev) {
  const t = String(ev.event_type || "");
  if (t === "tool_result" && ev.exit_code != null && ev.exit_code !== 0) return SEV_ERROR;
  if (/error|fail/i.test(t)) return SEV_ERROR;
  if (ev.decision === "deny" || /attempted|missing|blocked|destructive|non_progressing/i.test(t)) return SEV_WARN;
  return SEV_INFO;
}

// OTLP AnyValue: strings→stringValue, int→intValue (string-encoded int64),
// float→doubleValue, bool→boolValue, else JSON string.
export function toAnyValue(v) {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { boolValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  if (v === null || v === undefined) return { stringValue: "" };
  return { stringValue: JSON.stringify(v) };
}

function attributesFrom(ev) {
  const out = [];
  for (const [k, v] of Object.entries(ev)) {
    if (SKIP_KEYS.has(k)) continue;
    out.push({ key: k, value: toAnyValue(v) });
  }
  return out;
}

// ISO-ms → uint64 nanoseconds, BigInt-precise (ms*1e6 exceeds MAX_SAFE_INTEGER).
export function toUnixNano(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "0";
  return (BigInt(ms) * 1000000n).toString();
}

export function toOtelLogRecord(ev) {
  const [severityNumber, severityText] = severityFor(ev);
  const tn = toUnixNano(ev.timestamp);
  return {
    timeUnixNano: tn,
    observedTimeUnixNano: tn,
    severityNumber,
    severityText,
    body: { stringValue: String(ev.event_type || "event") },
    attributes: attributesFrom(ev),
  };
}

export function toOtlpLogs(events, { serviceName = "loom", version = "0.2.0" } = {}) {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: serviceName } },
            { key: "service.version", value: { stringValue: version } },
            { key: "telemetry.sdk.name", value: { stringValue: "loom-otel-mapper" } },
          ],
        },
        scopeLogs: [
          {
            scope: { name: "loom.observatory", version },
            logRecords: (events || []).map(toOtelLogRecord),
          },
        ],
      },
    ],
  };
}
