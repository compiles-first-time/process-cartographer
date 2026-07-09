# ADR-0021: Subagent canonical-prompt evals (human-graded)

**Status:** Accepted
**Date:** 2026-05-18
**Author:** Architect handoff — Loom v0.3 — approved by Nick
**Confidence:** [M]

## Context

v0.3 finding #5: HR and EAC are unverified. There is no integration test that says "given a deploy-style user prompt, EAC produces a reasonable specialist plan." Without that, the subagents are aspirational. The same applies to all six base subagents — we ship their SKILL.md contracts but never check the runtime honors them.

Automated grading of agentic responses is hard. LLM-as-judge is expensive, drift-prone, and circular (we'd be using the same family of models to grade itself). Regex-on-response is fragile and produces false negatives the moment the model phrases things differently. Both options promise more than they deliver.

## Decision

Ship **canonical prompts + a capture runner. Grading is human at template-release time.** Be honest about the limitation — don't pretend we have automated agentic evals.

### A. One canonical prompt per subagent

`observability/eval-suite/subagents/{hr,eac,human-replica,critic,memory-keeper,constitution-service}.md` — each has YAML frontmatter:

```yaml
---
subagent: <name>
canonical_prompt: |
  <a representative task that triggers the subagent's load-bearing
   responsibilities>
marker_behaviors:
  - <behavior 1>
  - <behavior 2>
  - ...
---
```

The body is the **human grading rubric** with Pass / Partial / Fail criteria per marker.

The canonical prompts are chosen to be **textbook cases** for each subagent — Critic facing a collapse-risk ADR; Constitution Service facing a `vercel deploy --prod`; EAC facing a research request with clear Tier-1 sources; Human Replica previewing a Rejected-tier inbox item; Memory-Keeper facing a query with no matches in a fresh template (anti-hallucination check); HR registering a new specialist (write-scope check).

### B. Capture runner

`scripts/eval-subagents.{sh,ps1}` + `scripts/lib/eval-subagents.mjs` invoke each subagent via the `claude` CLI:

```
claude --print --agent <name> "<canonical_prompt>"
```

Captures stdout/stderr/exit-code/duration to `observability/eval-suite/runs/YYYY-MM-DD/<name>.md`. The capture file has frontmatter linking back to the eval source + a "Grade" section for the human to fill.

### C. Dependency on the `claude` CLI

The runner requires `claude` on PATH. This is a documented trade-off (v0.3 plan confirmation item #2): the alternative — a Node-only subagent dispatcher — would duplicate fragile internals of Claude Code's subagent invocation. The CLI is the right boundary.

If `claude` isn't installed, the runner exits 2 with a clear error. `--dry-run` prints the plan without dispatching.

## Consequences

**Locks in:**
- Six concrete, reviewable behavioral expectations for the v0.2 subagents.
- A reproducible "did this template release regress agent behavior?" workflow.
- Honesty about agentic eval — automated grading is explicitly out of scope.

**Locks out:**
- Aspirational "we have agent tests" claims.
- LLM-as-judge automated grading (deferred to v0.4 or later, only if the value is proven).

**Migration path if it fails:** the canonical prompts are markdown — they remain useful as documentation of expected behavior even if the runner is removed. The runner is a thin CLI wrapper; removing it disables nothing else.

**Cadence:** **every template release.** Not every commit. The cost is N subagent dispatches × LLM call time × human grading time — affordable at release cadence, prohibitive at commit cadence.

## Alternatives considered

- **LLM-as-judge automated grading.** Rejected: expensive, circular (same model family grades itself), drift-prone, and the v0.3 budget doesn't include LLM cost. v0.4 may revisit if the value of agentic regression detection becomes obvious.
- **Regex on response.** Rejected: every legitimate phrasing variation produces a false negative. Fragile.
- **Node-only subagent dispatcher (no `claude` CLI dependency).** Rejected: duplicates Claude Code's subagent invocation internals. The CLI is the documented dispatch boundary; using it is more honest than reimplementing.
- **Run on every commit.** Rejected: cost-prohibitive (LLM calls per commit × six subagents). Release cadence is enough.

## References

- [`../observability/eval-suite/subagents/`](../observability/eval-suite/subagents/) — canonical prompts + rubrics
- [`../scripts/lib/eval-subagents.mjs`](../scripts/lib/eval-subagents.mjs) — runner
- [`../scripts/eval-subagents.sh`](../scripts/eval-subagents.sh), [`../scripts/eval-subagents.ps1`](../scripts/eval-subagents.ps1) — wrappers
- [`../observability/eval-suite/README.md`](../observability/eval-suite/README.md) — eval category index
- ADR-0012 — the subagents being evaluated
- ADR-0006 — eval-suite anti-collapse rule (this PR adds *alongside*, never replaces)
