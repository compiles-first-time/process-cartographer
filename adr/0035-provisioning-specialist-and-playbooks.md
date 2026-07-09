# ADR-0035: Provisioning specialist + playbook schema + staleness validation

**Status:** Accepted
**Date:** 2026-05-25
**Author:** Architect (Nick) — surfaced by Ravenwise lesson + 2026-05-25 architecture-design conversation; drafted by Claude
**Confidence:** [H]

## Context

The Ravenwise bootstrap (2026-05-22) exposed two related friction classes:

1. **Manual provisioning friction.** The architect had to log into Supabase, Google Cloud, and Vercel dashboards to set up the project's external dependencies. Each step broke audit-trail capture, exited the agent's working context, and required the architect to context-switch back to the build session. PR #29's lesson named this and proposed (out-of-scope) a `provisioning` specialist that drives platform-management APIs after one-time PAT setup.
2. **Knowledge staleness.** The MCP-vs-CLI capability matrix (ADR-0033) corrected a Supabase claim and added Google Cloud disambiguation only because the architect's question forced research validation. Vendor docs rebrand (Google's "Cloud Console" → "Google Auth Platform"), APIs deprecate (IAP OAuth Admin API in Jan 2025), and adjacent-but-different resources confuse agents (the 4-class GCP "OAuth client" disambiguation). Without active validation, the matrix would silently degrade.

The architect's 2026-05-25 question — *"how would we keep playbook information current as vendor docs change?"* — forced these two friction classes into one ADR. The provisioning specialist solves friction class 1; the playbook schema + staleness validation solves friction class 2; together they form the Loom v2 provisioning architecture.

[ADR-0033](./0033-mcp-vs-cli-capability-matrix.md) established the matrix as the *capability* reference (does this surface complete the action). [ADR-0027](./0027-permissions-protocol.md) / [LR-04](../constitution/local-rules.md) established the policy classifier. This ADR adds the *operational* layer: a specialist that drives the capabilities + a per-platform playbook that integrates matrix + SKILL.md + per-platform setup into a single architect-facing guide, with explicit validation discipline so the playbooks don't rot.

## Decision

Adopt the `provisioning` specialist + per-platform playbook artifact + 5-layer staleness validation as the operational provisioning architecture.

### A. The `provisioning` specialist

Bundled specialist at `agents/specialists/_registry/provisioning/SKILL.md`, analogous to `deploy` / `oauth` / `db-migration`. Frontmatter:

```yaml
---
name: provisioning
summary: Idempotent platform-resource provisioning via management APIs. Drives Supabase project creation, Vercel project linking, GitHub repo creation, etc. after one-time PAT setup. Consults the MCP-vs-CLI capability matrix + per-platform playbook before each operation.
tier: bundled
context_budget: 24000
tools: [Read, Glob, Grep, Edit, Write, WebFetch]
---
```

Required SKILL.md sections (per [ADR-0022](./0022-xlsx-docs-convention.md)):

