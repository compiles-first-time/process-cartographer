# Supabase provisioning playbook

> last_verified: 2026-05-25 | verification_method: agent | TTL: 90 days
> Per [ADR-0035](../../adr/0035-provisioning-specialist-and-playbooks.md). Specialist consumer: [`provisioning/SKILL.md`](../../agents/specialists/_registry/provisioning/SKILL.md).
>
> First playbook in the Loom v0.3.3 implementation. Validated against the Ravenwise 2026-05-22 real-session findings + Agent A's 2026-05-22 management-API research.

## Setup (one-time per architect account)
<!-- last_verified: 2026-05-25 | verification_method: agent -->

1. **Generate a Personal Access Token (PAT)** at https://supabase.com/dashboard/account/tokens (sign in as the account whose org will own this project's resources). Scope: leave default — Supabase PATs are full-account-scope (no granular scopes available at time of writing). Per [Supabase Management API introduction](https://supabase.com/docs/reference/api/introduction).
2. **Validate the PAT** before storing: `GET https://api.supabase.com/v1/organizations` with `Authorization: Bearer <pat>`. Expected: HTTP 200 + JSON array of orgs. If you see your expected org name in the response, the PAT is valid for the intended account.
3. **Store via `scripts/collect-credentials.{sh,ps1} supabase`** — the script handles the validation, account-attestation prompt, and keyring storage. Never paste the PAT into chat (LR-03).

After this one-time setup, all Class A operations below run without further architect interaction.

## Class A — automated provisioning operations
<!-- last_verified: 2026-05-25 | verification_method: agent -->

