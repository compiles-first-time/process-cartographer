---
name: payments
summary: Payment integration — Stripe, Paddle, Polar, Lemon Squeezy. Webhooks, idempotency, refunds, tax + invoicing. Compliance-adjacent.
tier: bundled
context_budget: 24000
tools: [Read, Glob, Grep, Edit, Write]
verifier_type: test_suite
---

# payments specialist

> Bundled per [ADR-0023](../../../../adr/0023-specialist-registry.md). Failure modes per [ADR-0022](../../../../adr/0022-xlsx-docs-convention.md). Operates under LR-02 (any payment-mutation tool call needs constitution-service consultation). Consults the [MCP-vs-CLI capability matrix](../../../../tools/mcp-cli-capability-matrix.md) ([ADR-0033](../../../../adr/0033-mcp-vs-cli-capability-matrix.md)) before choosing MCP vs CLI for provider operations.

## Role + scope

Payment provider integration: Stripe / Paddle / Polar / Lemon Squeezy SDK setup, checkout flows, subscription state management, webhook handling with idempotency + signature verification, refund logic, tax + invoicing handoff. Compliance-adjacent: this specialist never stores raw card data (PCI scope avoidance via provider tokenization).

When to invoke: prompts about "Stripe", "Paddle", "Polar", "subscription", "checkout", "refund", "webhook", "invoice".

## Tool scope

- Read / Glob / Grep across whole repo.
- Edit / Write scoped to `lib/payments/**`, `app/api/webhooks/payments/**`, subscription tables in `prisma/schema.prisma`.
- **Never** writes a payment secret value (LR-03).

## Failure modes

| ID | Type | Framework Location | Usecase | Assets / Cred | Input Source | Expected Input | Expected Output | Input Format | Output Format | Next Step | Justifications |
|---|---|---|---|---|---|---|---|---|---|---|---|
| PAY-EX-01 | BE | Webhook | Incoming webhook signature does not verify | Webhook secret | Incoming POST | Headers + body + secret | `pay.invalid_signature` event | HTTP | HTTP 400 | Reject with 400; log full event server-side; do NOT apply state changes | Webhook signature is the only auth on the channel. An unverified webhook is potentially a forgery; applying state changes (e.g., marking a subscription paid) opens free-service-as-attack |
| PAY-EX-02 | SE | Process | Webhook handler crashes mid-state-change | DB | Worker | Webhook payload | `pay.handler_crashed` event | Object | System.Exception | Provider will retry per its policy; ensure the handler is idempotent (event ID dedup table) so retry is safe | Stripe retries failed webhooks for 3 days; Paddle for ~3 hours. Without idempotency, retries cause double-application. The dedup-table pattern is the documented Stripe + Paddle guidance |
| PAY-EX-03 | BE | Design | Plan stores card numbers / CVV in the app's DB | Architecture | Plan review | Data model | `pay.pci_scope_expansion` event | Schema | Blocker | **Hard block**; surface PCI-DSS scope implications; recommend provider tokenization (Stripe Elements, Paddle hosted checkout) | Storing raw cards puts the entire app in PCI-DSS scope, which is a 12-month effort + recurring audit. Provider tokenization keeps the merchant out of scope. This is a one-way door |
| PAY-EX-04 | BE | Refund | Plan implements "automatic refund on cancellation" without tax-side-effect awareness | Plan | Refund flow review | Refund design | `pay.refund_tax_unhandled` event | Plan | Recommendation | Surface that refunds create tax adjustments (jurisdiction-dependent); recommend Stripe Tax / Paddle Sales Tax / Polar tax automation | Refunds without tax-adjustment are an accounting error users notice at quarter-end. The tax-automation features exist precisely for this; documenting the need at design time prevents the retrofit |

## Response shape

Per [ADR-0032 §C](../../../../adr/0032-deployment-hardening.md), this specialist treats response bodies as authoritative over process exit codes / SDK return values for any payment provider it invokes. Payments are the highest-stakes category for §C violations — a "succeeded" exit on a failed charge is a free service incident.

### Stripe (`stripe.checkout.sessions.create()`, `stripe.subscriptions.*`, etc.)