- **Role + scope** — provisions platform resources (projects, secrets, env vars, redirect URIs) end-to-end where the matrix marks the action as Class A (automatable). For Class B (browser-only) and Class C (runtime-dependent) actions, batches handoffs to the architect rather than scattering interrupts.
- **Required pre-flight (per ADR-0032 §B + ADR-0034)** — call the platform's `list_organizations` / `whoami` equivalent BEFORE any write op; verify the credential target matches the architect's intended account (closes Ravenwise Root cause 4); call cost-preview / quota-check APIs if available (Supabase MCP's `get_cost` + `confirm_cost` pattern); emit `pre_flight_quota_check` event.
- **Required idempotency** — every operation MUST be safe to re-run. Pattern: `list-by-name` → if exists, return existing; if not, `create` then return new. Records state in `discovery/provisioning-state.md`.
- **Response shape** (per ADR-0032 §C / specialist SKILL.md convention) — declares the response body shape for each platform's management API.
- **Failure-mode register** (PROV-EX-NN) with at minimum: PAT-invalid, PAT-wrong-account, quota-exhausted, name-collision, billing-required, partial-create-rollback.
- **Decline triggers** — operations that the matrix marks Class B (no API path) decline with an explicit batched-handoff message to the architect.
- **Evidence basis** — cites the matrix (ADR-0033) + the per-platform playbook for the operation in question.

### B. Per-platform playbook schema

Each playbook lives at `tools/provisioning-playbooks/<platform>.md` and follows this structure:

```markdown
# <Platform> provisioning playbook

> last_verified: YYYY-MM-DD | verification_method: <manual | agent | synthetic> | TTL: 90 days
> Per ADR-0035. Specialist consumer: `agents/specialists/_registry/provisioning/SKILL.md`.

## Setup (one-time per architect account)
<!-- last_verified: YYYY-MM-DD -->
1. Generate PAT at <vendor-url> (cite the canonical doc URL)
2. Validate the PAT: <read-only call> → expected response shape
3. Store via `scripts/collect-credentials.{sh,ps1} <platform>` (per ADR-0036) — never paste into chat

## Class A — automated provisioning operations
<!-- last_verified: YYYY-MM-DD | verification_method: agent + synthetic -->
| Operation | API / MCP | Required request fields | Expected success response | Failure recovery | Source |
|---|---|---|---|---|---|

## Class B — browser-only steps (batched handoff at session start)
<!-- last_verified: YYYY-MM-DD | verification_method: agent -->
| Step | URL | Click sequence | Output to capture | Why no API | Source |
|---|---|---|---|---|---|

## Class C — runtime-dependent (just-in-time handoff)
<!-- last_verified: YYYY-MM-DD -->
| Trigger event | URL | Click sequence | Time-to-do | Source |
|---|---|---|---|---|

## Vendor canonical docs (re-validate these on TTL expiry)
- <list of vendor URLs the playbook cites>

## Version log
- YYYY-MM-DD — initial population (verified end-to-end against <account>)
- YYYY-MM-DD — section X re-validated; <what changed>
```

**Schema invariants:**

1. **Per-section dates.** Some sections drift faster than others (Class B click sequences rebrand frequently — see Google's "Cloud Console" → "Google Auth Platform" rename — while API endpoints in Class A are more stable). Per-section `last_verified` lets doctor checks be precise about what's stale.
2. **`verification_method` is declared** so re-validation can be re-run with the same method. `agent` means a research-agent simulation was used (the pattern from Ravenwise session); `manual` means an architect walked through it; `synthetic` means an automated test (Class A only).
3. **Source column required** on every row — every claim cites the vendor doc URL that backs it. This is what re-validation re-fetches.
4. **Version log at the bottom** is append-only — never edit prior entries.

### C. Five-layer staleness validation

Discipline for keeping playbooks current. Each layer addresses a different drift class; together they cover the realistic threat model.

| Layer | Cost | Cadence | Detection target | Implementation |
|---|---|---|---|---|
| **1. TTL-based staleness warning** | Free | Continuous (doctor check) | Forgotten playbooks | `scripts/lib/doctor.mjs` `playbook-freshness` soft check. Scans `tools/provisioning-playbooks/*.md`, parses per-section `last_verified` dates, warns when any section is > 90 days old. Analogous to the `handoff-freshness` check that shipped in PR #21 / ADR-0031. |
| **2. Real-session discrepancy capture** | Low | Continuous (organic) | UI drift, field renames, click-sequence rebrands | New event type `playbook_discrepancy` emitted via slash command `/loom-playbook-stale <platform> <description>`. Events accumulate in `memory/event-log/*.jsonl`; periodic architect review surfaces emerging drift before it cascades. |
| **3. Agent-driven re-validation** | Medium (per playbook) | Per-playbook on TTL expiry OR architect-triggered | API deprecations, click sequence changes, vendor rebrands | `scripts/validate-playbook.{sh,ps1} <platform>` spawns a general-purpose Agent (per ADR-0034 path 2b) with the playbook + cited vendor docs as input. Agent compares + reports discrepancies + recommends edits. Pattern validated in 2026-05-22 session (Supabase + Google Cloud verification). |
| **4. Upstream deprecation feed** | Medium-high (one-time setup) | Continuous | Vendor-announced breaking changes | Subscribe to vendor changelog / deprecation feeds (Google Cloud deprecation announcements, AWS bulletins, Supabase status RSS, Anthropic API changelog). When something a playbook cites appears in a feed, flag for re-validation. Per-vendor signal-to-noise varies; only worth wiring for vendors with high-quality feeds (Google, Anthropic qualify). |
| **5. Synthetic test runs** | High (sandbox account maintenance) | Per-release or weekly | API call signature drift | For Class A operations on the highest-leverage platforms (Supabase, Vercel, GitHub), maintain a sandbox account + run periodic `create + verify + cleanup` cycles. If API signature changed, test fails loudly. Gold standard but real ops cost; only for the top 3 platforms. |

**Recommended starting set:** layers 1 + 2 + 3 (free + low + medium cost together cover most drift). Layer 4 added when a specific vendor has a high-quality feed worth wiring. Layer 5 deferred until the top 3 playbooks have shipped + been used in 3+ real projects.

### D. Boundaries with adjacent ADRs

- **ADR-0033 (matrix)** declares *capability*. The playbook declares *operational sequence*. The provisioning specialist consults both.
- **ADR-0036 (credentials, future)** declares *how PATs are collected + stored*. The playbook's "Setup" section assumes ADR-0036's `scripts/collect-credentials.{sh,ps1}` exists.
- **ADR-0034 (specialist-invocation discipline)** governs *how the provisioning specialist is invoked* when the registry isn't loaded. The specialist's SKILL.md is itself a candidate Agent-tool prompt under path 2b.
- **ADR-0032 §B (pre-flight quota check)** is *executed by* the provisioning specialist's pre-flight. The specialist is the operational layer for that ADR.

## Evidence basis

- **Primary:**
  - [`lessons-learned/2026-05-22-browser-gated-provisioning-friction.md`](../lessons-learned/2026-05-22-browser-gated-provisioning-friction.md) — Ravenwise post-mortem identifying the friction classes this ADR addresses, including the "provisioning specialist" follow-up flagged as out-of-scope #5 in that lesson. `[user-report][H]`
  - 2026-05-25 architect-design conversation surfacing the staleness validation requirement: *"If we did a playbook, we would need something that would validate its information every so often or if something broke in regards to the specific playbook. I imagine the information will change and we need to adapt."* `[user-direction][H]`
- **Corroborating sources** *(independent — checked at the publisher level)*:
  - [ADR-0031](./0031-handoff-maintenance-policy.md) — established the TTL-based freshness pattern for handoffs. Layer 1 of §C reuses this pattern. `[primary][H]`
  - [ADR-0033](./0033-mcp-vs-cli-capability-matrix.md) §A invariant #4 (per-row staleness threshold of 90 days) — the matrix-side precedent for the same per-section dating discipline this ADR applies to playbooks. `[primary][H]`
  - **Real-session agent-driven re-validation** (2026-05-22): the corrective sequence proved that general-purpose Agent invocations with SKILL.md / playbook context produce specialist-quality validation output (Supabase Management API rediscovery, Google Cloud 4-resource disambiguation). This is the empirical basis for §C layer 3. `[user-report][H]`
- **Synthesizer reasoning:** the provisioning specialist + playbook schema is the operational counterpart to the matrix + SKILL.md design that already shipped. Without it, agents have *capability awareness* (matrix) and *domain discipline* (SKILL.md) but no *idempotent operational primitive* to execute end-to-end. The staleness validation is the discipline that prevents the playbooks from becoming the next silent-degradation surface — exactly the failure mode the matrix corrections surfaced.
- **What would change this call:**
  - Vendors ship a standardized "platform-provisioning capability description" format (OpenAPI for management APIs + Standard Webhooks for events is the current closest) — could replace per-platform playbook authoring with auto-generation from those descriptions. Not yet at maturity for this to be reliable.
  - A peer-reviewed analysis demonstrates that agent-driven re-validation produces excessive false positives or false negatives at scale (would amend §C layer 3 to use a different validation mechanism).
  - Claude Code's Agent SDK adds a first-class "skill-as-prompt" wrapper (current pattern is to pass the SKILL.md content manually) — would simplify the implementation but not change the architecture.

## Consequences

**Locks in:**

- The provisioning specialist as the canonical operational primitive for platform-management API work.
- The per-platform playbook artifact at `tools/provisioning-playbooks/<platform>.md` as the single source of truth for platform-specific setup + provisioning sequences.
- The 5-layer staleness validation as the maintenance discipline.
- Per-section `last_verified` dating + `verification_method` declaration as schema invariants on all playbooks.
- A clear three-way separation: matrix (capability) / playbook (operational sequence) / specialist (executor).

**Locks out:**

- Per-specialist mirror copies of playbook content (would drift; specialists reference the playbook via markdown link instead).
- Treating "we documented it once" as sufficient — without TTL-based validation, the doc decays into wrong-but-confident.
- Browser-gated steps scattered throughout a build session (the provisioning specialist's decline-with-batched-handoff pattern eliminates this).

**Migration path if it fails:**

- Each layer (the specialist, the playbook schema, the validation discipline) is independently revertible. If the specialist over-fires, scope it down. If the playbook schema is too rigid, relax. If validation is too costly, defer the high-cost layers.
- Playbooks themselves are markdown — no code dependency. Their value is purely informational + as input to the validation script.
- The validation script (`scripts/validate-playbook.{sh,ps1}`) is opt-in; if it produces too many false positives, lower its cadence rather than removing it.

## Alternatives considered

- **Embed playbook content inside the specialist SKILL.md.** Rejected. The SKILL.md is the *discipline* (failure modes, declination triggers, response shape contracts); the playbook is the *operational sequence* (URLs, click steps, request bodies). Mixing them produces SKILL.md files that are too long to read and too brittle to keep current at the SKILL.md level. Separation matches the matrix-vs-SKILL.md separation that already works.
- **One ADR per playbook (Supabase ADR, Vercel ADR, etc.).** Rejected. The *playbook* is the artifact; the *schema + validation discipline* is the decision. ADRs document decisions, not data. Per-platform playbooks ship as files, not ADRs.
- **Use a runtime-introspectable format (JSON / YAML) for playbooks.** Considered. The matrix is markdown for human readability (per ADR-0033 alternatives section); same reasoning applies here. Synthetic test runs (§C layer 5) can parse markdown tables with the same effort as JSON, and human review is the dominant use case.
- **Manual-only re-validation (no Agent-driven).** Rejected — the Ravenwise session proved agent-driven validation works and is cheaper than manual at scale. Manual remains an option (`verification_method: manual`) for sections where the architect prefers direct sign-off.
- **Skip layer 1 (TTL) and rely entirely on layers 2 + 3.** Rejected. Layer 1 is free and catches the "forgot to look at it" case — the most common failure mode for any auxiliary documentation. The cost is one doctor check; the benefit is forced periodic attention.

## Affects / Affected by

**This ADR affects** *(downstream — when this ADR changes, these must be reviewed)*:

- `agents/specialists/_registry/provisioning/SKILL.md` (NEW) — the specialist this ADR specifies
- `tools/provisioning-playbooks/*.md` (NEW directory) — per-platform playbooks following the schema
- `scripts/lib/doctor.mjs` — `playbook-freshness` soft check (§C layer 1)
- `scripts/validate-playbook.{sh,ps1}` (NEW) — agent-driven re-validation script (§C layer 3)
- `scripts/bootstrap.{sh,ps1}` — should detect which platforms the project uses (from `tools/runtime.yaml` + discovery answers) and auto-surface the relevant playbooks at session start
- `tools/discovered-runtime.md` — should grow to include a "platforms in use + playbook status" section
- `agents/specialists/_registry/deploy/SKILL.md` — its "MCP counterparts" section should cross-reference the deploy-relevant playbooks
- `agents/specialists/_registry/secrets/SKILL.md` — should cross-reference the credentials-collection portions of each platform's playbook

**This ADR is affected by** *(upstream — these define constraints on this decision)*:

- [ADR-0022](./0022-xlsx-docs-convention.md) — the xlsx failure-mode register format the specialist's SKILL.md inherits
- [ADR-0023](./0023-specialist-registry.md) — the bundled-vs-project-local override mechanism the provisioning specialist participates in
- [ADR-0027](./0027-permissions-protocol.md) / [LR-04](../constitution/local-rules.md) — the policy classifier that pre-flight credential ops use
- [ADR-0031](./0031-handoff-maintenance-policy.md) — TTL-based freshness pattern precedent
- [ADR-0032](./0032-deployment-hardening.md) §B — pre-flight quota check the provisioning specialist executes
- [ADR-0033](./0033-mcp-vs-cli-capability-matrix.md) — the matrix the provisioning specialist consults before tool selection
- [ADR-0034](./0034-specialist-invocation-discipline.md) — the specialist invocation discipline that governs how the provisioning specialist is invoked
- ADR-0036 (companion, this cascade) — credential collection patterns this ADR depends on

## References

- Lesson 2026-05-22 (`browser-gated-provisioning-friction.md`) — Root cause 3 + out-of-scope items #4 (provisioning specialist) and #5 (bootstrap PAT collection)
- 2026-05-25 architect-design conversation (this session)
- ADR-0031 — `handoff-freshness` precedent for §C layer 1
- ADR-0033 — matrix per-row staleness precedent
- Standard Webhooks specification (https://www.standardwebhooks.com) — relevant for cross-platform webhook handling in playbooks
- OpenAPI specification (https://www.openapis.org) — the closest thing to a vendor-standardized capability description format
