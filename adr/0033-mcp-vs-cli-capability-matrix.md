# ADR-0033: MCP-vs-CLI capability matrix for cloud platforms

**Status:** Accepted
**Date:** 2026-05-21
**Author:** Architect (Nick) — bonus finding folded out of [ADR-0032 §E](./0032-deployment-hardening.md); built out by Claude
**Confidence:** [H]

## Context

[ADR-0032 §E](./0032-deployment-hardening.md) surfaced a bonus finding from the AnonForum deployment session (2026-05-21): **MCP servers and CLI tools disagree on which `(platform, action)` tuples actually work**. The Vercel MCP exposes `deploy_to_vercel` but the implementation just returns "run the Vercel CLI"; the Supabase MCP has rich read coverage but several mutation actions delegate back to `supabase` CLI; some Stripe MCPs cover product/webhook configuration but require browser steps for billing portal access.

Specialists driving these platforms (per [ADR-0024](./0024-starter-specialists.md)) need to know *before* picking a tool whether their intended action is end-to-end automatable, partially automatable (CLI + MCP collaboration), or fundamentally browser-gated (human-in-the-loop required). Without this knowledge a specialist will:

- Pick the MCP confidently, discover mid-flow it delegates back to CLI, and waste a tool-call round-trip
- Pick the CLI when an MCP would have kept the credential out of tool args (per [L4 MCP-over-CLI guidance](../layers/L4-tooling.md#mcp-over-cli-for-credentialed-services))
- Attempt a fully-automated flow on a browser-gated action, hit a confusing "you must visit https://..." response, and burn debug time

Existing guidance (L4 "MCP-over-CLI for credentialed services" table) covers the credential-leakage axis but not the capability axis — *whether the chosen surface actually does the thing*.

[ADR-0032 §E] deferred the capability matrix to v0.3.2 because building it requires per-MCP enumeration that didn't fit ADR-0032's scope. This ADR delivers the mechanism + the seed population.

## Decision

Adopt a `(platform, action) → capability-tuple` matrix as the authoritative reference for specialists choosing between MCP and CLI surfaces. The matrix lives at [`tools/mcp-cli-capability-matrix.md`](../tools/mcp-cli-capability-matrix.md) and follows a uniform schema:

| Column | Type | Meaning |
|---|---|---|
| Platform | string | Lowercase platform key matching [`scripts/lib/wait-for-deploy.mjs`](../scripts/lib/wait-for-deploy.mjs)'s `TERMINAL_STATES` keys where applicable |
| Action | string | Concrete verb (`deploy`, `list-projects`, `set-secret`, `check-billing`, `create-project`, ...) |
| MCP server | identifier or `—` | `mcp__<server>__<tool>` if a working MCP tool exists; `—` if not |
| CLI | identifier or `—` | The CLI binary + minimal args if a CLI path exists; `—` if not |
| Human-browser | `required` / `optional` / `—` | Whether the action requires a step the user must do in a browser (typical: billing changes, OAuth consent, account verification) |
| Confidence | `[H]` / `[M]` / `[L]` | Verification confidence per [LR-05](../constitution/local-rules.md#lr-05--decision-supersedence-discipline) |
| Source | citation | Vendor docs / MCP repo / observation |
| Notes | string | Quirks (e.g., "MCP delegates back to CLI"; "browser confirmation step required for billing changes") |

### A. Schema invariants

1. **At least one surface must be populated** (either MCP server or CLI; `— / — / —` is not a valid row — that's an unsupported action and shouldn't be in the matrix at all).
2. **`Human-browser: required` is non-optional**: if any path requires a browser step, that step is documented. Specialists treat this as a hard handoff to the user.
3. **MCP delegation to CLI** is called out explicitly in Notes when observed — picking such an MCP gives you nothing the CLI doesn't, and may add latency.
4. **Each row is timestamped via the document's version log** at the bottom of the matrix file. Stale rows (> 90 days unverified) are flagged when the matrix file is read by Loom doctor (separate doctor check, follow-up PR).

### B. Consultation point

Specialists invoke the matrix at decision time — before picking a tool, look up the `(platform, action)` row and choose the surface based on:

1. **Capability**: does this surface actually do the thing? Prefer the one that does end-to-end.
2. **Credential hygiene** (per L4): when both surfaces are capable, prefer the MCP server (credential stays out of tool args).
3. **Cost** (per [ADR-0032 §B](./0032-deployment-hardening.md)): a billable action's pre-flight quota check still applies regardless of surface.

When the matrix lacks a row, the specialist:
- Notes the gap in its return
- Defaults to the credential-hygiene preference (MCP > CLI when both exist)
- Proposes adding the row to the matrix (architect-approved follow-up PR)

### C. Seed population

PR #27 ships matrix rows for the platforms ADR-0032 explicitly named (vercel, netlify, fly, render, supabase, github, plus stripe and sendgrid as common cases). Other platforms (aws, gcp, azure, cloudflare, datadog, sentry, etc.) are framed as "matrix gap; populate on first real use" — the matrix is intentionally a living document, not an attempt at exhaustive enumeration.

Initial population (full version in [`tools/mcp-cli-capability-matrix.md`](../tools/mcp-cli-capability-matrix.md)) covers ~25 rows across 8 platforms.

### D. Maintenance policy

- New rows added when a specialist hits an `(platform, action)` it can't find in the matrix during real work
- Existing rows updated when a vendor ships MCP coverage (or removes it)
- Per-row staleness threshold: 90 days from last verification (Loom doctor surfaces stale rows as soft warning; not blocking)
- Confidence downgrades on observed evidence loss (e.g., "MCP exposed `deploy_to_vercel` in v1.0.0 but the implementation was removed in v1.2.0" → row marked stale + Notes updated)

## Evidence basis

- **Primary:** Direct inspection of the Vercel MCP, Supabase MCP, GitHub MCP, and Stripe MCP source repos (where public) plus per-vendor CLI documentation. `[primary][H]` for the surface-existence claims; `[primary][M]` for the implementation-actually-works claims (some MCP delegations were observed via the AnonForum session, others inferred from repo READMEs).
- **Corroborating sources** *(independent — checked at the publisher level)*:
  - **Anthropic MCP specification + reference server registry** (model-context-protocol.io). Provides the canonical MCP tool-name schema and the convention `mcp__<server>__<tool>` used in matrix Notes. `[institutional][H]`
  - **Twelve-Factor App methodology §X (Dev/prod parity)** — establishes that operational tooling and runtime tooling should expose the same affordances, which is the principle the matrix surfaces violations of (when MCP "implements" an action by deferring to CLI, that's a 12-factor violation in spirit). `[primary][H]`
  - **Per-vendor docs cited per row** — the matrix entries each carry a Source column with the URL.
- **Synthesizer reasoning:** Specialists can't reason about tool selection without knowing the actual capability of each surface. The L4 "MCP-over-CLI" guidance optimizes for credential hygiene, but capability is the prior question — picking the credential-clean surface that *doesn't actually do the thing* is worse than picking the credential-leaky surface that does. The matrix makes the two-axis decision explicit.
- **What would change this call:**
  - MCP-spec ratifies a standard "this tool delegates to <X>" capability declaration, making the matrix's "Notes: delegates back to CLI" column redundant (would replace the doc-level matrix with a runtime-introspectable signal)
  - A peer-reviewed analysis demonstrates that an alternative decision framework (e.g., per-task LLM-driven tool-picker rather than a static matrix) produces measurably better tool-selection outcomes; this is plausible but not yet evidenced
  - A vendor begins shipping authoritative per-MCP capability declarations alongside the MCP itself (replaces the manual-curation maintenance burden)

## Consequences

**Locks in:**

- The `(platform, action) → capability-tuple` decision framework as the authoritative tool-picker reference for specialists. Specialists must cite the matrix when their return references an MCP or CLI choice on a covered platform.
- The matrix file at [`tools/mcp-cli-capability-matrix.md`](../tools/mcp-cli-capability-matrix.md) as the single source of truth. Mirror entries in specialist SKILL.md files are forbidden — they'd drift.
- Living-document maintenance: rows added on first need, not pre-emptively. The matrix is intentionally incomplete in service of being accurate where it exists.

**Locks out:**

- Specialists making "MCP vs CLI" decisions ad-hoc without consulting the matrix on covered `(platform, action)` tuples. New code review should reject specialist returns that pick a surface against the matrix's recommendation without justification.
- Mirror copies of the matrix in specialist SKILL.md files (would diverge silently). Cross-references via markdown links are encouraged; copying rows is not.
- Exhaustive pre-population: trying to enumerate every `(platform, action)` ahead of need is rejected as over-engineering; populate on real-use signal.

**Migration path if it fails:**

- The matrix is one file. If the framework proves wrong, removing the file + reverting specialist references restores the prior ad-hoc decision model.
- Per-row staleness is auditable; if maintenance burden becomes excessive, lower the verification cadence rather than abandoning the matrix.
- If a vendor ships MCP-spec capability declarations, the matrix can be machine-generated from those — same file location, automated update.

## Alternatives considered

- **Per-specialist MCP-vs-CLI guidance baked into each SKILL.md.** Rejected: drift inevitable; 12 specialists × N platforms is the wrong cardinality. The matrix collapses this to one file with link references.
- **Runtime introspection of MCP capabilities** (call the MCP server, inspect its tool list, decide). Rejected for v0.3.2: the MCP spec doesn't yet require capability descriptions beyond tool name + input schema; "does this tool actually do what its name says" is not introspectable without invoking it. Worth revisiting if the spec evolves.
- **Capability matrix as YAML / JSON instead of markdown.** Considered. Rejected because (a) the matrix needs human-readable Notes prominently, (b) reviewers read markdown more readily than JSON for this category of doc, (c) Loom doctor's "stale rows" check can parse markdown tables with the same effort as JSON.
- **Per-action `requires_browser` flag inside `loom-permissions.yaml`** (extension of [ADR-0027](./0027-permissions-protocol.md)). Considered. Rejected as out-of-scope for the permissions classifier — that file is the LR-04 policy spec, not a tool-capability registry. Cross-reference is appropriate; merger is not.
- **Pre-populate exhaustively across all known platforms.** Rejected: would inflate this PR's scope past testability and produce many `[M]` / `[L]` confidence rows that erode trust in the higher-confidence ones. Living-document is the right cardinality.
- **One ADR per platform.** Rejected: the matrix mechanism is one decision; the rows are data. Splitting per-platform fragments the design discussion.

## Affects / Affected by

**This ADR affects** *(downstream — when this ADR changes, these must be reviewed)*:

- [`tools/mcp-cli-capability-matrix.md`](../tools/mcp-cli-capability-matrix.md) — the matrix file implementing this decision
- [`layers/L4-tooling.md`](../layers/L4-tooling.md) — gains a "Capability matrix" section pointing to the matrix file
- [`agents/specialists/_registry/deploy/SKILL.md`](../agents/specialists/_registry/deploy/SKILL.md) — consults the matrix before picking MCP vs CLI (PR #26 left a forward-reference)
- [`agents/specialists/_registry/secrets/SKILL.md`](../agents/specialists/_registry/secrets/SKILL.md) — consults the matrix for platform env-var operations
- [`agents/specialists/_registry/file-storage/SKILL.md`](../agents/specialists/_registry/file-storage/SKILL.md) — consults the matrix for bucket / object operations
- [`agents/specialists/_registry/error-tracking/SKILL.md`](../agents/specialists/_registry/error-tracking/SKILL.md) — consults the matrix for source-map upload routing
- [`agents/specialists/_registry/payments/SKILL.md`](../agents/specialists/_registry/payments/SKILL.md) — consults the matrix for Stripe/Paddle webhook + product operations
- [`scripts/lib/doctor.mjs`](../scripts/lib/doctor.mjs) — gains a `mcp-cli-matrix-staleness` check (follow-up PR)

**This ADR is affected by** *(upstream — these define constraints on this decision)*:

- [`adr/0032-deployment-hardening.md`](./0032-deployment-hardening.md) — §E explicitly deferred the capability matrix to v0.3.2; this ADR closes that deferral
- [`adr/0027-permissions-protocol.md`](./0027-permissions-protocol.md) — LR-04 categories cross-reference the matrix's `Human-browser: required` rows as a flag for `external_service_setup` operations requiring human-in-the-loop
- [`adr/0028-oauth-preference.md`](./0028-oauth-preference.md) — credential-hierarchy guidance is the second axis in the surface-selection decision (capability first, then credential hygiene)
- [`layers/L4-tooling.md`](../layers/L4-tooling.md) — the "MCP-over-CLI for credentialed services" section establishes the credential-hygiene preference this ADR is layered atop
- [`adr/0022-xlsx-docs-convention.md`](./0022-xlsx-docs-convention.md) — the matrix's table format mirrors the xlsx-convention precedent for structured-tabular data in the project

## References

- AnonForum deployment session post-mortem (2026-05-21, user direction)
- Anthropic Model Context Protocol spec — https://modelcontextprotocol.io/specification
- Twelve-Factor App methodology — https://12factor.net
- Per-platform CLI documentation and MCP server source repos (cited inline in each matrix row's Source column)
