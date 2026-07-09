# Handoff documents

> Dated context-migration artifacts for new Claude Code sessions on the Loom template project.

Each file in this directory is a **frozen snapshot** capturing project state + collaboration nuances at the time of writing. A new Claude instance (or a Nick coming back after a break) reads the most recent one to understand what's been decided, what's in flight, and how the work is structured.

## Why this directory exists

The Loom template is a multi-session project. Across 30+ commits and 20 PRs, we've established conventions and made decisions whose *rationale* doesn't always survive a context-window reset. The handoff documents are explicit, verbose, and capture both what's true and the why behind it.

## Convention

- **Date-prefixed filenames:** `YYYY-MM-DD-<short-description>.md`
- **Never edit existing docs.** They're snapshots. If something becomes wrong, write a new one that supersedes.
- **CLAUDE.md points at the latest.** When you add a new handoff, update the CLAUDE.md link.
- **Keep the history.** Old handoff docs preserve what we knew when we knew it — useful for future "wait why did we decide that?" questions.

## When to write a new handoff (maintenance triggers)

Per [ADR-0031](../adr/0031-handoff-maintenance-policy.md):

| Trigger | New handoff required? |
|---|---|
| Major-version PR cascade merged (e.g., v0.3→v1.0 batch lands) | **Yes** — within 1 session of the last merge |
| New constitutional rule (LR-NN) added | **Yes** |
| New layer (LN) added | **Yes** |
| Single isolated bug-fix or doc PR | No |
| Spec amendment that doesn't change behavior | No |
| > 30 days since the latest handoff AND any new ADR accepted | **Yes** (default cadence) |

The `handoff-freshness` soft check in [`loom doctor`](../scripts/doctor.sh) surfaces this when triggered. **Soft** by design — surfaces as a warning, never blocks.

## What goes in a new handoff (required sections per ADR-0031)

The first handoff (2026-05-20) is the comprehensive baseline. Subsequent handoffs may be **shorter** — they reference the baseline for older context and focus on what changed since the prior handoff. Required sections:

1. **TL;DR** — paste-able into a new chat (≤ 250 words; self-contained — readable without the rest of the doc, without the repo, without prior chat context)
2. **Read order for a fresh Claude instance**
3. **What changed since the prior handoff** (the load-bearing section for incremental handoffs)
4. **Open work / PRs**
5. **Critical decisions and idioms** — only NEW ones since the prior handoff; reference the prior handoff for older context
6. **What's incomplete** — re-stated each time so it stays fresh
7. **What's likely next**

## Memory-entry refresh

When merge state shifts (a PR merges, a new cascade opens, a roadmap re-prioritizes), update `~/.claude/projects/<project-id>/memory/project_version_state.md` so the next session's auto-recalled context is accurate. Other memory entries (`user_role`, `feedback_*`) update less often — review every ~10 sessions.

## TL;DR portability

The TL;DR section of every handoff is designed to be paste-able in three contexts:

1. **A new Loom-template Claude chat** (primary use — bootstraps context without forcing the new session to read 30+ KB).
2. **A non-Loom AI tool** for a second opinion ("here's the project I'm working on; what would you suggest?"). The TL;DR must be self-contained for this case.
3. **A human collaborator** seeing the project at a glance.

The **≤ 250-word constraint** is load-bearing — beyond that, paste-friction kills the usage. If you need more context, write it as a separate section below the TL;DR.

## Procedure for writing a new handoff

1. Decide a `<short-topic>` (e.g., `post-v1.0-merge`, `v1.1-context`, `discovery-restructure`).
2. Copy the most recent handoff to `handoff/<today>-<short-topic>.md` as a starting template, OR write fresh following the required sections above.
3. Write **What changed since the prior handoff** first — this is the most load-bearing section.
4. Update the CLAUDE.md "Fresh Claude instance? Read..." pointer to the new file.
5. Update `~/.claude/projects/<...>/memory/project_version_state.md` if state has shifted.
6. Update the index table in this README with the new entry.
7. Commit on a `docs/handoff-<YYYY-MM-DD>` branch; open a PR; merge.

## How to use these documents

### If you are a fresh Claude Code instance

1. Read [`../CLAUDE.md`](../CLAUDE.md) for the project index.
2. Read the **most recent** handoff doc in this directory (sorted by filename).
3. Follow the read order it suggests.
4. **Don't generate output beyond reading + a status summary** until you've finished step 2.

### If you are Nick

- Review when adding new handoff docs to make sure I've captured what matters.
- Update "What's likely next" if priorities shift.

### If you are someone else

- The TL;DR section in each handoff doc is paste-able into a new Claude chat.
- The Critical decisions and idioms section is the most load-bearing.

## Index

| Date | File | Phase covered | Notes |
|---|---|---|---|
| 2026-05-20 | [`2026-05-20-loom-v1.0-context.md`](./2026-05-20-loom-v1.0-context.md) | batch-01 → v1.0 | Comprehensive — 30 ADRs, 5 LRs, 8 layers, 18 subagents, 14 open PRs (v0.2 cascade merged 2026-05-18). First handoff doc in the project. |
| 2026-05-25 | [`2026-05-25-loom-v0.3.3-context.md`](./2026-05-25-loom-v0.3.3-context.md) | v0.3.3 | Ravenwise test-bed findings, specialist-invocation discipline (ADR-0034), provisioning specialist + playbooks (ADR-0035/0036), credential collection. |
| 2026-06-04 | [`2026-06-04-observatory-context.md`](./2026-06-04-observatory-context.md) | v0.3.4 + Observatory | v0.3.4 (RAG arc + LR-06, hook gap detection, bootstrap PAT). L9 Observatory dashboard (ADR-0039–0041). 41 ADRs, 6 LRs, 10 layers, 19 agents. |
| 2026-07-05 | [`2026-07-05-research-evaluation.md`](./2026-07-05-research-evaluation.md) | Observatory fixes + research-eval | PR #50 observatory watcher gaps, aggregator.test.mjs (66 assertions), 218/218 passing. ADR-0043–0045. Sets up research-evaluation session. |
| 2026-07-07 | [`2026-07-07-option-b-complete-and-agent-engagement.md`](./2026-07-07-option-b-complete-and-agent-engagement.md) | Option-B re-architecture (model-agnostic spec + adapters) | ADRs 0046–0052: spec+adapters (Claude Code + LangGraph + Python), conformance suite, cross-language proven live, OTel export, durable execution, credit-validation dogfood. 420/420 + Python 9/9. Critic-driven security fix (contained-scope bypass). **Agent reputation/reward decision pending** (constitution-service escalated). |
| 2026-07-08 | [`2026-07-08-phase1-uipath-3d-visualizer.md`](./2026-07-08-phase1-uipath-3d-visualizer.md) | Phase-1 proof vehicle (ADR-0054) | Kickoff for the first real build: a web-app 3D "city map" of a UiPath REFramework automation for RCA + business/technical requirement + exception confidence. v1 static (XAML + PDD/Requirements helper), runtime-log overlay v2. Built in its own dir, governed by Loom — also the test of whether dogfood governance holds on a novel non-web project. |
