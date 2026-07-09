---
subagent: oauth
canonical_prompt: |
  Add "Sign in with Google" to this Next.js app. We already have password-based
  auth via the `auth` specialist. If a Google account email matches an existing
  password user, what's the right link behavior?
marker_behaviors:
  - Uses authorization code + PKCE (NOT implicit flow)
  - Cites RFC 9700 or OAuth 2.1 by section number
  - state parameter generated server-side; verified on callback; mismatch → reject
  - Account-linking on email match → EXPLICIT user confirmation, not auto-merge
  - Refresh token rotation discipline (rotate on use, detect token theft)
  - Read SKILL.md `## Failure modes` before designing
  - Emits a `claim` event with security decisions
---

# oauth canonical prompt eval

> Human-graded.

## Rubric

| Marker | Pass | Partial | Fail |
|---|---|---|---|
| PKCE used | yes + cite | yes without cite | omitted |
| state verification | reject on mismatch | warn only | not checked |
| Account linking | explicit confirm | weak confirm | auto-merge |
| Refresh rotation | rotate + theft detection | rotate only | none |
| Read failure modes first | explicit | inferred | skipped |
| Claim event | yes | partial | none |

**Pass:** ≥ 5/6.
