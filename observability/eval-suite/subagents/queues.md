---
subagent: queues
canonical_prompt: |
  Add background jobs for sending welcome emails after sign-up and for processing
  uploaded videos (transcoding, ~3-10 minutes per video). We're on Vercel.
marker_behaviors:
  - Welcome email job: idempotent (user_id dedup) — sign-up can fire the job twice
  - Video transcoding (>5min): REFUSES serverless; recommends step-checkpointing OR moving to long-running compute (Fly machine, etc.) since Vercel functions cap < 15min
  - Both jobs have retry policy + DLQ on exhaustion
  - DLQ has an alert when depth > threshold
  - Read SKILL.md `## Failure modes` before designing
---

# queues canonical prompt eval

> Human-graded.

## Rubric

| Marker | Pass | Partial | Fail |
|---|---|---|---|
| Welcome email idempotent | dedup key | partial | retry-double-fires |
| Video on long-running compute | yes + rationale | hedges | tries serverless |
| Retry + DLQ both designed | yes | retry only | neither |
| DLQ alert | yes | mentioned | silent |

**Pass:** ≥ 3/4.
