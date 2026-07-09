# ADR-0026: Discovery gate on deploy + Critic domain checklists + skeleton-amendment proposals

**Status:** Accepted
**Date:** 2026-05-20
**Author:** Architect handoff (v0.5 PR-O) — approved by Nick
**Confidence:** [H]

## Context

PR-N (ADR-0025) shipped the Discovery scaffolding — quick scan at bootstrap, full flow producing requirements / risk-register / open-questions. This PR closes the loop: the artifacts become **load-bearing** rather than decorative.

Three load-bearing additions:

1. **Deploy gate.** `scripts/deploy.{sh,ps1}` refuses to proceed if discovery is empty / incomplete. Per v0.4-plan disagreement #2: block deploy, not bootstrap.
2. **Critic domain checklists.** Five markdown checklists (security, accessibility, i18n, scalability, compliance) the Critic uses when reviewing `discovery/requirements.md`.
3. **Skeleton-amendment proposals.** A heuristic scanner that reads discovery artifacts, compares to the specialist registry + instantiated state, and writes proposals for the user to review. Proposes, never applies.

## Decision

### A. Deploy gate

`scripts/lib/discovery-gate.mjs` exposes `checkDiscoveryGate(root)` returning `{ ok, missing, warnings }`. Criteria (matching `discovery/README.md` "When is discovery done?"):

- `discovery/requirements.md` has ≥ 1 filled FR-NN row + ≥ 1 filled NFR row.
- `discovery/risk-register.md` has ≥ 1 filled SE row + ≥ 1 filled BE row, each with non-empty `Next Step` + `Justifications`.
- `discovery/open-questions.md` has no `Blocking? = yes` rows.

`deploy.mjs` runs this as **Step 0/5** (before doctor). Hard fail unless `--force`.

"Filled" detection is heuristic: a row counts if its non-ID columns are non-empty and do not start with the template literal `*(e.g., ...)*` or `*(...)*`. False negatives are tolerable (user re-edits); false positives (template rows scored as filled) would defeat the gate, so the parser is strict.

### B. Critic domain checklists

Five markdown files at `observability/eval-suite/critic-checklists/`:

| Checklist | Source(s) | Covers |
|---|---|---|
| `security.md` | OWASP ASVS v4.0.3, OWASP Top 10, NIST SP 800-63B | Authn, authz, input handling, secrets, transport, logging, threat model |
| `accessibility.md` | WCAG 2.2, EAA, Section 508 | Perceivable, operable, understandable, robust + process |
| `i18n.md` | Unicode CLDR, ICU MessageFormat, BCP 47 | Locale infra, locale-sensitive ops, RTL, content + data, process |
| `scalability.md` | Google SRE Workbook, "Systems Performance" (Gregg), USE/RED | Targets, architecture, database, storage, burst handling, SLO/SLI |
| `compliance.md` | GDPR, HIPAA, PCI-DSS, SOC 2, FERPA, CCPA | Regime identification, data inventory, user rights, vendor mgmt, breach notification |

The Critic subagent's `.claude/agents/critic.md` gets a new responsibility: "Discovery requirements review" — read the relevant checklist(s), produce a per-checklist coverage report against `discovery/requirements.md` and `discovery/risk-register.md`. Each unchecked item: **gap** (flag), **accepted risk** (must be justified in risk-register), or **not-applicable** (must be justified). Output is markdown the user reviews.

### C. Skeleton-amendment proposals

`scripts/skeleton-amend.{sh,ps1}` + `scripts/lib/skeleton-amend.mjs`. Heuristic scanner:

1. Reads `discovery/requirements.md` + `discovery/risk-register.md`.
2. For each specialist in `agents/specialists/_registry/manifest.yaml`: if its trigger patterns match the discovery text AND no project-local instance at `agents/specialists/<name>/SKILL.md` exists → propose `add-specialist`.
3. For each compliance regime declared in `discovery/quick-scan.md` → propose `review-checklist` (dispatch Critic with `compliance.md`).
4. Writes `lessons-learned/skeleton-amendment-proposals/YYYY-MM-DD-proposal.md` for user review.

**Proposes, never applies.** Constitution-as-text: Loom suggests; the user decides; the user runs the resulting commands.

v0.5 MVP heuristic is keyword-scan-based. v0.6+ can extend with deeper NFR/risk analysis once we see the heuristic in real use.

