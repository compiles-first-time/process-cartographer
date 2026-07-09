# ADR-0044: Verifier gates for agent tasks

**Status:** Accepted
**Date:** 2026-06-15
**Author:** Builder — approved by Nick
**Confidence:** [H] on verifier principle; [M] on surrogate verifier applicability

## Context

LLM agents perform most reliably on tasks that have an objective verifier — a binary signal confirming correct completion. Without a declared verifier, agent tasks compound errors silently, cannot be caught by the progress ledger, and produce undetectable drift in long-running sessions.

The 2026-06-15 literature validation confirms this at `[H]` confidence across three independent primary sources:
- DeepSeek-R1 RLVR (arXiv:2501.12948): reinforcement learning with binary verifier rewards produces reliable improvement only in verifiable domains.
- Lightman et al. process rewards (arXiv:2305.20050): outcome verification is the binding constraint on model reliability.
- τ-bench (arXiv:2406.12045): even in bounded task domains, agents achieve ~61% pass@1 — performance degrades without explicit verifiers and cannot improve without a binary success signal.

Loom's existing checks (`loom doctor`, hook exit codes, eval suite) implicitly implement verifiers for specific tasks, but no systematic convention requires agents to declare their verifier at design time.

## Decision

Add a `verifier_type:` field to every SKILL.md frontmatter. This is a soft documentation convention enforced by a new `loom doctor` check (`skill-verifier-declared`). Non-compliance emits a warning; it does not fail the build, consistent with L5's transparency-not-blocking philosophy per ADR-0011.

### Verifier types

| `verifier_type` value | Meaning | Example |
|---|---|---|
| `exit_code` | Terminal command exits 0 on success | `collect-credentials`, any script-backed specialist |
| `schema_check` | Output conforms to a declared schema | ADR frontmatter, manifest.yaml, event-log record |
| `test_suite` | A test suite passes | `npm test`, eval-suite rubric |
| `human_gate` | A human explicitly approves before task closes | credential-setup consent protocol, consequential ADRs |
| `surrogate` | Proxy metric approximating success | Position-size ≤5% NAV, drawdown limit (trading) |

A task may declare more than one (e.g., `exit_code + human_gate`). In that case, both must pass.

### Surrogate verifiers

For tasks where ground truth is not available at runtime (trading signals, research quality), a surrogate verifier is the practical equivalent: a measurable proxy that correlates with success. Surrogate verifiers must be declared explicitly — an undeclared surrogate is not a verifier.

### loom doctor check

A new soft check `skill-verifier-declared` scans all `SKILL.md` files under `agents/specialists/_registry/` and `agents/specialists/` for the `verifier_type:` field. Missing files emit a warning.

### L5 orchestration convention

The L5 supervisor must not dispatch an agent task that lacks a declared verifier without first escalating to the architect. Open-ended instructions without a declared verifier (e.g., "manage the portfolio", "fix the codebase") are a doc violation under this ADR.

## Evidence basis

- **Primary:** DeepSeek-R1 / RLVR (arXiv:2501.12948, 2025) — RLVR trains reliably only in domains with binary verifiers; out-of-scope for non-verifiable domains by design. `[primary][H]`
- **Primary:** Lightman et al. process rewards (arXiv:2305.20050, OpenAI/ICLR 2024) — process supervision reaches 78% vs 69% for outcome supervision; both contingent on verifiable ground truth. `[primary][H]`
- **Primary:** τ-bench (arXiv:2406.12045, ICLR 2025) — agents achieve ~61% pass@1 in constrained domains; consistent reliability requires explicit rule-compliance verifiers at each step. `[primary][H]`
- **Corroborating:** Cemri et al. multi-agent failure modes (arXiv:2503.13657) — task verification failures are the primary failure mode in multi-agent pipelines. `[primary][M]`
- **What would change this call:** Evidence that verifier declarations add significant engineering overhead without reliability gain would justify dropping to advisory-only. Current evidence strongly supports the convention.

## Consequences

**Locks in:**
- `verifier_type:` is a required SKILL.md frontmatter field (soft enforcement via loom doctor).
- `loom doctor` gains a new soft check: `skill-verifier-declared`.
- L5 orchestration layer documents the convention and the five verifier types.
- `credential-setup` SKILL.md is the reference implementation for `human_gate + exit_code`.

**Locks out:**
- Nothing. The convention is additive and soft-enforced; existing SKILL.md files without the field emit a warning, not a build failure.

**Migration:** Existing bundled specialists should add `verifier_type:` at next edit. The doctor check surfaces which ones remain un-declared.

## Affects / Affected by

**This ADR affects:**
- [`layers/L5-orchestration.md`](../layers/L5-orchestration.md) — new Verifier contract section
- [`scripts/lib/doctor.mjs`](../scripts/lib/doctor.mjs) — new `checkSkillVerifiers` soft check
- [`agents/specialists/_registry/credential-setup/SKILL.md`](../agents/specialists/_registry/credential-setup/SKILL.md) — adds `verifier_type:` as reference implementation

**This ADR is affected by:**
- [ADR-0011](./0011-claude-code-enforcement-runtime.md) — transparency-not-blocking philosophy; verifier checks are soft, not hard
- [ADR-0015](./0015-loom-doctor.md) — loom doctor extension protocol
- [LR-06](../constitution/local-rules.md#lr-06) — exit conditions must be declared before loop execution; `verifier_type` is the task-level formalization of exit condition
- [`constitution/kernel-v6.md`](../constitution/kernel-v6.md) — Rule 22 (audit trail); verifier outcome must be observable

## References

- Literature validation 2026-06-15 (this session) — synthesizes the three primary sources above
- [`layers/L5-orchestration.md §Verifier contract`](../layers/L5-orchestration.md#verifier-contract) — implementation
- [`scripts/lib/doctor.mjs`](../scripts/lib/doctor.mjs) — `checkSkillVerifiers` function
