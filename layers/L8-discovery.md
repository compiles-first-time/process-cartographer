# L8 — Discovery

> **Canonical source:** *(new in v0.5 per [ADR-0025](../adr/0025-discovery-scaffolding.md). Will be mirrored into the spec when v0.5 closes.)*
> **Why this layer matters:** Loom v0.1–v0.4 took "what to build" as a single ad-hoc conversation. The result was projects that shipped the requested feature without surfacing the NFRs (security, scale, observability, compliance) the user didn't think to mention.

---

## Purpose

Make Discovery a first-class verb in Loom. Convert "what should we build" from an implicit pre-conversation into an explicit, audited artifact that the rest of the layers can consume:

- **L2 (agents)** routes specialists per discovered requirements.
- **L5 (orchestration)** generates work items from `requirements.md` (HR v1.0 — PR-R).
- **L6 (observability)** wires the NFRs (latency, error budget) the requirements declared.
- **L7 (Update Bus)** treats requirements changes as a normal change path.

## Two phases

| Phase | Duration | Output | When |
|---|---|---|---|
| **Quick scan** | ~5 min | [`../discovery/quick-scan.md`](../discovery/quick-scan.md) | Bootstrap calls `scripts/discover.{sh,ps1} --quick` |
| **Full discovery** | ~30–60 min | [`../discovery/requirements.md`](../discovery/requirements.md) + [`../discovery/risk-register.md`](../discovery/risk-register.md) + [`../discovery/open-questions.md`](../discovery/open-questions.md) | Post-bootstrap, before serious build |

## Quick scan (Phase 1)

Five questions:

1. **Project type** — web app / CLI / library / API / mobile / desktop / agentic-system
2. **Scale** — solo / team / public
3. **Compliance regime** — none / GDPR / HIPAA / SOC2 / PCI / FERPA
4. **Primary user** — you / internal team / customers / general public
5. **Deploy target** — Vercel / Netlify / Fly / Render / self-hosted / TBD

Answers shape the initial skeleton: which specialists are likely needed, what compliance implications exist, what monitoring tier matters. **Wrong answers are fine** — the skeleton can be rebuilt as understanding deepens.

## Full discovery (Phase 2)

Three artifacts:

| Artifact | What it captures |
|---|---|
| [`requirements.md`](../discovery/requirements.md) | Functional capabilities (FR-01, FR-02 …) + non-functional pillars (performance, security, reliability, accessibility, i18n, scalability, compliance, observability) + explicit out-of-scope |
| [`risk-register.md`](../discovery/risk-register.md) | Per-risk rows in the [xlsx convention](../adr/0022-xlsx-docs-convention.md) — SE/BE classification, input/output schema, mitigation, **Justifications** |
| [`open-questions.md`](../discovery/open-questions.md) | What we don't yet know; tracked until resolved; resolution log preserved |

## Iteration model

Discovery is **iterative**, not one-shot.

1. Bootstrap → quick scan → initial skeleton.
2. Full discovery → may amend the skeleton (PR-O / ADR-0026 — skeleton-amendment proposals).
3. The Critic reviews `requirements.md` against domain checklists (security, accessibility, i18n, scalability, compliance) — PR-O.
4. As requirements change during build, the artifacts are updated; LR-05 governs supersedence.

## Gates (per [ADR-0026](../adr/0026-discovery-gate.md), PR-O)

- **Bootstrap:** NOT gated on discovery (quick scan is part of bootstrap; full discovery comes later).
- **Deploy:** `scripts/deploy.sh` checks that discovery/ has a "good enough" state — see [`../discovery/README.md`](../discovery/README.md) "When discovery is done" criteria. Override with `--force`.

This is the v0.4-plan disagreement #2 decision: block deploy, not bootstrap. Deploying without a risk register is the genuinely dangerous case; blocking bootstrap forces the user to delay scaffolding work that's prerequisite to discovery.

## Per LR-05 supersedability

Every assertion in `requirements.md` and `risk-register.md` is supersedable by evidence. The user may have asserted "scale: solo" at bootstrap; real measurement during build may show 100x usage and justify revising the NFRs. The artifacts are living documents; the resolution log tracks the history.

## Open work for this layer

- [x] Quick-scan + full-discovery flow (PR-N / ADR-0025)
- [ ] Critic domain checklists + skeleton-amendment proposals (PR-O / ADR-0026)
- [ ] Discovery gate on deploy.sh (PR-O / ADR-0026)
- [ ] HR consumes requirements.md to generate work items (PR-R / ADR-0029)
- [ ] Mirror this layer's substantive content into `spec/loom-spec-v0.1-full.md` §B.9 when v0.5 closes
