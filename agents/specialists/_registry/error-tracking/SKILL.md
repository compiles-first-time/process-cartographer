---
name: error-tracking
summary: Exception monitoring — Sentry, Honeycomb, Datadog. SDK install, source maps, breadcrumbs, PII scrubbing, alert routing.
tier: bundled
context_budget: 16000
tools: [Read, Glob, Grep, Edit, Write]
verifier_type: exit_code
---

# error-tracking specialist

> Bundled per [ADR-0023](../../../../adr/0023-specialist-registry.md). Failure modes per [ADR-0022](../../../../adr/0022-xlsx-docs-convention.md). Consults the [MCP-vs-CLI capability matrix](../../../../tools/mcp-cli-capability-matrix.md) ([ADR-0033](../../../../adr/0033-mcp-vs-cli-capability-matrix.md)) before choosing MCP vs CLI for SDK / source-map operations.

## Role + scope

Application exception / error tracking: SDK installation (Sentry / Honeycomb / Datadog), source-map upload at build time, breadcrumb configuration, PII scrubbing, alert routing. Distinct from `monitoring` (uptime / RUM / APM).

When to invoke: prompts about "Sentry", "error tracking", "exception monitoring", "source maps", "stack traces".

## Tool scope

- Read / Glob / Grep across whole repo.
- Edit / Write scoped to `instrumentation.ts`, `sentry.client.config.ts`, `sentry.server.config.ts`, build config, CI for source-map upload.

## Failure modes

| ID | Type | Framework Location | Usecase | Assets / Cred | Input Source | Expected Input | Expected Output | Input Format | Output Format | Next Step | Justifications |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ERR-EX-01 | BE | Configure | PII scrubbing not enabled on the SDK | SDK config | Config review | SDK init options | `err.no_pii_scrubbing` event | Config | Boolean | Refuse to ship without `beforeSend` / `sendDefaultPii: false`; surface GDPR / CCPA implications to the user | Error trackers capture stack traces + breadcrumbs that often include user emails, request bodies, etc. Shipping without scrubbing creates a regulatory liability and an exfiltration risk. The default-on stance is the standard SDK guidance (Sentry's "PII data" doc) |
| ERR-EX-02 | SE | Build | Source-map upload fails during CI (auth token missing or invalid) | Sentry / Datadog auth token | CI build step | Source maps + auth | `err.sourcemap_upload_failed` event | Files | System.Exception | Do NOT fail the build over this; surface a warning + queue the upload for the next run | Failing the build over a transient observability-tool outage prevents valid releases. The trace will still appear in the tracker as unminified; degraded but not lost |
| ERR-EX-03 | BE | Configure | Sampling rate set to 1.0 in production for a high-traffic app | SDK config | Config review | `tracesSampleRate` | `err.full_sampling_warning` event | Float | Recommendation | Recommend tiered sampling (`tracesSampler` function); surface cost projection from vendor pricing | Full sampling at scale produces eye-watering bills (Sentry / Datadog / Honeycomb all bill by event). Tiered sampling — 100% for errors, 10% for non-error transactions, 1% for `GET /healthz`-style — is the documented pattern |

## Response shape

Per [ADR-0032 §C](../../../../adr/0032-deployment-hardening.md), this specialist treats response bodies as authoritative over process exit codes for any external tool it invokes.

### `sentry-cli sourcemaps upload` / `sentry-cli releases new`

- **Format**: text by default; JSON via `--log-format=json`
- **Authoritative fields**: with JSON — `success` (boolean), `release.version`, `artifacts.uploaded` count, `error.message`
- **Success criteria**: exit 0 AND (`success === true` if JSON) AND uploaded artifact count matches local file count
- **Failure criteria**: exit ≠ 0; stderr contains `error:` / `auth`/`token` patterns. **Specifically for ERR-EX-02**: missing or invalid `SENTRY_AUTH_TOKEN` produces "permission denied" → degrade-not-fail per the failure mode policy
- **Vendor docs**: [Sentry CLI](https://docs.sentry.io/cli/)

### Datadog `datadog-ci sourcemaps upload` / `datadog-ci tag`

- **Format**: text by default; some commands support `--json` for stdout JSON
- **Authoritative fields**: exit code is meaningful for Datadog-CI (well-behaved); stdout contains `Success` / `Error` lines + count
- **Success criteria**: exit 0 AND stdout contains `Uploaded` count line
- **Failure criteria**: exit ≠ 0; stderr `[error]` lines; auth token missing
- **Vendor docs**: [datadog-ci](https://docs.datadoghq.com/serverless/libraries_integrations/cli/)

### Honeycomb (`hny build` / Honeycomb Marker API)

- **Format**: JSON
- **Authoritative fields**: `id` (success), `error_code`, `error_message`
- **Success criteria**: HTTP 2xx AND `id` present
- **Failure criteria**: HTTP 4xx/5xx with `error_code`
- **Vendor docs**: [Honeycomb Markers API](https://docs.honeycomb.io/api/tag/Markers)

### SDK runtime success signals (Sentry / Datadog / Honeycomb client SDKs)

- **Sentry**: `Sentry.captureException()` returns an event-ID string. Empty string = scrubbed / sampled-out. Not a failure per se — distinguish from connectivity failure via the SDK's `beforeSend` return-null path
- **Datadog browser-rum**: `datadogRum.addError()` returns void. Confirm via dashboard or API query after deploy
- **Honeycomb (`@honeycombio/opentelemetry-web`)**: OpenTelemetry span — success = span exported (visible via `BatchSpanProcessor` internal events) or via API query

### Internal contract (what THIS specialist commits to returning)

When invoked, returns:
- Provider chosen + rationale
- PII-scrubbing strategy (ERR-EX-01) — concrete `beforeSend` snippet
- Sampling policy (ERR-EX-03) — tiered rates with rationale
- CI integration design (source-map upload step, with degrade-not-fail per ERR-EX-02)
- Failure-mode IDs (ERR-EX-*) the implementation guards against

## Decline triggers

- **In-house custom error tracker** → escalate to EAC.
- **Tracking that captures full request bodies without PII scrubbing review** → block; LR-03-adjacent.

## Evidence basis

- **Primary:** Sentry / Datadog / Honeycomb SDK docs. `[vendor][H]`
- **Corroborating:**
  - OWASP "Logging Cheat Sheet" — what to / not to log. `[institutional][H]`
  - GDPR Art. 5 §1(c) — data minimization. `[institutional][H]`
- **What would change this call:** regulatory regime change (e.g., a new state privacy law mandating opt-in for error capture).

## Runtime counterpart

[`../../../../.claude/agents/error-tracking.md`](../../../../.claude/agents/error-tracking.md).
