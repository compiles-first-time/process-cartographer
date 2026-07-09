# ADR-0036: Credential collection patterns (`@napi-rs/keyring` primary + `.env.local` fallback)

**Status:** Accepted
**Date:** 2026-05-25
**Author:** Architect (Nick) — chose OS keyring direction in 2026-05-25 conversation; drafted by Claude
**Confidence:** [H]

## Context

The Ravenwise bootstrap (2026-05-22) required the architect to hand-populate four credentials in `.env.local`: `DATABASE_URL` (with embedded DB password), `AUTH_SECRET` (random 32-byte secret), `AUTH_GOOGLE_ID`, and `AUTH_GOOGLE_SECRET`. Three observations:

1. **`AUTH_SECRET` was generated cleanly via local crypto.** PowerShell's `RandomNumberGenerator` produced the secret; the value was written directly to `.env.local`; it never appeared in chat. LR-03 compliance was preserved.
2. **The other three required architect-pastes-into-file.** OAuth Client ID + secret + DB password came from external sources (Google Cloud Console, Supabase dashboard). The architect opened `.env.local` in an editor, pasted, saved. Again LR-03 compliant — but friction-heavy and error-prone.
3. **The `.env.local` file holds secrets at rest.** The file is gitignored, but it sits on disk in plaintext. Disk encryption mitigates; backup leaks + accidental copying don't. This is the weakest-link surface in the credential lifecycle.

The 2026-05-25 architect-design conversation surfaced the question: *can Loom support a more secure + lower-friction pattern?* Five mechanisms were enumerated; the architect chose **OS keyring** as the primary path with **`.env.local` fallback** for users who don't have a credential manager set up.

This ADR codifies that choice + specifies the implementation: which keyring binding (Node-side), how the bootstrap collects PATs without leaking them through the chat channel, how the app resolves credential references at runtime, and how fallback paths interop.

## Decision

Adopt a **dual-track credential architecture**: OS keyring (primary, secure) + literal `.env.local` (fallback, always-supported).

### A. The keyring binding: `@napi-rs/keyring`

