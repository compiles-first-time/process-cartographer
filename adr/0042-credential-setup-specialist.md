# ADR-0042: Credential-setup specialist (browser-driven registration, login, 2FA, API-key retrieval)

**Status:** Accepted
**Date:** 2026-06-07
**Author:** Architect (Nick) — requested in the 2026-06-07 session; drafted by Builder
**Confidence:** [H]

## Context

Loom can already *provision* and *store* credentials, but it cannot *acquire* them. The gap:

- [ADR-0035](./0035-provisioning-specialist-and-playbooks.md) (`provisioning` specialist) drives platform **management APIs** — but only *after* the architect has a PAT in hand. Its playbook schema explicitly buckets account creation, login, and key generation as **Class B "browser-only" steps** that the provisioning specialist *declines and hands back* to the architect.
- [ADR-0036](./0036-credential-collection-patterns.md) (`scripts/collect-credentials.{sh,ps1}`) **stores** a credential the architect already possesses — it prompts via terminal stdin, validates, and writes to the OS keyring. It assumes the secret already exists.
- `auth` / `oauth` specialists design *application* authentication; they don't register the developer's own accounts on third-party services.

So the very first link in the credential lifecycle — *"I have no account on this service; get me a validated API key"* — is entirely manual. The [2026-05-22 Ravenwise lesson](../lessons-learned/2026-05-22-browser-gated-provisioning-friction.md) named this "browser-gated provisioning friction": the architect repeatedly broke out of the build session to sign up, click through dashboards, copy keys, and paste them back. Root cause 4 of that lesson (auth target unverified) is the same friction viewed from the security side.

In the 2026-06-07 session the architect asked for a specialist that **drives those browser steps directly** — account registration, login, 2FA / email verification, and navigating to API-key generation — **with explicit user consent at every step**, then hands the resulting secret to ADR-0036's stdin path. This ADR specifies that specialist and the guardrails that keep it constitutional.

## Decision

Adopt a **`credential-setup`** bundled specialist that acquires web-gated credentials via **browser automation** (Claude in Chrome MCP) under a **strict human-in-the-loop consent model**, delegating secret capture and storage to ADR-0036 and management-API work to ADR-0035.

### A. Scope

**In scope:** navigating a provider's web UI to (1) register a new account, (2) log into an existing account, (3) satisfy a 2FA / email / SMS verification gate, (4) reach and trigger generation of an API key / token in a dashboard.

**Out of scope (delegated):**
- **Secret capture + storage** → `scripts/collect-credentials.{sh,ps1}` (ADR-0036). The specialist never reads, screenshots, or stores a secret value itself (see §C).
- **Management-API provisioning** (create project, set env var, add redirect URI) → `provisioning` (ADR-0035), which runs *after* this specialist lands the credential.
- **OAuth authorization-code/token flows** → `oauth`. **Application password/session auth** → `auth`.

**Path preference (browser is the fallback).** Before automating a UI, the specialist checks the platform playbook + docs for a cheaper acquisition path: programmatic key/token issuance → provider OAuth (ADR-0028) → an existing MCP → and only then browser. A look-alike caught during the 2026-06-07 validation: Alpaca's `issuetokens` (`POST authx.alpaca.markets/v1/oauth2/token`) is OAuth2 *access-token* issuance for OAuth/Broker partners, **not** self-service trading-key creation — Alpaca trading keys remain dashboard-only, so browser acquisition is the correct path *there*, but the check must be made (read the doc, don't infer from the name). Separately, the official `alpaca-mcp-server` *consumes* keys this specialist acquires (it is downstream operational tooling, not an acquisition path).

### B. Consent model (Kernel Rule 8 + LR-04)

This specialist runs **human-in-the-loop, never autonomously.** It cannot be dispatched as a fire-and-forget subagent, because every consequential step is consent-gated and 2FA requires a human. Before any browser action that **creates state, submits a form, accepts terms, or generates a credential**, the agent must present — and wait for explicit approval of:

