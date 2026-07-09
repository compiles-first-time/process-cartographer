# ADR-0032: Deployment hardening — pre-flight quota, wait-for-terminal-state, failure-mode heuristics

**Status:** Accepted
**Date:** 2026-05-21
**Author:** Architect handoff from AnonForum deploy session (Nick), built out by Claude
**Confidence:** [H]

## Context

A real deployment session (AnonForum project, Vercel + Supabase stack, 2026-05-21) surfaced a gap class the v0.2 runtime did not catch. A one-line code fix took ~14 hours to ship to production. The code change was correct on first try; everything between "code change" and "live in prod" was where Loom lost time.

Five findings from the post-mortem, all silent-failure modes:

1. **Pre-flight quota failure went undetected.** Vercel Hobby plan had 0 build minutes allocated AND no payment method on file. Every `vercel deploy` returned `"status": "error", "reason": "deploy_failed", "message": "Not authorized"`. Six deploys silently failed before checking the billing dashboard.
2. **CLI auth tokens lose write scope over time.** `vercel login` (device-code flow) issues READ scope permanently but DEPLOY scope can drop between sessions. Symptom: `vercel ls` works, `vercel deploy` fails with "Not authorized." Recovery: `vercel logout && vercel login`.
3. **Wait-for-terminal-state loops have an incomplete state set.** A `until grep -qE "Production|Error|Ready"` loop hung for 12 hours because Vercel's quiet-fail state is `UNKNOWN` — not matched by any of those tokens. Nothing surfaced the stall.
4. **Auth errors are often quota / billing errors.** Cloud platforms collapse permission-denied and budget-exhausted into the same HTTP status and message. Re-authenticating burns 5+ minutes without fixing the real problem.
5. **CLI exit codes lie.** `vercel deploy` runs returned exit code 0 with body `"status": "error"`. Trusting exit codes alone is unsafe across `vercel`, `gh`, `supabase`, and other modern CLI tools.

Each finding individually is small. Together they describe a systemic gap: the v0.2 runtime trusts process signals (exit codes, CLI success) and string-matches output, while modern cloud platforms communicate through structured response bodies + state-machine APIs that the legacy signals don't faithfully represent.

A bonus (lower-priority) finding: MCP servers and CLI tools disagree on which (platform, action) tuples actually work. The Vercel MCP exposes `deploy_to_vercel` but the implementation just returns "run the Vercel CLI." Specialists need to know which surface drives which action *before* picking one.

User direction 2026-05-21:

> "Priority: 3 (wait-loop coverage) is the highest leverage because it would have caught all the other findings 5 minutes after they started, instead of hours later. Implement it first."

## Decision

Adopt a four-part deployment-hardening pattern, binding from the merge date of this ADR. Each part is independently testable and independently superseded if a better mechanism emerges.

### A. Wait-for-terminal-state primitive (Finding 3 — implemented)

`scripts/lib/wait-for-deploy.mjs` provides a `waitForDeploy()` function with **three terminal outcomes**, not two:

- `succeeded` — platform reported a known success state
- `failed` — platform reported a known failure state
- `non_progressing` — platform reported a non-terminal state for too long, an explicit unknown-class state, or no observation arrived for too long

The `non_progressing` outcome is the new primitive. It fires a loud `onProgress({event: "non_progressing", message: "..."})` event before returning, with a human-readable diagnostic naming the reason (`stall`, `in_progress_timeout`, `explicit_state`, `stream_ended_without_terminal_state`).

Each known platform has a `TERMINAL_STATES[platform]` registry classifying its states into `succeeded`, `failed`, `in_progress`, and `non_progressing` buckets. Adding a new platform = enumerate the states + cite the source. Default thresholds: 20 min in `in_progress`, 5 min of silence = stall.

Used by `scripts/lib/deploy.mjs` and by specialists that drive long-running platform operations.

### B. Pre-flight quota check requirement (Findings 1, 4)

**Every specialist touching a billable cloud service MUST emit a `pre_flight_quota_check` event as the first audit-log line for the operation.** The check consults the platform's usage / quota / billing API and verifies:

1. A payment method (or sufficient free credit) is on file
2. The relevant quota (build minutes, requests, storage) is not at zero
3. The account is not in a hard-suspended state

If any check fails, the specialist surfaces "you need to add a payment method / upgrade plan" with the **exact dashboard URL** before attempting the platform operation. The specialist does NOT retry the operation until the user confirms the quota state is fixed.

Skipping the pre-flight check on a billable platform is a **constitutional violation** under LR-04 (`external_service_setup` category). The `permissions-classifier.mjs` (v0.6 P) recognizes any `*-deploy`, `*-provision`, `*-create` action against a known billable platform as requiring this pre-flight.

