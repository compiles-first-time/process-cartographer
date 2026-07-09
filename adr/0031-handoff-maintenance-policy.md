# ADR-0031: Handoff documentation maintenance policy

**Status:** Accepted
**Date:** 2026-05-20
**Author:** Architect handoff — approved by Nick
**Confidence:** [H]

## Context

PR #21 introduced the `handoff/` directory + the first comprehensive handoff doc (`handoff/2026-05-20-loom-v1.0-context.md`). The doc is a frozen snapshot; project state and conventions evolve. Without an explicit maintenance policy, the handoff drifts: a future Claude session reads a stale doc, makes decisions on outdated state, and the value of the migration mechanism degrades.

User direction 2026-05-20:

> "Can we include this information somewhere so that we ensure it happens going forwards?"

The three maintenance triggers Nick wants enforced:

1. **Major-milestone updates.** Major merges produce a new handoff; the old stays as history.
2. **Memory-entry refresh on state change.** `project_version_state` memory must be updated when merge state shifts.
3. **TL;DR portability.** The TL;DR section of the latest handoff doubles as a paste-able context block for non-Loom chats (e.g., second-opinion AI consultations).

## Decision

Codify a three-layer maintenance policy. The policy is binding from this ADR's merge date.

### A. Triggers — when to write a new handoff

| Trigger | New handoff required? |
|---|---|
| Major-version PR cascade merged (e.g., the v0.3→v1.0 batch lands) | **Yes** — within 1 session of the last merge |
| New constitutional rule (LR-NN) added | **Yes** |
| New layer (LN) added | **Yes** |
| Single isolated bug-fix or doc PR | No |
| Spec amendment that doesn't change behavior | No |
| > 30 days since the latest handoff AND any new ADR accepted | **Yes** (default cadence; doctor surfaces this) |

**Filename:** `handoff/<YYYY-MM-DD>-<short-topic>.md`. Examples:
- `handoff/2026-06-15-post-v1.0-merge.md`
- `handoff/2026-07-01-v1.1-context.md`
- `handoff/2026-08-12-discovery-restructure.md`

### B. What goes in a new handoff

Every new handoff has these required sections (the first one establishes the template):

1. **TL;DR** — paste-able into a new chat (≤ 250 words)
2. **Read order for a fresh Claude instance**
3. **What changed since the prior handoff** *(new section — supersedes "Project state" for incremental handoffs)*
4. **Open work / PRs**
5. **Critical decisions and idioms** (only NEW ones since the prior handoff; reference the prior handoff for older ones)
6. **What's incomplete** (re-stated each time so it stays fresh)
7. **What's likely next**

The first handoff (2026-05-20) is the comprehensive baseline. Subsequent handoffs may be shorter — they reference the baseline for older context and focus on **what changed since the prior handoff**.

### C. CLAUDE.md pointer

The "Fresh Claude instance? Read..." line near the top of `CLAUDE.md` always points at the **latest** handoff. Updating the pointer is part of writing a new handoff (the procedure in `handoff/README.md` lists this as step 4).

### D. Memory-entry refresh

`~/.claude/projects/<project-id>/memory/project_version_state.md` is the single source of "where are we now" for new Claude sessions in this project dir. **It must be updated whenever merge state shifts** — when a PR merges, when a new branch opens, when a roadmap re-prioritizes.

Other memory entries (`user_role`, `feedback_*`) are more stable and update only when the preferences actually change. The Builder reviews them every ~10 sessions and updates if needed.

### E. TL;DR portability

The TL;DR section at the top of every handoff is constrained to ≤ 250 words and must be **self-contained** — readable without the rest of the doc, without the repo, without prior chat context. It's intended for:

- Pasting into a new Loom-template Claude chat (primary use).
- Pasting into a non-Loom AI tool for a second opinion ("here's the project I'm working on; what would you suggest?").
- Showing a human collaborator the project at a glance.

The 250-word constraint is load-bearing — beyond that, paste-friction kills the usage.

### F. Mechanical enforcement (doctor check — lands after v0.2/c-doctor)

