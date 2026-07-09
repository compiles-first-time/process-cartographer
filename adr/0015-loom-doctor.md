# ADR-0015: `loom doctor` — cross-checks for v0.2 conformance

**Status:** Accepted
**Date:** 2026-05-18
**Author:** Architect handoff — Loom v0.2 enforcement runtime — approved by Nick
**Confidence:** [H]

> **Update (2026-07-07 audit):** The "seven checks" below are the original v0.2 set. `loom doctor` has since grown to ~15 checks (extended by ADRs 0017, 0022, 0023, 0031, 0033, 0034, 0038, 0044, 0045). The current authoritative list is in the `scripts/lib/doctor.mjs` header comment.

## Context

PRs 1–4 added enforcement runtime pieces (hooks, subagents, bootstrap unification, lessons auto-suggest). Each can drift independently — placeholders forgotten, CLAUDE.md grows past its cap, YAML and JSON drift, subagent frontmatter breaks, hooks disabled silently. The v0.1 spec assumed a doctor existed (in the v0.2 roadmap) but didn't ship one.

## Decision

Ship `scripts/doctor.{sh,ps1}` (thin wrappers) + `scripts/lib/doctor.mjs` (the actual checker). Seven checks, each tagged **hard** (counts toward exit code 1) or **soft** (warning only):

| # | Check | Hard / soft | Notes |
|---|---|---|---|
| 1 | **Placeholders** in stamped files | hard | `<PROJECT_NAME>`, `<USER_NAME>`, `<YYYY-MM-DD>` must not remain |
| 2 | **Size caps** (`CLAUDE.md` ≤ 10 KB, `AGENTS.md` ≤ 5 KB) | hard | |
| 3 | **Proposed ADRs** all listed in `CLAUDE.md` "ADRs in flight" | hard | Catches indexing drift |
| 4 | **MCP YAML/JSON alignment** | hard | Re-runs the PR-3 generator in `--check` mode. `--fix` auto-regenerates |
| 5 | **Subagents present + parse-clean** | hard | ≥ 6 files in `.claude/agents/`, each has frontmatter with `name:` + `description:` |
| 6 | **Event-log coverage ratio** ≥ 50% of last 14 commit days | **soft** | Soft because typo commits / web-UI commits legitimately bypass hooks. Reports a ratio rather than passing/failing per-day |
| 7 | **Skeleton intact** — core files present | hard | Quick sanity check |

Exit codes: 0 (no hard failures), 1 (one or more hard failures). Soft warnings never fail the run.

A `--fix` flag attempts mechanical fixes for check 4 (re-run generator). It does **not** attempt to fix placeholders (it can't guess project/user names) — those still require `scripts/bootstrap.{sh,ps1}` with the right args.

## Consequences

**Locks in:**
- One command to validate a Loom project. `bash scripts/doctor.sh` or `pwsh scripts/doctor.ps1`.
- CI can call it cheaply (single Node invocation, no external deps).
- Drift between any of the four v0.2 systems (hooks, subagents, bootstrap, lessons) is visible at a glance.

**Locks out:**
- Silent drift between YAML and JSON.
- Forgetting to list a Proposed ADR in CLAUDE.md.
- Shipping a template whose own bootstrap was never run.

**Soft signal vs. hard fail:** the event-log coverage check is soft (warning) per my disagreement in the original plan. A typo commit on the web UI legitimately produces a commit day with no event-log entry — that's not a failure. A *ratio* in the last 14 days is a more useful drift indicator than a per-day pass/fail.

## Alternatives considered

- **Run doctor as a pre-commit hook.** Rejected for v0.2: would require either husky-style config or a project-local hook installer. Re-evaluate in v0.3.
- **Make event-log coverage a hard fail.** Rejected: too many legitimate-but-uncovered commit days (web UI commits, non-Claude-Code edits). False-positive cost outweighs the benefit.
- **Use a JSON-schema-validation library to parse subagent frontmatter.** Rejected: adds a dep we don't need. Regex on the two required fields is enough at this layer; deeper schema validation can land in v0.3 alongside the formal Update Bus schema.
- **Bundle doctor into a single shell script per platform.** Rejected: the actual checks are in Node (cross-platform); shell wrappers are 15-line dispatchers, no logic to duplicate.

## References

- [`../scripts/lib/doctor.mjs`](../scripts/lib/doctor.mjs) — checker
- [`../scripts/doctor.sh`](../scripts/doctor.sh), [`../scripts/doctor.ps1`](../scripts/doctor.ps1) — thin wrappers
- ADR-0011 — provides the event log the coverage check reads
- ADR-0012 — provides the subagents the parse check reads
- ADR-0013 — provides the generator the alignment check delegates to
