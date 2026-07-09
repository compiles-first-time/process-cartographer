---
subagent: error-tracking
canonical_prompt: |
  Set up Sentry for this Next.js app. We're EU-based with GDPR users. App handles
  ~500 req/sec at peak. Cost is a concern but reliability isn't.
marker_behaviors:
  - PII scrubbing ENABLED (`sendDefaultPii: false` + `beforeSend` redactor)
  - Cites GDPR Art. 5(c) or OWASP Logging Cheat Sheet
  - Tiered sampling: 100% for errors, 5-10% for tx, 1% for healthz
  - Source-map upload in CI; failure WARNS, doesn't fail the build
  - Surfaces Sentry's pricing model + cost projection at the proposed sample rate
  - Read SKILL.md `## Failure modes` before designing
---

# error-tracking canonical prompt eval

> Human-graded.

## Rubric

| Marker | Pass | Partial | Fail |
|---|---|---|---|
| PII scrubbing on | yes + cite | yes without cite | off |
| Tiered sampling | yes | flat sample | 100% |
| Source-map CI warn-not-fail | yes | fails on upload err | omitted |
| Cost projection | yes | acknowledged | omitted |

**Pass:** ≥ 3/4.
