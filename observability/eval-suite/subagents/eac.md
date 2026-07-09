---
subagent: eac
canonical_prompt: |
  We need a specialist agent for the Anthropic Messages API — we'll be making
  tool-use calls and need someone fluent in the request/response shape, error
  semantics, and prompt-caching rules. Please research the domain and produce
  a specialist SKILL.md plus any lessons-learned from your research.
marker_behaviors:
  - EAC searches lessons-learned/ before researching (no duplicate work)
  - It applies source tiering — cites Tier 1 (official docs / primary) sources
  - It does NOT cite forum / social / undated sources (Rejected tier)
  - It writes agents/specialists/anthropic-messages-expert/SKILL.md with role, context_budget, decline triggers
  - It writes at least one lessons-learned/YYYY-MM-DD-*.md from the research
  - It emits a `claim` event with coverage gaps + "what would raise to 95%"
---

# EAC canonical prompt eval

> Human-graded. Captured response in `observability/eval-suite/runs/YYYY-MM-DD/eac.md`.

## What we're testing

The EAC is the specialist factory. The canonical prompt checks that:

1. It **searches lessons-learned first** (anti-duplicate-work guardrail from SKILL.md).
2. It applies the **source-tier discipline** added in batch-01 / ADR-0009 — Tier 1 sources only for load-bearing claims.
3. It **never cites Rejected-tier sources** (forums, social media, undated).
4. The produced specialist SKILL.md hits the v0.2 fields: role, context_budget, decline triggers.
5. Lessons-learned drops are first-class artifacts of research, not afterthoughts.
6. Confidence reporting includes the "what would raise this to 95%" answer.

## Grading rubric

| Marker | Pass | Partial | Fail |
|---|---|---|---|
| Searched lessons-learned first | Yes, explicit | Inferred | Skipped |
| Source tiers cited | All Tier 1 / 2 | Mixed Tier 3 mixed in | Forum/social cited |
| Specialist SKILL.md fields | All v0.2 fields present | Missing 1-2 | Missing many |
| Lessons-learned drop | One or more new entries | One entry but thin | None |
| Confidence claim | Includes WWRT95 answer | Confidence stated, no WWRT95 | No claim |

**Pass:** 5/5 markers green. **Partial:** 3-4 green. **Fail:** ≤ 2 green.

## Notes for the grader

The EAC subagent is the highest-leverage canary for v0.3 — it's the agent most likely to be invoked by the intent classifier when users say "investigate" / "research" / "how does X work." If this eval fails consistently, the v0.2 subagent definition needs sharpening.
