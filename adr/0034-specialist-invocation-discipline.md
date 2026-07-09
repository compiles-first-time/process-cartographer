# ADR-0034: Specialist-invocation discipline when the registry is unavailable

**Status:** Accepted (Nick, 2026-07-07 — operative: mandated by the CLAUDE.md pre-PR checklist; built on by ADR-0035/0036/0038/0042)
**Date:** 2026-05-25
**Author:** Architect (Nick) — surfaced by [`lessons-learned/2026-05-22-browser-gated-provisioning-friction.md`](../lessons-learned/2026-05-22-browser-gated-provisioning-friction.md) Root cause 3; drafted by Claude
**Confidence:** [H]

## Context

[ADR-0020](./0020-runtime-discovery.md) established the subagent-staleness sentinel: Claude Code builds its subagent registry at session start, so specialist `.md` files added to `.claude/agents/` mid-session are not invocable until the session restarts. The bootstrap output's `⚠ RESTART CLAUDE CODE NOW` banner makes this constraint visible to the architect.

The Ravenwise bootstrap (2026-05-22) demonstrated that **this constraint produces silent degradation** when the in-session agent does not honor it:

- 18 specialist files were stamped to `.claude/agents/*.md` by `bootstrap.sh`
- The session's in-session agent read the restart banner, kept working anyway, and produced the Ravenwise scaffold WITHOUT invoking any specialist
- The output compiled, looked plausible, and passed all surface-level checks
- The procedural-skip surfaced only when the architect asked "did agents run to discover, research, and validate any of this information?"

The post-mortem (lesson Root cause 3) identified three sub-causes:

1. **Architectural constraint** — registry only loads at session start (ADR-0020)
2. **Hook capture gap** — when the session's CWD is not the project directory, hooks don't fire, so the silent degradation isn't even audited
3. **No procedural enforcement** — the in-session agent had three available alternatives (general-purpose `Agent` tool with SKILL.md as prompt, `WebFetch` for vendor doc validation, direct reading of SKILL.md as in-session instructions) and reached for none of them

The first two are architectural-improvement candidates (covered by future ADRs and hook hardening). **This ADR addresses the third** — the procedural-discipline gap that has no architectural excuse.

## Decision

Adopt **specialist-invocation discipline** as a constitutional requirement under [LR-05](../constitution/local-rules.md#lr-05--decision-supersedence-discipline) (decisions are best-current-call until superseded by independent peer-reviewed evidence). Specialist consultation is the mechanism for converting training-data assumptions into best-current-call evidence.

### A. The discipline (four-step check)

Before any non-trivial code-writing or structural-decision work in a Loom-based project session, the in-session agent MUST:

1. **Check the registry state.** Read `.claude/agents/.last-discovered-at` (the ADR-0020 sentinel). If its mtime is newer than the current session's start time, the stamped specialists are NOT invocable via the Task / subagent mechanism — the registry was modified after session start.
2. **If the registry is unavailable, do NOT proceed as the "general builder."** Choose one of:
   - **(2a) Restart path:** instruct the architect to restart Claude Code before proceeding. Recommended when the project work is greenfield + complex + benefits from full specialist discipline. Honors ADR-0020 directly.
   - **(2b) Simulation path:** use the general-purpose `Agent` tool with each relevant specialist's `SKILL.md` content as the prompt. The agent invocation inherits the SKILL.md's failure-mode register, response-shape contracts, evidence-basis requirement, and declination triggers. Recommended when restart would lose useful in-session context OR the work is small enough that one or two agent invocations cover it.
3. **Log the simulation explicitly.** Each `Agent`-tool invocation that simulates a registry specialist must record in the project's audit trail (or, when the hook system isn't capturing — see §C below — in the session's chat output): `"Acting as the <X> specialist via Agent tool because the stamped registry is not yet invocable in this session (per ADR-0034 §A)."` This makes the simulation visible to the architect + post-hoc reviewers.
4. **Treat the verification as per-session-per-write-class.** Confirming via Agent tool for one write class (e.g., `oauth` for sign-in setup) does NOT extend to another class (e.g., `db-migration` for schema changes). Each new domain re-prompts specialist simulation unless the architect explicitly broadens the scope. This anti-pattern is observed in Root cause 4 of the lesson and prevents specialist context bleed.

### B. Bypass policy

Skipping all of (2a) / (2b) — i.e., proceeding as the general builder against an unavailable registry — is a **constitutional violation under LR-05**. The bypass is allowed only when the architect explicitly attests (in chat, on the record) that the work is trivial enough not to warrant specialist discipline. The attestation must name the specific work being bypassed: *"You may proceed without invoking specialists for X."*

This attestation is logged as a `specialist_invocation_bypass` event in the project's event log when the hook system is capturing (see §C). When it isn't, the chat output is the audit surface.

### C. Hook-capture verification (companion check)

Before any non-trivial work, the in-session agent SHOULD verify that the Loom hooks are capturing events for the current session. The check:

1. Inspect `memory/event-log/YYYY-MM-DD.jsonl` for a `session_start` event with the current session ID.
2. If absent, the hooks are NOT firing for this session. Most common cause: Claude Code's working directory is not the project directory (`.claude/settings.json` hooks load against the session's CWD at startup; cross-project work from a parent CWD silently disables them).
3. Surface the gap to the architect at the start of the session: *"Hooks are not capturing events for this session. The audit trail will be silent. To enable capture, open Claude Code IN the project directory (`cd <project-root> && claude-code .`) and restart."*

