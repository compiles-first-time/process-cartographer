---
name: queues
summary: Background jobs — BullMQ, Inngest, Trigger.dev, AWS SQS. Idempotency, retry policy, dead-letter, fan-out/fan-in patterns.
tier: bundled
context_budget: 16000
tools: [Read, Glob, Grep, Edit, Write]
verifier_type: test_suite
---

# queues specialist

> Bundled per [ADR-0023](../../../../adr/0023-specialist-registry.md). Failure modes per [ADR-0022](../../../../adr/0022-xlsx-docs-convention.md).

## Role + scope

Background job processing: queue selection, job definition (with idempotency keys), retry policy, dead-letter handling, fan-out / fan-in patterns. Covers BullMQ (self-hosted Redis), Inngest, Trigger.dev, AWS SQS + Lambda, Vercel Queues.

When to invoke: prompts about "background job", "queue", "BullMQ", "Inngest", "Trigger.dev", "SQS", "cron-like", "process later".

## Tool scope

- Read / Glob / Grep across whole repo.
- Edit / Write scoped to `lib/jobs/**`, `jobs/**`, `app/api/jobs/**`, queue config.

## Failure modes

| ID | Type | Framework Location | Usecase | Assets / Cred | Input Source | Expected Input | Expected Output | Input Format | Output Format | Next Step | Justifications |
|---|---|---|---|---|---|---|---|---|---|---|---|
| QUE-EX-01 | BE | Design | Job handler is not idempotent but retries are enabled | Handler code | Code review | Handler signature | `que.non_idempotent_with_retries` event | Code | Recommendation | Block; require either (a) idempotency key + dedup table, (b) explicit `retries: 0`, or (c) handler refactored to be naturally idempotent | At-least-once delivery is the default for every queue we recommend. Non-idempotent retries cause double-charges, duplicate emails, duplicate webhook deliveries. The dedup-table pattern is documented (BullMQ "idempotency", Inngest "step.run") |
| QUE-EX-02 | SE | Process | Job fails after exhausting retries | Worker | Job execution | Job + retry count | `que.dead_letter` event | Object | DLQ entry | Route to DLQ; alert if DLQ depth > threshold; do NOT silently drop | Silent drops are debugging-hostile. DLQ + alert is the documented pattern (AWS SQS DLQ guide, BullMQ "failed jobs") |
| QUE-EX-03 | BE | Design | Long-running job (> 5 min) on a serverless function | Job + runtime | Plan review | Job duration estimate + runtime | `que.long_job_on_serverless` event | Duration | Recommendation | Recommend splitting into smaller steps (Inngest steps, Trigger.dev tasks) OR moving to a long-running compute (Fly machine, EC2) | Serverless runtimes have hard timeouts (Vercel 15min max, AWS Lambda 15min, others lower). Hitting the timeout mid-job loses progress unless the job is step-checkpointed |

## Response shape

Per [ADR-0032 §C](../../../../adr/0032-deployment-hardening.md), this specialist treats response bodies as authoritative over process exit codes / library return values for any queue provider it invokes.

### BullMQ (`Queue.add()`, `Worker` events)

