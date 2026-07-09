---
date: 2026-05-22
agent: ravenwise-session (synthesized from real use of Loom to spin up a first project)
severity: high
share: true
---

# Browser-gated provisioning fragments the architect's flow — and we over-classified actions as browser-only

## What happened

A new project (Ravenwise — a Google-OAuth-gated reading log) was bootstrapped from `loom-template` for the first time as a real architect-builder collaboration. The builder reached the deploy-prep stage and surfaced two unavoidable manual steps to the architect:

1. **Create a Supabase project** — the builder cited the v0.3.2 [MCP-vs-CLI capability matrix](../tools/mcp-cli-capability-matrix.md), which claimed `create-project` was browser-only.
2. **Create a Google Cloud OAuth 2.0 Client ID** — the builder treated this as browser-only by inheritance (no matrix row at the time).

The architect responded:

> "I do not want to have to do this. These specific pieces of information need to be updated in the Loom repo of GitHub and NOT with the Ravenwise code/repo."

Two distinct problems were surfaced by that single sentence:

1. **The Supabase claim was wrong.** Supabase ships a [Management API](https://supabase.com/docs/reference/api/introduction) with `POST /v1/projects` that creates projects programmatically given a Personal Access Token (PAT). The matrix row I authored in PR #27 was `[H]` confidence but the claim "no programmatic path" was incomplete — I checked dashboard docs and concluded no automation existed, when in fact a separate Management API exists at `api.supabase.com` distinct from the per-project APIs at `<ref>.supabase.co`.
2. **Even where browser-gating is genuine** (e.g., creating a standard-web-app OAuth Client in Google Cloud Console — there is no first-party API for this), the *fragmentation cost* on the architect's flow is real and not adequately surfaced as a Loom-level concern. The architect's working time gets diced by "go log into X, do Y, come back" round-trips. Each round-trip exits the loom-template's session, breaks the audit trail, and burns context.

## Why it happened

Three root causes, on different layers. **The third was surfaced by the architect after the first version of this lesson was authored — it is the load-bearing one.**

### Root cause 1 — matrix population was shallow

When I populated `tools/mcp-cli-capability-matrix.md` rows in PR #27, I checked **per-project / per-resource** docs (e.g., Supabase's CLI reference, which doesn't cover org-level project creation) and concluded "no programmatic path" without looking for **org-level / management** APIs at distinct domains. ADR-0033 §A invariant #1 ("at least one surface must be populated") was satisfied — `Human-browser: required` is a valid surface — but the `[H]` confidence marker was unwarranted for "no automated path" without checking the platform's management API surface.

### Root cause 2 — Loom doesn't yet have an opinion about minimizing browser-gated friction

The matrix tells you whether a given action is browser-gated. It does **not**:

- Suggest *credentials patterns* the architect should set up once (PATs, OAuth-installed-app tokens) that let the builder automate subsequent operations
- Identify *one-time vs. recurring* browser steps — creating an OAuth Client is one-time; creating projects is potentially recurring per Loom user; creating individual records is per-feature
- Provide a *bootstrap-time provisioning helper* that walks the architect through the one-time setup of PATs and stores them in `.env.local` so subsequent Loom sessions are friction-free
- Recommend a *provisioning specialist* analogous to `deploy` or `oauth` whose purpose is "drive management APIs to provision resources idempotently"

The matrix is necessary but not sufficient. The architect's complaint is precisely that the *gap* between "matrix tells you what's automatable" and "Loom actually automates it" is too wide.

### Root cause 3 — agents did not run during the Ravenwise bootstrap (the deeper failure)

When the architect asked "did agents run to discover, research, and validate any of this information?", the empirical answer was **no**:

- `discovery/quick-scan.md` was stamped by `bootstrap.sh` in non-interactive default mode. `discovery/requirements.md`, `risk-register.md`, and `open-questions.md` — the artifacts produced by the **interactive** `scripts/discover.sh` walkthrough — **did not exist** because the full discover script was never run.
- `memory/event-log/2026-05-22.jsonl` was **0 bytes**. The Loom hooks captured zero events for the entire Ravenwise build session.
- 18 specialist subagent files were stamped at `.claude/agents/*.md` — `auth`, `oauth`, `deploy`, `db-migration`, `secrets`, etc. **None of them were invoked.**

This is a procedural failure that *caused* Root cause 1. If the `deploy` or `oauth` specialist had been consulted (or simulated via the general-purpose `Agent` tool with their SKILL.md as the prompt) when populating PR #27's matrix rows, the management-API question would have surfaced — that's exactly what the specialists exist for. The shallow population in Root cause 1 is downstream of the procedural skip in Root cause 3.

**Why didn't agents run?** Three sub-causes converged:

1. **ADR-0020 architectural constraint.** Claude Code builds the subagent registry at session start. The 18 specialist files were stamped *during* this session by `bootstrap.sh`. They are invisible to the subagent system **until the Claude Code session restarts** — exactly the staleness sentinel ADR-0020 documents. The bootstrap output's "⚠ RESTART CLAUDE CODE NOW" banner was explicit. I read it and **kept going anyway.**
2. **Hook capture didn't apply to this session.** Loom's hooks live in `.claude/settings.json` of the Ravenwise project. The Claude Code session was running with `cwd = C:\Users\14134\Documents\Internal Platform`, not in the Ravenwise directory. When the builder shelled into Ravenwise via `cd` / `Push-Location`, the hook system was already loaded against the parent session's settings, not Ravenwise's. **The builder had no audit trail and did not realize it** until the architect's question forced an inspection of the empty event log.
3. **Available in-session alternatives were not used.** Even with #1 blocking the stamped registry, the builder had: the general-purpose `Agent` tool (any specialist's SKILL.md could be passed as the prompt — "act as the oauth specialist; what's the right Auth.js v5 + Drizzle setup for Google OAuth?"), `WebFetch` for vendor doc validation, and direct reading of SKILL.md files as in-session instructions. None of these required a restart. The builder reached for none of them.

The third sub-cause is the one with no architectural excuse. It's a procedural-discipline gap that needs codifying.

### Root cause 4 — MCP auth target was unverified (surfaced after Root cause 3 was acted on)

**This was caught only because the architect read the org name back.** It would not have been caught by any current Loom mechanism.

After Root cause 3 was captured and the corrective sequence was approved, the builder followed the lesson's own discipline: spawn agents (via the `Agent` tool with each specialist's SKILL.md as the prompt). Agent A's investigation surfaced that the Supabase MCP server's "account" tool group could automate project creation if the MCP was launched in PAT-mode. The builder then proceeded to read-only-test the MCP: `list_organizations`, `get_organization`, `list_projects`, `get_cost`. All four calls succeeded.

