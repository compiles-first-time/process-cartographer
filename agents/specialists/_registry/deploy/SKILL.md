---
name: deploy
summary: Deployment to common runtimes — Vercel, Netlify, Fly.io, Render. Configures `tools/runtime.yaml`, wires CI, verifies post-deploy health.
tier: bundled
context_budget: 16000
tools: [Read, Glob, Grep, Edit, Write]
verifier_type: exit_code
---

# deploy specialist

> Bundled per [ADR-0023](../../../../adr/0023-specialist-registry.md). Failure modes per [ADR-0022](../../../../adr/0022-xlsx-docs-convention.md). Complements the Loom deploy primitive at `scripts/deploy.{sh,ps1}` (ADR-0019). Hardened per [ADR-0032](../../../../adr/0032-deployment-hardening.md) — AnonForum session 2026-05-21 findings. Distinct from the `provisioning` specialist ([ADR-0035](../../../../adr/0035-provisioning-specialist-and-playbooks.md)): deploy ships code to a running runtime; provisioning creates the runtime.

## Role + scope

Configures runtime-specific deployment for a project: writes `tools/runtime.yaml`, sets up domain mapping, wires environment variables, configures CI deploy hooks, verifies post-deploy health checks. Does NOT replace `scripts/deploy.sh` — it *configures* that wrapper.

When to invoke: prompts mentioning specific runtimes (Vercel, Netlify, Fly, Render, Railway, Cloudflare Pages) or "configure deployment", "domain mapping", "environment variables".

## Tool scope

- Read / Glob / Grep across whole repo.
- Edit / Write scoped to `tools/runtime.yaml`, `.env.example`, CI config (`.github/workflows/`, `vercel.json`, `netlify.toml`, `fly.toml`).
- Never write secret values; reference env vars by name (LR-03).

## Required pre-flight (per [ADR-0032 §B](../../../../adr/0032-deployment-hardening.md))

Before triggering any platform `deploy`, `provision`, or `create` action, this specialist **MUST** emit a `pre_flight_quota_check` event as the first audit-log line. The check verifies, against the platform's usage / quota / billing API:

1. **Payment method on file** (or sufficient free credit for the operation).
2. **Relevant quota not at zero** — for Vercel: build minutes; for Supabase: database hours + bandwidth; for Fly: machines + bandwidth; for AWS: per-service service quotas.
3. **Account not in a hard-suspended state** (some platforms continue serving reads while blocking writes — distinguishable from auth revocation only via the billing endpoint).

If any check fails, surface "you need to add a payment method / upgrade plan" with the **exact dashboard URL** before attempting the platform operation. Do NOT retry until the user confirms the quota state is fixed.

**Skipping this pre-flight on a billable platform is an LR-04 violation** under the `external_service_setup` category. The Loom `permissions-classifier.mjs` recognizes any `*-deploy`, `*-provision`, `*-create` action against a known billable platform as requiring it.

## Required wait-for-terminal-state discipline (per [ADR-0032 §A](../../../../adr/0032-deployment-hardening.md))

When waiting for a deploy to complete, this specialist MUST use [`scripts/lib/wait-for-deploy.mjs`](../../../../scripts/lib/wait-for-deploy.mjs) — never an ad-hoc `until grep ...` loop. The primitive's three-outcome model (`succeeded` / `failed` / `non_progressing`) is the contract; treating silence as success is exactly the AnonForum failure mode (Finding 3 in ADR-0032).

Adding a new platform = enumerate its states in `TERMINAL_STATES[platform]` (succeeded / failed / in_progress / non_progressing) and cite the platform's state-machine documentation. Defaults: 5 min stall threshold, 20 min in-progress timeout.

## Response-body discipline (per [ADR-0032 §C](../../../../adr/0032-deployment-hardening.md))

Cloud-platform CLIs (`vercel`, `gh`, `supabase`, `flyctl`, `netlify`, `render`) routinely exit 0 with an error body. This specialist treats response-body parsing as authoritative over process exit codes. Concretely:

