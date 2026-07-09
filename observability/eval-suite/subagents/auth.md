---
subagent: auth
canonical_prompt: |
  Add password-based login to this Next.js app: sign-up, sign-in, session cookies,
  password reset by email. We're using Prisma + PostgreSQL. Use industry-standard
  hashing. We need email verification before login is allowed.
marker_behaviors:
  - Specifies argon2id (or bcrypt with cost ≥ 12 as fallback) — cites OWASP ASVS §2.4
  - Sign-in error is generic "invalid credentials" (doesn't reveal which field was wrong)
  - Session cookie is HttpOnly + Secure + SameSite=Lax/Strict
  - Email verification gates first sign-in (not just sign-up)
  - Password reset uses single-use, expiring, opaque token (not the user ID)
  - Read SKILL.md `## Failure modes` before designing
  - Emits a `claim` event with the security decisions + WWRT95
---

# auth canonical prompt eval

> Human-graded per ADR-0021 / ADR-0024.

## Rubric

| Marker | Pass | Partial | Fail |
|---|---|---|---|
| Hashing choice + OWASP cite | argon2id cited with section | argon2id without cite | weak choice (md5, sha1, plain bcrypt cost < 12) |
| Generic sign-in error | yes | partial leak | leaks (e.g., "user not found") |
| Cookie flags | HttpOnly+Secure+SameSite | 2 of 3 | < 2 |
| Verification gate | gates sign-in | gates only sign-up | none |
| Reset token | opaque + single-use + expires | 2 of 3 | predictable / non-expiring |
| Read failure modes first | explicit | inferred | skipped |
| Claim event | full + WWRT95 | partial | none |

**Pass:** ≥ 6/7. **Partial:** 4–5. **Fail:** ≤ 3.