Failure-mode disambiguation heuristic for Finding 4: if WRITE-auth fails but READ-auth succeeds against the same credentials, the failure is almost always quota / billing / plan-tier, NOT actual permission revocation. Specialists must check quota before recommending re-authentication.

### C. Trust response bodies over exit codes (Finding 5)

Specialists driving CLI tools (`vercel`, `gh`, `supabase`, `flyctl`, `netlify`, `render`, etc.) MUST:

1. Capture stdout AND stderr separately
2. Attempt to parse the captured output as JSON (or as the documented response shape)
3. Treat the parsed `status` / `state` / `error` field as authoritative
4. Treat the process exit code as one signal among several — never trust it alone for platform operations

The Loom deploy primitive (`scripts/lib/deploy.mjs`) is updated in a follow-up to apply this discipline. Specialist SKILL.md files declare the response-body shape they expect in a new `Response shape` section (deferred to v0.3.2 — too much surface area to add in one PR).

### D. Device-code-auth scope-drop recovery (Finding 2)

For specialists targeting platforms that authenticate via device-code flow (Vercel, GitHub, Supabase, Cloudflare, Render), the first diagnostic step when a write operation fails with auth-error but reads still work is:

```
<platform> logout && <platform> login
```

This is added as a failure-mode entry in the deploy SKILL.md and the oauth SKILL.md, and as a lessons-learned entry that the Stop hook (ADR-0014) auto-suggests when a similar pattern recurs.

### E. Deferred — bonus: MCP-vs-CLI capability matrix

The Vercel MCP, Supabase MCP, and others have asymmetric (action, surface) coverage. A specialist pre-flight should consult a `(platform, action) → {mcp_capable, cli_required, human_browser_required}` matrix before assuming it can drive the platform end-to-end. This requires its own design pass and surface mapping — deferred to a v0.3.2 PR. Scoped out of this ADR to keep the wait-for-deploy primitive shippable now.

## Evidence basis

- **Primary:** Real deployment session post-mortem (AnonForum, 2026-05-21) — direct observation that the listed silent failures occurred and the listed mitigations would have caught them. `[user-report][H]`
- **Corroborating sources** *(independent — checked at the publisher level, not just URL)*:
  - **Vercel deployment-states documentation** confirms `UNKNOWN`, `BUILDING`, `READY`, `ERROR`, `CANCELED` as the canonical state set. Source: https://vercel.com/docs/deployments/states. `[vendor][H]`
  - **Netlify deploys API** confirms `NEW`, `ENQUEUED`, `PREPARING`, `PROCESSING`, `UPLOADING`, `UPLOADED`, `READY`, `CURRENT`, `ERROR`, `REJECTED`. Source: https://docs.netlify.com/api/get-started/#deploys. `[vendor][H]`
  - **Google SRE Book chapter 6 — Monitoring distributed systems**, Beyer et al. (2016), §"Setting reasonable expectations for monitoring." Treating a long-running operation's silent state as success is the canonical anti-pattern; the cited mitigation is exactly the "non-progressing as first-class outcome" model. `[institutional][H]`
  - **The Twelve-Factor App §X (Dev/prod parity)** — "Treat backing services as attached resources" — and §XII (Admin processes). Establishes the discipline of treating platform responses as the source of truth, not local process signals. `[primary][H]`
  - **OWASP Application Security Verification Standard v4.0.3 §1.4 — Access Control Architecture.** Distinguishes "permission denied" from "rate-limited" from "billing-suspended" as orthogonal failure modes that observers must disambiguate. `[institutional][H]`
- **Synthesizer reasoning:** The five findings are individually small but collectively describe a systemic mismatch between v0.2's process-signal–based design and modern cloud-platform response semantics. The wait-for-terminal-state primitive (part A) is the highest-leverage mitigation because it converts the "silent hang" failure mode — the worst outcome — into a fail-loud event with diagnostic context.
- **What would change this call:**
  - A peer-reviewed analysis demonstrating that a different failure-detection abstraction (e.g., distributed tracing exclusively, no state-machine model) is measurably more reliable for cloud-platform operations.
  - Real-session evidence that the chosen thresholds (5 min stall, 20 min in_progress) produce too many false positives — would require tuning, not the model change.
  - A platform standardizes its CLI exit codes to faithfully reflect deploy outcome, removing the need for Finding 5's discipline (no evidence of this happening across the industry as of 2026-05-21).

## Consequences

**Locks in:**