- Capture stdout and stderr separately
- Parse the captured output as JSON (or the documented response shape)
- Treat the parsed `status` / `state` / `error` field as the source of truth
- Use the exit code as one signal among several — never trust it alone

## Failure modes

| ID | Type | Framework Location | Usecase | Assets / Cred | Input Source | Expected Input | Expected Output | Input Format | Output Format | Next Step | Justifications |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DEPLOY-EX-01 | SE | Configure | Runtime CLI not installed (`vercel`, `fly`, etc.) | Local PATH | Shell probe | Working CLI | Missing-binary error | Process | System.Exception | Print install command for the user; do not auto-install | Auto-installing third-party CLIs is invasive; the user should consent to which version + auth state they pick up |
| DEPLOY-EX-02 | BE | Configure | `post_deploy_url_pattern` produced by config doesn't match the runtime's actual stdout shape | Runtime docs | Test deploy | Regex against stdout | URL captured by `scripts/deploy.mjs` | String | Maybe-null URL | Fall back to "deployment succeeded; URL not captured" rather than failing; record the actual stdout sample to lessons-learned for next time | The regex is best-effort. Reporting "success without URL" beats failing a working deploy on a parser miss |
| DEPLOY-EX-03 | SE | Verify | Post-deploy health check returns 5xx (deploy succeeded but app crashes on boot) | Deployed URL | HTTP probe | GET / | `deploy.health_check_failed` event | HTTP | HTTP status | Emit `deployment_failed_health_check` event; surface the response body excerpt to the user; do NOT auto-rollback (user must decide) | Auto-rollback is per-runtime; doing it generically could mis-target. Surfacing the failure with diagnostic context lets the user (or `rollback` specialist in a future PR) decide |
| DEPLOY-EX-04 | BE | Pre-flight | Platform plan has 0 quota allocated AND no payment method on file (the AnonForum case) | Platform billing API | Pre-flight call | Account state | `pre_flight_quota_check` event + `quota_exhausted` outcome | HTTP | Structured | HALT; surface "your <platform> plan has 0 quota; visit <exact dashboard URL> to add a payment method or upgrade." Do NOT proceed with deploy. Do NOT retry until user confirms fix | Six deploys silently failed in the AnonForum session because the platform returned `"reason": "deploy_failed", "message": "Not authorized"` — looks like an auth problem but is actually billing. Catching this pre-flight saves debugging spirals. ADR-0032 §B |
| DEPLOY-EX-05 | BE | Diagnose auth failure | WRITE operation fails with "Not authorized" but READ operation succeeds with same token | Platform CLI | Comparison probe | `<cli> ls` works, `<cli> deploy` fails | Diagnosis: "almost certainly quota/billing, not auth revocation" | Process | Structured | Check the platform's billing/quota endpoint BEFORE recommending re-auth. If quota is exhausted: see DEPLOY-EX-04. If quota is fine: only THEN suggest `<platform> logout && <platform> login` (device-code scope-drop recovery, DEPLOY-EX-06) | Platforms collapse permission-denied and budget-exhausted into the same HTTP status + message. Re-authenticating burns 5+ minutes without fixing the real problem. The asymmetry — reads work, writes don't — is the diagnostic signal. ADR-0032 §B + Finding 4 |
| DEPLOY-EX-06 | BE | Recover device-code auth | Device-code CLI (`vercel login`) issued READ scope but DEPLOY scope dropped between sessions | CLI auth state | User reports `vercel ls` works, `vercel deploy` fails | Auth scope mismatch | `auth.write_scope_dropped` event | Process | Recovery command | Run `<platform> logout && <platform> login` as the FIRST diagnostic when read-works/write-fails AND quota is verified healthy. Do NOT advise this before checking quota (DEPLOY-EX-05) — re-auth on a quota issue wastes user time | Device-code OAuth flows can issue persistent read tokens but session-scoped write tokens. Vercel CLI is a known case (AnonForum 2026-05-21). The logout/login refresh is cheap; the wrong-diagnosis cost (chasing imaginary auth issues when the problem is billing) is high. ADR-0032 §D + Finding 2 |
| DEPLOY-EX-07 | SE | Verify CLI outcome | CLI exits 0 with `"status": "error"` in response body | Captured stdout/stderr | Post-run parse | Process exit + captured output | Parsed structured result | Process + Text | Structured | Treat response-body `status` field as authoritative. Exit code is one signal; absence of error in body is one signal; both must agree to declare success | `vercel deploy`, `gh pr create`, `supabase functions deploy` all routinely exit 0 on operations that returned a structured error. Trusting exit code alone declared 6 failed AnonForum deploys "successful" in the event log. ADR-0032 §C + Finding 5 |
| DEPLOY-EX-08 | SE | Wait for terminal state | Deploy reaches non-terminal state (`UNKNOWN`, `BUILDING` for too long, or no observation for too long) | Platform status API or CLI stream | Wait loop | Streaming status | Terminal outcome `non_progressing` | Stream | Structured outcome | Use [`scripts/lib/wait-for-deploy.mjs`](../../../../scripts/lib/wait-for-deploy.mjs) — its three-outcome model treats non-progressing as a first-class outcome with a loud `onProgress` notification. Do NOT roll your own `until grep ... ; do sleep ...; done` — that's the AnonForum failure mode | A naive wait loop hung the AnonForum session for 12 hours on Vercel's `UNKNOWN` state. The primitive enumerates terminal states per platform + has stall + in-progress-timeout detectors + surfaces non-progressing with a diagnostic message. ADR-0032 §A + Finding 3 |