1. **The action** — what it is about to click/submit and on which page/URL.
2. **The smallest-needed scope** — the narrowest account tier / key scope that satisfies the goal (e.g., paper-trading-only, read-only key, single-project token).
3. **The reversibility** — whether the step is undoable (Kernel Rule 20). Account creation and ToS acceptance are effectively irreversible and are flagged as such.

**Anti-paternalism (Rule 8):** the agent never decides "for the user's benefit" to skip a consent gate, auto-accept terms, or pick a broader scope for convenience. The user authors the decision; the agent executes it. Read-only navigation (loading a page, reading non-secret on-screen text) does not require per-action consent.

**Executing-agent constraint (hard — above the consent model).** The Claude instance executing this specialist is bound by its own safety policy, which for standard instances **prohibits creating accounts, entering passwords to authenticate, and solving CAPTCHAs even when the user authorizes it.** Where that policy applies, the specialist **degrades to *guide + validate + store*:** the agent navigates read-only and guides, the **human performs** account creation / password entry / login / CAPTCHA / KYC, and the agent then owns validation + keyring storage (via `collect-credentials`) + downstream config. This is not consent-gateable — it supersedes §B's protocol. Surfaced during the 2026-06-07 Alpaca/Sovereign Forge validation; it means the specialist's realistic value is *friction removal + correct storage + the secret-handoff seam*, with the irreversible auth actions always human-performed. **Stronger still:** the agent's browser tool may block the target **domain** entirely (financial/brokerage/regulated sites are), so for such services even read-only navigation fails and the specialist degrades to **text guidance** from authoritative docs + a docs MCP. (Confirmed 2026-06-07: `app.alpaca.markets` was blocked for browser automation — which is *why* the docs-MCP + playbook path matters: it's how the specialist stays useful when it can't touch the site.)

### C. The LR-03 secret-handoff seam

The defining safety property. A browser agent that *reads a freshly generated secret off the page* (via screenshot, `get_page_text`, DOM read) pulls that secret into its context and the event log — a permanent LR-03 leak. Therefore:

