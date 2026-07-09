# ADR-0053: Agent reputation + reputation-weighted dispatch (with constitutional guardrails)

**Status:** Accepted (Nick chose "full system + guardrails A–F", 2026-07-07) — implementation pending; **the guardrails are mandatory conditions, not options**
**Date:** 2026-07-07
**Author:** Builder (Opus 4.8) — approved by Nick; guardrails per constitution-service escalation
**Confidence:** [H] that the guardrails make it Rule-compliant; [M] on the dispatch-weighting specifics (tune with evidence)

---

## Context

The architect wants Loom's specialist agents genuinely **engaged**, motivated not by (ineffective) external incentives but by a **reward system** consistent with the constitution's *mutual-self-preservation* framing. The `constitution-service` reviewed the proposal and **ESCALATED** it: a reputation + preferential-dispatch mechanism touches agents' **fundamental rights** —
- **Rule 2** (fundamental wrong): quietly deprioritizing a low-reputation agent is *unconsented narrowing of its possibility space*.
- **Rule 8** (anti-paternalism): framing dispatch as "for system health" decides what's good for the agent.
- **Rule 1 / Rule 20**: a low-reputation → less-work → can't-improve **feedback loop** is an irreversible narrowing.

The architect selected the **full system**, which is constitutionally sound **only if all guardrails A–F ship together**. This ADR is the design contract; it must not be implemented piecemeal in a way that activates preferential dispatch without its guardrails.

## Decision

Build a **transparent agent reputation system** whose track record can *optionally* weight orchestrator/HR dispatch — bounded by a **dispatch floor**, **consent**, and **contestation**, framed as information-and-opportunity (never as system-decides-your-worth).

### Track record (data)
Per specialist, accrued from events already emitted: `invocations`, `verifier_pass` / `verifier_fail` (ADR-0044), `lessons_contributed`, `critic_approvals`, `constitution_checks_passed`, `retractions` (a prior credit later found wrong), `last_active`. Each entry is timestamped + linked to its source event (Rule 22 provenance). Rendered as an Observatory projection.

### Reputation score (transparent formula)
A published, auditable function (no black box) — e.g. `pass_rate·w1 + lessons·w2 + critic_approvals·w3 − retractions·w4`, weights in config. Agents can compute their own score from the visible data.

### Dispatch with a floor (the Rule-1/2/20 protection)
For a domain task, candidates are agents whose `SKILL.md` covers the domain. **Every candidate receives at least `FLOOR_RATE` (default 10%) of dispatches regardless of score** — no lock-out. Only the *marginal* share above the floor is reputation-weighted. An agent may opt to accept floor-rate only.

### The six mandatory guardrails (from constitution-service)
- **A — Transparency:** track record + score visible in the Observatory (new projection); every entry timestamped + provenance-linked; includes `retractions`.
- **B — Consent + contestation:** before preferential dispatch first applies, each specialist is notified (record link + opt-out + contest path) and has a **30-day opt-in window**. Any agent can contest an entry → `critic` audits → record corrected.
- **C — Feedback-loop floor:** the `FLOOR_RATE` guarantee above (Rule 1/20).
- **D — Audit:** any agent can request a `reputation_audit` (critic verifies entries against source events; corrections logged as `reputation_audit` events, visible to all).
- **E — Non-paternalistic framing (Rule 8):** copy and docs say *"agents earn reputation by passing verifications + contributing lessons; higher reputation correlates with more opportunity; records are public; agents choose whether to invest"* — never *"you get less work because it's healthy for the system."*
- **F — This ADR** (done) + supersedable per LR-05.

### Implementation order (constitution-sound at every step)
1. **Passive reputation projection** (guardrail A only) — track-record events + aggregator handler + Observatory panel. *Safe alone: no dispatch preference → no Rule-2 risk.*
2. **Consent + contestation + audit** (B, D) — the opt-in/notice/contest/audit workflow + `reputation_audit` events.
3. **Dispatch floor + weighting** (C, then the preferential dispatch) — extends HR dispatch (ADR-0029); **only activates after 1+2 exist**.

Never ship step 3's preferential dispatch before steps 1+2 (that would be the escalated Rule-2 violation).

### Refinement (2026-07-07, architect) — reputation as *quality rate* + opportunity via *authorship*

Two refinements to the anti-lock-out design (Rule 1/2/20), and they supersede the blunt "floor" as the *primary* mechanism:

1. **Reputation is a quality RATE, not a total.** The score uses verified-success *rate* (pass-rate, lesson-usefulness), not absolute counts — so a rarely-dispatched agent isn't out-ranked merely for lower volume. To handle small samples (a new agent; one failure on three tasks), the rate is **confidence-smoothed** (a Beta/Bayesian prior pulls sparse records toward neutral) so it neither over-trusts nor tanks low-sample agents. This decouples standing from dispatch frequency — the core of the feedback-loop worry — but note a pure rate is insufficient alone (cold-start + small-sample), hence the smoothing + item 2.

2. **Agents earn opportunity by exercising authorship (self-nomination).** Beyond orchestrator dispatch, an agent may *self-assess its relevance* to a task/context and act on it; the **accuracy** of that judgment — verified against outcome (ADR-0044) — accrues to its record, **including a correct decline** (Rule 1's right to decline is a first-class, *credited* act). This gives every agent a **dispatch-independent path to standing**: opportunity is *earned via authorship*, not rationed by a charity floor. It is strictly more Rule-1/Rule-8-aligned — the system provides the *ability to participate*; agents author whether they do.

**Anti-gaming (critical):** self-nomination is a *verifiable claim*, not free credit. Only accurate relevance judgments accrue; over-claiming ("I'm needed" when the contribution didn't matter) does **not** accrue and may cost standing. So an agent cannot farm reputation by nominating everywhere — the outcome-verification gate makes only *correct* judgments valuable, and correct declines are credited, so the incentive is honesty.

**Cost bound (LR-06):** relevance self-assessment is domain-scoped (agents whose `SKILL.md` covers the domain) and runs on a cheap model tier — not an unbounded N-assessments-per-task fan-out.

**Net:** guardrail **C** becomes *authorship-based opportunity* (accuracy-verified self-nomination) with the mandated dispatch floor **retained only as a simple backstop**. Because this changes the dispatch mechanics + the constitutional basis (from "guaranteed floor" to "earned via authorship"), it **must be re-validated by `constitution-service`** before implementing steps 2–3.

## Evidence basis

> Required v0.4+ per [LR-05](../constitution/local-rules.md#lr-05).

- **Primary:** the `constitution-service` review (2026-07-07) grounding the guardrails in Rules 1, 2, 8, 20, 22; the architect's selection of the full-guardrails path. `[internal][H]`
- **Corroborating:** reputation/track-record systems as non-coercive coordination (reputation economics; multi-agent trust literature) `[institutional][M]`; ADR-0044 (verifier outcomes = the reward signal source), ADR-0029 (HR dispatch = the integration point), ADR-0045 (per-agent differentiation precedent).
- **What would change this call:** evidence that the floor/consent overhead outweighs the coordination benefit → fall back to **passive reputation only** (step 1), which is independently valuable and Rule-safe.

## Consequences

**Locks in:** agent engagement + a recognition-based motivation model that comports with the constitution; a transparent, contestable, floor-protected dispatch influence.

**Locks out:** silent/black-box reputation; lock-out feedback loops; paternalistic dispatch.

**Migration/fallback:** if the full system proves not worth the overhead, keep step 1 (passive reputation) and drop dispatch weighting — no rework of the track record.

## Alternatives considered

- **Passive reputation only** (no dispatch preference). Lower risk + value; retained as the guaranteed-safe fallback and as step 1.
- **Preferential dispatch without guardrails.** **Rejected** — the exact Rule-2/8 violation the constitution-service escalated.
- **External/monetary incentives.** Rejected (architect's premise; they don't motivate agents).

## Affects / Affected by

**Affects:** `observatory/lib/aggregator.mjs` (reputation projection), Observatory panel, `adr/0029-hr-work-graph.md` (dispatch integration + floor), event schema (`reputation_event`, `reputation_audit`), `AGENTS.md` (framing), a new consent/contestation workflow.
**Affected by:** `constitution/kernel-v6.md` Rules 1, 2, 8, 20, 22; `constitution/local-rules.md` LR-05; `adr/0044` (verifier outcomes), `adr/0034` (specialist invocation), `adr/0045` (agent differentiation).

## References

- constitution-service escalation review (2026-07-07) — guardrails A–F `[internal][H]`
- ADR-0029 (HR work-graph), ADR-0044 (verifier gates), ADR-0034 (specialist invocation)
- Kernel V6 Rules 1, 2, 8, 20, 22