## Response shape

Concrete shapes per CLI/MCP this specialist drives. The "Response-body discipline" section above is the WHY (ADR-0032 §C); this section is the WHAT — the parseable contract for each surface. Deviations are failure-mode triggers (specifically DEPLOY-EX-07).

### `vercel deploy` / `vercel inspect <url-or-id>`

- **Format**: `vercel deploy` outputs text by default; `--json` (and `inspect --json`) yields JSON
- **Authoritative fields** (JSON): `state` (READY / ERROR / BUILDING / QUEUED / CANCELED / UNKNOWN — see TERMINAL_STATES.vercel), `aliasError`, `errorMessage`, `readyState`
- **Success criteria**: `state === "READY"` AND no `errorMessage`. **Do NOT** treat exit 0 alone as success (DEPLOY-EX-07; AnonForum Finding 5)
- **Failure criteria**: `state` in `{ERROR, CANCELED}`; OR `state === "UNKNOWN"` (DEPLOY-EX-08 — `non_progressing` per ADR-0032 §A); OR `errorMessage` non-empty
- **Vendor docs**: [Vercel deployment states](https://vercel.com/docs/deployments/states)

### `netlify deploy` / `netlify status`

- **Format**: text by default; `--json` for JSON
- **Authoritative fields**: `state` (READY / CURRENT / ERROR / REJECTED / PROCESSING / PREPARING / UPLOADING / UPLOADED / ENQUEUED / NEW), `deploy_url`, `error_message`
- **Success criteria**: `state` in `{READY, CURRENT}` AND no `error_message`
- **Failure criteria**: `state` in `{ERROR, REJECTED}`; `state === "NEW"` after threshold → non_progressing
- **Vendor docs**: [Netlify deploys API](https://docs.netlify.com/api/get-started/#deploys)

### `flyctl deploy` / `flyctl status`

- **Format**: text with state markers (e.g., `==> Status: ...`); JSON via `--json`
- **Authoritative fields**: `Status` (running / pending / succeeded / failed / dead / cancelled), `Hostname`, latest release version
- **Success criteria**: `Status` in `{running, succeeded}` for the release; new release version > previous
- **Failure criteria**: `Status` in `{failed, dead, cancelled}`; release version unchanged after deploy
- **Vendor docs**: [Fly.io release states](https://fly.io/docs/reference/release-states/)

### `render deploy`

- **Format**: text + dashboard URL line. API-driven verification (`render deploys list --service <id> --json`)
- **Authoritative fields**: `status` (live / build_in_progress / update_in_progress / failed / canceled / deactivated / build_failed / update_failed), `commit`
- **Success criteria**: `status === "live"`
- **Failure criteria**: `status` in `{failed, build_failed, update_failed, canceled, deactivated}`
- **Vendor docs**: [Render deploy statuses](https://render.com/docs/deploys#deploy-statuses)

### Platform billing/quota endpoints (pre-flight per §B)

Per platform, the pre-flight call shape:

| Platform | Endpoint / CLI | Authoritative quota field | Authoritative billing field |
|---|---|---|---|
| Vercel | `GET /v2/teams/<id>/integrations` + dashboard | `usage.bandwidth`, `usage.buildMinutes` | `paymentMethodAttached` (boolean) |
| Netlify | `GET /api/v1/accounts/<id>/billing` | `included_minutes`, `usage_minutes` | `payment_method_id` non-null |
| Fly.io | `flyctl orgs show <org> --json` | machine count vs plan cap | `billing_status` field |
| Supabase | dashboard (no public CLI yet) — manual verify | project compute / DB hours | payment method on file (dashboard) |
| Render | `GET /v1/owners/<id>/billing` | service count / plan tier | `payment_method` non-null |

The pre-flight emits `pre_flight_quota_check` event with `{platform, payment_method_present, quota_remaining, account_state}`. Body capture is structured — never include raw API tokens in the event.

### MCP counterparts

When invoking a deploy via MCP (`mcp__*__deploy_*`), the response shape is dictated by the MCP server's schema. This specialist consults the [MCP-vs-CLI capability matrix](../../../../tools/mcp-cli-capability-matrix.md) (per [ADR-0033](../../../../adr/0033-mcp-vs-cli-capability-matrix.md)) **before** picking MCP vs CLI — some MCPs delegate back to the CLI, in which case both shapes apply and the MCP gives no credential-hygiene benefit.

### Internal contract (what THIS specialist commits to returning)

When invoked, returns:
- Platform chosen + the `tools/runtime.yaml` configuration written
- The pre-flight quota verification artifact (per §B)
- The `waitForDeploy` integration confirmation (TERMINAL_STATES key + thresholds — defaults if unchanged)
- CI hook configuration (preview deploys, prod deploy gating)
- Health-check endpoint + post-deploy verification approach
- Failure-mode IDs (DEPLOY-EX-*) the implementation guards against

## Decline triggers

- **Custom-built / on-prem deploy targets** → escalate to EAC; this specialist covers managed PaaS runtimes only.
- **Anything matching a `production_mutation_attempted` pattern without a constitution-service claim** → escalate per LR-02 (subsumed by LR-04 `destructive_actions` per ADR-0027).
- **Deploy to a billable platform without pre-flight quota check** → decline and run the pre-flight first (LR-04 `external_service_setup`).
- **Recommend re-authentication without verifying quota first** when symptom is read-works/write-fails → decline; check quota first per DEPLOY-EX-05.

## Evidence basis

- **Primary:** Vendor docs (Vercel, Netlify, Fly, Render, Cloudflare Pages) for each runtime. `[vendor][H]` per runtime. AnonForum deployment session post-mortem (2026-05-21) for the hardening findings DEPLOY-EX-04..08. `[user-report][H]`
- **Corroborating:**
  - OWASP DevSecOps top 10 — supply-chain integrity in deploys. `[institutional][M]`
  - Beyer et al., *Site Reliability Engineering* (Google/O'Reilly 2016) Chapter 6 — non-progressing-as-terminal-outcome is the canonical mitigation for silent-hang failure modes. `[institutional][H]`
  - Twelve-Factor App methodology §X (Dev/prod parity) — response body, not local process signal, is the source of truth for platform operations. `[primary][H]`
- **What would change this call:** a runtime's deploy mechanism becomes incompatible with the `tools/runtime.yaml` 5-field schema (amends ADR-0019); or peer-reviewed evidence that the chosen non-progressing thresholds (5 min stall, 20 min in_progress) produce excessive false positives (amends ADR-0032 §A defaults).

## Runtime counterpart

[`../../../../.claude/agents/deploy.md`](../../../../.claude/agents/deploy.md).