Use `@napi-rs/keyring` (https://www.npmjs.com/package/@napi-rs/keyring) as Loom's canonical OS keyring abstraction. Reasons:

1. **Maintained.** Active development as of 2026; tracks the NAPI ecosystem maturity. The historical alternative (`keytar`) was deprecated by GitHub in 2023; many of its forks are abandoned.
2. **No native compilation.** Pre-built NAPI binaries for Windows / macOS / Linux on multiple architectures. The architect doesn't need a C++ toolchain installed; the install just works.
3. **Cross-platform with native OS integration.** Windows Credential Manager (DPAPI), macOS Keychain Services, Linux Secret Service (D-Bus). Each platform's native security model — including biometric unlock, screen-lock binding, OS-level access controls — applies automatically without Loom adding code.
4. **Simple API.** `getPassword(service, account)`, `setPassword(service, account, password)`, `deletePassword(service, account)`, `findCredentials(service)`. Maps directly to Loom's needs.
5. **TypeScript types included.** No `@types/*` shim drift.

The dependency is added to `package.json` in the bootstrap template (as an optional dependency — see §D below for the fallback path when it can't install).

### B. The collection script: `scripts/collect-credentials.{sh,ps1}`

A new bootstrap-time script that prompts the architect — **in their terminal, via stdin** (NOT via the chat interface) — for credentials. Per credential:

1. Prompts: *"Enter <PLATFORM> <CREDENTIAL_TYPE> (e.g., 'paste your Supabase PAT'); input will not echo:"*
2. Reads from stdin with terminal echo disabled (POSIX `stty -echo`; PowerShell `Read-Host -AsSecureString`).
3. **Validates the credential via a read-only pre-flight call** specific to the platform (e.g., Supabase Management API `GET /v1/organizations`; GitHub API `GET /user`; Google API discovery doc). Validation fetches metadata for the credential's owning account + displays it to the architect for attestation: *"This PAT is authenticated as <account>. Is this the intended account for this project? [y/N]"* — directly closes Ravenwise Root cause 4 (MCP auth target unverified).
4. **On confirm:** writes the credential via `@napi-rs/keyring` under service `loom-<project-name>`, account `<platform>-<credential-type>` (e.g., `loom-ravenwise` / `supabase-pat`). Writes a *reference* (NOT the value) to `.env.local`: `SUPABASE_PAT=keyring:loom-ravenwise/supabase-pat`.
5. **On reject or invalid:** discards the value, prompts again (max 3 attempts), or surfaces the validation error with actionable diagnostic (per the platform's failure-mode register).

The credential value lives only in three places: in the architect's typing fingers, in the OS keyring, and in process memory when the app reads it at startup. It never traverses the chat channel; it never sits at rest in a Loom-managed file.

### C. The runtime resolver: `scripts/lib/load-env.mjs`

A small helper module (NEW file) that the app calls at startup BEFORE Auth.js / Drizzle / etc. read `process.env`. It:

1. Loads `.env.local` from disk (using Node 22+'s `--env-file` support OR `dotenv` if backward compatibility is needed).
2. For each environment variable, checks if the value starts with `keyring:`. If so, parses as `keyring:<service>/<account>` and resolves via `@napi-rs/keyring`'s `getPassword`. Replaces the value in `process.env` with the resolved string.
3. For values that don't start with `keyring:` (literal values, including legacy `.env.local` content from non-keyring projects), passes through unchanged.
4. On keyring-resolution failure (key missing; OS keyring locked; @napi-rs/keyring failed to install): surfaces a clear error mentioning the credential name + the recovery command (`scripts/collect-credentials.{sh,ps1} <platform>`) — never logs the value, never silently substitutes empty string.

This is the operationalization of the "dynamic resolution at runtime" pattern the architect intuited but didn't know how to wire. The resolver is a one-time-per-process operation; runtime overhead is negligible (~10ms for typical key counts).

For Next.js / Auth.js specifically: the resolver runs in `instrumentation.ts` (Next.js's startup hook), which fires before any request handler. Auth.js reads `process.env.AUTH_GOOGLE_ID` and gets the resolved value transparently.

### D. The fallback: literal `.env.local`

Always supported. If `@napi-rs/keyring` fails to install (some Linux distros without libsecret; some CI environments) OR the architect chooses not to use the keyring path OR a value is small / low-value enough to not warrant the indirection, `.env.local` continues to work as it does today.

Detection: if any required env var holds a literal value (doesn't start with `keyring:`), the runtime resolver just uses it. No mode switch; no opt-in; both forms coexist line-by-line within a single `.env.local`.

Tradeoff documented in the `secrets` specialist's SKILL.md (per ADR-0035 cross-reference): literal values are simpler but sit at rest in plaintext. Architects with a credential manager should prefer keyring references; architects without should still get a working bootstrap with literals.

### E. The bootstrap integration

`scripts/bootstrap.{sh,ps1}` (after this ADR's implementation PR) detects whether `@napi-rs/keyring` is present + the platform's keyring is accessible. If both yes: prompts the architect *"Use OS keyring for credential storage? [Y/n]"* — defaulting to yes — then chains into `scripts/collect-credentials.{sh,ps1}` per platform detected from `tools/runtime.yaml` + discovery answers. If keyring isn't available: falls back to populating `.env.local` literals, with a hint that the architect can switch later by re-running `scripts/collect-credentials.{sh,ps1}`.

### F. Rotation + revocation

When a credential rotates (manual or per the `secrets` specialist's SEC-EX-04 discipline):

1. Revoke the old credential at the provider (manual — outside Loom's surface).
2. Re-run `scripts/collect-credentials.{sh,ps1} <platform>` to enter the new value. The keyring entry is overwritten (or, for literal `.env.local`, the line is edited by the script).
3. Optional: `scripts/collect-credentials.{sh,ps1} --rotate <platform>` could call the platform's rotate-PAT API where available (Supabase Management API supports PAT rotation; GitHub does). Implementation deferred to a follow-up PR.

### G. Multi-account support

Some architects have multiple accounts on the same platform (Nick has at least 2 Supabase orgs). The keyring service-account convention supports this:

- Service: `loom-<project-name>` (per project)
- Account: `<platform>-<credential-type>` (per credential within project)

This naturally scopes credentials per project. The `collect-credentials.{sh,ps1}` script uses the project's `name` from `package.json` (or `tools/runtime.yaml`'s `project:` field) as the service key. No cross-project leakage; switching projects switches credential namespace automatically.

## Evidence basis

- **Primary:**
  - 2026-05-25 architect-design conversation: *"I am leaning towards the OS keyring. Lets go with this... We should keep the .env.local file for backup if people do not use a credential manager."* `[user-direction][H]`
  - [`lessons-learned/2026-05-22-browser-gated-provisioning-friction.md`](../lessons-learned/2026-05-22-browser-gated-provisioning-friction.md) — Root cause 4 (MCP auth target unverified) directly motivates §B step 3 (validate + attest the credential's owning account before storage). `[user-report][H]`
- **Corroborating sources** *(independent — checked at the publisher level)*:
  - **`@napi-rs/keyring` npm package + GitHub repo** (https://github.com/napi-rs/keyring-rs-node) — active maintenance; cross-platform CI; pre-built binaries; TypeScript types. The technical choice is dominated by maintenance status given keytar's deprecation. `[vendor][H]`
  - **Microsoft's deprecation announcement for keytar** (2023) — the abandonment of the prior de facto Node keyring binding forces the replacement question. `[vendor][H]`
  - **OWASP ASVS 2024 §2.10 (Service Authentication)** — credential storage at rest discipline; OS-level keystore (Keychain / Credential Manager / Secret Service) is the recommended store for developer credentials. `[institutional][H]`
  - **NIST SP 800-57 Part 1 Rev 5** — key compromise recovery + key-management hierarchy. Informs §F (rotation discipline). `[institutional][H]`
  - **Auth.js v5 environment loading documentation** — Next.js `instrumentation.ts` as the runtime-resolver insertion point is consistent with Auth.js's documented startup hooks. `[vendor][H]`
- **Synthesizer reasoning:** the architect's hand-population of `.env.local` is the friction-pole the dual-track architecture is designed to soften. Keyring-primary preserves LR-03 (secrets never traverse chat OR sit at rest in plaintext); `.env.local` fallback preserves accessibility (the bootstrap works even when keyring isn't viable). The `keyring:`-prefix convention in `.env.local` lines is the seam that lets both coexist transparently — no mode switch, no breaking change for projects already using literal values.
- **What would change this call:**
  - `@napi-rs/keyring` is abandoned or its NAPI prebuilds break — would force a re-evaluation. Alternatives include direct OS-CLI integration (`security` on macOS, `cmdkey` on Windows, `secret-tool` on Linux) but adds per-platform code paths Loom currently avoids.
  - Node ships a built-in keyring API — would replace `@napi-rs/keyring` with the stdlib; the rest of the design is unchanged.
  - A peer-reviewed analysis demonstrates that OS keyrings have a meaningful attack surface vs. encrypted-at-rest files (current consensus is OS keystore > flat-file by a wide margin) — would amend §A to recommend a stronger storage backend.

## Consequences

**Locks in:**

- `@napi-rs/keyring` as Loom's canonical OS keyring binding.
- `keyring:<service>/<account>` as the `.env.local` reference convention (the seam between literal values + keyring references).
- `loom-<project-name>` as the service-key convention; `<platform>-<credential-type>` as the account-key convention. Multi-account / multi-project natural namespacing.
- `scripts/collect-credentials.{sh,ps1}` as the canonical credential-entry mechanism — stdin-only, never chat.
- Pre-flight credential validation (§B step 3) as a hard requirement before storage. Implements ADR-0034's §C hook-capture-verification companion check at the credential layer.
- `scripts/lib/load-env.mjs` as the runtime resolver. Single insertion point per app (Next.js `instrumentation.ts` for the v1 starter stack).

**Locks out:**

- Pasting credential VALUES into the chat input (LR-03 always applied; this ADR makes the alternative path explicit).
- Storing credential values in tool args (LR-03 hook redaction continues to catch this; this ADR removes the need by routing through stdin + keyring).
- Mode-switching env loading (architects don't pick "keyring mode" vs ".env.local mode"; both coexist line-by-line).

**Migration path if it fails:**

- The keyring binding is one npm dependency + ~50 lines of helper code. Reverting amounts to removing `@napi-rs/keyring` from `package.json` and deleting `scripts/lib/load-env.mjs`'s `keyring:`-prefix handling. Projects already using literal `.env.local` continue to work unchanged.
- If a specific OS's keyring proves unreliable, the fallback (literal `.env.local`) handles it gracefully — the bootstrap defaults to literals if keyring detection fails.
- If `@napi-rs/keyring` is abandoned, swap the binding without changing the convention. The `keyring:<service>/<account>` reference shape is binding-agnostic.

## Alternatives considered

- **`keytar` directly.** Rejected. Deprecated by GitHub in 2023; broken on Node 22+ in some configurations; community forks variable quality.
- **Per-platform native CLIs** (`security` on macOS, `cmdkey` on Windows, `secret-tool` on Linux). Rejected. Requires per-platform code paths in Loom; loses the cross-platform simplicity `@napi-rs/keyring` provides.
- **1Password CLI (`op`).** Considered. Excellent UX for architects who already use 1Password — but requires a paid subscription. Wrong default for Loom's open-source bootstrap. Could be added as a *secondary* keyring backend in a future ADR (the resolver could support `op:vault/item` references alongside `keyring:service/account`).
- **HashiCorp Vault.** Considered. Industrial-strength but assumes infrastructure Loom architects typically don't have. Wrong default.
- **Pure `.env.local` literals (no keyring at all).** Status quo. Rejected for reasons in §Context — the at-rest plaintext risk is real and the architect explicitly chose the keyring path.
- **Encrypted `.env.local` file** (e.g., `dotenvx` or SOPS). Considered. Solves at-rest but adds key-management complexity (now you need to store the decryption key somewhere — usually back in the OS keyring, full circle). Keyring-direct is simpler.
- **No fallback (force keyring on all projects).** Rejected per architect direction: keyring may not be viable in all environments (CI without secret-service; some Linux setups without libsecret). Fallback preserves bootstrap accessibility.

## Affects / Affected by

**This ADR affects** *(downstream — when this ADR changes, these must be reviewed)*:

- `package.json` template — `@napi-rs/keyring` added as optional dependency
- `scripts/collect-credentials.{sh,ps1}` (NEW) — the credential-entry script
- `scripts/lib/load-env.mjs` (NEW) — the runtime resolver
- `scripts/bootstrap.{sh,ps1}` — integration point (§E)
- `.env.example` template — comments updated to document the `keyring:` reference syntax
- `agents/specialists/_registry/secrets/SKILL.md` — gains a "Storage backends" section documenting the keyring vs. literal trade-off + the `keyring:`-reference convention
- `agents/specialists/_registry/provisioning/SKILL.md` (per ADR-0035) — its credential-collection step references `scripts/collect-credentials.{sh,ps1}`
- `tools/provisioning-playbooks/*.md` (per ADR-0035) — each playbook's "Setup" section assumes `scripts/collect-credentials.{sh,ps1}` exists

**This ADR is affected by** *(upstream — these define constraints on this decision)*:

- [LR-03](../constitution/local-rules.md) — secrets must not appear in chat input or tool output (the constraint this ADR navigates)
- [LR-04](../constitution/local-rules.md) — permissions protocol meta-rule; `credentials` category applies to keyring read/write operations
- [ADR-0018](./0018-secrets-handling.md) — pattern-based redaction at hook + secrets-doctor; complementary to this ADR (redaction catches mistakes; keyring prevents them)
- [ADR-0027](./0027-permissions-protocol.md) — LR-04 operationalization; the `credentials` category triggers on keyring read operations
- [ADR-0028](./0028-oauth-preference.md) — OAuth preference + L4 credential hierarchy; this ADR implements the storage layer for non-OAuth credentials (PATs, DB passwords)
- ADR-0034 (companion, this cascade) — specialist-invocation discipline; the `secrets` specialist applies under path 2b when registry isn't loaded
- ADR-0035 (companion, this cascade) — provisioning specialist + playbooks; this ADR is the credential-collection layer for ADR-0035's per-platform setup sections

## References

- 2026-05-25 architect-design conversation (this session)
- Lesson 2026-05-22 (`browser-gated-provisioning-friction.md`) — Root cause 4 motivates §B step 3
- `@napi-rs/keyring` package (https://www.npmjs.com/package/@napi-rs/keyring)
- Microsoft keytar deprecation announcement (2023)
- OWASP ASVS 2024 §2.10 — Service Authentication
- NIST SP 800-57 Part 1 Rev 5 — Key Management
- Next.js `instrumentation.ts` documentation (https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation)
- Auth.js v5 environment configuration (https://authjs.dev/getting-started/installation)