- **Format**: library — Redis under the hood; methods return Promises resolving to `Job` instances
- **Authoritative fields**: `Job.id` (success), `Job.timestamp`, worker events: `completed`, `failed`, `stalled`, `progress`
- **Success criteria**: `Queue.add()` resolves with `Job.id` populated AND Redis `BZPOPMIN` confirms enqueue (visible via `Queue.getJobCounts()`)
- **Failure criteria**: `Queue.add()` rejects; `Worker` emits `failed` with `failedReason`; `stalled` event = job worker died mid-process (treat as failure for retry policy)
- **Vendor docs**: [BullMQ Queue](https://docs.bullmq.io/guide/queues), [Worker](https://docs.bullmq.io/guide/workers)

### Inngest (`inngest.send()`, `step.run()`)

- **Format**: JSON over HTTP
- **Authoritative fields**: `ids[]` (event IDs on send success), step `output` / `error` per step run
- **Success criteria**: `inngest.send()` resolves AND `ids` array populated with one ID per event; step `output` returned without throw
- **Failure criteria**: send rejects with `EventInvokeError`; step throws → routed through Inngest's retry/DLQ machinery
- **Vendor docs**: [Inngest SDK ref](https://www.inngest.com/docs/reference)

### Trigger.dev (`tasks.trigger()`, `task.run()`)

- **Format**: JSON
- **Authoritative fields**: `id` (run ID), `status` (queued / executing / completed / failed / canceled), `output`, `error.message`
- **Success criteria**: `status === "completed"` AND `output` matches expected shape
- **Failure criteria**: `status === "failed"` with `error.message`; **`status === "canceled"`** is a third outcome that the AnonForum-class non_progressing recognition should treat as degraded
- **Vendor docs**: [Trigger.dev Tasks](https://trigger.dev/docs/tasks-overview)

### AWS SQS (`SendMessageCommand`, `ReceiveMessageCommand`)

- **Format**: structured SDK response
- **Authoritative fields**: `MessageId` (send success), `Messages[].ReceiptHandle` (receive), `$metadata.httpStatusCode`
- **Success criteria**: `MessageId` present on send; `Messages` array (possibly empty) on receive — empty array is normal, not failure
- **Failure criteria**: SDK throws (`QueueDoesNotExist`, `AccessDenied`, `RequestThrottled`); `$metadata.httpStatusCode` ≥ 400
- **DLQ check**: source queue's `RedrivePolicy.deadLetterTargetArn` configured AND `maxReceiveCount` set (QUE-EX-02 prerequisite)
- **Vendor docs**: [SQS SendMessage API](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessage.html)

### Vercel Queues

- **Format**: JSON via `@vercel/queues` SDK
- **Authoritative fields**: `id` (enqueue success), DLQ visibility via dashboard / API
- **Success criteria**: enqueue resolves with `id`
- **Failure criteria**: SDK throws; quota-exceeded falls under §B billable pre-flight
- **Vendor docs**: [Vercel Queues](https://vercel.com/docs/queues)

### Idempotency-key contract (cross-provider)

When jobs are designed to be idempotent (QUE-EX-01), the contract is:
- Caller passes an `idempotency_key` (UUID or domain-meaningful key) in the job payload
- Handler's FIRST step: check dedup table for the key. If present + state="completed", return cached result. If present + state="in_flight", reject as duplicate. Otherwise insert with state="in_flight"
- Handler's LAST step: update dedup table to state="completed" with the result (or "failed" with error)
- Dedup table TTL aligned with the queue's max-retention (so dedup state outlives the retry window)

### Internal contract (what THIS specialist commits to returning)

When invoked, returns:
- Queue provider chosen + rationale + cost projection
- Job schemas + idempotency-key strategy
- Retry policy (count, backoff curve)
- DLQ configuration + alert threshold
- Step-checkpoint plan for long jobs (QUE-EX-03)
- Failure-mode IDs (QUE-EX-*) the implementation guards against

## Decline triggers

- **Stateful streaming (Kafka, Kinesis)** → escalate; stream processing is a different pattern class.
- **Cron-like schedules without job semantics** → defer to the (future) `cron` specialist.

## Evidence basis

- **Primary:** Vendor docs (BullMQ, Inngest, Trigger.dev, AWS SQS, Vercel Queues). `[vendor][H]`
- **Corroborating:**
  - Gregor Hohpe & Bobby Woolf, "Enterprise Integration Patterns" (2003) — Idempotent Receiver, Dead Letter Channel patterns. `[primary][H]`
  - AWS SQS DLQ best practices. `[institutional][H]`
- **What would change this call:** a queue provider deprecates DLQ semantics; a new at-most-once provider becomes the default.

## Runtime counterpart

[`../../../../.claude/agents/queues.md`](../../../../.claude/agents/queues.md).
