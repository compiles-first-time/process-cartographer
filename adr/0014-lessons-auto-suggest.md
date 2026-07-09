# ADR-0014: Lessons-learned auto-suggestion via the Stop hook

**Status:** Accepted
**Date:** 2026-05-18
**Author:** Architect handoff — Loom v0.2 enforcement runtime — approved by Nick
**Confidence:** [H]

## Context

The v0.1 real-session findings noted that the session hit at least two clean failure-avoidance events — npm version-skew between `ai@6` and `@ai-sdk/react@2`, and a fictitious `@vercel/config@^1.0.0` package — but `lessons-learned/` stayed empty. The spec promised "exception registry" but had no mechanism to populate it.

The PR-1 hooks already emit `tool_result` events with an `error_signature` (SHA-1 prefix over a canonicalized error key). We just need to consume that.

## Decision

The Stop hook (`scripts/hooks/stop.mjs`) calls `scripts/hooks/stop-lessons.mjs` at session end. The auto-suggester:

1. Reads today's JSONL for `tool_result` records with non-null `error_signature` from this session.
2. Groups them by signature; for each unique signature, looks up `lessons-learned/.signatures/<sig>.txt`.
3. If novel, writes a `lessons-learned/draft-YYYY-MM-DD-<slug>.md` with:
   - `status: draft` frontmatter
   - `auto_suggested: true` and `auto_suggested_observation_count: N` keys
   - Pre-filled "What happened" section (tool, count, first/last timestamps, error preview)
   - Empty "Why it happened", "What we did", "What we'd do differently" sections for the human to fill
4. Touches `.signatures/<sig>.txt` to dedup against future sessions.
5. Emits a `lessons_autosuggest` event with `suggested` and `skipped` counts.

**Drafts are never auto-promoted.** Promotion is manual:

- Rename `draft-YYYY-MM-DD-<slug>.md` → `YYYY-MM-DD-<slug>.md`.
- Remove `status: draft` and `auto_suggested*` keys from frontmatter.

This respects Kernel Rule 22 (epistemic transparency requires human review of memory writes) and the v0.1 design that lessons-learned files are first-class.

The hook is **lazy-loaded** and **error-tolerant**: removing `stop-lessons.mjs` disables auto-suggest cleanly; any failure inside it produces a `lessons_autosuggest_error` event but never fails the Stop hook itself.

## Consequences

**Locks in:**
- Every session ends with a populated lessons-learned signal: either a draft exists, or the failure has been seen before (signature recorded).
- The signature dedup mechanism prevents the same failure from producing N drafts across N sessions.
- The .signatures/ directory is durable state — losing it causes duplicate drafts.

**Locks out:**
- Auto-promotion. The Critic / human always reviews before a draft becomes a real lesson.
- Noise from signature-less errors (e.g., framework errors that don't reach stderr). Those produce no draft; they're not lost (tool_result is logged) but they don't pollute lessons-learned.

**Migration path if it fails:** delete `scripts/hooks/stop-lessons.mjs`; the Stop hook continues without it. Existing `.signatures/*.txt` and `draft-*.md` files stay as a record but no new ones get created.

## Alternatives considered

- **Auto-promote drafts to real lessons.** Rejected: violates Rule 22; risks polluting memory with false-positive "lessons."
- **Match by full error text rather than signature.** Rejected: every absolute path / timestamp variation would produce a new "novel" failure. The signature canonicalization (path/timestamp stripping, SHA-1 prefix) is the dedup primitive.
- **Run the suggester from a cron / scheduled task.** Rejected: needlessly stateful; the Stop hook already runs at the right cadence (end of session, single source of authoritative timing) and has the right data in scope.
- **Write drafts to a separate `drafts/` directory.** Rejected: lessons-learned is the canonical location; a `draft-` prefix on the filename is enough disambiguation and keeps everything in one directory for grep / review.

## References

- [`../scripts/hooks/stop-lessons.mjs`](../scripts/hooks/stop-lessons.mjs) — the auto-suggester
- [`../scripts/hooks/stop.mjs`](../scripts/hooks/stop.mjs) — wires it into the Stop hook
- [`../lessons-learned/`](../lessons-learned/) — destination
- [`../lessons-learned/.signatures/`](../lessons-learned/.signatures/) — dedup sentinels
- ADR-0011 — provides the `error_signature` field the suggester reads
