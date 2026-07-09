# ADR-0025: Discovery scaffolding — quick scan at bootstrap + full flow + L8 layer

**Status:** Accepted
**Date:** 2026-05-20
**Author:** Architect handoff (v0.5 PR-N) — approved by Nick
**Confidence:** [H]

## Context

v0.3 finding (B): Loom's "what to build" inputs came from a single ad-hoc conversation, not a structured Discovery phase. Result: projects that shipped the requested feature without surfacing the non-functional requirements (security, scale, observability, compliance) the user didn't think to mention.

PR-N (this ADR) makes Discovery a first-class verb with two phases:

1. **Quick scan** (~5 min) at bootstrap, shaping initial skeleton.
2. **Full discovery** (~30–60 min) post-bootstrap, producing requirements + risk register + open questions.

PR-O (ADR-0026) adds the deploy gate + Critic domain checklists + skeleton-amendment proposals.

## Decision

### A. Two-phase Discovery

Quick scan in bootstrap; full discovery post-bootstrap. Per user direction 2026-05-20: the skeleton may be rebuilt as deeper research changes the answers. Bootstrap is **not** blocked on full discovery; deploy **is** (PR-O).

### B. `scripts/discover.{sh,ps1}` + `scripts/lib/discover.mjs`

Modes:

- `--quick` — 5 questions → `discovery/quick-scan.md`.
- (default) — interactive walk-through of `requirements.md`, `risk-register.md`, `open-questions.md`.
- `--non-interactive` — stamp templates only; no prompts (CI / re-bootstrap of existing project).

### C. `discovery/` directory

- `discovery/README.md` — orientation
- `discovery/quick-scan.md` — Phase 1 output
- `discovery/requirements.md` — functional + NFR pillars
- `discovery/risk-register.md` — **xlsx convention** per ADR-0022 (SE/BE rows + Justifications)
- `discovery/open-questions.md` — unresolved + resolution log

### D. L8 layer doc

New `layers/L8-discovery.md` describes the model. Mirrored into the spec when v0.5 closes (v0.5 is in-progress; L8 is the layer doc; spec §B.9 amendment follows when the phase completes).

### E. Bootstrap integration

`scripts/bootstrap.{sh,ps1}` calls `scripts/discover.{sh,ps1} --quick` in the v0.2 runtime-stamping phase, before the "RESTART CLAUDE CODE" banner. Non-interactive when bootstrap itself is being run non-interactively (the discover script detects stdin TTY status).

### F. Iteration model

Discovery is iterative. Quick scan → initial skeleton → full discovery → potential skeleton amendment (PR-O proposes; user approves) → build → requirements change → artifacts updated under LR-05. The Critic reviews `requirements.md` against domain checklists (PR-O).

## Evidence basis

- **Primary evidence:** the v0.3 finding (B) from a real downstream session — AnonForum shipped without surfacing the NFR pillars. `[user-report][H]`
- **Corroborating sources:**
  - ISO/IEC/IEEE 29148:2018 (Requirements engineering) — establishes functional vs. NFR distinction and risk-register practice. `[institutional][H]`
  - Bohem, "Software Engineering Economics" (1981) — cost of fixing requirements defects at release is ~100× cost at requirements time. `[primary][H]`
  - User-supplied Credit Validation xlsx — risk-register format applied here. `[primary][H]`
- **What would change this call:**
  - A peer-reviewed study showing two-phase Discovery is materially worse than continuous-discovery-during-build at delivering NFR compliance.
  - User report that the quick-scan questions miss a recurring failure category.

## Consequences

**Locks in:**
- Every Loom project has explicit `discovery/` artifacts to point to. The "where are the requirements?" question has a documented answer.
- The xlsx convention (ADR-0022) is exercised in the risk register — that's its second canonical use (first was specialist failure modes per PR-M).
- Bootstrap's "RESTART CLAUDE CODE" banner stays the same; quick-scan runs before it.

**Locks out:**
- Build-without-discovery as a default path. The artifacts will be empty unless the user fills them, but they exist as a forcing function.

**Migration path if it fails:** `discovery/` is markdown — projects can hand-fill or delete the directory; bootstrap continues without it. The quick-scan questions can be amended in `scripts/lib/discover.mjs` without breaking the artifact structure.

**Subagent staleness:** unaffected; this PR adds no new `.claude/agents/*.md` files. The interactive prompts are in the Node script.

## Alternatives considered

- **One-shot discovery before bootstrap.** Rejected per user direction 2026-05-20: the user may not know enough at bootstrap to answer rich discovery questions. Two-phase respects the "users make mistakes; iterate" reality.
- **Discovery as a dedicated subagent.** Considered. Deferred to a future PR: the Discovery flow is procedural (5 questions, 3 templates), not the kind of open-ended task subagents shine at. A subagent-based Discovery would shine when the system can ask follow-up questions based on prior answers (PR-O's Critic-domain-checklist review is closer to that).
- **Skip risk register; only requirements + open questions.** Rejected: the risk register is the most load-bearing artifact for downstream Loom layers (HR's work-graph in PR-R consumes it; the Critic's monthly audit reviews it; deploy gate checks it).
- **JSON Schema-validated artifacts.** Rejected for v0.5: human-edit ergonomics matter more. A JSON mirror could land in v0.6+ if HR's work-graph (JSON) starts needing programmatic input from these.

## Affects / Affected by

**This ADR affects** *(downstream)*:

- `scripts/lib/discover.mjs` — implementation
- `scripts/discover.sh` + `scripts/discover.ps1` — wrappers
- `scripts/bootstrap.sh` + `scripts/bootstrap.ps1` — invoke `discover --quick`
- `discovery/README.md` + `discovery/{quick-scan,requirements,risk-register,open-questions}.md`
- `layers/L8-discovery.md` — layer doc
- `adr/0026-discovery-gate.md` *(planned, PR-O)* — deploy gate + Critic review + skeleton amendments
- `adr/0029-hr-work-graph.md` *(planned, PR-R)* — HR consumes `requirements.md` (generated at bootstrap/runtime — absent in a template repo)

**This ADR is affected by** *(upstream)*:

- `adr/0022-xlsx-docs-convention.md` — risk-register.md follows this convention
- `constitution/local-rules.md` — LR-05 (Discovery artifacts are supersedable by evidence)
- `layers/L1-skeleton.md` — Discovery is now a top-level directory in the skeleton

## References

- v0.3 finding (B) — AnonForum NFR-blind session
- ISO/IEC/IEEE 29148:2018 — Requirements engineering
- ADR-0022 — xlsx docs convention (used by risk-register.md)
- LR-05 — Discovery artifacts are supersedable by evidence