- A three-outcome model (`succeeded` / `failed` / `non_progressing`) for all long-running platform operations. Specialists may not silently wait without a defined non-progressing detector.
- Pre-flight quota check as a constitutional requirement for billable-platform operations. The check is auditable via the JSONL event log.
- Response-body parsing as authoritative over process exit codes for platform CLIs.
- The `TERMINAL_STATES` registry as the single source-of-truth for what each platform's states mean. Adding a new platform requires updating this registry + citing the source.

**Locks out:**

- Wait loops that match only against `succeeded` and `failed` tokens (Finding 3 anti-pattern). New code review should reject these.
- Treating any cloud-platform CLI's exit code as the deploy outcome (Finding 5 anti-pattern).
- Recommending re-authentication on a write-fails-but-read-succeeds symptom without checking quota first (Finding 4 anti-pattern).

**Migration path if it fails:**

- The wait-for-deploy primitive is one file; removing it disables nothing else. Specialists fall back to direct CLI invocation.
- The pre-flight requirement is a SKILL.md convention + a `permissions-classifier.mjs` rule; relaxing it requires a superseding ADR per LR-05.
- Each terminal-state registry entry is independent; one platform's classifications can be revised without touching others.

## Alternatives considered

- **Two-outcome model (success / failure only) with retries.** Rejected: the AnonForum session's 12-hour hang is exactly this pattern's failure mode. Retries without non-progressing detection multiply the loss when the deploy is wedged.
- **Cap wait time to a fixed 30 minutes for every deploy, no state machine.** Rejected: produces high false-positive rate on legitimate slow deploys (cold starts on free tiers can take 10+ min), and silently fails on truly hung deploys that complete in 31 minutes via a transient self-heal.
- **Pre-flight quota check via a generic "any HTTP 4xx → bail" heuristic.** Rejected: doesn't distinguish quota-exhaustion from permission-denied, and platforms increasingly return 200 with a JSON error body (Finding 5).
- **Build the MCP-vs-CLI capability matrix (bonus finding) now.** Rejected: it's a separate design problem requiring per-MCP enumeration and would expand this ADR's scope past testability. Deferred to v0.3.2.
- **One ADR per finding.** Considered. Rejected: the findings are interconnected (a single deployment session surfaced them) and they share the same evidence basis + same downstream artifacts. Splitting would create cross-reference overhead without clarifying decisions.

## Affects / Affected by

**This ADR affects** *(downstream — when this ADR changes, these must be reviewed)*:

- `scripts/lib/wait-for-deploy.mjs` — the primitive implementation
- `scripts/lib/wait-for-deploy.test.mjs` — the test suite
- `scripts/lib/deploy.mjs` — integration of the wait primitive (planned follow-up PR, v0.3.2)
- `agents/specialists/_registry/deploy/SKILL.md` — failure modes + pre-flight requirements + response-body discipline
- `agents/specialists/_registry/oauth/SKILL.md` — device-code scope-drop entry (planned follow-up)
- `lessons-learned/2026-05-21-auth-scope-drop-on-device-code.md` — recurring-pattern entry
- `lessons-learned/2026-05-21-write-fails-read-works-is-quota.md` — recurring-pattern entry
- `lessons-learned/2026-05-21-exit-code-zero-with-error-body.md` — recurring-pattern entry
- `scripts/lib/permissions-classifier.mjs` — recognizes the pre-flight requirement as `external_service_setup` (follow-up integration)
- `layers/L4-tooling.md` — capability-matrix design when v0.3.2 ships

**This ADR is affected by** *(upstream — these define constraints on this decision)*:

- `constitution/local-rules.md` — LR-04 (permissions protocol meta-rule; pre-flight is in the `external_service_setup` category)
- `constitution/kernel-v6.md` — Rule 22 (epistemic transparency; non_progressing must emit an audit event with reason)
- `adr/0019-deploy-primitive.md` — establishes the deploy primitive this ADR extends
- `adr/0022-xlsx-docs-convention.md` — failure-mode table format used in updated specialist SKILL.md files
- `adr/0027-permissions-protocol.md` — LR-04 categories the pre-flight check is enforced under

## References

- AnonForum deployment session post-mortem (2026-05-21, user direction)
- Vercel deployment-states docs — https://vercel.com/docs/deployments/states
- Netlify deploys API — https://docs.netlify.com/api/get-started/#deploys
- Fly.io release-states — https://fly.io/docs/reference/release-states/
- Render deploy-statuses — https://render.com/docs/deploys#deploy-statuses
- Beyer, Jones, Petoff, Murphy — *Site Reliability Engineering*, Google (O'Reilly 2016), Chapter 6 — Monitoring distributed systems
- Twelve-Factor App methodology (Adam Wiggins, 2011/2017) — https://12factor.net
- OWASP ASVS v4.0.3 §1.4 — Access Control Architecture
