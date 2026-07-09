# MCP-vs-CLI capability matrix

> Per [ADR-0033](../adr/0033-mcp-vs-cli-capability-matrix.md). Authoritative reference for specialists choosing between MCP server and CLI tool surfaces for a given `(platform, action)` tuple.

This is a **living document**. Rows are added when a specialist hits an unmapped `(platform, action)` during real work; updated when a vendor ships, removes, or changes MCP coverage. Per-row staleness threshold is 90 days from last verification (Loom doctor flags stale rows as soft warning in a follow-up PR).

## How to read a row

- **Platform**: lowercase platform key; matches `TERMINAL_STATES` keys in [`../scripts/lib/wait-for-deploy.mjs`](../scripts/lib/wait-for-deploy.mjs) where applicable.
- **Action**: concrete verb. Same `(platform, action)` may appear as multiple rows if behavior differs by sub-action (e.g., `deploy` vs `deploy --prod`).
- **MCP server**: identifier of the form `mcp__<server>__<tool>` if a working MCP tool exists; `—` if not.
- **CLI**: the binary + minimal args if a CLI path exists; `—` if not.
- **Human-browser**: `required` / `optional` / `—`. `required` is a hard handoff to the user — the specialist must stop and route to the human.
- **Confidence**: `[H]` (verified end-to-end), `[M]` (verified surface exists, end-to-end not personally tested), `[L]` (claim from vendor docs only, no real-session evidence).
- **Source**: citation for verification. Vendor docs preferred; MCP repo READMEs second.
- **Notes**: quirks. Specifically called out when an MCP delegates back to a CLI (picking the MCP gives no credential-hygiene benefit and adds latency).

## How to use the matrix in a specialist

