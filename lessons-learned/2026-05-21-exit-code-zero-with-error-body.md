---
date: 2026-05-21
agent: deploy specialist (synthesized from AnonForum session)
severity: high
share: true
---

# Cloud CLIs routinely exit 0 with `"status": "error"` in the body — never trust exit codes alone

## What happened

During AnonForum, `vercel deploy` runs completed with exit code 0 while the JSON body carried `"status": "error", "reason": "deploy_failed"`. The Loom event log recorded these as `deployment_completed` with `exit_code: 0` — successful. The user discovered the failure only by visiting the Vercel dashboard hours later.

This is not a Vercel-specific bug. The same pattern has been observed in:

- `gh pr create` returning 0 with a stderr message that no PR was actually created (when the head ref matches the base ref).
- `supabase functions deploy` returning 0 with an error body when the project is paused.
- `flyctl deploy` returning 0 with `"release_command_failed"` in the body.
- `netlify deploy` returning 0 when the build skipped due to no changed files (sometimes desired, sometimes a bug).

## Why it happened

Modern cloud CLIs design exit codes for *script integration* — exit 0 means "the CLI ran successfully," not "the platform operation succeeded." The platform's structured response is the actual outcome. CLI authors prefer not to make the exit code semantics depend on the response body because:

1. Backwards compatibility — existing scripts grep stdout for success markers and don't expect exit-code semantics to change.
2. Streaming vs. final state — a deploy that *queued* but later failed should not retroactively change the CLI's exit code.
3. Distinguishing CLI bugs from platform failures — a non-zero exit historically means "the CLI couldn't talk to the platform," which is different from "the platform said no."

This is defensible from the CLI author's perspective. From a Loom orchestration perspective, it's a silent-failure landmine.

## What we did

Updated `scripts/lib/deploy.mjs` event-emission discipline (planned for v0.3.2 follow-up): capture stdout AND stderr separately, parse the captured output as the documented response shape, treat the parsed `status` / `state` / `error` field as authoritative. The `deployment_completed` event in the JSONL log now carries both `exit_code` AND `body_status` so audit catches the divergence.

## What we'd do differently

Specialist response-body discipline (ADR-0032 §C, DEPLOY-EX-07) is now the baseline:

1. Capture stdout and stderr separately.
2. Attempt to parse the output as JSON (or the documented response shape).
3. Treat the parsed `status` / `state` / `error` field as the source of truth.
4. Use the exit code as ONE signal among several — never trust it alone for platform operations.

A success declaration requires both:

- Exit code 0 AND
- Parsed body confirming success (or, if the CLI's documented shape is opaque, the wait-for-deploy primitive observing a `succeeded` terminal state per ADR-0032 §A).

If only one signal indicates success, the specialist HALTs and surfaces the discrepancy to the user. Better to over-report ambiguity than under-report failure.

The Critic checklist (`observability/eval-suite/critic-checklists/security.md` was the v0.5 candidate location) gains a "CLI integration" item: "does this specialist's success criterion require body parsing in addition to exit code?"

## Related

- [ADR-0032 §C — response-body discipline](../adr/0032-deployment-hardening.md)
- [`agents/specialists/_registry/deploy/SKILL.md` DEPLOY-EX-07](../agents/specialists/_registry/deploy/SKILL.md)
- [`scripts/lib/deploy.mjs` — v0.3.2 follow-up integration of body parsing](../scripts/lib/deploy.mjs)
- AnonForum deployment session post-mortem (2026-05-21)
