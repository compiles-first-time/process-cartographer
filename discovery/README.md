# Discovery

> Loom v0.5 — Discovery as a first-class verb. Per [L8](../layers/L8-discovery.md) / [ADR-0025](../adr/0025-discovery-scaffolding.md).

Discovery in Loom has **two phases**:

## Phase 1 — Quick scan (~5 min, runs at bootstrap)

`scripts/discover.{sh,ps1} --quick` asks 5 questions and writes [`quick-scan.md`](./quick-scan.md). The answers inform initial skeleton choices (which specialists are likely needed, what compliance regime applies, etc.). Wrong answers are fine — the skeleton can be rebuilt later (per user direction 2026-05-20).

## Phase 2 — Full discovery (~30–60 min, post-bootstrap)

`scripts/discover.{sh,ps1}` (no flag) walks through three artifacts:

| File | Purpose |
|---|---|
| [`requirements.md`](./requirements.md) | Functional + non-functional requirements (performance, security, reliability, accessibility, i18n, scalability, compliance, observability) |
| [`risk-register.md`](./risk-register.md) | Failure-modes register in the [xlsx convention](../adr/0022-xlsx-docs-convention.md) — SE/BE rows with Justifications |
| [`open-questions.md`](./open-questions.md) | Things we don't yet know; tracked until resolved |

## Iteration

Discovery is **iterative**. The quick-scan informs an initial skeleton; the full discovery may surface requirements that change the skeleton; the Critic (PR-O / ADR-0026) reviews the requirements doc against domain checklists; Loom may propose skeleton amendments. The user always approves.

## Per LR-05

Every assertion in `requirements.md` and `risk-register.md` should be supersedable by evidence. If a risk's mitigation turns out to be inadequate at production scale, the row is updated (or added to the Acceptance / Mitigation status section) — never deleted.

## When discovery is "done"

Discovery is **never** truly done. It is **good enough to deploy** when:

- `requirements.md` lists at least one functional + one NFR per pillar (perf / security / reliability / a11y / scalability / compliance / observability).
- `risk-register.md` has at least one SE and one BE row, each with a mitigation in `Next Step`.
- `open-questions.md` has no `Blocking? = yes` rows.

This is the gate PR-O ties to `scripts/deploy.sh` — production deploys check that discovery is good-enough before proceeding.
