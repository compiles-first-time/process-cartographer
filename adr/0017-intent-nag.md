# ADR-0017: Intent classifier + subagent-invocation nag + production-mutation detector

**Status:** Accepted
**Date:** 2026-05-18
**Author:** Architect handoff — Loom v0.3 — approved by Nick
**Confidence:** [H]

## Context

v0.2 shipped six subagents at `.claude/agents/*.md`. A real downstream session running on the v0.2 template never invoked a single one. Root causes (per the v0.3 findings):

1. **Nothing nudged the model toward subagents.** The model defaulted to direct tool calls because no signal — in the constitution, hooks, or system prompt — told it "this kind of work routes through subagent X." (Finding #1.)
2. **Subagent registry is built at session start.** Files added mid-session were invisible until restart — that's finding #6, addressed in PR-J. PR-G assumes the subagents *are* loaded; the nag only works once the registry sees them.
3. **Production mutations bypassed the Constitution Service entirely.** The Critic was supposed to review, the Constitution Service was supposed to validate — neither was invoked because nothing distinguished "I'm about to `vercel deploy`" from "I'm about to `ls`."

ADR-0017 closes (1) and partially closes (3) at the *transparency* layer. Real enforcement remains social + Critic-driven, consistent with constitution-as-text.

## Decision

### A. UserPromptSubmit intent classifier

New hook `scripts/hooks/user-prompt-submit.mjs` + shared `scripts/hooks/_classify.mjs`. Heuristic regex over the user's prompt matches intent categories (deploy, destructive, research, review, memory, agent_lifecycle, user_proxy, governance) and:

- Appends a `subagent_suggestion` event to today's JSONL with the matched intent and suggested subagent(s).
- Injects an `additionalContext` block via the Claude Code UserPromptSubmit hook output schema, so the model sees: "[loom intent classifier] heuristic match — consider invoking `eac` — domain research is the EAC's role".

**Heuristic by design.** Misclassification cost: extra context the model can ignore. Correct-classification cost: educates the user about available subagents. The point is to bridge the gap from "subagent exists" to "subagent gets invoked," not to be authoritative routing.

### B. PreToolUse production-mutation detector

`pre-tool-use.mjs` extended with `classifyProductionMutation` (in `_classify.mjs`). Pattern list:

- `vercel deploy`, `vercel --prod`
- `npm publish`, `yarn publish`, `pnpm publish`
- `gh release create`
- `git push origin <main|master|prod|production>` (with or without `--force`)
- `prisma migrate deploy`, `supabase db push`, `terraform apply`, `kubectl apply ... prod`

On a match: appends `production_mutation_attempted` event. If no prior `constitution-service` claim exists in the session, *also* appends `constitution_check_missing` with `rule: "LR-02"` and a remediation message.

**Non-blocking.** The hook does not refuse the tool call. Real enforcement comes from:
- The Critic subagent during pre-commit review.
- LR-02 in `constitution/local-rules.md` (new in this PR).
- The doctor's `constitution-coverage` soft check.

### C. LR-02 — Production-state mutations require constitution-service consultation

New entry in `constitution/local-rules.md`. Extends Kernel Rule 20 (temporal weighting) and Rule 22 (epistemic transparency). The rule lives in text; v0.3 hooks make violations *visible* in the event log; the doctor surfaces them; the Critic flags repeated violations.

### D. Doctor soft check `constitution-coverage`

`scripts/lib/doctor.mjs` gains a soft check that scans the last 14 days of event logs, finds session IDs that emitted `production_mutation_attempted`, and reports how many of those did *not* have a preceding `constitution-service` claim. **Soft** by the v0.3 plan disagreement: a hard fail is too aggressive given the heuristic pattern list and legitimate cases where someone catches the issue mid-session.

### E. Bug fix carried in this PR

PR-3's YAML parser did not strip inline `# comments`, so `enabled: false  # set true to enable` was being parsed as the string `"false  # ..."` instead of the boolean `false`. Result: `database`, `chat-gateway`, and `github` were appearing as empty `{}` entries in the regenerated `mcpServers` block. Fixed in `scripts/lib/mcp-yaml-to-settings.mjs` `parseScalar`; the regenerated JSON now correctly contains only `enabled: true` servers.

## Consequences

**Locks in:**
- Every user prompt gets an intent-classification pass. The model sees subagent suggestions in context.
- Every production-mutation tool call generates an audit trail tying it (or its absence) to LR-02 compliance.
- The doctor reports LR-02 violations as a soft signal.

**Locks out:**
- The "deploy slipped through without any check" pattern from the v0.2 real session — at minimum, the log will show that it happened.

**Migration path if it fails:** the UserPromptSubmit hook is opt-in via `.claude/settings.json`. Removing the entry disables the classifier entirely. The PreToolUse extension degrades gracefully — if `_classify.mjs` is removed, the production-mutation detection is skipped but the rest of pre-tool-use continues working.

## Alternatives considered

- **Block tool calls that match production-mutation patterns without a constitution-service claim.** Rejected for v0.3: false-positive cost on a heuristic pattern list is too high. v0.4 may revisit once the pattern list is validated against real sessions.
- **Stderr nag instead of additionalContext.** Rejected: stderr from UserPromptSubmit is logged but not shown to the user or injected into model context. additionalContext is the documented mechanism for "tell the model this on the way in."
- **Auto-invoke constitution-service from the PreToolUse hook.** Rejected: the hook is a transparency layer; it has no path to dispatch a subagent. The session/model dispatches subagents; this PR makes the *need* visible, the dispatch remains the model's call.

## References

- [`../scripts/hooks/user-prompt-submit.mjs`](../scripts/hooks/user-prompt-submit.mjs) — UserPromptSubmit hook
- [`../scripts/hooks/_classify.mjs`](../scripts/hooks/_classify.mjs) — intent rules + production-mutation patterns
- [`../scripts/hooks/pre-tool-use.mjs`](../scripts/hooks/pre-tool-use.mjs) — extended detector
- [`../constitution/local-rules.md`](../constitution/local-rules.md) — LR-02
- [`../scripts/lib/doctor.mjs`](../scripts/lib/doctor.mjs) — `checkConstitutionCoverage`
- ADR-0011 (hooks surface), ADR-0012 (subagents being suggested), ADR-0013 (YAML parser this fixes), ADR-0015 (doctor extended)