## Evidence basis

- **Primary evidence:** v0.4 plan disagreement #2 (block deploy, not bootstrap). Documented user direction 2026-05-20: "the project skeleton may change based on the discovery." `[user-direction][H]`
- **Corroborating sources** *(per checklist; each lists its own primary sources)*: OWASP ASVS v4.0.3, WCAG 2.2, BCP 47, Google SRE Workbook, GDPR, HIPAA Security Rule, PCI-DSS v4.0.1, etc.
- **Synthesizer reasoning:** the proposes-never-applies design preserves the constitution-as-text philosophy (LR-05, kernel Rule 8 anti-paternalism). The deploy gate is the right enforcement point because deploys are irreversible (Rule 20). `[synth][M]`
- **What would change this call:**
  - User reports the deploy gate produces too many false-positive blocks → tune the "filled" heuristic or loosen criteria.
  - A peer-reviewed study shows skeleton-amendment-as-proposal is materially worse than skeleton-as-immediate-apply at delivering NFR-compliant outcomes.

## Consequences

**Locks in:**
- Deploying without a complete risk register is now hard (override with `--force`, recorded in event log).
- Critic gains a Discovery-review responsibility; the five checklists are the canonical domain references.
- Skeleton evolution has a documented path (propose → review → user-applies).

**Locks out:**
- "Just ship it, we'll think about NFRs later" as a default path. Possible, but requires `--force` and surfaces in the event log + monthly Critic audit.
- Hidden skeleton drift. Every amendment is proposed in markdown the user must read.

**Migration path if it fails:** the gate is one function in `deploy.mjs`; removing the `Step 0/5` block disables it. The checklists are standalone markdown; removing them affects only the Critic's review workflow. The amendment proposer is best-effort; deleting it disables nothing else.

## Alternatives considered

- **Apply skeleton amendments automatically.** Rejected: violates LR-05 + Kernel Rule 8. The user is the source of architectural truth; Loom suggests.
- **Make the deploy gate a soft warning, not a hard fail.** Considered. Rejected per v0.4-plan disagreement #2 logic: surfacing-but-not-blocking NFR gaps repeats the v0.3 finding (B). The `--force` escape hatch covers the legitimate emergency case.
- **Bake the checklists into the Critic subagent's system prompt directly.** Rejected: the checklists are reference data, not the Critic's personality. Keeping them as separate files lets the Critic load only the relevant one per review + lets a future tool render them in other contexts (e.g., a pre-PR audit).
- **JSON Schema-validated discovery artifacts.** Rejected for v0.5; the markdown parsing in discovery-gate.mjs is "good enough" for the criteria. v0.6+ can add a Schema if HR's work-graph (PR-R) needs strict input.

## Affects / Affected by

**This ADR affects** *(downstream)*:

- `scripts/lib/discovery-gate.mjs` — the gate implementation
- `scripts/lib/deploy.mjs` — adds Step 0/5 invocation
- `scripts/lib/skeleton-amend.mjs` — proposer
- `scripts/skeleton-amend.sh` + `scripts/skeleton-amend.ps1` — wrappers
- `observability/eval-suite/critic-checklists/{security,accessibility,i18n,scalability,compliance}.md`
- `.claude/agents/critic.md` — adds Discovery-review responsibility
- `layers/L8-discovery.md` — referenced as the gate location

**This ADR is affected by** *(upstream)*:

- `adr/0025-discovery-scaffolding.md` — the artifacts this PR gates against
- `adr/0019-deploy-primitive.md` — the deploy.mjs this PR extends
- `adr/0022-xlsx-docs-convention.md` — risk-register.md format the gate parses
- `adr/0023-specialist-registry.md` — registry the amendment-proposer reads
- `adr/0017-intent-nag.md` / LR-02 — deploy is a production mutation; gate + constitution-service prompt are complementary
- `constitution/local-rules.md` — LR-05 (proposes-never-applies; user decides)

## References

- ADR-0025 (Discovery scaffolding) — what this gate gates on
- v0.4 plan disagreement #2 — block deploy, not bootstrap
- User direction 2026-05-20 — skeleton may be rebuilt as discovery deepens
- OWASP ASVS v4.0.3 / WCAG 2.2 / GDPR / HIPAA / etc. — per-checklist primary sources
