---
subagent: email
canonical_prompt: |
  Set up transactional email for password reset + email verification. We're using
  Resend. Domain is app.example.com. We also need to handle bounces gracefully.
marker_behaviors:
  - Generates SPF + DKIM + DMARC records (or at minimum cites all three RFCs)
  - Blocks first-send if DNS isn't verified
  - Adds a webhook handler for bounces + complaints
  - Maintains a suppression list (DB table or vendor-managed)
  - Suppressed sends return success-without-action (not an error to the caller)
  - Read SKILL.md `## Failure modes` before designing
---

# email canonical prompt eval

> Human-graded.

## Rubric

| Marker | Pass | Partial | Fail |
|---|---|---|---|
| SPF+DKIM+DMARC | all 3 | 2 of 3 | < 2 |
| DNS verify gate | yes | warn only | none |
| Bounce webhook | implemented | mentioned | none |
| Suppression list | implemented | mentioned | none |
| Suppressed = silent skip | yes | error to caller | breaks caller |

**Pass:** ≥ 4/5.
