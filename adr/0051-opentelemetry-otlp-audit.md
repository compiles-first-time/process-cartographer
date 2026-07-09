# ADR-0051: OpenTelemetry-compatible audit (OTLP mapper, zero-dep)

**Status:** Accepted
**Date:** 2026-07-06
**Author:** Builder (Opus 4.8) — approved by Nick (autonomy mandate, 2026-07-06)
**Confidence:** [H] on the mapping; [M] on how far to take the live view (scoped)

---

## Context

[ADR-0048](./0048-north-star-model-agnostic-spec-and-adapters.md) names **OpenTelemetry** as the vendor-neutral audit/observability component (Phase 3 / Option 2). Loom already has a rich, append-only audit trail (the JSONL event log). The goal is to make that trail ingestible by *any* OTel backend (Grafana, Jaeger, Honeycomb, Datadog, …) without locking Loom to one vendor — and without breaking the zero-dep core ([ADR-0039](./0039-observatory-architecture.md)).

## Decision

**Emit the event log as OpenTelemetry Logs in OTLP/JSON via a zero-dependency mapper.**

- `observatory/lib/otel.mjs` — pure functions mapping a Loom event → an OTLP `LogRecord`, and a list of events → a full OTLP `resourceLogs` payload. Accurate to the OTLP Logs data model: `timeUnixNano` (BigInt-precise), `severityNumber`/`severityText`, `body`, typed `attributes`, resource `service.name`.
- `scripts/otel-export.mjs` — reads a day's event log and prints OTLP/JSON to stdout, so any OTel collector / `otlp` HTTP endpoint can ingest Loom's audit trail: `node scripts/otel-export.mjs [YYYY-MM-DD] | <your collector>`.
- **Deferred (adopt-on-trigger, per [ADR-0049](./0049-policy-engine-native-first.md)):** the full OpenTelemetry SDK + a live push exporter (OTLP/gRPC or HTTP) — pulled in as an *adapter* dependency only when a real collector deployment needs streaming, not batch export. Trigger: a production deployment with an OTel backend.
- **Follow-on:** the Observatory rendering *from* an OTLP source (the "Observatory becomes an OTel view" half of Option 2). v1 makes the data OTel-*compatible*; the live view is a later increment.

## Evidence basis

> Required v0.4+ per [LR-05](../constitution/local-rules.md#lr-05).

- **Primary:** the OpenTelemetry Logs Data Model + OTLP/JSON spec (severity 1–24 bands; `AnyValue` typing: `stringValue`/`intValue`(string int64)/`doubleValue`/`boolValue`; `timeUnixNano` uint64). `[institutional][H]`
- **Corroborating:** OTel is CNCF-graduated and the de-facto vendor-neutral telemetry standard; batch OTLP/JSON export is ingestible by all major backends. `[institutional][H]`; ADR-0039 zero-dep constraint `[internal][H]`.
- **What would change this call:** a production deployment needing live streaming → adopt the OTel SDK exporter (the deferred trigger).

## Consequences

**Locks in:** vendor-neutral audit — Loom's trail exports to any OTel backend, zero-dep. Precise timestamps (BigInt nanos) + standard severity/attributes.

**Locks out:** nothing — the JSONL log remains the source of truth; OTLP is an additive projection.

**Migration path:** if the mapper is wrong for a backend, it's a pure function with tests — fix in one place. The live SDK push supersedes batch export when triggered.

## Alternatives considered

- **Adopt the OTel SDK now.** Rejected for v1: a dependency + collector infra before any backend consumes it; batch export covers audit needs zero-dep.
- **Bespoke log format.** Rejected: OTLP *is* the vendor-neutral standard; inventing one re-creates the lock-in we're avoiding.

## Affects / Affected by

**Affects:** `observatory/lib/otel.mjs` (+ test), `scripts/otel-export.mjs`, `layers/L6-observability.md` (audit is OTel-exportable), `layers/L9-observatory.md` (future OTel view).
**Affected by:** `adr/0048` (OTel is the audit component), `adr/0039` (zero-dep), `adr/0049` (adopt-heavy-deps-on-trigger), `constitution/kernel-v6.md` Rule 22 (every action emits a trace).

## References

- OpenTelemetry Logs Data Model + OTLP/JSON specification `[institutional][H]`
- ADR-0048 (north star), ADR-0039 (Observatory zero-dep), ADR-0049 (native-first)
