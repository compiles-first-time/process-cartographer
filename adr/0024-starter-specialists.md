# ADR-0024: Starter specialist pack (12) for v0.4 registry

**Status:** Accepted
**Date:** 2026-05-20
**Author:** Architect handoff (v0.4 PR-M) — approved by Nick
**Confidence:** [M]

## Context

PR-L (ADR-0023) ships the specialist registry mechanism but the manifest is empty. PR-M populates it with **12 starter specialists** that cover the most common project-bootstrap tasks. These are the cases that a real session (the v0.2 AnonForum deploy) handled directly without ever invoking the EAC. The starter pack closes that gap.

Per the v0.4 plan disagreement #1: 12 specialists land here, validated against real sessions, then the remaining 8 from the user's original list (search, cron, cdn, dns, push-notifications, analytics, feature-flags, A/B testing) ship in a follow-up after we see the first 12 perform.

## Decision

Ship the following 12 starter specialists at `agents/specialists/_registry/<name>/SKILL.md` plus matching runtime `.claude/agents/<name>.md` files plus canonical-prompt evals at `observability/eval-suite/subagents/<name>.md`:

| Name | Purpose | Key constraints / load-bearing references |
|---|---|---|
| `auth` | Application authentication — sessions, hashing, MFA | OWASP ASVS v4.0.3 §2/§3, argon2id (Biryukov 2017) |
| `oauth` | OAuth 2.1 / OIDC integration | RFC 9700 (2025), PKCE mandatory, OAuth 2.1 §10.2 state check |
| `deploy` | Runtime deployment configuration (Vercel/Netlify/Fly/Render) | Configures `tools/runtime.yaml` for `scripts/deploy.sh` |
| `db-migration` | Schema migrations (Prisma/Drizzle/SQL) | Two-step deprecate-then-drop pattern (Stripe, Orosz) |
| `secrets` | Credential storage + rotation | LR-03, 12-factor §III, OWASP ASVS §6 |
| `email` | Transactional email | SPF/DKIM/DMARC (RFC 7208/6376/7489), M3AAWG BCP |
| `file-storage` | Object storage (S3/R2/Supabase Storage/Vercel Blob) | Presigned URLs for > 5 MB; expiry ≤ 15min |
| `error-tracking` | Exception monitoring (Sentry/Honeycomb/Datadog) | PII scrubbing mandatory; tiered sampling |
| `monitoring` | Uptime + APM + RUM + OTel | Burn-rate SLO alerts (Google SRE workbook ch. 5) |
| `queues` | Background jobs (BullMQ/Inngest/Trigger.dev/SQS) | At-least-once → idempotency required; DLQ; EIP 2003 |
| `payments` | Stripe/Paddle/Polar | LR-02 production-mutation; PCI tokenization (provider checkout); webhook signature + idempotency |
| `ci` | GitHub Actions CI/CD | Per-job permissions; SHA-pinning for sensitive workflows; deploy gates on tests |

Each ships with:

1. **SKILL.md** (design source) — role, scope, tool allowlist, **xlsx-convention `## Failure modes` section** with SE/BE rows + Justifications, decline triggers, evidence basis (LR-05).
2. **Runtime `.claude/agents/<name>.md`** — Claude Code subagent file; tighter prompt; tool allowlist; decline triggers.
3. **Eval file** at `observability/eval-suite/subagents/<name>.md` — canonical prompt + marker behaviors + Pass/Partial/Fail rubric (PR-K format).
4. **Manifest entry** in `agents/specialists/_registry/manifest.yaml` — name, summary, triggers, skill_md path, context_budget, eval_source.

## Evidence basis

- **Primary evidence:** the user-supplied v0.4 plan list of 20 task domains; v0.2 AnonForum-deploy real session showed these as the cases that bypassed the EAC. `[user-report][H]`
- **Corroborating sources** *(per specialist; see each SKILL.md `## Evidence basis` section)*: OWASP ASVS v4.0.3, RFC 9700 OAuth 2.0 BCP, NIST SP 800-63B, RFC 7208/6376/7489 (email), Google SRE workbook, Stripe engineering blog "Online migrations at scale" (2017), PCI-DSS v4.0.1, M3AAWG Sender BCP 4.0. Each specialist cites its own primary evidence.
- **Synthesizer reasoning:** the 12 chosen represent the most-common "I need to wire X for a new project" tasks based on the v0.2 AnonForum-deploy session and a survey of recent project-bootstrap discussions. The remaining 8 from the original list defer to v0.4.1 pending validation of the first 12. `[synth][M]`
- **What would change this call:**
  - Real sessions reveal that one of the 12 doesn't generalize (e.g., the `auth` specialist's argon2id default breaks on a common serverless runtime, or the `payments` specialist's PCI guidance becomes incorrect for a new payment-network rule).
  - A new task domain enters the top 12 by frequency (e.g., realtime / WebSockets specialist).

