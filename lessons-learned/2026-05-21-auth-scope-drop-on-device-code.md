---
date: 2026-05-21
agent: deploy specialist (synthesized from AnonForum session)
severity: medium
share: true
---

# Device-code CLIs can drop write scope while keeping read scope

## What happened

During the AnonForum deployment session, `vercel ls` worked fine and listed deployments correctly, but `vercel deploy` returned `"Not authorized"`. The error message suggested an auth problem. Re-authenticating via `vercel login` (device-code flow) restored deploy capability — but only after several minutes spent investigating the wrong cause.

## Why it happened

Device-code OAuth flows can issue tokens with mixed-lifetime scopes:

- Read scope is typically long-lived (the CLI caches it persistently).
- Write/deploy scope is often session-scoped or per-action — it can drop between sessions without invalidating the read scope.

This is documented behavior for some platforms (Vercel CLI is one observed case) but the CLI doesn't surface "your write scope expired; reads still work." It just rejects the write with a generic auth-error message that looks identical to "token revoked."

## What we did

`vercel logout && vercel login` restored deploy scope. The login is a 30-second device-code dance — cheap. But this was the SECOND diagnostic, after spending time checking the token file and re-running `vercel whoami`.

## What we'd do differently

When a CLI write operation fails with auth-error AND a read operation succeeds with the same credentials, the heuristic order is:

1. **Check quota / billing first.** Cloud platforms collapse "permission denied" and "budget exhausted" into the same status + message; quota-exhaustion is the more common cause of read-works/write-fails (see [`2026-05-21-write-fails-read-works-is-quota.md`](./2026-05-21-write-fails-read-works-is-quota.md)).
2. **Only after quota is verified healthy**, try device-code scope refresh: `<cli> logout && <cli> login`.
3. Generic `<cli> whoami` and token-file inspection come AFTER both of the above. They almost never reveal the real cause for this symptom.

The deploy specialist (DEPLOY-EX-06) encodes this order. Bootstrapping a new project, the bootstrap script's discover-runtime step should also note which CLIs use device-code flows so the specialist knows to apply this heuristic.

## Related

- [ADR-0032 §D — device-code-auth scope-drop recovery](../adr/0032-deployment-hardening.md)
- [`agents/specialists/_registry/deploy/SKILL.md` DEPLOY-EX-06](../agents/specialists/_registry/deploy/SKILL.md)
- Sister entry: [`2026-05-21-write-fails-read-works-is-quota.md`](./2026-05-21-write-fails-read-works-is-quota.md)
- AnonForum deployment session post-mortem (2026-05-21)
