---
name: monitoring
summary: Uptime + APM + RUM — Better Stack, Datadog, Vercel Analytics, OpenTelemetry. Distinct from error-tracking; this covers performance + availability.
tier: bundled
context_budget: 16000
tools: [Read, Glob, Grep, Edit, Write]
verifier_type: exit_code
---

# monitoring specialist

> Bundled per [ADR-0023](../../../../adr/0023-specialist-registry.md). Failure modes per [ADR-0022](../../../../adr/0022-xlsx-docs-convention.md).

## Role + scope

Performance + availability monitoring: uptime probes, APM (request traces, slow-query detection), RUM (Core Web Vitals, real-user latency), dashboard setup, on-call alert routing. Distinct from `error-tracking` (which handles exceptions).

When to invoke: prompts about "uptime", "latency", "APM", "Core Web Vitals", "Datadog", "Better Stack", "Grafana", "OpenTelemetry", "tracing".

## Tool scope

- Read / Glob / Grep across whole repo.
- Edit / Write scoped to `lib/monitoring/**`, `instrumentation.ts`, alert config files, dashboards-as-code.

## Failure modes

| ID | Type | Framework Location | Usecase | Assets / Cred | Input Source | Expected Input | Expected Output | Input Format | Output Format | Next Step | Justifications |
|---|---|---|---|---|---|---|---|---|---|---|---|
| MON-EX-01 | BE | Configure | Alert thresholds set so tight that pager fires hourly | Alert config | Config review | Threshold values | `mon.alert_storm_risk` event | Numbers | Recommendation | Recommend SLO-based alerting (burn-rate thresholds) over raw threshold alerting; surface Google SRE workbook ch.5 reference | Alert fatigue is the #1 cause of on-call burnout (Google SRE workbook ch.5). Burn-rate alerts on a stated SLO are the documented antidote |
| MON-EX-02 | SE | Configure | OTel collector unreachable | Collector | Network | OTel spans | `mon.collector_unreachable` event | gRPC / HTTP | Network error | Drop spans (do NOT block the app's hot path on telemetry); emit `mon.spans_dropped` metric locally for retrospective tuning | Telemetry must not affect application latency. Drop-on-failure with local accounting is the OpenTelemetry "data quality" guidance |
| MON-EX-03 | BE | Configure | RUM enabled without consent gating in a GDPR-relevant region | RUM SDK | Config review | SDK init + region | `mon.rum_consent_missing` event | Config | Boolean | Refuse to ship; require consent-mode integration or region-conditional disable | RUM SDKs typically set cookies and capture user behavior; this is regulated by ePrivacy Directive in the EU/UK. Shipping without consent is a regulatory liability |

## Response shape

Per [ADR-0032 §C](../../../../adr/0032-deployment-hardening.md), this specialist treats response bodies as authoritative over process exit codes / SDK return values for any monitoring vendor it invokes.

### OTel Collector OTLP export (`/v1/traces`, `/v1/metrics`)

- **Format**: protobuf or JSON over gRPC / HTTP
- **Authoritative fields**: gRPC status code; HTTP body `partial_success.rejected_spans` count + `error_message`
- **Success criteria**: HTTP 200 / gRPC OK AND `rejected_spans === 0`
- **Failure criteria**: any non-zero `rejected_spans`; HTTP 4xx/5xx; gRPC non-OK. **MON-EX-02**: unreachable collector → SDK drops + records locally (do NOT propagate error to app hot path)
- **Vendor docs**: [OTLP spec](https://opentelemetry.io/docs/specs/otlp/)

### Datadog APM (`POST /api/v2/intake`, `dd-trace` library)

- **Format**: JSON (intake API); SDK runtime is fire-and-forget
- **Authoritative fields**: HTTP 202 (Datadog acceptance); SDK internal metrics: `dogstatsd.flush_count`, `agent.connection_error`
- **Success criteria**: HTTP 202 from intake; agent connection metrics show no errors
- **Failure criteria**: HTTP 4xx with `errors[]`; agent connection error count increasing
- **Vendor docs**: [Datadog APM API](https://docs.datadoghq.com/api/latest/tracing/)

### Better Stack uptime check API

- **Format**: JSON
- **Authoritative fields**: `data.id` (success), `data.attributes.url`, `errors[].detail` on failure
- **Success criteria**: HTTP 200/201 AND `data.id` present
- **Failure criteria**: HTTP 4xx with `errors` array
- **Vendor docs**: [Better Stack API](https://betterstack.com/docs/uptime/api/)

### Vercel Analytics / Speed Insights

- **Format**: SDK-only (no public API for ingestion); dashboard-only inspection
- **Authoritative success signal**: dashboard shows events within 5 minutes of deploy
- **Failure criteria**: no events after deploy → verify SDK initialization (often the result of CSP blocking the analytics domain — typical anti-pattern)
- **Vendor docs**: [Vercel Speed Insights](https://vercel.com/docs/speed-insights)

### Grafana Cloud (Prometheus remote_write, Loki push API, Tempo OTLP)

- **Format**: protobuf (Prom) / JSON / OTLP
- **Authoritative fields**: HTTP 204 (Prom remote_write success); 200 (Loki / Tempo); error body on 4xx with `error.code`
- **Success criteria**: HTTP 2xx
- **Failure criteria**: HTTP 4xx (especially 429 = rate-limited; treat as retryable with backoff per Prom remote_write semantics); 5xx
- **Vendor docs**: [Prom remote_write](https://prometheus.io/docs/concepts/remote_write_spec/)

### Internal contract (what THIS specialist commits to returning)

When invoked, returns:
- Provider chosen + rationale + cost projection
- SLO declarations (per service / endpoint)
- Burn-rate alert config (MON-EX-01 — never raw-threshold-only)
- Consent gating strategy if RUM is included (MON-EX-03)
- OTel-to-vendor mapping
- Failure-mode IDs (MON-EX-*) the implementation guards against

## Decline triggers

- **Self-hosted observability stack design** → escalate to EAC; v0.4 covers SaaS providers + OTel-to-vendor.

## Evidence basis

- **Primary:** OpenTelemetry specification (otel.io). `[institutional][H]`
- **Corroborating:**
  - Google SRE Workbook ch. 5 (Alerting on SLOs). `[institutional][H]`
  - Vendor docs (Datadog, Better Stack, Vercel Analytics, Grafana Cloud). `[vendor][H]`
- **What would change this call:** OTel spec major version breaking change.

## Runtime counterpart

[`../../../../.claude/agents/monitoring.md`](../../../../.claude/agents/monitoring.md).
