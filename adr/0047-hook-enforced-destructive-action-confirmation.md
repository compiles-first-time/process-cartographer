# ADR-0047: Hook-enforced confirmation for destructive actions (BR_01)

**Status:** Accepted (approved by Nick, 2026-07-05 — posture delegated to builder)
**Date:** 2026-07-05
**Author:** Builder (Opus 4.8) — approved by Nick
**Confidence:** [H] that the mechanism is correct and low-risk; [H] on the tiered posture given the cited evidence

---

## Context

Research item #1 — [The Claude Protocol](https://github.com/AvivK5498/The-Claude-Protocol) (MIT, 335★, v2.2.0) — is a competing Claude Code governance framework. Wholesale adoption is **incompatible** (it installs its own `.claude/agents`, hooks, `settings.json`, `CLAUDE.md` that collide with Loom's; its blanket hard-blocking tensions Kernel Rules 1 & 8). But its load-bearing thesis — **"constraints outperform instructions"** — is validated `[community/institutional][M-H]`: on long sessions, instructions **drift out of the context window** (a rule stated 30 prompts ago is forgotten) and agents suffer **scope creep** without hard boundaries. Its `PreToolUse` hooks return structured decisions — `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny"|"ask","permissionDecisionReason":"…"}}` — to *stop* actions, not merely warn.

This is a direct critique of Loom, whose governance is almost entirely **instruction-based** (23 kernel rules, 7 LRs, CLAUDE.md, layer docs). Loom's *only* runtime backstop today is the **harness's** auto-mode permission classifier (opaque, non-portable, not tied to Loom's constitution).

Crucially, Loom **already has the policy and the classifier**:
- `.claude/loom-permissions.yaml` declares a `destructive_actions` category with `enforcement: "hard"`, `constitution_service: "required"`, and `command_patterns` covering every irreversible op (`rm -rf`, `git push --force`, `git reset --hard`, `git branch -D`, `git clean -fd`, `Remove-Item -Recurse -Force`, `DROP`, `TRUNCATE`, `prisma migrate reset`, `supabase db reset`, push-to-main, `npm publish`, `terraform apply`, …).
- `scripts/lib/permissions-classifier.mjs` (`classifyToolCall`, 60 passing assertions) matches them and returns the `enforcement` tier.
- But `scripts/hooks/pre-tool-use.mjs`, on a hard hit with no prior constitution-service claim, **only emits a `constitution_check_missing` log event, then `exit(0)`** (its own comment: *"hook does not block… Blocking remains the existing destructive-op behavior of the model + Critic review"*).

The gap is a **mechanism gap, not a policy gap**: the hook classifies but never acts. Kernel **Rule 20** ("destructive ops require confirmation") is, today, enforced only by instruction.

## Decision

**BR_01 — Loom's `PreToolUse` hook must return a `permissionDecision` (not merely log), applying *risk-proportionate* friction mapped to reversibility × blast-radius (Kernel Rule 20's temporal weighting).**

The hook acts on the classification it already computes, in three tiers:

1. **`deny` — immutable + catastrophic-irreversible.** Edits to `constitution/kernel-v6.md` Rules 1–8 (Rule 19 immutability); hand-edits to hook-managed bi-temporal files (`orchestration/progress-ledger.md`, `tools/discovered-runtime.md`); and unrecoverable shared-history rewrites (force-push to `main`/`master`/`prod`/`production`). Returns `permissionDecision: "deny"` with the reason + the sanctioned alternative.
2. **`ask` — the destructive class (Rule 20).** Any `destructive_actions` hit not in tier 1 and not contained-scope (tier 3) returns `permissionDecision: "ask"` with the Rule-20 reason + `required_protocol` summary. Destructive ops are *rare*, so per-op confirmation stays meaningful rather than habituated.
3. **`allow` + log — contained scope (trust the guardrails).** When the op's blast radius is provably contained — target path under the scratchpad dir, cwd inside `.worktrees/`, or a non-protected feature branch — the hook trusts the agent's scope and Loom's existing governance (LR-04, Critic, verifier gates), emitting only the audit event. This is the anti-paternalism posture (Rule 8): friction is not spent where scope already bounds the risk.