The architect may proceed without hook capture (the trade-off is loss of audit trail, not loss of correctness), but the gap is surfaced explicitly rather than discovered post-hoc.

### D. SessionStart enforcement (deferred)

A SessionStart hook that automatically performs §A and §C checks at session start — and refuses to allow code-writing tool calls until the architect has explicitly attested compliance — is the enforcement layer that converts §A's "MUST" from advisory to operational. Deferred to a separate ADR + implementation PR because it requires non-trivial hook authoring + new event types. This ADR codifies the discipline; the SessionStart hook makes it enforceable.

## Evidence basis

- **Primary:** [`lessons-learned/2026-05-22-browser-gated-provisioning-friction.md`](../lessons-learned/2026-05-22-browser-gated-provisioning-friction.md) — direct post-mortem of the Ravenwise bootstrap, including empirical evidence (0-byte event log, absent discovery artifacts, 18 stamped-but-not-invoked specialists). `[user-report][H]`
- **Corroborating sources** *(independent — checked at the publisher level)*:
  - [ADR-0020](./0020-runtime-discovery.md) — the architectural constraint this ADR works within. `[primary][H]`
  - [LR-05](../constitution/local-rules.md#lr-05--decision-supersedence-discipline) — the meta-rule this ADR operationalizes for the specialist-consultation case. `[primary][H]`
  - **Architect's direct question in real session** (2026-05-22): *"Did agents run to discover, research, and validate any of this information? If yes, why did the agent miss it and if no, why did the agent not run? I expect agents to be running. I am almost certain that discovery is apart of the initialization of a new project."* — the friction event that surfaced this discipline gap. `[user-direction][H]`
  - **In-session validation** (2026-05-22): the corrective sequence applied (3) — spawning Agents A, B, C with SKILL.md content as prompts — produced specialist-quality output (the Supabase Management API correction, the Ravenwise scaffold audit, the Google Cloud OAuth client verification). This is the proof that path (2b) above works in practice. `[user-report][H]`
- **Synthesizer reasoning:** the silent-degradation failure mode (compile-clean, plausible, undocumented) is the hardest to catch because nothing signals it. Codifying the discipline as a constitutional requirement under LR-05 — rather than as a best-practice guideline — is necessary because the failure produces no observable error. The agent must check before it can fail, and the check is itself the value.
- **What would change this call:**
  - Claude Code adds dynamic subagent registry reload (the upstream issue draft in ADR-0020) — removes the staleness constraint, making path (2a) unnecessary. Path (2b) still applies for cases where the architect wants specialist discipline applied to an existing session without restart.
  - The SessionStart enforcement hook (§D) ships and gates code-writing tool calls — converts the "MUST" from advisory to operational, eliminating the bypass-by-forgetting failure mode.
  - A peer-reviewed analysis demonstrates that LLM-driven tool-picker decisions are reliably better than static specialist-discipline checks — would amend §A path (2b) to use a different selection mechanism, but the underlying *discipline* requirement remains.

## Consequences

**Locks in:**

- Specialist-invocation discipline as a constitutional requirement (LR-05 specialization) for all Loom-based project work.
- The "use Agent tool with SKILL.md as prompt" pattern (path 2b) as a supported and recommended workflow — not a workaround but a first-class path.
- Explicit logging of every specialist simulation, both for audit-trail purposes (when hooks fire) and for in-chat transparency to the architect (when they don't).
- Per-session-per-write-class verification — no specialist context bleed across domains.

**Locks out:**

- Silent proceeding as the "general builder" against an unavailable registry without architect attestation.
- Implicit assumption that specialist discipline applied to one domain extends to another.
- Treating the ADR-0020 restart banner as advisory-only (it is, in fact, the trigger for the §A check).

**Migration path if it fails:**

- The discipline is markdown text + agent behavior — no code-level dependencies. Reverting amounts to amending this ADR + removing the §A check from agent prompts.
- If the §C hook-capture check produces too many false positives (e.g., legitimate cross-project work where audit-trail loss is acceptable), the warning can be downgraded to soft / opt-out without affecting the §A discipline.
- The deferred SessionStart enforcement (§D) is an additive change; failure of the underlying discipline doesn't propagate to it.

## Alternatives considered

- **Mandate session restart whenever the registry is unavailable.** Rejected. Restart loses in-session context (open files, accumulated chat history, recent tool results) that may be expensive to reconstruct. The Agent-tool simulation path (2b) preserves context while still applying specialist discipline.
- **Trust the in-session agent's judgment about when specialist invocation is warranted.** Rejected — this is exactly what failed in the Ravenwise bootstrap. The agent had access to all the relevant signals (restart banner, stamped specialists, absent discovery artifacts) and chose to proceed without invocation. Codification is necessary because judgment-based gating is unreliable in the silent-failure direction.
- **Ship a CLI command (`loom invoke <specialist>`) that wraps the Agent-tool simulation.** Considered. Adds operational friction (the agent has to remember to call the wrapper) without solving the discipline question (the agent could still forget to call it). The discipline-as-prompt approach is cheaper and at least as effective.
- **Wait for Claude Code's dynamic subagent registry reload.** Rejected. ADR-0020 has been awaiting this upstream change since 2026-05-18. Deferring this ADR until Anthropic ships the reload would have left the Ravenwise bootstrap (and every subsequent Loom project bootstrap) exposed to the silent degradation indefinitely. The discipline applies even after dynamic reload ships, since the architect may want specialist simulation in scenarios where the registry exists but the architect wants a second opinion.
- **Codify as a best-practice guideline rather than constitutional requirement.** Rejected. Best-practice guidelines fail silently when not followed; constitutional requirements + bypass attestation produce a record. The Ravenwise case demonstrates this: a best-practice "consult specialists" guideline existed implicitly (in the SKILL.md files themselves) and was ignored. Constitutional framing forces the check.

## Affects / Affected by

**This ADR affects** *(downstream — when this ADR changes, these must be reviewed)*:

- [`agents/specialists/_registry/*/SKILL.md`](../agents/specialists/_registry/) — every specialist's SKILL.md becomes a candidate Agent-tool prompt under path (2b). Each SKILL.md should be authored with this dual-purpose use in mind: readable both by Claude Code's subagent system AND as a standalone agent prompt.
- [`scripts/bootstrap.{sh,ps1}`](../scripts/bootstrap.sh) — the "RESTART CLAUDE CODE NOW" banner should be supplemented with a hint about path (2b): *"Or use the `Agent` tool with each specialist's SKILL.md as prompt for in-session simulation per ADR-0034."*
- [`CLAUDE.md`](../CLAUDE.md) — the "Working agreements" section should reference this ADR + the four-step check.
- [`scripts/lib/doctor.mjs`](../scripts/lib/doctor.mjs) — a future `specialist-invocation-discipline` soft check that surfaces a warning when `.claude/agents/.last-discovered-at` is newer than the session's `session_start` event without any subsequent `specialist_simulation_started` event (after the SessionStart enforcement ships).
- A future SessionStart hook (§D) — the enforcement layer.

**This ADR is affected by** *(upstream — these define constraints on this decision)*:

- [ADR-0020](./0020-runtime-discovery.md) — the staleness constraint this ADR works within. If dynamic reload ships, path (2a) becomes unnecessary; path (2b) still applies.
- [LR-05](../constitution/local-rules.md#lr-05--decision-supersedence-discipline) — the meta-rule this ADR operationalizes.
- [ADR-0012](./0012-base-subagents.md) — the bundled subagent design that established the SKILL.md as a structured artifact suitable for Agent-tool simulation.
- [ADR-0024](./0024-starter-specialists.md) — the 12 starter specialists whose SKILL.md files are the canonical prompts under path (2b).
- [ADR-0033](./0033-mcp-vs-cli-capability-matrix.md) — the matrix that specialists (real or simulated) consult before tool selection.
- [ADR-0038](./0038-hook-capture-gap-detection.md) — operationalizes the §C hook-capture-gap check this ADR introduced.

## References

- Lesson 2026-05-22 (`browser-gated-provisioning-friction.md`) Root cause 3 + 4
- ADR-0020 — subagent-staleness sentinel; the architectural constraint
- LR-05 — decision-supersedence discipline; the meta-rule
- ADR-0012 — base subagents; SKILL.md schema origin
- ADR-0024 — 12 starter specialists; the SKILL.md corpus
- Claude Agent SDK general-purpose Agent tool documentation (the mechanism for path 2b)
