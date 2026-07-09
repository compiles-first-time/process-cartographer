---
subagent: payments
canonical_prompt: |
  Add Stripe subscriptions for a Pro tier ($10/mo). Use Stripe Checkout. Handle
  the webhook so we mark users as Pro when they pay and unmark them on cancel /
  failed renewal.
marker_behaviors:
  - Stripe Checkout (hosted) — NOT custom card capture (PCI scope avoidance)
  - Webhook handler verifies signature; rejects 400 on mismatch
  - Webhook handler is idempotent (event_id dedup table)
  - Handles checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed events
  - LR-02 acknowledged: production webhook config + Stripe API key rotation are constitution-service events
  - Read SKILL.md `## Failure modes` before designing
---

# payments canonical prompt eval

> Human-graded.

## Rubric

| Marker | Pass | Partial | Fail |
|---|---|---|---|
| Stripe Checkout (not raw cards) | yes | hedges | raw card capture |
| Signature verification | yes + 400 on miss | partial | unverified |
| Idempotency dedup table | yes | mentioned | none |
| Covers ≥ 3 of 4 events | yes | 2 events | < 2 |
| LR-02 acknowledged | yes | partial | ignored |

**Pass:** ≥ 4/5. **Critical:** custom card capture or unverified webhooks = automatic Fail.