| Operation | API / MCP | Required request fields | Expected success response | Failure recovery | Source |
|---|---|---|---|---|---|
| `list_organizations` | `mcp__supabase__list_organizations` OR `GET https://api.supabase.com/v1/organizations` (Bearer PAT) | none | HTTP 200; body `[{id, slug, name}, ...]` | 401 = invalid PAT (PROV-EX-01); 403 = scope/billing issue | [Supabase MCP account tools](https://supabase.com/docs/guides/getting-started/mcp); [Mgmt API orgs](https://supabase.com/docs/reference/api/v1-list-organizations) |
| `get_organization` | `mcp__supabase__get_organization` OR `GET https://api.supabase.com/v1/organizations/{slug}` | `id` (path) | HTTP 200; body `{id, name, plan, opt_in_tags}` | 404 = wrong org id (PROV-EX-02); 403 = not a member | Supabase MCP |
| `list_projects` | `mcp__supabase__list_projects` OR `GET https://api.supabase.com/v1/projects` | none | HTTP 200; body `[{id, ref, organization_id, name, region, status, ...}, ...]` | 401 = PAT issue | Supabase MCP |
| `get_cost` (pre-flight per §B) | `mcp__supabase__get_cost` OR `GET https://api.supabase.com/v1/organizations/{slug}/billing/subscription` | `organization_id` | `{type: "project", recurrence: "monthly", amount: 0}` for free-tier or non-zero for Pro/Team | If amount > 0 + no payment method: PROV-EX-03 | Supabase MCP |
| `confirm_cost` (pre-flight per §B) | `mcp__supabase__confirm_cost` | `type: "project"`, `recurrence: "monthly"`, `amount: <from get_cost>` | confirmation_id string | n/a (always succeeds after get_cost) | Supabase MCP |
| `create_project` | `mcp__supabase__create_project` OR `POST https://api.supabase.com/v1/projects` (Bearer PAT) | `name` (string), `organization_id`, `region` (e.g., `us-east-1`), `db_pass` (set via stdin, never tool args), `confirm_cost_id` | HTTP 201; body `{id, ref, ...}`; project takes ~2 min to reach `status: ACTIVE_HEALTHY` | 402 = quota exhausted (PROV-EX-03); 409 = name collision (PROV-EX-04, return existing); 5xx = retry per PROV-EX-05 | [Supabase Mgmt API create-project](https://supabase.com/docs/reference/api/v1-create-a-project) |
| `get_project` (poll for ACTIVE_HEALTHY) | `mcp__supabase__get_project` OR `GET https://api.supabase.com/v1/projects/{ref}` | `ref` (path) | `status` ∈ `{ACTIVE_HEALTHY, INACTIVE, INIT_FAILED, ...}` | Poll every 10s for 5 min; if not ACTIVE_HEALTHY after that → PROV-EX-05 | Supabase MCP |
| `apply_migration` | `mcp__supabase__apply_migration` OR `supabase db push` CLI (with --include-all + DATABASE_URL=direct connection, NOT pooler) | `project_id`, `name`, `query` (DDL) | structured success result | Direct-URL required for DDL (pooler in Transaction mode rejects DDL); see SETUP.md §5.3 of Ravenwise for the swap pattern | Supabase MCP |
| `execute_sql` (queries only) | `mcp__supabase__execute_sql` OR psql against pooler URL | `project_id`, `query` | rows array | psql via DATABASE_URL pooler (port 6543, prepare:false) | Supabase MCP |
| `deploy_edge_function` | `mcp__supabase__deploy_edge_function` OR `supabase functions deploy <name>` | `project_id`, `name`, `body` | structured success | If status not READY in 60s → PROV-EX-05 | Supabase MCP |
| `list_extensions` | `mcp__supabase__list_extensions` | `project_id` | `[{name, version, installed_version, ...}, ...]` | n/a — read-only | Supabase MCP |

**MCP mode caveat:** the Supabase MCP server's `create_project` / `confirm_cost` / `get_cost` / `list_organizations` / `get_organization` tools are ONLY available when the MCP server is launched WITHOUT `--project-ref` (PAT-mode). When launched with `--project-ref`, these account-group tools are excluded by design. Per Agent A's 2026-05-22 verification. Mitigation: if the specialist needs these and the MCP is project-scoped, fall back to the Management API directly.

## Class B — browser-only steps (batched handoff at session start)
<!-- last_verified: 2026-05-25 | verification_method: agent -->

| Step | URL | Click sequence | Output to capture | Why no API | Source |
|---|---|---|---|---|---|
| Generate PAT (if not yet done) | https://supabase.com/dashboard/account/tokens | Click "Generate new token" → enter name → click Generate → copy the token (shown ONCE) | The token value (paste into `scripts/collect-credentials.sh supabase` prompt) | PAT generation requires session cookie auth + cannot be self-bootstrapped via API | [PAT docs](https://supabase.com/docs/guides/api#authentication) |
| Reset DB password (if lost) | https://supabase.com/dashboard/project/<ref>/settings/database | Click "Reset database password" → enter new password → confirm | The new password value | Per Agent A's research: Supabase Management API does NOT support programmatic password change after project creation. Dashboard reset is the only path | [Mgmt API create-project §gotchas](https://supabase.com/docs/reference/api/v1-create-a-project) |
| Pause / unpause project (free-tier cap relief) | https://supabase.com/dashboard/project/<ref>/settings/general | Scroll to "Pause project" / "Restore project" → confirm | n/a (status visible via `list_projects`) | Pause/restore endpoints exist (`mcp__supabase__pause_project` / `restore_project`) — actually Class A! Move to Class A in next playbook revision; left here as fallback documentation | Supabase MCP |
| Upgrade org plan (Pro/Team) | https://supabase.com/dashboard/org/<slug>/billing | Click "Change subscription" → pick plan → enter payment details → confirm | n/a (plan visible via `get_organization`) | Billing portal access is dashboard-only; Stripe Customer Portal embedding | [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase) |

## Class C — runtime-dependent (just-in-time handoff)
<!-- last_verified: 2026-05-25 -->

| Trigger event | URL | Click sequence | Time-to-do | Source |
|---|---|---|---|---|
| First Vercel deploy completes → need to set Supabase auth-callback redirect URL | https://supabase.com/dashboard/project/<ref>/auth/url-configuration | Add `https://<vercel-url>/api/auth/callback/<provider>` to Redirect URLs → Save | < 30s after deploy URL is known | n/a (only needed if project uses Supabase Auth — Ravenwise uses Auth.js, so this is N/A for that case) |
| User reports "email not arriving" → check email rate limit | https://supabase.com/dashboard/project/<ref>/auth/rate-limits | Inspect "Email" tier → adjust if needed | < 60s | Auth rate-limit dashboard |

## Vendor canonical docs (re-validate these on TTL expiry)

When this playbook's TTL expires (90 days from `last_verified`), `scripts/validate-playbook.{sh,ps1} supabase` re-fetches each of these URLs + asks an agent (per ADR-0034 path 2b) to compare against the playbook content + report discrepancies:

- [Supabase Management API introduction](https://supabase.com/docs/reference/api/introduction)
- [Supabase Management API: Create a project](https://supabase.com/docs/reference/api/v1-create-a-project)
- [Supabase Management API: List all projects](https://supabase.com/docs/reference/api/v1-list-all-projects)
- [Supabase MCP server (account tools)](https://supabase.com/docs/guides/getting-started/mcp)
- [Personal Access Token page](https://supabase.com/dashboard/account/tokens)
- [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase)

## Version log
- **2026-05-25** — initial population (validated 2026-05-22 via Agent A against Ravenwise project). Covers 10 Class A ops + 4 Class B + 2 Class C across the surface most relevant to Loom-bootstrapped projects (project create/get/list, migrations, edge functions, auth redirect config).