## Consequences

**Locks in:**
- 12 specialists are now suggestible by the v0.4 intent classifier (ADR-0023). Real-session prompts mentioning "OAuth", "deploy to Vercel", "stripe webhook" etc. will route via `additionalContext` injection.
- Each specialist enforces a curated set of best practices at design time (e.g., `auth` refuses MD5; `payments` blocks raw card capture; `db-migration` refuses single-step destructive drops).
- The xlsx convention (ADR-0022) is exercised — 12 SKILL.md files with SE/BE failure-mode tables establish the pattern.
- LR-02 (production-mutation discipline) is wired into deploy/payments/db-migration/ci where it matters.

**Locks out:**
- Hidden / undeclared specialists — the manifest is the source of truth.
- Specialists that bypass LR-03 (secrets in tool args) — each SKILL.md explicitly references env-var-by-name.

**Migration path if it fails:** specialists are independent — any one can be deleted without affecting the others. The manifest is the index; remove entries to disable.

**Anthropic upstream issue dependency:** ADR-0020's dynamic-subagent-reload issue is **load-bearing here**. The 12 new `.claude/agents/*.md` files will not be invokable in the session that just landed PR-M — restart Claude Code after merge. The bootstrap "RESTART CLAUDE CODE NOW" banner from ADR-0020 covers this case.

## Alternatives considered

- **Ship 20 specialists (the user's full list).** Rejected per v0.4 plan disagreement #1: 20 un-validated specialists is too much content to land at once. 12 → validate → 8 more.
- **Ship specialist SKILL.md only, no runtime `.claude/agents/<name>.md`.** Rejected: makes the specialists un-invokable. The two-file structure (design + runtime) mirrors the base subagents per ADR-0012.
- **Auto-generate runtime `.claude/agents/<name>.md` from SKILL.md at bootstrap.** Considered. Deferred to v0.4.1 — hand-crafted runtime files are tighter (the SKILL.md has the full failure-modes register; the runtime file just needs the load-bearing constraints).
- **Defer the canonical-prompt evals to v0.4.1.** Rejected: shipping specialists without their evals leaves us unable to detect regressions when SKILL.md edits drift in v0.5+.

## Affects / Affected by

**This ADR affects** *(downstream — when this ADR changes, these must be reviewed)*:

- `agents/specialists/_registry/manifest.yaml` — populates the 12 entries
- `agents/specialists/_registry/<name>/SKILL.md` — 12 SKILL files
- `.claude/agents/<name>.md` — 12 runtime subagent files
- `observability/eval-suite/subagents/<name>.md` — 12 canonical-prompt evals
- `scripts/hooks/_classify.mjs` — registry path consumes the manifest's trigger patterns

**This ADR is affected by** *(upstream)*:

- `adr/0022-xlsx-docs-convention.md` — failure-modes format the SKILL.md files follow
- `adr/0023-specialist-registry.md` — manifest + override mechanism
- `adr/0017-intent-nag.md` — classifier this PR's manifest extends
- `adr/0020-runtime-discovery.md` — staleness sentinel applies to the 12 new `.claude/agents/<name>.md` files
- `constitution/local-rules.md` — LR-02 (deploy/payments/db-migration/ci specialists honor it), LR-03 (secrets specialist enforces it), LR-05 (evidence basis required per SKILL.md)

## References

- v0.4 plan disagreement #1 (12 starters first, 8 more in v0.4.1)
- ADR-0022 — xlsx docs convention (failure-modes register format)
- ADR-0023 — specialist registry mechanism
- ADR-0020 — runtime discovery (subagent staleness sentinel applies)
- Per-specialist primary sources cited inside each SKILL.md `## Evidence basis` section