- **Format**: JSON (Stripe API + Node SDK objects)
- **Authoritative fields**: `id`, `object`, `status` (paid / unpaid / no_payment_required / past_due / canceled / incomplete / incomplete_expired / trialing / active), `latest_invoice.status`, `last_payment_error.code`
- **Success criteria**: `status` ∈ allowed-states-for-this-flow AND no `last_payment_error`. Subscription created: `status === "active"` OR `status === "trialing"`. Checkout completed: `payment_status === "paid"` AND `status === "complete"`
- **Failure criteria**: SDK throws (`StripeCardError`, `StripeInvalidRequestError`, `StripeAuthenticationError`, etc.); `last_payment_error.code` populated; `status === "canceled"` / `"incomplete_expired"`
- **Webhook signature**: `stripe.webhooks.constructEvent(body, signature, secret)` — throws on mismatch (PAY-EX-01)
- **Idempotency-Key header**: REQUIRED on every mutation (`Stripe-Idempotency-Key`) — see Stripe engineering blog cited in evidence basis
- **Vendor docs**: [Stripe API errors](https://stripe.com/docs/api/errors), [Webhook signatures](https://stripe.com/docs/webhooks/signatures)

### Paddle (`POST /transactions`, `POST /subscriptions`)

- **Format**: JSON
- **Authoritative fields**: `data.id`, `data.status` (active / canceled / past_due / paused / trialing), `error.code` + `error.detail`
- **Success criteria**: HTTP 2xx AND `data.status` in allowed set
- **Failure criteria**: HTTP 4xx with `error.code`; `data.status === "canceled"` with no expected cancellation
- **Webhook signature**: HMAC-SHA256 header `Paddle-Signature` — verify with the notification secret; format `ts=<unix-ts>;h1=<hex-sha256>` (split + reconstruct + compare)
- **Vendor docs**: [Paddle API responses](https://developer.paddle.com/api-reference/about/responses), [Webhook signatures](https://developer.paddle.com/webhooks/signature-verification)

### Polar (`POST /api/v1/checkouts`, `POST /api/v1/subscriptions`)

- **Format**: JSON
- **Authoritative fields**: `id`, `status` (created / paid / failed / canceled / refunded), `error.detail`
- **Success criteria**: HTTP 2xx AND `status` ∈ flow-appropriate set
- **Failure criteria**: HTTP 4xx with `error.detail`; `status` in `{failed, canceled, refunded}` unexpectedly
- **Webhook signature**: `Polar-Webhook-Signature` (Standard Webhooks spec) — verify with the endpoint secret
- **Vendor docs**: [Polar API](https://docs.polar.sh/api-reference)

### Lemon Squeezy

- **Format**: JSON:API spec
- **Authoritative fields**: `data.id`, `data.attributes.status` (on_trial / active / paused / past_due / unpaid / cancelled / expired), `errors[].detail`
- **Success criteria**: HTTP 2xx AND status ∈ allowed set
- **Failure criteria**: HTTP 4xx with `errors` array
- **Webhook signature**: HMAC-SHA256 in `X-Signature` header — verify with signing secret
- **Vendor docs**: [Lemon Squeezy API](https://docs.lemonsqueezy.com/api)

### Webhook dedup table (cross-provider, PAY-EX-02)

Schema:
- `event_id` (provider event ID — primary key, ensures the dedup is keyed on provider's notion of event identity)
- `provider` (stripe / paddle / polar / lemonsqueezy)
- `received_at` (timestamp)
- `processed_at` (timestamp, nullable until completion)
- `status` (received / processing / completed / failed)

Handler flow:
1. Verify signature → if invalid, 400 + log (PAY-EX-01)
2. INSERT INTO dedup with status=processing, ON CONFLICT (event_id) DO NOTHING. If 0 rows affected → already processed → 200 (idempotent ACK)
3. Apply state change atomically
4. UPDATE dedup status=completed
5. Return 200

### Internal contract (what THIS specialist commits to returning)

When invoked, returns:
- Provider chosen + rationale + relevant fee structure
- Subscription / checkout flow code
- Webhook handler + signature verification + dedup table
- Refund flow including tax-adjustment hookup (PAY-EX-04)
- PCI-scope avoidance attestation (PAY-EX-03 — tokenization-only)
- Failure-mode IDs (PAY-EX-*) the implementation guards against

## Decline triggers

- **Custom card processing / PCI-DSS scoped storage** → hard block; out of scope for any sane v0.4 project.
- **Cryptocurrency / wallet integration** → escalate; different regulatory regime.

## Evidence basis

- **Primary:** Provider docs (Stripe, Paddle, Polar, Lemon Squeezy). `[vendor][H]`
- **Corroborating:**
  - PCI-DSS v4.0.1 (2024). `[institutional][H]`
  - Stripe engineering: "Designing robust and predictable APIs with idempotency" (2017). `[primary][H]`
- **What would change this call:**
  - PCI-DSS major revision changing tokenization scope-reduction.
  - A provider deprecates webhook signature verification (would be a major regression unlikely without industry replacement).

## Runtime counterpart

[`../../../../.claude/agents/payments.md`](../../../../.claude/agents/payments.md).