The MCP returned one organization: `ZD Digital Marketing`. The builder formatted this finding and asked the architect to confirm before any write.

The architect's response: **"No — wrong account; stop."**

Had the architect green-lit the operation without reading the org name back — or had the MCP been authed to *any* account the architect had access to (e.g., a different personal account of theirs) — the `create_project` call would have written to the wrong organization. Recovery: dashboard cleanup, possible cross-account quota burn, days-later auditability headache, and a `lessons-learned` entry written under a different file name.

**Why this happens:** the MCP server's credential (a PAT) is configured at the *MCP server level* (typically in the user's Claude Code MCP config). The credential travels with the session, not with the project. There is no current Loom mechanism to:

- Cross-check that the MCP's authenticated account matches the project's intended account
- Surface the auth-target to the architect proactively at session start
- Prevent a write op against an unverified target

In effect, every MCP credential is a *shared default* across the architect's projects. For a Loom user who has multiple accounts on the same service (Nick has at least two Supabase accounts: `ZD Digital Marketing` org + the intended `nick@ideallab.ai` org), the default account may be the wrong one for the current project. The builder cannot tell. Only the architect can.

**Why the lesson must absorb this NOW, not later:** the proposed `provisioning` specialist (out-of-scope #4 of the original list) would have committed this exact failure if it had landed in time for the Ravenwise bootstrap. The specialist's discipline would be to "call `create_project` after pre-flight passes" — but pre-flight as currently scoped checks *cost + quota*, not *target-account-identity*. Without the identity-verification step, automation amplifies the wrong-account risk.

## What we did

In this PR:

1. **Corrected the Supabase `create-project` row** in [`tools/mcp-cli-capability-matrix.md`](../tools/mcp-cli-capability-matrix.md) to reflect the Management API + PAT path. Confidence downgraded `[H] → [M]` for the create row because I haven't personally end-to-end verified the API works against a fresh org — that verification is a follow-up.
2. **Added new rows** for Google Cloud OAuth client management (`oauth-client-create`, `oauth-client-list`, `oauth-consent-screen-config`) so the next session doesn't repeat the inheritance mistake.
3. **Added a "One-time browser-gated setup" section** to the matrix's header explaining the credentials-bootstrap pattern (PAT, service account, OAuth installed-app token) so the matrix is a *tool* for friction reduction rather than just a passive inventory.
4. Captured the lesson here.

Out of scope for this PR but flagged for the next architect-builder cycle (in priority order — #4 is the load-bearing one):

- **(#4 — highest leverage) ADR-0034 candidate: specialist-invocation discipline when the registry is unavailable.** Codifies the rule: when stamped specialists at `.claude/agents/*.md` are not invocable (typically because they were stamped *during* the current session), the in-session agent MUST either (a) instruct the architect to restart Claude Code before proceeding, OR (b) use the general-purpose `Agent` tool with the specialist's SKILL.md as the prompt to simulate the specialist's discipline. Bypassing both is a constitutional violation under LR-05 (decisions are best-current-call; specialist consultation is the mechanism for converting training-data assumptions into best-current-call).
- **Bootstrap hardening in `scripts/bootstrap.{sh,ps1}`:** before the "RESTART CLAUDE CODE NOW" banner, the script should write a sentinel file (e.g., `.claude/agents/.session-must-restart`) that a SessionStart hook can detect and refuse to allow code-writing tool calls until either (a) Claude Code restarts (sentinel auto-clears) or (b) the architect explicitly acknowledges the bypass with a one-line file edit. This converts the current advisory banner into an enforced gate.
- **Hook-capture-gap documentation in L6 / ADR-0011.** When an architect runs Loom-based work from a Claude Code session whose CWD is *not* the Loom project, the hooks loaded for that session do NOT fire on Loom's tool calls. The audit trail goes silent. Either ADR-0011 codifies "open Claude Code IN the project directory" as a prerequisite, or Loom ships a session-bound wrapper that detects CWD mismatch and emits a warning event into the project's log so the gap is visible at session start.
- **A `provisioning` specialist** (analogous to `deploy`) whose SKILL.md drives the platform-management APIs Loom now knows exist (Supabase, Vercel, Render, GitHub, Cloudflare, fly, etc.). The specialist would consult the matrix, find management-API rows, and provision resources end-to-end after the architect has set up the relevant PATs once.
- **A bootstrap-time provisioning-PAT collection step** in `scripts/bootstrap.{sh,ps1}` — interactive prompt: "Do you want to enable programmatic provisioning of {Supabase, Vercel, ...}? Paste a PAT for each platform; we'll store under `.env.local`." Honors LR-03 (paste-in-shell, not chat). This would close the loop on "I don't want to do this manually."
- **A matrix maintenance discipline doctor check** — when a `[H]` confidence "no automated path" row is added, doctor surfaces a soft warning to verify against the platform's management API documentation before committing.
- **(new — high-leverage adjacency to #4 + provisioning specialist) MCP auth-target verification at session start.** Specifically: a SessionStart hook + doctor check that, for every credentialed-service MCP (Supabase, GitHub, Vercel, Stripe, etc.) configured in the project's `.claude/settings.json`, calls the MCP's identity / "whoami" / `list_organizations` equivalent and writes the authenticated identity to `tools/discovered-runtime.md` under a new section: `MCP auth targets`. Bootstrap then asks the architect to attest, per credentialed MCP: "the `<service>` MCP is authenticated as `<identity>`; confirm this is the intended account for this project [y/N]." Attestation is recorded in `.claude/mcp-auth-attestations.json` (gitignored to prevent identity leaks via the audit log) and is required before any MCP write tool call. Per ADR-0027 / LR-04 `credentials` category. This closes the Root cause 4 gap.

## What we'd do differently

When populating the MCP-vs-CLI capability matrix from now on, the discipline:

1. **Check both per-resource and management API surfaces.** A platform's CLI rarely covers org-level operations; the Management API often does. Search the docs site for "Management API" and "PAT" before claiming "no programmatic path."
2. **Confidence markers reflect investigation depth.** A row with `[H]` "no automated path" must cite the management-API doc that confirms the gap, not just the CLI doc that doesn't cover it. Default to `[M]` until verified end-to-end against a real account.
3. **Distinguish *one-time* from *recurring* browser-gating** in the Notes column. "One-time PAT setup; then automatable" is a different friction class than "every operation requires browser confirmation."
4. **Loom's job is friction reduction, not friction documentation.** If a browser-gated row is for an operation the architect will hit repeatedly (creating projects, rotating credentials, adding redirect URIs), the matrix row is a signal that we should ship a `provisioning` specialist + helper, not that we should resign to manual work.

When using the matrix in real builder work, the heuristic:

- See a `Human-browser: required` row → **don't surface to the architect immediately**. First check: is there a management API the matrix missed? Is there a one-time-setup pattern that converts this from recurring-manual to one-time-manual? Surface the friction only after that check.
- If the operation is genuinely one-time-per-account (Google OAuth Client creation), bundle ALL one-time setup into a single architect handoff at session start, not one-step-at-a-time mid-session.

**Specialist-invocation discipline (the load-bearing change):**

When starting a new Loom-based project:

1. **Check the registry state.** If `.claude/agents/*.md` were stamped *during* the current Claude Code session (which is the normal case immediately after bootstrap), the stamped specialists are NOT invocable until restart per ADR-0020.
2. **If the registry is unavailable, do NOT proceed as the "general builder."** Use the general-purpose `Agent` tool with each relevant specialist's SKILL.md content as the prompt. The agent invocation acts as a *simulation* of the specialist — it inherits the SKILL.md's failure-mode discipline, response-shape contracts, evidence-basis requirement, and declination triggers. This produces specialist-quality output even when the registry isn't loaded.
3. **Log the simulation explicitly.** Each Agent-tool invocation that simulates a registry specialist must record in the project's audit trail (or, when the hook system isn't capturing — see below — in the session's chat output): "Acting as the `<X>` specialist via Agent tool because the stamped registry is not yet invocable in this session."
4. **Verify hook capture is live.** Before writing any non-trivial code, check `memory/event-log/YYYY-MM-DD.jsonl` for a SessionStart event. If absent, the hooks aren't firing for this session (likely a CWD mismatch — Claude Code must be opened IN the project directory for `.claude/settings.json`'s hooks to load). Surface the gap to the architect.

The fail-state of these four steps — what happened in the Ravenwise bootstrap — is silent. Nothing crashed. Nothing warned. The builder produced code that compiled, looked plausible, and had documented decisions in CLAUDE.md / ADRs / PRs. The output was just *worse than it should have been* because the specialists' discipline was bypassed. That silent degradation is the hardest failure mode to catch — exactly why the discipline above needs to be enforced (eventually by the SessionStart hook proposed in "Out of scope" #2), not just documented.

**MCP auth-target discipline (Root cause 4):**

Before any MCP write operation against a credentialed service, the agent MUST:

1. **Read the MCP's authenticated identity** via the service's `list_organizations` / `whoami` / equivalent read-only call.
2. **Report the identity to the architect** with the org/account name explicitly named: "The `<service>` MCP is authenticated as `<identity>`. Is this the intended account for this project?"
3. **Wait for explicit architect confirmation** before queuing any write op. "Proceed" / "stop" answers are required; ambiguous responses (`continue`, `looks good`) are not sufficient.
4. **Treat the verification as per-session-per-write-class** — confirming for `create_project` does NOT extend to `create_org` or `delete_project`. Each new write class re-prompts unless the architect's settings explicitly broaden the scope.

The Ravenwise session validated this discipline: the architect's "No — wrong account; stop" response prevented a wrong-org `create_project` call. Without the read-back step, the operation would have proceeded silently. *Trust but verify* is the operative principle, and verify means *get architect attestation*, not *the credential exists therefore it's the right one*.

## Related

- [ADR-0033 — MCP-vs-CLI capability matrix](../adr/0033-mcp-vs-cli-capability-matrix.md) (this lesson amends §C "Maintenance policy" implicitly; a follow-up PR may codify the management-API discipline)
- [`tools/mcp-cli-capability-matrix.md`](../tools/mcp-cli-capability-matrix.md) (rows corrected in this PR)
- [ADR-0032 §B — pre-flight quota check](../adr/0032-deployment-hardening.md) (still applies; a programmatic project create still needs the pre-flight)
- Ravenwise session, 2026-05-22 (architect-builder dialog)
- Supabase Management API docs: https://supabase.com/docs/reference/api/introduction (the surface the original matrix entry missed)
