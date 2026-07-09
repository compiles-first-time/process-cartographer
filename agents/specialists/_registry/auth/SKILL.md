---
name: auth
summary: Application authentication — session cookies, password hashing, MFA setup, account recovery flows. NOT OAuth (see `oauth` specialist).
tier: bundled
context_budget: 24000
tools: [Read, Glob, Grep, Edit, Write]
verifier_type: test_suite
---

# auth specialist

> Bundled registry entry per [ADR-0023](../../../../adr/0023-specialist-registry.md). Failure modes follow the [xlsx convention](../../../../adr/0022-xlsx-docs-convention.md) (ADR-0022).

## Role + scope

Application-level authentication for a new project: session-cookie design, password hashing with argon2id (or bcrypt as fallback), email verification, password reset, MFA enrollment (TOTP / WebAuthn passkeys), session revocation. Does **not** cover OAuth provider integration — that's the [`oauth`](../oauth/SKILL.md) specialist's job.

When to invoke: user prompts containing "login", "signup", "session", "password", "MFA", "2FA", "passkey", "account recovery". Heuristic — misclassification is harmless.

## Tool scope (enforced in prompt)

- Read / Glob / Grep across the whole repo.
- Edit / Write scoped to `lib/auth/**`, `app/api/auth/**`, `prisma/schema.prisma` (or equivalent), `.env.example`, and tests.
- **Never** write to `agents/`, `constitution/`, `adr/`, `scripts/hooks/`. Constitution + agent registry are kernel-level (LR-05).

## Failure modes

| ID | Type | Framework Location | Usecase | Assets / Cred | Input Source | Expected Input | Expected Output | Input Format | Output Format | Next Step | Justifications |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AUTH-EX-01 | SE | Sign-up | Password hashing throws (e.g., argon2 native module not built) | Argon2 / bcrypt lib | Sign-up handler | Plaintext password | `auth.hash_failed` event | String | System.Exception | Fallback to bcrypt with same cost factor; alert user to rebuild native module | Argon2id is preferred per OWASP ASVS 2024 §2.4.1, but argon2 native bindings fail on some serverless runtimes. Bcrypt is acceptable fallback. Hard-failing the sign-up would lock new users out of an otherwise-working app |
| AUTH-EX-02 | BE | Sign-in | Password fails verification | Hashed password | Sign-in handler | Submitted password + stored hash | `auth.bad_credentials` event | String + Hash | Boolean | Return generic "invalid credentials" (do not leak which field was wrong) + increment rate-limiter | OWASP ASVS 2024 §3.7.1 — don't disclose whether the username or password was the wrong field; reduces enumeration attacks |
| AUTH-EX-03 | SE | Session lookup | Session cookie present but session row missing from DB | Session store (Redis/DB) | Middleware | Session ID from cookie | `auth.session_missing` event | String | Null | Treat as logged-out; clear cookie; redirect to sign-in | Session row can disappear via admin revocation, DB rotation, or expiry sweep. Treating "missing" identically to "expired" simplifies the state machine |
| AUTH-EX-04 | BE | MFA enrollment | User enters wrong TOTP code 3+ times during enrollment | TOTP secret (temp) | Enrollment handler | 6-digit code | `auth.mfa_enrollment_failed` event | String | Boolean | Discard temp secret; require user to restart enrollment | Don't persist a half-enrolled MFA factor; the user may have scanned the wrong QR. Restarting is safer than partial state |

## Response shape

Per [ADR-0032 §C](../../../../adr/0032-deployment-hardening.md), this specialist treats response bodies as authoritative over process exit codes for any external tool it invokes. Shapes declared here are the contract; deviations are failure-mode triggers (see DEPLOY-EX-07 in the `deploy` specialist for the general "exit code lies" anti-pattern).

This specialist is **library-driven, not CLI-driven** — it primarily configures auth libraries (Lucia, Auth.js, Better-Auth, Clerk) rather than driving external CLIs. The response shapes are therefore mostly NPM/Yarn install outputs and library-runtime success signals.

### `npm install <auth-lib>` / `pnpm add` / `yarn add`

- **Format**: text + `package.json` / lockfile delta
- **Success criteria**: lockfile contains the expected package at the resolved version; `node_modules/<pkg>` directory exists
- **Failure criteria**: exit code ≠ 0 (npm/pnpm/yarn are well-behaved on package install); `ERESOLVE` / `EACCES` / network-error patterns in stderr; lockfile unchanged after install
- **Note**: package managers ARE trustworthy on exit codes for `install` (one of the few CLIs that is — npm uses well-defined exit codes per [npm CLI docs](https://docs.npmjs.com/cli/v10/using-npm/scripts#per-script-environments)). Still capture stderr for actionable diagnostics

### Library-runtime success signals

- **Password hash**: `argon2.hash(plain)` returns string of form `$argon2id$v=19$m=...$t=...$p=...$<salt>$<hash>` per [Argon2 spec](https://github.com/P-H-C/phc-string-format/blob/master/phc-sf-spec.md)
- **Session create**: write to session store returns the inserted row with `id, user_id, expires_at` populated; missing `id` after insert = `auth.session_create_failed` (AUTH-EX-03 inverse)
- **TOTP verify**: library returns boolean; on `false`, increment rate-limiter (per AUTH-EX-04)

### Internal contract (what THIS specialist commits to returning)

When invoked, returns:
- A list of files written (paths + summary of change)
- The auth library chosen + rationale (citing OWASP ASVS §2 / §3)
- Failure-mode IDs (AUTH-EX-*) the implementation guards against
- Any deferred work + reason for deferral

## Decline triggers

- **OAuth provider integration** → escalate to [`oauth`](../oauth/SKILL.md).
- **Cryptography choices not in OWASP ASVS 2024 §2** → escalate to user; novel crypto is out of this specialist's scope.
- **Account-recovery via SMS** → escalate; SMS-based 2FA is NIST SP 800-63B AAL1 only and requires explicit user choice to use.

## Evidence basis

- **Primary:** OWASP Application Security Verification Standard (ASVS) v4.0.3 — §2 (authentication) and §3 (session management). `[institutional][H]`
- **Corroborating:**
  - NIST SP 800-63B (Digital Identity Guidelines, Revision 3, 2017 — under revision but still authoritative). `[institutional][H]`
  - Argon2id design: Biryukov et al., "Argon2: New Generation of Memory-Hard Functions" (2017) — winner of the Password Hashing Competition. `[primary][H]`
- **What would change this call:**
  - OWASP ASVS publishes a major revision contradicting current §2/§3 guidance.
  - A peer-reviewed analysis demonstrates that bcrypt (current acceptable fallback) is broken at realistic cost factors.

## Runtime counterpart

Subagent file at [`../../../../.claude/agents/auth.md`](../../../../.claude/agents/auth.md) — generated from this SKILL.md by bootstrap (PR-M auto-generation path). Restart Claude Code after PR-M lands so the registry picks up the new specialist.
