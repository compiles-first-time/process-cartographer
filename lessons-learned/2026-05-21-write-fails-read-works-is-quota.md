---
date: 2026-05-21
agent: deploy specialist (synthesized from AnonForum session)
severity: high
share: true
---

# "Auth error" on write while reads succeed = check quota/billing first

## What happened

In the AnonForum session, every `vercel deploy` returned `"status": "error", "reason": "deploy_failed", "message": "Not authorized"`. The same credentials served `vercel ls` fine. Six deploys were attempted before checking the billing dashboard and discovering the real cause: the Vercel Hobby plan had 0 build minutes allocated AND no payment method on file.

A correct one-line code change took ~14 hours to ship to production. The code was right on first try; every minute past that was burned on chasing the wrong diagnosis.

## Why it happened

Cloud platforms routinely collapse three orthogonal failure modes into one HTTP status + one error message:

1. **Permission denied** — the token genuinely doesn't have the right scope.
2. **Budget exhausted** — quota is 0 for this billing cycle.
3. **Plan-tier restriction** — the operation requires a higher tier than the current plan.

Vercel, AWS, Supabase, Cloudflare, and GCP all do this to varying degrees. The asymmetry — reads continue working, writes don't — is the diagnostic signal that distinguishes (2) and (3) from (1).

The reason platforms collapse these: leaking which one it is (via error text or HTTP code) leaks information about other tenants' usage patterns and is sometimes considered an information-disclosure vulnerability. The collapsed message is a deliberate design choice.

## What we did

Once the billing dashboard was checked manually, the cause was obvious — Vercel surfaced it clearly there. Adding a payment method + upgrading from the free tier resolved every deploy attempt instantly.

## What we'd do differently

The deploy specialist's pre-flight quota check (ADR-0032 §B, DEPLOY-EX-04) makes this impossible to miss. Before any platform write, the specialist consults the platform's quota / billing API and verifies:

1. A payment method (or sufficient free credit) is on file.
2. The relevant quota is not at zero.
3. The account is not in a hard-suspended state.

If any check fails, the specialist surfaces "your `<platform>` plan has 0 quota — visit `<exact dashboard URL>`" BEFORE attempting the deploy. No retries. The user fixes the quota state and then re-invokes.

For any specialist touching a billable platform: skipping the pre-flight is an LR-04 violation under `external_service_setup`. The `permissions-classifier.mjs` flags it.

**Diagnostic heuristic encoded in DEPLOY-EX-05:** when write-auth fails but read-auth succeeds, the cause order is:

1. Quota / billing / plan-tier (most common; the AnonForum cause).
2. Device-code auth scope drop (second most common; see [`2026-05-21-auth-scope-drop-on-device-code.md`](./2026-05-21-auth-scope-drop-on-device-code.md)).
3. Actual permission revocation (rare).

Re-authenticating before checking quota is the wrong order — it burns 5+ minutes without fixing anything.

## Related

- [ADR-0032 §B — pre-flight quota check requirement](../adr/0032-deployment-hardening.md)
- [`agents/specialists/_registry/deploy/SKILL.md` DEPLOY-EX-04 + DEPLOY-EX-05](../agents/specialists/_registry/deploy/SKILL.md)
- [`constitution/local-rules.md` LR-04 — `external_service_setup` category](../constitution/local-rules.md)
- Sister entry: [`2026-05-21-auth-scope-drop-on-device-code.md`](./2026-05-21-auth-scope-drop-on-device-code.md)
- AnonForum deployment session post-mortem (2026-05-21)
