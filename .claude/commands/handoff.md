Generate a comprehensive context-transfer document for this Loom project so a fresh chat session can continue work with zero information loss.

## What to do

**Step 1 — Gather project state** (run these in parallel):
- Read `CLAUDE.md` (entry point, current goals, working agreements, recent ADRs)
- Read `orchestration/progress-ledger.md` (session log, in-progress tasks)
- Run `git log --oneline -12` (recent commits)
- Run `git status` (any uncommitted changes)
- Read `handoff/README.md` if it exists (the handoff convention)

**Step 2 — Gather session activity**:
- Find today's event log at `memory/event-log/YYYY-MM-DD.jsonl` (use today's date)
- Extract: tool_calls, session_end records, any claim or subagent_suggestion events
- Identify which files were edited in the last 3 commits: `git diff HEAD~3..HEAD --name-only`

**Step 3 — Read the 3 most recent ADRs**:
- List `adr/` sorted by filename descending, read the top 3
- For each: extract Status, Decision summary, and Consequences

**Step 4 — Assemble the handoff document** with ALL of these sections:

```
# [Project name] — Context Transfer [YYYY-MM-DD]

## What this is
[One paragraph: what the project is, what it does, why it exists]

## Who is working on it
[Nick's role, collaboration model, escalation bar]

## Repo location
[Local path + GitHub URL]

## Current state (as of [date])
[Version, last commit hash, branch, what's done/merged]

## What was accomplished recently
[Bullet list: what changed, which PRs merged, why each decision was made]

## The task that needs to continue
[Precise description of what the next chat should build or fix, with enough
 detail that no clarification is needed. Include file paths, function names,
 expected output.]

## Key files to read before building
[Exact paths with one-line description of why each matters]

## Architectural constraints
[Hard constraints that affect what's buildable. Frame each as: 
 "X is not possible because Y. The workaround is Z."]

## Past decisions and WHY
[Decisions made recently with their rationale. Format:
 - Decision: [what was chosen]
   Why: [reason]
   Trade-off: [what was given up]
   Evidence: [source if available]]

## Collaboration conventions
[How Nick and Claude work together: PR style, who merges, how to flag disagreement]

## Do not do
[Explicit list of things the new session should NOT do without checking first]

## Verbatim implementation prompt
[A copy-paste-ready prompt the user can paste into a new chat to continue the work.
 Self-contained — zero prior context assumed. Include file paths, exact function
 signatures, model IDs, etc.]
```

**Step 5 — Write the document**:
- Write to `handoff/[today's date]-[topic-slug].md`
- The topic slug should describe what comes next (e.g., `routing-launcher-implementation`)
- Per ADR-0031: include a frontmatter block with `date:`, `author:`, `topic:`, `status: active`

**Step 6 — Print the verbatim prompt section** to the terminal so the user can copy it directly without opening the file.

---

## Quality bar

A good handoff document passes this test: give it to a Claude session that has never seen this project and ask it to start the next task. It should be able to start immediately, make the right architectural choices, and not need to ask clarifying questions about project conventions.

Red flags that mean the handoff is incomplete:
- The new session has to ask "where is X file?"
- The new session has to ask "why did we do it this way?"
- The new session has to ask "what model should I use?"
- The new session omits justifications for its choices
- The new session has to re-read more than 3 files to understand what to do

$ARGUMENTS