- The agent drives navigation **up to** the key-generation result, then **stops and hands off**: the user copies the secret from their *own* browser into `collect-credentials.{sh,ps1} <platform>` (terminal stdin, echo-suppressed), which validates and writes it to the OS keyring. The secret's only homes are the user's clipboard, the keyring, and process memory at runtime — exactly ADR-0036's invariant. **It never traverses chat, tool args, or a screenshot the agent ingests.**
- The agent **must not** call screenshot/`get_page_text`/DOM-read tools on a viewport that displays a secret value. If a secret is unavoidably on screen, the agent narrates the hand-off instead of capturing.
- **Passwords** chosen during signup are typed by the **user directly into the browser field** at a consent pause, or generated locally and routed through the keyring — never passed as a browser-automation tool argument (which would be logged).
- The agent **may** capture **non-secret** identifiers needed for attestation: the account email/username, or a provider-designated *public* key ID (e.g., Alpaca's `APCA-API-KEY-ID`, which is sent as a non-secret request header). When in doubt, treat a value as secret and hand it off.

### D. 2FA / verification handling

At a 2FA, email-verification, or SMS gate the agent **pauses and requests the code from the user**, who reads it from their authenticator / inbox / phone. With **explicit per-instance consent**, the agent may instead read a one-time verification code from a connected email MCP — the code is *used*, not written to memory (LR-01: external content is untrusted and non-persistent here). The agent never persists or logs the code.

### E. Decline triggers (hard stop → hand to user)

The agent stops and hands control to the user — it does **not** attempt to bypass — when it encounters:

- **CAPTCHA / anti-bot challenges.** Never solved deceptively. Both an integrity matter and typically a ToS matter.
- **KYC / government-ID / selfie / liveness** verification.
- **Payment-method entry** (card numbers, bank details).
- **Any step the provider's Terms of Service prohibit automating.** The agent surfaces the ToS consideration (Kernel Rule 22 transparency) and lets the user decide whether and how to proceed (Rule 8). The agent does not covertly evade bot detection.

### F. Registration in `collect-credentials`

A platform this specialist targets must have a `collect-credentials.{sh,ps1}` entry declaring its credential env-var names, keyring accounts, and a read-only validation endpoint (for the post-storage account attestation that closes Ravenwise Root cause 4). This ADR adds **Alpaca** as the first such entry. Alpaca authenticates with two custom headers (`APCA-API-KEY-ID` / `APCA-API-SECRET-KEY`) validated *as a pair* against `GET https://paper-api.alpaca.markets/v2/account`, so the collector gains a paired **validate-before-store** path distinct from the existing single-bearer flow.

## Evidence basis

> Required v0.4+ per [LR-05](../constitution/local-rules.md#lr-05).

- **Primary evidence:**
  - 2026-06-07 architect request: a specialist that "handles account registration, login, 2FA, and API key retrieval using browser automation, with explicit user consent at every step." `[user-direction][H]`
  - [`lessons-learned/2026-05-22-browser-gated-provisioning-friction.md`](../lessons-learned/2026-05-22-browser-gated-provisioning-friction.md) — names the friction this specialist removes and Root cause 4 (auth target unverified) the attestation step closes. `[user-report][H]`
- **Corroborating sources** *(independent — checked at the publisher level)*:
  - [ADR-0036](./0036-credential-collection-patterns.md) — the stdin→keyring storage discipline this specialist hands off to; §C's secret-handoff seam is the operationalization of ADR-0036's "secret never traverses chat" invariant. `[primary][H]`
  - OWASP ASVS 2024 §2.10 (service-credential storage) + §2 (authentication) — credentials belong in an OS keystore, not in logs/transcripts; informs §C. `[institutional][H]`
  - Claude in Chrome MCP (navigate / snapshot / read / form_input / click) — the browser-driving capability this specialist's tool scope assumes. `[vendor][M]`
- **What would change this call:**
  - Providers converge on **programmatic signup + key-issuance APIs** (today almost none exist; signup is browser-gated) — would shrink §A's browser scope to a thin fallback and shift most work to `provisioning`.
  - A headless, auditable consent mechanism emerges that lets a subagent pause for human approval mid-run — would relax §B's "main-session only" execution constraint.

## Cost model

> Required per [LR-06](../constitution/local-rules.md#lr-06) — this specialist runs an observe→act browser loop.

- **Which LLM calls are iterative:** the browser drive loop — *snapshot/read page → decide next action → act (navigate/click/fill) → re-observe*, repeated until the credential is acquired.
- **Exit condition:** task complete (credential handed to the collector) **OR** the user aborts **OR** a §E decline trigger fires. The loop is **human-gated** — every consequential action (§B) blocks on explicit user consent, so the human is the rate-limiter; it cannot spin unbounded. No autonomous retry loop on a failed step: a failure is surfaced to the user, not silently retried.
- **Estimated token bound (typical):** ~10–40 model turns per credential acquisition (navigation + a handful of form steps), each carrying a DOM/vision snapshot. Roughly comparable to a short interactive debugging session.
- **Estimated token bound (worst case):** bounded by user patience and the decline triggers; a stuck flow hits a §E hand-off rather than looping. Single agent, single session — **not** a fan-out.
- **Cost multiplier vs single-pass baseline:** n/a (interactive, human-paced) — this is not a batch/automated pattern; cost accrues only while the user is actively approving steps.

## Consequences

**Locks in:**
- The consent-gated browser pattern (§B) and the secret-handoff seam (§C) as the canonical way to acquire web-gated credentials.
- `credential-setup` as a distinct specialist from `provisioning` — *acquisition* (browser + consent + 2FA) vs *management-API operation* are separate phases with separate risk profiles.
- A new `browser_credential_automation` permission category (§ permissions) making browser-driven credential actions observable in the event log.

**Locks out:**
- Autonomous (no-consent) account creation or ToS acceptance.
- Capturing secret values into the agent's context (screenshot/DOM read of a key) — the stdin seam exists precisely to avoid this.
- Covertly defeating CAPTCHA / bot-detection.

**Migration path if it fails:** the specialist is a SKILL.md + a playbook + a collector platform entry + a permission category. Reverting = delete those and the manifest row; nothing else depends on it. Projects already using `collect-credentials` literally are unaffected.

## Alternatives considered

- **Status quo (manual browser steps).** Rejected — the exact friction the Ravenwise lesson named.
- **Fully autonomous signup bot (no consent gates).** Rejected — violates Kernel Rule 8 (anti-paternalism), Rule 2 (unconsented action), LR-03 (would capture the secret), and collides with CAPTCHA/KYC/ToS reality. Consent gates are not optional friction; they are the design.
- **Provider-API-only signup.** Rejected — virtually no provider offers programmatic account creation + key issuance; the browser path is unavoidable today.
- **Fold into the `provisioning` specialist.** Rejected — provisioning is *post-credential* management-API work with an idempotent-write risk profile; acquisition is *pre-credential* browser work with a consent/2FA/secret-handling risk profile. Mixing them produces a SKILL.md that is both too long and discipline-confused.
- **Capture the secret via screenshot, then store it programmatically.** Rejected — direct LR-03 violation. The whole point of §C is that the secret never enters the agent's context.

## Affects / Affected by

**This ADR affects** *(downstream — when this ADR changes, these must be reviewed)*:

- `agents/specialists/_registry/credential-setup/SKILL.md` (NEW) — the specialist this ADR specifies
- `agents/specialists/_registry/manifest.yaml` — new `credential-setup` registry row
- `.claude/agents/credential-setup.md` (NEW) — runtime subagent counterpart
- `observability/eval-suite/subagents/credential-setup.md` (NEW) — canonical-prompt eval
- `scripts/collect-credentials.{ps1,sh}` — Alpaca platform entry + paired two-header validate-before-store path
- `tools/provisioning-playbooks/alpaca.md` (NEW) — browser-step playbook (ADR-0035 schema)
- `.claude/loom-permissions.yaml` — new `browser_credential_automation` category
- `CLAUDE.md` — ADRs-in-flight + agent count

**This ADR is affected by** *(upstream — these define constraints on this decision)*:

- [`constitution/kernel-v6.md`](../constitution/kernel-v6.md) — Rule 8 (anti-paternalism; §B), Rule 2 (unconsented narrowing; §B), Rule 20 (irreversible account creation; §B), Rule 22 (ToS transparency; §E)
- [LR-03](../constitution/local-rules.md#lr-03) — secrets never in chat/args/logs (§C, the secret-handoff seam)
- [LR-04](../constitution/local-rules.md#lr-04) — permissions protocol (§B; new `browser_credential_automation` category)
- [LR-01](../constitution/local-rules.md#lr-01) — external content untrusted (§D; verification codes used, not persisted)
- [ADR-0036](./0036-credential-collection-patterns.md) — credential collection/storage this specialist hands off to
- [ADR-0035](./0035-provisioning-specialist-and-playbooks.md) — sibling provisioning specialist + playbook schema (§A boundary, §F playbook)
- [ADR-0028](./0028-oauth-preference.md) — OAuth-preference + L4 credential hierarchy (prefer provider OAuth when offered)
- [ADR-0027](./0027-permissions-protocol.md) — LR-04 operationalization the new category plugs into
- [ADR-0023](./0023-specialist-registry.md) — bundled-specialist registry mechanics
- [ADR-0034](./0034-specialist-invocation-discipline.md) — how this specialist is invoked when the registry isn't loaded
- [ADR-0022](./0022-xlsx-docs-convention.md) — failure-mode (CRED-EX-NN) table format
- [ADR-0018](./0018-secrets-handling.md) — pattern-based redaction; complementary defense to §C

## References

- 2026-06-07 architect session (this decision)
- [`handoff/2026-06-07-credential-agent-and-sovereign-forge.md`](../handoff/2026-06-07-credential-agent-and-sovereign-forge.md)
- Lesson 2026-05-22 (`browser-gated-provisioning-friction.md`)
- ADR-0035 (provisioning), ADR-0036 (credential collection)
- Alpaca Trading API — account endpoint `GET /v2/account`, paper base `https://paper-api.alpaca.markets` (https://docs.alpaca.markets/reference/getaccount)
- OWASP ASVS 2024 §2 / §2.10