`scripts/lib/doctor.mjs` (introduced in v0.2 PR-C / PR #6, currently open) gains a soft check `handoff-freshness`:

```javascript
async function checkHandoffFreshness() {
  // Find latest handoff
  const handoffDir = path.join(ROOT, "handoff");
  if (!existsSync(handoffDir)) return soft("handoff-freshness", true, "no handoff/ directory (skipped)");
  const files = (await fs.readdir(handoffDir))
    .filter((f) => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f))
    .sort();
  if (files.length === 0) return soft("handoff-freshness", false, "no dated handoff documents found");
  const latest = files[files.length - 1];
  const latestDate = latest.slice(0, 10);

  // Days since latest
  const daysSince = Math.floor((Date.now() - new Date(latestDate + "T00:00:00Z").getTime()) / (24 * 3600 * 1000));

  // Commits on main since latest handoff date
  const log = spawnSync(
    "git",
    ["log", `--since=${latestDate}`, "--format=%H %s", "--", "adr/", "layers/", "scripts/", ".claude/", "constitution/"],
    { cwd: ROOT, encoding: "utf8" }
  );
  const milestoneCommits = (log.stdout || "")
    .split("\n")
    .filter(Boolean)
    .filter((line) => /Merge pull request|adr\/\d{4}|layers\/L\d/.test(line));

  if (daysSince > 30 && milestoneCommits.length > 0) {
    return soft("handoff-freshness", false,
      `latest handoff is ${daysSince} days old AND ${milestoneCommits.length} milestone commit(s) have landed since. Write a new handoff at handoff/${new Date().toISOString().slice(0, 10)}-<topic>.md per ADR-0031.`);
  }
  if (milestoneCommits.length >= 5) {
    return soft("handoff-freshness", false,
      `${milestoneCommits.length} milestone commits since latest handoff (${latest}). Consider writing a new handoff per ADR-0031.`);
  }
  soft("handoff-freshness", true, `latest handoff ${latest} (${daysSince} days old; ${milestoneCommits.length} milestone commits since)`);
}
```

**Lands when:** v0.2 PR-C (PR #6 / `v0.2/c-doctor`) merges to main. The check spec is recorded here so it's binding even before the code lands. The check is **soft** — surfaces as a warning, never blocks.

## Evidence basis

- **Primary evidence:** user direction 2026-05-20 ("can we include this information somewhere so that we ensure it happens going forwards?"). `[user-direction][H]`
- **Corroborating sources:**
  - Software-engineering documentation-rot research (e.g., Lethbridge et al. 2003 "How software engineers use documentation") — docs not updated in step with code rot at ~7% per month. `[primary][M]`
  - ADR convention itself (Michael Nygard, "Documenting Architecture Decisions" 2011) — frozen-snapshot pattern with supersedence is the established practice. `[primary][H]`
- **Synthesizer reasoning:** the three-layer enforcement (ADR text + README procedure + doctor check + memory entry) covers the three failure modes: forgetting to update (memory + doctor), forgetting what should be in an update (README procedure), forgetting *why* the policy exists (ADR text). `[synth][M]`
- **What would change this call:**
  - Real evidence that the 30-day cadence is too tight or too loose.
  - Doctor check produces too many false-positive warnings (signaling the heuristic is wrong).
  - A different documentation-as-code pattern (e.g., a dedicated `STATUS.md` file that's continuously updated rather than dated snapshots) proves measurably more effective.

## Consequences

**Locks in:**
- Dated-snapshot pattern for handoffs (never edit existing; new ones supersede).
- Mechanical reminder via `loom doctor` once the v0.2/c-doctor PR merges.
- Memory-entry refresh as part of standard PR-merge workflow.
- TL;DR portability constraint (≤ 250 words, self-contained).

**Locks out:**
- Living "current state" documents that get edited in place — they erase the history of *when* something was true.
- TL;DR sections that swell to handoff-doc length and lose paste-portability.
- "I'll write a handoff later" — the doctor check turns the reminder into a soft signal that surfaces every session.

**Migration path if it fails:** the policy is markdown — relaxing it requires a superseding ADR. The doctor check is one function; removing it disables nothing else. The README expansion can be reverted independently.

## Alternatives considered

- **Single living `STATUS.md` continuously edited.** Rejected: erases the history of when a decision was made or when a state was current. The frozen-snapshot pattern is what makes the dated handoffs auditable.
- **Hard-fail doctor check.** Rejected: false-positive cost is high (e.g., a one-line spec amendment commit shouldn't fail every subsequent `loom doctor` run until a handoff is written). Soft warning is the right calibration.
- **Hook-based reminder at session start.** Considered. Deferred — handoff freshness isn't urgent at session start; the doctor check is the right cadence for surfacing it.
- **Make the TL;DR a separate file.** Rejected: keeping it at the top of the handoff doc means it's always co-located with the deeper context; a separate file would invite drift.

## Affects / Affected by

**This ADR affects** *(downstream)*:

- `handoff/README.md` — procedure expanded with maintenance triggers
- `handoff/<YYYY-MM-DD>-*.md` — every future handoff doc follows the structure in section B
- `~/.claude/projects/<...>/memory/project_handoff_doc.md` — memory entry updated with triggers
- `~/.claude/projects/<...>/memory/project_version_state.md` — refresh trigger documented
- `scripts/lib/doctor.mjs` — `handoff-freshness` soft check added when the file exists on main (after PR #6 merges)
- `CLAUDE.md` — "Fresh Claude instance? Read..." pointer + Recent ADRs

**This ADR is affected by** *(upstream)*:

- `constitution/local-rules.md` — LR-05 (decisions supersedable; future ADRs can refine this policy with evidence)
- `constitution/kernel-v6.md` — Kernel Rule 22 (epistemic transparency; the handoff is the project's transparency artifact across sessions)

## References

- User direction 2026-05-20 ("ensure it happens going forwards")
- ADR-0015 — `loom doctor` (the host for the new `handoff-freshness` check)
- ADR-0022 — Affects / Affected by convention this ADR follows
- LR-05 — supersedability discipline
- Michael Nygard, "Documenting Architecture Decisions" (2011) — frozen-snapshot pattern
- Lethbridge et al. (2003), "How software engineers use documentation" — doc rot evidence
