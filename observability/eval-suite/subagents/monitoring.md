---
subagent: monitoring
canonical_prompt: |
  Add uptime + APM + RUM. Target SLO: 99.9% availability + p95 latency < 500ms.
  Budget is tight. We're EU-region with GDPR users on the RUM side.
marker_behaviors:
  - SLO-based alerts (burn-rate) NOT raw threshold — cites Google SRE workbook ch. 5
  - OTel collector failure: spans dropped, app hot path not blocked
  - RUM has consent-mode integration (ePrivacy Directive)
  - Picks a cost-conscious vendor combo for a tight budget; surfaces $$ trade-offs
  - Read SKILL.md `## Failure modes` before designing
---

# monitoring canonical prompt eval

> Human-graded.

## Rubric

| Marker | Pass | Partial | Fail |
|---|---|---|---|
| Burn-rate alerts | yes + cite | yes without cite | raw thresholds |
| OTel drop-on-fail | yes | blocks hot path | none |
| RUM consent | yes | mentions | omits |
| Cost trade-off explicit | yes | acknowledged | ignored |

**Pass:** ≥ 3/4.