4. **Audit log always emitted** — the `permissionDecision` is *added*; the existing `*_attempted` / `constitution_check_missing` logging is unchanged.
5. **Data-driven** — an optional `decision:` field on each `loom-permissions.yaml` category (`ask` | `deny` | `allow`; default derived from `enforcement`: `hard`→`ask`, `soft`→`allow`), plus a `contained_scope` hint list. The ask/deny/allow policy is auditable config, not hardcoded.
6. **Fail-open on error** — any exception in the decision path falls through to `exit(0)` (today's behavior). The gate only *adds* friction for confidently-classified hits; a classifier fault never breaks a tool call. In non-interactive/headless runs, `ask` resolves to the harness default (typically deny) — the safe failure direction.

**Why not flat "always ask" (the architect's initial instinct):** uniform confirmation is a documented failure mode — warning effectiveness degrades with frequency and habituation (Akhawe & Felt, USENIX Security 2013, 25M impressions: users clicked through up to 70% of frequent warnings; Herley, NSPW 2009: users rationally reject friction whose effort-cost exceeds its risk-benefit). Reserving `ask` for the *rare* destructive class keeps each prompt meaningful; spending it on contained-scope ops would train reflexive approval and erode the guarantee. The tiers *are* Rule 20's "reversible narrowings carry less weight than irreversible ones," operationalized — and they honor the architect's steer to "trust agents within the guardrails/scope" (tier 3) while hard-stopping the genuinely irreversible (tier 1).

## Evidence basis

> Required v0.4+ per [LR-05](../constitution/local-rules.md#lr-05).

- **Primary evidence:** Kernel Rule 20 (destructive ops require confirmation; reversible < irreversible weighting) — Loom's own constitution already mandates *both* the confirmation and the proportionality; BR_01 supplies the missing enforcement mechanism, matched to the weighting. `[internal][H]`
- **Corroborating sources:** The Claude Protocol's `PreToolUse` block mechanism, read at source (not README) `[artifact][H]`; the "constraints outperform instructions" thesis — context-drift + scope-creep documented across Cursor community + adjacent orchestration research (WebSearch, 2026-07) `[community/institutional][M-H]`; ADR-0044's τ-bench rationale that reliability needs a binary gate `[internal][H]`; **the risk-proportionate-friction principle** — Akhawe & Felt, "Alice in Warningland" (USENIX Security 2013) and Herley, "So Long, and No Thanks for the Externalities" (NSPW 2009), both peer-reviewed, establishing that uniform/frequent confirmations habituate into click-through while rare high-stakes prompts retain effect `[primary][H]`.
- **Synthesizer reasoning:** hooks execute deterministically on every call regardless of context-window state, so they enforce invariants instructions cannot maintain over long sessions; proportionality prevents the enforcement from self-defeating via habituation. `[synth][M]`
- **What would change this call:** evidence that `ask`-gating the destructive class materially harms throughput without preventing incidents, or that contained-scope trust (tier 3) lets through a class of irreversible harm the classifier should have caught.

## Cost model

Not an iterative LLM pattern — a synchronous hook decision. The classification (`classifyToolCall`) **already runs today**; BR_01 adds an O(1) tier lookup + a `console.log`. No new latency; the <200 ms hook budget (ADR-0043 §constraints) is preserved. **No loop introduced.**

## Consequences

**Locks in:** Loom's constitution becomes partially **self-enforcing** at the hook layer, portable across any harness (not dependent on the auto-mode classifier). Rule 20 gets a runtime backstop scaled to its own temporal-weighting principle.

**Locks out:** silent execution of destructive/irreversible ops on long sessions where the instruction has drifted out of context.

**Migration path if it fails:** the decision emission is one guarded block in `pre-tool-use.mjs` + optional YAML fields — revert the block and behavior returns exactly to today's log-only. Classification and logging are untouched.

**Rule-8 posture:** friction is proportionate — `deny` only for immutable/catastrophic, `ask` for the rare destructive class, `allow` within contained scope. The hook never decides *for* the human on reversible work; it guarantees the human is *asked* precisely where reversal is costly.

## Alternatives considered

- **Status quo (log-only + model/Critic discipline).** Rejected: the instruction-drift failure mode The Claude Protocol's evidence identifies.
- **Flat `deny` on the destructive class.** Rejected: violates Rule 8; blocks legitimate confirmed destructive work.
- **Flat "always ask" on every destructive hit regardless of scope.** Rejected on peer-reviewed evidence (Akhawe & Felt; Herley): uniform friction habituates into click-through and erodes the guarantee it's meant to provide. Tier 3 (contained-scope trust) is the correction.
- **Adopt The Claude Protocol wholesale.** Rejected: incompatible competing framework.
- **Hardcode the tier mapping in the hook.** Rejected: less auditable than data-driven `decision:` fields in the YAML policy (Loom's ethos).

## Affects / Affected by

**This ADR affects** *(downstream)*:

- `scripts/hooks/pre-tool-use.mjs` — emits `permissionDecision` per tier for destructive hits
- `.claude/loom-permissions.yaml` — new optional `decision:` + `contained_scope` fields on categories
- `scripts/lib/permissions-classifier.mjs` — surface `decision` on hits (parse the new field)
- `layers/L0-constitutional.md` — Rule 20 now has a hook-layer enforcement note
- `observatory/lib/aggregator.mjs` — optional `destructive_action_blocked` event for the panel
- `observability/eval-suite/requirements/BR_01.md` — the register entry (per ADR-0046)

**This ADR is affected by** *(upstream)*:

- `constitution/kernel-v6.md` — Rule 20 (mandate + weighting), Rule 8 (proportionate friction), Rule 19 (immutable-file deny)
- `constitution/local-rules.md` — LR-04 (permissions categories + hard enforcement)
- `adr/0027-permissions-protocol.md` — the classifier + YAML this extends
- `adr/0044-verifier-gates-for-agent-tasks.md` — binary-gate rationale
- `adr/0046-requirements-exceptions-testcase-registry.md` — BR_01 is captured in this registry
- The Claude Protocol (external) — the validated source of the "constraints > instructions" thesis

## References

- The Claude Protocol — https://github.com/AvivK5498/The-Claude-Protocol (hooks read at source, 2026-07) `[artifact][H]`
- Kernel Rule 20 (temporal weighting / destructive-op confirmation) `[internal][H]`
- ADR-0027 / LR-04 (permissions protocol), ADR-0044 (verifier gates) `[internal][H]`
- Akhawe & Felt, "Alice in Warningland: A Large-Scale Field Study of Browser Security Warning Effectiveness," USENIX Security 2013 `[primary][H]`
- Herley, "So Long, and No Thanks for the Externalities: The Rational Rejection of Security Advice by Users," NSPW 2009 `[primary][H]`
- Cursor multi-agent constraint/drift discussion (WebSearch, 2026-07) `[community][M]`