1. **Look up** the `(platform, action)` pair before choosing a tool.
2. **Capability first**: prefer the surface that completes the action end-to-end. If only one does, pick that.
3. **Credential hygiene** (per [L4 MCP-over-CLI](../layers/L4-tooling.md#mcp-over-cli-for-credentialed-services)): when both surfaces are capable, prefer the MCP server (credential stays out of tool args).
4. **Cost** (per [ADR-0032 §B](../adr/0032-deployment-hardening.md)): a billable action's `pre_flight_quota_check` event still fires regardless of surface; the matrix doesn't change that.
5. **If absent**: note the gap in the specialist's return; default to credential-hygiene preference; propose a matrix row in a follow-up PR.

## One-time browser-gated setup vs. recurring browser-gating

Per [lessons-learned/2026-05-22-browser-gated-provisioning-friction.md](../lessons-learned/2026-05-22-browser-gated-provisioning-friction.md), `Human-browser: required` rows fall into two friction classes that specialists must distinguish:

- **One-time per account** — generate a Personal Access Token (PAT), create an OAuth Client, install a service account. After the one-time step, the platform's Management API is automatable via the issued credential. **Bundle these into a single architect handoff at session start.** Don't surface them one-at-a-time during execution.
- **Recurring** — every operation requires browser confirmation (rare; usually billing portal access). Genuinely fragments the flow; surface immediately with the dashboard URL.

The matrix's Notes column calls out which category each row belongs to. A specialist that hits a `Human-browser: required` row should:

1. Check Notes for `one-time PAT setup; then automatable` — if present, prefer driving the platform's Management API after architect has set up the PAT (capture the PAT in `.env.local`, not in chat).
2. If genuinely recurring, batch the architect handoffs: do not surface step-by-step.

## Management-API discipline (population checklist)

When adding or auditing a `create-*` / `provision-*` / `manage-*` row, BEFORE marking `Human-browser: required` with `[H]` confidence, verify:

- [ ] Searched the platform's docs for "Management API", "Admin API", or "Account API" — these are typically at separate domains (e.g., `api.supabase.com` vs `<ref>.supabase.co`)
- [ ] Searched the platform's docs for "Personal Access Token" or "PAT" — a PAT often unlocks an entire Management API surface
- [ ] Searched for `*-api` / `*-admin` packages on npm / pypi — third-party SDKs often exist before first-party CLIs
- [ ] Checked whether the operation is in the platform's [Open API spec](https://api.swagger.io) — many platforms ship a spec even when their docs site is sparse

If you can't confirm "no management API exists" via at least three of these, mark the row `[M]` not `[H]`. The Supabase `create-project` row taught us this discipline by being wrong (PR #27, corrected in this PR).

---

## Vercel

| Action | MCP server | CLI | Human-browser | Confidence | Source | Notes |
|---|---|---|---|---|---|---|
| deploy | `mcp__vercel__deploy_to_vercel` | `vercel deploy [--prod]` | — | [M] | Vercel MCP source repo; [Vercel CLI docs](https://vercel.com/docs/cli) | **MCP delegates back to CLI in some implementations** — verify before picking; if MCP delegates, credential-hygiene benefit is lost (AnonForum 2026-05-21 finding) |
| inspect | `mcp__vercel__get_deployment` | `vercel inspect <url-or-id>` | — | [H] | [Vercel API](https://vercel.com/docs/rest-api/endpoints/deployments) | MCP path returns full JSON; CLI text by default + `--json` flag |
| list-deployments | `mcp__vercel__list_deployments` | `vercel ls` | — | [H] | [Vercel API](https://vercel.com/docs/rest-api/endpoints/deployments) | Either works; MCP preferred for credential hygiene |
| set-env | — | `vercel env add <NAME> <env>` | optional | [H] | [Vercel CLI env](https://vercel.com/docs/cli/env) | CLI is interactive (prompts for value); no MCP coverage observed |
| add-domain | — | `vercel domains add <domain>` | required for DNS verification | [H] | [Vercel domains](https://vercel.com/docs/projects/domains) | DNS records added at registrar — browser step is on the user's DNS provider, not Vercel |
| check-billing | — | — | required | [H] | [Vercel billing dashboard](https://vercel.com/dashboard/usage) | Dashboard-only; no CLI / MCP for billing portal access |
| login (auth) | — | `vercel login` | required | [H] | [Vercel CLI login](https://vercel.com/docs/cli/login) | Device-code OAuth flow; browser confirmation step is the device-code dance (DEPLOY-EX-06) |

## Netlify

| Action | MCP server | CLI | Human-browser | Confidence | Source | Notes |
|---|---|---|---|---|---|---|
| deploy | — | `netlify deploy [--prod]` | — | [H] | [Netlify CLI](https://docs.netlify.com/cli/get-started/) | No first-party MCP at time of writing; CLI is the only path |
| status | — | `netlify status` | — | [H] | [Netlify CLI](https://docs.netlify.com/cli/get-started/) | — |
| set-env | — | `netlify env:set NAME value` | optional | [H] | [Netlify env vars](https://docs.netlify.com/configure-builds/environment-variables/) | — |
| add-domain | — | `netlify domains:add <domain>` | required for DNS | [H] | [Netlify domains](https://docs.netlify.com/domains/) | DNS step on user's registrar |
| check-billing | — | — | required | [H] | [Netlify billing dashboard](https://app.netlify.com/billing) | Dashboard-only |

## Fly.io

| Action | MCP server | CLI | Human-browser | Confidence | Source | Notes |
|---|---|---|---|---|---|---|
| deploy | — | `fly deploy` | — | [H] | [Fly.io deploy](https://fly.io/docs/launch/deploy/) | No first-party MCP observed |
| status | — | `fly status` | — | [H] | [Fly.io status](https://fly.io/docs/flyctl/status/) | — |
| set-secret | — | `fly secrets set NAME=value` | — | [H] | [Fly.io secrets](https://fly.io/docs/reference/secrets/) | Writes are **staged**, applied on next deploy — surprise category for first-time users |
| create-app | — | `fly apps create <name>` | — | [H] | [Fly.io apps](https://fly.io/docs/flyctl/apps-create/) | Billable: triggers ADR-0032 §B pre-flight quota check |
| check-billing | — | `fly orgs show <org> --json` | optional | [H] | [flyctl orgs](https://fly.io/docs/flyctl/orgs-show/) | CLI returns billing fields in JSON; full dashboard for plan changes |

## Render

| Action | MCP server | CLI | Human-browser | Confidence | Source | Notes |
|---|---|---|---|---|---|---|
| deploy | — | `render deploys create --service <id>` | — | [H] | [Render CLI](https://render.com/docs/cli) | — |
| list-deploys | — | `render deploys list --service <id>` | — | [H] | [Render CLI](https://render.com/docs/cli) | — |
| create-service | — | `render services create` | optional | [M] | [Render services](https://render.com/docs/blueprint-spec) | Blueprint-driven YAML preferred; CLI for ad-hoc |
| check-billing | — | — | required | [H] | [Render billing dashboard](https://dashboard.render.com/billing) | Dashboard-only |

## Supabase

| Action | MCP server | CLI | Human-browser | Confidence | Source | Notes |
|---|---|---|---|---|---|---|
| query (SELECT) | `mcp__supabase__execute_sql` | `supabase db query` | — | [H] | Supabase MCP repo; [supabase CLI](https://supabase.com/docs/reference/cli) | MCP strongly preferred for credential hygiene |
| migrate | `mcp__supabase__apply_migration` | `supabase db push` | — | [H] | Supabase MCP repo | MCP and CLI both work; MCP preferred |
| create-project | `mcp__supabase__create_project` (account-group; requires PAT-mode MCP server, NOT `--project-ref`-scoped) | `POST https://api.supabase.com/v1/projects` (Management API, PAT-authed) | one-time PAT setup | [H] | [Supabase Management API: Create a project](https://supabase.com/docs/reference/api/v1-create-a-project); [Supabase MCP account tools](https://supabase.com/docs/guides/getting-started/mcp) | **Two earlier matrix attempts were incomplete** (PR #27 said "no programmatic path"; the initial PR #29 correction added only the Management API — missed the first-party MCP coverage). Corrected here per agent-validation 2026-05-22. The Supabase MCP server's "account" tool group exposes `create_project` + `confirm_cost` + `get_cost` + `list_organizations` + `get_organization` when launched WITHOUT the `--project-ref` flag (PAT-mode). Alternative: Management API at `api.supabase.com` (distinct from per-project `<ref>.supabase.co`), PAT-authed at `https://supabase.com/dashboard/account/tokens`. Body: `name`, `organization_id`, `region`, `db_pass` (NOT `plan` — inherits org plan). **Free-tier cap: 2 projects per USER across ALL orgs where user is Owner/Admin** (cross-org, not per-org — paused projects don't count). Companion: call `mcp__supabase__get_cost` + `confirm_cost` BEFORE `create_project` per ADR-0032 §B pre-flight discipline. Password is immutable post-creation via API |
| deploy-edge-function | `mcp__supabase__deploy_edge_function` | `supabase functions deploy <name>` | — | [H] | Supabase MCP repo | Both work; MCP preferred |
| set-secret | — | `supabase secrets set NAME=value --project-ref <ref>` | — | [H] | [supabase secrets](https://supabase.com/docs/reference/cli/supabase-secrets) | No MCP coverage for secrets at time of writing |
| link-project | — | `supabase link --project-ref <ref>` | optional | [H] | [supabase link](https://supabase.com/docs/reference/cli/supabase-link) | First-time link prompts for DB password (LR-03 — value should be sourced from env, not typed inline) |
| check-billing | — | — | required | [H] | [Supabase billing dashboard](https://supabase.com/dashboard/org/_/billing) | Dashboard-only |

## GitHub

| Action | MCP server | CLI | Human-browser | Confidence | Source | Notes |
|---|---|---|---|---|---|---|
| list-issues | `mcp__github__list_issues` | `gh issue list` | — | [H] | [GitHub MCP](https://github.com/github/github-mcp-server); [gh CLI](https://cli.github.com/manual/) | Both work; MCP preferred for credential hygiene |
| create-pr | `mcp__github__create_pr` | `gh pr create` | — | [H] | GitHub MCP repo | Both work; **note**: `gh` can exit 0 with body errors on org-policy rejections (DEPLOY-EX-07 — §C lying-CLI case) |
| merge-pr | — | `gh pr merge` | optional | [H] | [gh CLI pr merge](https://cli.github.com/manual/gh_pr_merge) | **CLI-only**; Builder is auto-classifier-blocked from this per handoff §"Anthropic CLI auto-mode classifier" — Nick merges via web UI |
| set-secret | `mcp__github__set_repo_secret` | `gh secret set NAME --body <val>` | — | [M] | GitHub MCP repo | MCP and CLI both work; the CLI's `--body` flag inlines the value into args — prefer the MCP for LR-03 hygiene OR `gh secret set NAME --body "$(cat /dev/stdin)"` patterns |
| create-release | `mcp__github__create_release` | `gh release create <tag>` | — | [H] | GitHub MCP repo | Both work; MCP preferred |
| login (auth) | — | `gh auth login` | required | [H] | [gh auth login](https://cli.github.com/manual/gh_auth_login) | Device-code OAuth (same pattern as Vercel) |

## Stripe

| Action | MCP server | CLI | Human-browser | Confidence | Source | Notes |
|---|---|---|---|---|---|---|
| create-product | `mcp__stripe__create_product` | `stripe products create` | — | [M] | [Stripe MCP](https://github.com/stripe/agent-toolkit); [Stripe CLI](https://docs.stripe.com/stripe-cli) | Both work; MCP preferred |
| create-webhook | `mcp__stripe__create_webhook_endpoint` | `stripe webhook_endpoints create` | — | [M] | Stripe MCP | Both work |
| forward-webhook (dev) | — | `stripe listen --forward-to <url>` | — | [H] | [Stripe webhook forwarding](https://docs.stripe.com/stripe-cli/webhook-forwarding) | **CLI-only**; long-running dev convenience tool; no MCP equivalent |
| process-refund | `mcp__stripe__create_refund` | `stripe refunds create --charge <id>` | — | [M] | Stripe MCP | Both work; payments specialist's PAY-EX-04 (tax-side-effect) applies regardless |
| portal-config | — | — | required | [H] | [Stripe customer portal](https://docs.stripe.com/customer-management/integrate-customer-portal) | Customer portal config requires browser-side dashboard interaction for branding / consent text |

## Google Cloud (OAuth client management)

Most commonly used by Loom projects to configure **Sign in with Google** as an IAM. OAuth Client creation for standard web applications is **verified browser-only** (no first-party API exists, deliberately). Related operations (consent screen config, redirect URI updates, client listing) inherit the same constraint. The good news: all of it is **one-time-per-project** — once the Client ID + secret are issued, subsequent dev/deploy work needs no further Google Cloud Console visits except when adding a new prod/preview redirect URI.

### Resource-class disambiguation (read this first)

Four distinct resources are all confusingly called "OAuth client" in Google Cloud. **They are not interchangeable.** Always verify which class a tool / provider documents before assuming it applies to "Sign in with Google":

| Class | What it does | Programmatic? | Use case |
|---|---|---|---|
| **(a) Standard web-app client** | The one used by Auth.js / NextAuth / Lucia for "Sign in with Google" | **No API** (Console only — this section) | End-user browser sign-in to your app |
| (b) Identity-Aware Proxy (IAP) client | Authenticates users to GCP-hosted resources behind IAP | **API DEPRECATED 2025-01-22** — use Google-managed shared client | Internal apps behind IAP only |
| (c) Workforce Identity Federation OAuth app | Authenticates federated workforce users into GCP itself | `gcloud iam oauth-clients` ✓ | Federated SSO to GCP, NOT end-user app sign-in |
| (d) Identity Platform OAuth IdP config | Configures an *external* IdP for Identity Platform | `gcloud identity-platform` ✓ | Adds Google as one IdP among many — different from Google IAM |

If you're shipping Auth.js / NextAuth Google sign-in (the Ravenwise / typical Loom case), you need class **(a)** — and the answer is browser-only.

### Capability rows

| Action | MCP server | CLI | Human-browser | Confidence | Source | Notes |
|---|---|---|---|---|---|---|
| oauth-consent-screen-config | — | — | required (one-time) | [H] | [Manage OAuth Clients (Google Auth Platform)](https://support.google.com/cloud/answer/15549257) | No first-party API for consent-screen branding + scope declaration. One-time per Google Cloud project. Console-rebranded to "Google Auth Platform" in late 2025; URL still works |
| oauth-client-create (Web app — class **a**) | — | — | required (one-time) | [H] | [Get your Google API client ID](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid); [HashiCorp issue #16452](https://github.com/hashicorp/terraform-provider-google/issues/16452) | **Verified: no first-party API exists** as of 2026-05-22. Position has been stable since at least 2020 (HashiCorp issue #6074). Closest adjacent API (IAP OAuth Admin) was deprecated 2025-01-22 with no replacement. Standard web-app clients are class **(a)** in the disambiguation table above — NOT what `gcloud iam oauth-clients` or `google_iam_oauth_client` / `gcp.iam.OauthClient` manage (those are class **c**) |
| oauth-client-list (Web app — class **a**) | — | — | required | [H] | [Issue Tracker #182710613](https://issuetracker.google.com/issues/182710613) — open feature request | No API for listing standard-web Client IDs in a project. Open since 2021 with no Google commitment. Workaround for "did I already create one?" — open the Console |
| oauth-client-update-redirects (Web app — class **a**) | — | — | required (recurring) | [H] | [Credentials page](https://console.cloud.google.com/apis/credentials) | Redirect URI list edited via Console only. **Recurring** — whenever a new prod/preview URL is added, the architect must edit. Per LR-2026-05-22: surface this AT DEPLOY TIME, not at session start; bundle with other deploy-time tasks |
| project-create | — | `gcloud projects create <id>` | — | [H] | [gcloud projects](https://cloud.google.com/sdk/gcloud/reference/projects/create) | The Google Cloud project itself IS automatable — only the OAuth Client inside it isn't |
| api-enable | — | `gcloud services enable <api>` | — | [H] | [gcloud services](https://cloud.google.com/sdk/gcloud/reference/services/enable) | Enabling Google APIs (Google Books, OAuth, etc.) is CLI-driven |
| auth (developer login) | — | `gcloud auth login` / `gcloud auth application-default login` | required | [H] | [gcloud auth](https://cloud.google.com/sdk/gcloud/reference/auth) | Device-code browser dance for the developer themselves; same DEPLOY-EX-06 scope-drop pattern applies |
| oauth-client-create (IAP — class **b**) | — | — | DEPRECATED | [H] | [Migrate from IAP OAuth Admin API](https://docs.cloud.google.com/iap/docs/deprecations/migrate-oauth-client) | The IAP OAuth Admin API was deprecated 2025-01-22. Use the **Google-managed shared client** for new IAP work; existing custom clients keep working but cannot be created/modified via API |
| oauth-app-create (Workforce — class **c**) | — | `gcloud iam oauth-clients create <id>` | — | [H] | [Manage OAuth application (Workforce)](https://docs.cloud.google.com/iam/docs/workforce-manage-oauth-app) | **NOT a substitute for class (a).** Authenticates federated workforce users into GCP itself; doesn't issue tokens for end-user browser sign-in to your app |

**Implication for the `oauth` specialist:** when adding Google Sign-In to a project, bundle ALL one-time class-(a) Google Cloud setup into a single architect handoff at session start (consent screen + OAuth Client + initial redirect URIs). Recurring redirect-URI additions (per new prod/preview deploy) surface at deploy time, not bootstrap. See [lessons-learned/2026-05-22-browser-gated-provisioning-friction.md](../lessons-learned/2026-05-22-browser-gated-provisioning-friction.md).

## SendGrid / Resend

| Action | MCP server | CLI | Human-browser | Confidence | Source | Notes |
|---|---|---|---|---|---|---|
| send-email | — | — | — | [H] | [Resend API](https://resend.com/docs/api-reference/emails/send-email); [SendGrid API](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send) | **HTTP API only** — no first-party CLI or MCP at time of writing. Specialist invokes the API directly per `email/SKILL.md` Response shape |
| add-domain (DNS) | — | — | required | [H] | Provider docs | DNS records published at user's registrar; provider verifies. EMAIL-EX-01 handles unpropagated DNS |
| suppression-list-add | — | — | — | [H] | Provider APIs | HTTP API; some providers have CLI wrappers but they're community-maintained |

## Alpaca (brokerage — paper + live trading)

Used by trading projects (e.g., Sovereign Forge). **Trading API keys are dashboard-only to create**; once issued, account/trading/data is fully automatable via the official `alpaca-mcp-server` or REST. Two distinct Alpaca MCPs exist — keep them apart: the **trading** MCP (`alpaca-mcp-server`, consumes keys) vs the **docs** MCP (`alpaca-us`, `https://docs.alpaca.markets/mcp`, for documentation queries / playbook re-validation).

### Resource disambiguation (read first)

`issuetokens` ≠ API-key creation. Alpaca's [`issuetokens`](https://docs.alpaca.markets/us/reference/issuetokens) is `POST https://authx.alpaca.markets/v1/oauth2/token` — an **OAuth2 access-token** endpoint (`client_credentials` grant) for OAuth apps / Broker-API partners acting on behalf of users. It does **not** mint your own trading keys. Self-service trading keys (Key ID + Secret) are created **only** in the dashboard (Home); the Secret is shown once.

| Action | MCP server | CLI/REST | Human-browser | Confidence | Source | Notes |
|---|---|---|---|---|---|---|
| generate-api-keys (own trading keys) | — | — | required (one-time) | [H] | [Alpaca connect guide](https://alpaca.markets/learn/connect-to-alpaca-api) | Dashboard **Home** only; Secret shown once; **no programmatic creation**. This is the `credential-setup` browser-acquisition case (ADR-0042). One-time per account |
| signup / login | — | — | required | [H] | [signup](https://app.alpaca.markets/signup) | Account creation + password entry are **human-only** (ADR-0042 §Executing-agent constraint); the agent navigates read-only + guides. Paper needs no live-brokerage KYC |
| get-account / validate | `alpaca-mcp-server` (account tools) | `GET https://paper-api.alpaca.markets/v2/account` + `APCA-API-KEY-ID`/`APCA-API-SECRET-KEY` | — | [M] | [getAccount](https://docs.alpaca.markets/reference/getaccount); [alpaca-mcp-server](https://github.com/alpacahq/alpaca-mcp-server) | Two custom headers (NOT bearer), validated **as a pair**. 401 = wrong key or paper/live mismatch. Collector + `node index.js --status` use the REST path |
| trading / positions / market-data | `alpaca-mcp-server` (orders, positions, bars, quotes, options, news, indices) | Alpaca REST / `@alpacahq/alpaca-trade-api` SDK | — | [M] | [alpaca-mcp-server](https://github.com/alpacahq/alpaca-mcp-server) | MCP **consumes** existing keys (`ALPACA_API_KEY`/`ALPACA_SECRET_KEY` env, `ALPACA_PAPER_TRADE` default true) — downstream of credential-setup. Sovereign Forge uses the SDK today; MCP migration is a tracked follow-up |
| oauth-token (client_credentials) | — | `POST https://authx.alpaca.markets/v1/oauth2/token` | — | [M] | [issuetokens](https://docs.alpaca.markets/us/reference/issuetokens) | OAuth2 token for OAuth/Broker partners — **NOT** trading-key creation (see disambiguation) |
| docs-query / playbook re-validation | `alpaca-us` docs MCP (`https://docs.alpaca.markets/mcp`, http) | — | — | [M] | [Alpaca docs MCP](https://docs.alpaca.markets/mcp) | Documentation MCP. Registered (`enabled: false`) in `tools/mcp-servers/config.yaml`; use for ADR-0035 staleness re-validation of `alpaca.md` |

---

## Matrix gaps (rows to add on first need)

These platforms / actions appeared in PR #26's specialist updates but don't yet have matrix rows. Add a row when a specialist hits one during real work:

- AWS — `s3 cp`, `lambda invoke`, `secretsmanager get-secret-value`, `iam create-role`, `ses send-email`, `sqs send-message`
- GCP — `gcloud compute *`, `gcloud functions deploy`, `gcloud secrets create` (OAuth + projects are populated above as of 2026-05-22)
- Azure — `az * create`
- Cloudflare — `wrangler deploy`, `wrangler r2 *`, Cloudflare Images
- Sentry — `sentry-cli sourcemaps upload`, `sentry-cli releases new`, Sentry MCP (if any)
- Datadog — `datadog-ci sourcemaps upload`, dashboard-as-code, monitor management
- Honeycomb — `hny` CLI, Markers API
- Doppler / Vault / 1Password — secrets read / write / rotate (per `secrets/SKILL.md`)
- Railway — `railway up`, `railway deploy`, `railway init`
- Planetscale — `planetscale database create`, `planetscale branch create`
- DigitalOcean — `doctl apps create`, `doctl compute droplet create`
- BullMQ / Inngest / Trigger.dev — library-driven, may not need matrix rows
- Cloudflare R2 native — `wrangler r2 bucket create`, etc.

---

## Version log

- **2026-05-21** — Initial population (PR #27 / ADR-0033). 30 rows across 8 platforms. Gaps section enumerates 12 platforms / 40+ actions awaiting first-need.
- **2026-05-22** — First real-session correction (Ravenwise bootstrap). Supabase `create-project` row corrected: the Management API at `api.supabase.com` was missed in the initial population. Added Google Cloud (OAuth client management) section. Added "One-time vs. recurring browser-gating" guidance + management-API discipline checklist. See [lessons-learned/2026-05-22-browser-gated-provisioning-friction.md](../lessons-learned/2026-05-22-browser-gated-provisioning-friction.md).
- **2026-06-07** — Added the **Alpaca** section (ADR-0042 credential-setup validation). Documented dashboard-only trading-key creation (no programmatic API), the `issuetokens`/OAuth2 disambiguation, the official `alpaca-mcp-server` (consumes keys; downstream of credential-setup), and the `alpaca-us` docs MCP (registered `enabled: false` in `tools/mcp-servers/config.yaml` for playbook re-validation). Sourced against architect-supplied Alpaca docs.
- **2026-05-22 (later that day)** — Agent-validated second-pass corrections. The Ravenwise lesson surfaced that no specialist agents had been invoked during the original work; three general-purpose agents were spawned to research-validate the matrix corrections. Findings: (1) **Supabase MCP "account" tool group exists** when launched WITHOUT `--project-ref` (PAT-mode) — `create_project`, `confirm_cost`, `get_cost`, `list_organizations`, `get_organization` — meaning the MCP cell in `create-project` should NOT be `—`. Both the original PR #27 row and the first PR #29 correction missed this. Confidence bumped `[M] → [H]`. (2) **Google Cloud OAuth Client (standard web app) is genuinely Console-only** — verified across 9 sources; agent confirmed the matrix claim with [H] confidence + added the four-resource-class disambiguation (standard-web vs IAP-deprecated vs Workforce vs Identity-Platform) to prevent future agents from being confused by adjacent-but-different APIs.
