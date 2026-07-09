# ADR-0030: Specialist lifecycle — spawn / retire / promote-lessons

**Status:** Accepted
**Date:** 2026-05-20
**Author:** Architect handoff (v1.0 PR-S) — approved by Nick
**Confidence:** [H]

## Context

PR-R (ADR-0029) generates the work graph. PR-S closes the loop: specialists need a lifecycle managed by HR + the user — **spawn** them per work item, **retire** them at project end, **propagate** their lessons-learned to the registry for future projects.

v1.0 finding (D) third bullet: "Specialists get spawned per work item, retired on completion, lessons-learned propagated to the registry for future projects."

## Decision

`scripts/specialist-lifecycle.{sh,ps1}` + `scripts/lib/specialist-lifecycle.mjs` with three subcommands:

### A. `spawn <WI-id>`

- Reads `orchestration/work-graph.json`, finds the work item by ID.
- For each `assigned_specialists[]` name not already instantiated, creates `agents/specialists/<name>/SKILL.md` with `extends: _registry/<name>` frontmatter (per ADR-0023 override semantics) + a work-item-context section.
- Marks the work item as `status: "dispatched"` in `work-graph.json`; records `spawned_at` + `spawned_specialists`.
- Emits a `specialist_spawned` event to the daily JSONL log.
- Prints a reminder to restart Claude Code if new `.claude/agents/<name>.md` files were added (ADR-0020 staleness sentinel).

### B. `retire <name>`

- Moves `agents/specialists/<name>/SKILL.md` → `agents/specialists/<name>/.retired/<ts>-SKILL.md`.
- Emits a `specialist_retired` event with the archive path.
- Prints a reminder that AGENTS.md may still reference the specialist (HR-Agent should update).
- Does NOT delete the directory — `.retired/` preserves the history.

### C. `promote-lessons`

- Scans `lessons-learned/*.md` for files with `share: true` in frontmatter that don't already have a propagation proposal at `lessons-learned/.propagation/<id>.md`.
- Writes a propagation proposal with three boxes: approve / reject / modify-before-propagating.
- The user reviews; the user runs the Update Bus to actually send (out of scope for v1.0; lands in v0.3-spec's Update Bus implementation when that ships).

**Proposes / records; never auto-applies kernel-level changes.** The user is the source of architectural truth (LR-05 + Kernel Rule 8 anti-paternalism).

## Evidence basis

- **Primary evidence:** v1.0 finding (D) — specialist lifecycle is the explicit closing of v1.0. `[user-direction][H]`
- **Corroborating sources:**
  - ADR-0023 (specialist registry) — override semantics this subcommand applies.
  - ADR-0029 (work graph) — the source of truth for what to spawn.
  - L7 Update Bus design (ADR-0007, ADR-0009, ADR-0016) — the mechanism propagation flows through.
- **Synthesizer reasoning:** the `extends: _registry/<name>` override pattern is established (ADR-0023). The spawn command just creates the override file with work-item context pre-filled. Lifecycle is shallow on purpose — Loom's role is to scaffold, not to enforce. `[synth][M]`
- **What would change this call:**
  - Specialists need richer lifecycle (e.g., "hand-off from oauth specialist to monitoring specialist when OAuth setup completes") — would extend the schema.
  - Cross-project propagation requires more than `share: true` — e.g., domain-scoped sharing.

## Consequences

**Locks in:**
- Spawning a specialist is one command; the work item status transitions cleanly.
- Retiring preserves history under `.retired/`; no destructive deletes.
- Lesson promotion is a proposal mechanism, not auto-applied.

**Locks out:**
- Hidden specialist instantiation (the spawn command leaves an event trail).
- Specialist file deletion without history (retire only moves; user can manually delete after if desired).
- Auto-propagation of lessons to other projects.

**Migration path if it fails:** specialists can still be hand-created (write the project-local SKILL.md manually). The subcommands are conveniences; removing the script affects nothing structurally.

## Alternatives considered

- **Auto-spawn during HR work-graph generation.** Rejected: too eager. The user should see the proposed work graph + assigned specialists before spawning starts.
- **Delete on retire instead of move to `.retired/`.** Rejected: history is cheap; reversibility matters per Kernel Rule 20.
- **Auto-propagate `share: true` lessons.** Rejected: cross-project propagation requires the Update Bus (PR-6 / ADR-0016 stub). v1.0's `promote-lessons` puts the lesson on a queue; the Update Bus (when implemented) consumes the queue.
- **Make specialist lifecycle a subagent (HR-managed).** Considered. Deferred — the script is a thin CLI; HR-Agent + user can call it via Bash. Subagent overhead is unnecessary for a synchronous file operation.

## Affects / Affected by

**This ADR affects** *(downstream)*:

- `scripts/lib/specialist-lifecycle.mjs` — implementation
- `scripts/specialist-lifecycle.{sh,ps1}` — wrappers
- `agents/specialists/<name>/SKILL.md` *(created on spawn)*
- `agents/specialists/<name>/.retired/<ts>-SKILL.md` *(created on retire)*
- `lessons-learned/.propagation/<id>.md` *(created on promote-lessons)*
- `orchestration/work-graph.json` *(generated at bootstrap/runtime — absent in a template repo; WI status updated on spawn)*

**This ADR is affected by** *(upstream)*:

- `adr/0023-specialist-registry.md` — override semantics
- `adr/0029-hr-work-graph.md` — work-graph schema
- `adr/0020-runtime-discovery.md` — staleness sentinel (new `.claude/agents/<name>.md` files trigger it)
- `adr/0016-update-bus-stub.md` — propagation receiver (v0.3-spec Update Bus implementation)
- `constitution/local-rules.md` — LR-05 (proposes-not-applies)

## References

- v1.0 finding (D) third bullet
- ADR-0023 (specialist registry override)
- ADR-0029 (work-graph generator)
- L7 Update Bus + ADR-0016 stub
