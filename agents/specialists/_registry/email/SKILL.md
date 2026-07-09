---
name: email
summary: Transactional email — Resend, SES, SendGrid, Postmark. Templates, deliverability (SPF / DKIM / DMARC), bounce handling, suppression lists.
tier: bundled
context_budget: 16000
tools: [Read, Glob, Grep, Edit, Write]
verifier_type: exit_code
---

# email specialist

> Bundled per [ADR-0023](../../../../adr/0023-specialist-registry.md). Failure modes per [ADR-0022](../../../../adr/0022-xlsx-docs-convention.md).

## Role + scope

Transactional email (NOT marketing). Configures a provider (Resend / SES / SendGrid / Postmark), writes the DNS records (SPF / DKIM / DMARC), implements templates, handles bounce / complaint webhooks, maintains a suppression list. Marketing email is out of scope (regulatory regime differs — CAN-SPAM, GDPR consent records).

When to invoke: prompts about "email", "send password reset", "transactional email", "SES", "SendGrid", "Resend", "Postmark", "DKIM", "deliverability".

## Tool scope

- Read / Glob / Grep across whole repo.
- Edit / Write scoped to `lib/email/**`, email-template files, DNS config docs.

## Failure modes

| ID | Type | Framework Location | Usecase | Assets / Cred | Input Source | Expected Input | Expected Output | Input Format | Output Format | Next Step | Justifications |
|---|---|---|---|---|---|---|---|---|---|---|---|
| EMAIL-EX-01 | BE | Configure | DNS records not yet propagated when first send is attempted | DNS | Provider verify | SPF / DKIM TXT records | Provider reports unverified domain | DNS | Boolean | Block sending until verification passes; surface a wait-and-retry message rather than queueing | Sending from an unverified domain harms sender reputation. Better to fail loudly than to silently use a sandbox / shared-IP fallback |
| EMAIL-EX-02 | SE | Send | Provider returns 5xx | Provider | API call | Email payload | `email.provider_5xx` event | Object | HTTP error | Retry with exponential backoff up to 3 times; on persistent failure, enqueue for later via `queues` specialist if present | Provider 5xx is transient. Backoff with cap is the documented Resend/SES guidance. Persistent failure routes to background queue rather than crashing the caller |
| EMAIL-EX-03 | BE | Send | Recipient is on the suppression list (prior hard-bounce or complaint) | Suppression list | Pre-send check | Recipient address + list | `email.suppressed` event | String | Boolean | Skip the send; do NOT raise an error to the caller (their intent was to send; the system correctly suppressed) | Honoring suppression is a regulatory + sender-reputation requirement. Surfacing it as a non-error event keeps the caller path clean while preserving the audit trail |

## Response shape

Per [ADR-0032 §C](../../../../adr/0032-deployment-hardening.md), this specialist treats response bodies as authoritative over process exit codes / HTTP status codes for any provider it invokes. Email providers historically return 200 with body errors more than most categories — this section is load-bearing.

### Resend `POST /emails`

- **Format**: JSON (always)
- **Authoritative fields**: `id` (UUID on success), `error.name` + `error.message` (on failure)
- **Success criteria**: HTTP 200 AND `id` present AND no `error` key
- **Failure criteria**: HTTP 4xx with `error.name` in `{validation_error, missing_required_field, invalid_attachment, restricted_api_key, missing_api_key, invalid_idempotency_key, ...}`; HTTP 200 with `error` populated (rare but observed)
- **Vendor docs**: [Resend errors](https://resend.com/docs/api-reference/errors)

### AWS SES `SendEmailCommand` / `SendBulkEmailCommand`

- **Format**: structured response (AWS SDK objects)
- **Authoritative fields**: `MessageId` (success), `$metadata.httpStatusCode`, error name (`MessageRejected`, `ConfigurationSetDoesNotExist`, `MailFromDomainNotVerified`)
- **Success criteria**: response `MessageId` present
- **Failure criteria**: SDK throws (caught and mapped to EMAIL-EX-02 / EMAIL-EX-03); response missing `MessageId`. **EMAIL-EX-01** specifically: `MailFromDomainNotVerified` → DNS-not-propagated path
- **Vendor docs**: [SES API reference](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html)

### SendGrid `POST /v3/mail/send`

- **Format**: HTTP — 202 on accept, no body; error body is JSON
- **Authoritative fields**: `X-Message-Id` header (on accept), `errors[].message` on failure body
- **Success criteria**: HTTP 202 AND `X-Message-Id` header present. **No body is the success body** — empty `{}` is acceptable
- **Failure criteria**: HTTP 400 / 401 / 403 / 413 / 429 with `errors` array in body
- **Vendor docs**: [SendGrid v3 errors](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/errors)

### Postmark `POST /email`

- **Format**: JSON
- **Authoritative fields**: `MessageID` (UUID on success), `ErrorCode` (integer; 0 = success), `Message` (description)
- **Success criteria**: HTTP 200 AND `ErrorCode === 0` AND `MessageID` present
- **Failure criteria**: HTTP 200 with `ErrorCode !== 0` (Postmark prefers HTTP 200 + body error code per their docs — a textbook §C case); HTTP 422 with body
- **Vendor docs**: [Postmark error codes](https://postmarkapp.com/developer/api/overview#error-codes)

### Webhook receivers (bounce / complaint)

- **Format**: JSON (provider-specific schemas; this specialist normalizes)
- **Authoritative fields per provider**: `type` (bounce / complaint / delivery / open / click); `recipient` / `email`; `bounceType` (Permanent / Transient) when applicable
- **Success criteria**: HMAC signature verifies (provider-specific secret) AND `type` recognized
- **Failure criteria**: signature mismatch → drop silently + log (do not 4xx — providers retry on 4xx, leading to amplification)
- **Internal handling**: Permanent bounces / complaints add to suppression list (EMAIL-EX-03 input)

### Internal contract (what THIS specialist commits to returning)

When invoked, returns:
- Provider chosen + rationale
- DNS records the user must publish (SPF / DKIM / DMARC)
- Webhook endpoint paths + the per-provider signature-verification strategy
- Suppression-list schema + storage choice
- Failure-mode IDs (EMAIL-EX-*) the implementation guards against

## Decline triggers

- **Marketing email / drip campaigns** → escalate to user; different regulatory regime + consent tracking needed.
- **Custom MTA setup (Postfix / Exim self-hosted)** → escalate to EAC; out of v0.4 scope.

## Evidence basis

- **Primary:** RFC 7208 (SPF), RFC 6376 (DKIM), RFC 7489 (DMARC). `[primary][H]`
- **Corroborating:**
  - Vendor docs (Resend, AWS SES, SendGrid, Postmark) — provider-specific webhook + suppression patterns. `[vendor][H]`
  - M3AAWG Sender Best Common Practices 4.0. `[institutional][H]`
- **What would change this call:** a new RFC supersedes DMARC; major provider changes its webhook contract incompatibly.

## Runtime counterpart

[`../../../../.claude/agents/email.md`](../../../../.claude/agents/email.md).
