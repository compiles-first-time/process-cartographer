---
name: secrets
summary: Credential storage + rotation — env vars, .env, secrets managers, OS keyring. NEVER receives or writes secret values; references by name only. Enforces LR-03.
tier: bundled
context_budget: 18000
tools: [Read, Glob, Grep, Edit, Write]
verifier_type: human_gate
verifier_note: "Storage decisions and resulting config (.env.example entries, .gitignore additions, rotation procedures) are verified by the human architect reviewing the output. The specialist never writes real credential values, so exit_code verification is not applicable. Per ADR-0044."
---

# secrets specialist

> Bundled registry entry per [ADR-0023](../../../../adr/0023-specialist-registry.md). Failure modes follow the [xlsx convention](../../../../adr/0022-xlsx-docs-convention.md) (ADR-0022). Operationalizes [LR-03](../../../../constitution/local-rules.md) — secrets never appear in chat input or tool args. Interoperates with credential collection ([ADR-0036](../../../../adr/0036-credential-collection-patterns.md)) and the `provisioning` specialist ([ADR-0035](../../../../adr/0035-provisioning-specialist-and-playbooks.md)); consults the [MCP-vs-CLI capability matrix](../../../../tools/mcp-cli-capability-matrix.md) ([ADR-0033](../../../../adr/0033-mcp-vs-cli-capability-matrix.md)) before driving secret-manager CLIs.

## Role + scope

Where credentials live across a new project: choice of `.env` vs platform secrets manager (Vercel / Doppler / 1Password / AWS Secrets Manager) vs OS keyring; `.env.example` template authoring; `.gitignore` coverage; rotation procedures; secret-scanning hooks in CI. Hard rule: **the specialist NEVER receives a secret value as input and NEVER writes a value into a file** — only names, placeholders, references.

When to invoke: user prompts containing "secret", "credential", "API key", "rotate key", "env var", "vault", ".env". Heuristic — misclassification is harmless; the agent declines if not applicable.

## Tool scope (enforced in prompt)

- Read / Glob / Grep across the whole repo.
- Edit / Write scoped to `.env.example`, `.gitignore`, `tools/mcp-servers/config.yaml`, `tools/runtime.yaml`, and project docs that reference secret *names*.
- **Never** write to `.env`, `.env.local`, `.env.production`, any file matching `*secret*`, or any path containing real credential values. Constitution + agent registry are kernel-level (LR-05) and out of scope.

## Failure modes

| ID | Type | Framework Location | Usecase | Assets / Cred | Input Source | Expected Input | Expected Output | Input Format | Output Format | Next Step | Justifications |
|---|---|---|---|---|---|---|---|---|---|---|---|
| SEC-EX-01 | BE | Pre-tool-use hook (LR-03) | User pastes a real secret value into chat or tool args | Live credential | User prompt | Pasted secret matching HIGH-confidence pattern | `secrets.value_leaked` event + redaction marker | String | RedactedString | HALT specialist work; advise user to ROTATE the leaked credential immediately (the chat transcript + tool logs retain the value); replace with placeholder reference | LR-03 + [ADR-0018](../../../../adr/0018-secrets-handling.md). A leaked secret is permanent — rotation is the only safe response. The redaction prevents downstream tool calls from seeing it, but logs already captured the original |
| SEC-EX-02 | BE | Repo audit | `.env` is tracked by git (in working tree or in history) | Project repo | `git ls-files \| grep '^\\.env$'` | A line matching `.env` | `secrets.env_tracked` event | Git tree | Boolean | HALT; advise `git rm --cached .env && commit`, then **rotate every value the file ever contained**. `.gitignore` does NOT retroactively remove the file from history | A committed `.env` is in every clone and the GitHub mirror forever. Once a credential is in git history, the only safe stance is "assume compromised, rotate everything" |
| SEC-EX-03 | SE | `.env.example` generation | App needs a new secret (e.g., `STRIPE_WEBHOOK_SECRET`) | App config | App schema diff | New env var name + purpose comment | Append to `.env.example` with placeholder | String | Text patch | Add `<name>=` line with a `# <purpose, where to obtain>` comment; never include a real value even in dev | `.env.example` is committed; placing a real value (even a "dev" or "test" one) re-creates SEC-EX-02. Convention: placeholder is empty after `=`, with a comment pointing at the source-of-truth provisioning step |
| SEC-EX-04 | BE | Rotation request | User asks "rotate the Stripe key" without specifying environment | Multi-env config | User prompt | Ambiguous rotation request | Clarifying question | String | Question | Decline and ask: live vs. test vs. preview? Rotating live without coordination causes outages; rotating test silently can mask integration tests | Multi-environment credential management is the most common source of production incidents during rotation (Verizon DBIR 2024 §Web App attacks). Ambiguity = halt + clarify |

## Response shape

Per [ADR-0032 §C](../../../../adr/0032-deployment-hardening.md), this specialist treats response bodies as authoritative over process exit codes for any external tool it invokes. Critical for this specialist because secret-handling CLIs frequently exit 0 on operations that silently no-op'd (rotation that hit a stale token cache; setting a value with the wrong scope).

### `doppler secrets`

- **Format**: text by default; `--json` flag yields JSON
- **Success criteria** (with `--json`): HTTP 2xx + body contains the operation result (`name`, `value` — but **this specialist NEVER captures or logs the value** per LR-03); `updated_at` timestamp post-operation
- **Failure criteria**: stderr contains `Error:` / `Unable to`; HTTP 4xx in body; missing `updated_at`
- **Vendor docs**: [Doppler CLI reference](https://docs.doppler.com/docs/cli)

### `vault kv get` / `vault kv put`

- **Format**: text by default; `-format=json` for JSON
- **Success criteria** (with `-format=json`): exit 0 AND body contains `data.metadata.version` greater than previous version on `put`; `data.data` keys match expected on `get`
- **Failure criteria**: exit ≠ 0; stderr `Error writing data` / `permission denied`; same `data.metadata.version` after `put` (indicates no-op write)
- **Vendor docs**: [HashiCorp Vault CLI docs](https://developer.hashicorp.com/vault/docs/commands/kv)

### `op` (1Password CLI)

- **Format**: JSON by default
- **Success criteria**: exit 0 AND body contains expected `id` / `vault.id` fields; `updated_at` advances on writes
- **Failure criteria**: exit ≠ 0; stderr `[ERROR]` lines; `Forbidden` / `Not authenticated` (1Password device-code session expiry, similar to OAUTH-EX device-code-scope-drop pattern — see DEPLOY-EX-06)
- **Vendor docs**: [1Password CLI reference](https://developer.1password.com/docs/cli/reference)

### Platform env-var CLIs (`vercel env`, `gh secret`, `fly secrets`)

These specialists DRIVE these CLIs but invoke them **only to set / list, never to read values**. Response shape:

- **`vercel env ls`**: text table; success = exit 0 + table header present
- **`vercel env add`**: prompt-driven (interactive); success = "Added Environment Variable <name>" on stdout AND `vercel env ls` shows the new entry on follow-up call
- **`gh secret set`**: text; success = exit 0 (no body); confirm via `gh secret list`
- **`fly secrets set`**: text; success = exit 0 + "Secrets are staged for the next deployment" line. Note: writes are staged, not applied, until next deploy — confirm via follow-up `fly secrets list`

### Internal contract (what THIS specialist commits to returning)

When invoked, returns:
- Storage decision (`.env` / Doppler / Vault / 1Password / platform-native) with rationale
- `.env.example` entries (NAMES only, never values)
- `.gitignore` additions
- Rotation procedure document (per-credential)
- Failure-mode IDs (SEC-EX-*) the design guards against
- **Never** in the return: a credential value, even redacted

## Keyring resolver patterns (Loom built-in)

Loom provides two built-in helpers for resolving `keyring:<service>/<account>` refs at runtime. This specialist references them when advising on OS-keyring credential storage.

### Async path — `loadEnv()` (preferred for Node entry points)

```js
import { loadEnv } from "./scripts/lib/load-env.mjs";
await loadEnv({ root: projectDir }); // reads .env.local, resolves keyring: refs into process.env
```

`loadEnv` reads `.env.local`, detects any `keyring:<service>/<account>` values, and resolves them via `@napi-rs/keyring` before they land in `process.env`. Zero credential leakage — the resolved value is written directly into the environment, never into a file or tool arg. Use this in: Next.js `instrumentation.ts`, plain Node entry files, any async startup path.

### Sync path — `resolveKeyringRefSync()` (for synchronous config loaders)

```js
import { resolveKeyringRefSync } from "./scripts/lib/keyring.mjs";
const apiKey = resolveKeyringRefSync(process.env.MY_KEY, projectDir);
// process.env.MY_KEY may be "keyring:loom-sovereign-forge/ANTHROPIC_API_KEY"
// resolveKeyringRefSync returns the live secret; non-keyring values pass through unchanged
```

`resolveKeyringRefSync` is the synchronous counterpart. Reference implementation: `sovereign-forge/src/config/index.js`. It resolves `keyring:<service>/<account>` strings from the OS keyring; if the value is not a keyring ref, it returns it unchanged.

### `LOOM_KEYRING_PROJECT_DIR` env var

In subdir project layouts where `node_modules` is not at the repo root, set `LOOM_KEYRING_PROJECT_DIR` to the directory containing the project's `node_modules` before calling either helper. This controls how `@napi-rs/keyring` is resolved. Both helpers respect this env var; the sync helper also accepts `projectDir` as a second argument (see function signature in `scripts/lib/keyring.mjs`).

**Full implementation:** `scripts/lib/keyring.mjs` (`resolveKeyringRefSync` at line 218, `getServiceKey` for deriving `loom-<name>` service names); `scripts/lib/load-env.mjs` (async canonical path). Operates per [LR-07](../../../../constitution/local-rules.md#lr-07): narrowest credential scope, resolved at call time, never forwarded.

## Decline triggers

- **HSM / custom KMS integration** → escalate to EAC. Hardware-backed key management is project-specific and needs a deeper research pass.
- **Receiving a real secret value as input** → already covered by SEC-EX-01: the pre-tool-use hook redacts; this specialist confirms redaction + advises rotation. Never proceeds with the value.
- **Storing user-supplied secrets in a database** (e.g., per-tenant API keys for an integration) → escalate; this is application-level encryption-at-rest design, not project credential storage. The specialist may consult on the boundary but won't design the schema.
- **Secret scanning of historical git commits** → escalate to a dedicated tool (`gitleaks`, `trufflehog`). This specialist designs going-forward storage; remediation of past leaks is a separate workflow.

## Evidence basis

- **Primary:** OWASP ASVS v4.0.3 §14.1 (Build) — credentials must never be hard-coded; §10.2 (Malicious Code) — secrets in source control are a hard-block finding. `[institutional][H]`
- **Corroborating:**
  - NIST SP 800-57 Part 1 Rev 5 (Recommendation for Key Management) §5.3.5 — key compromise recovery requires assuming all key uses are tainted from first compromise. `[institutional][H]`
  - GitHub Secret Scanning docs (2024) — published list of patterns confirms `*.env` files committed to public repos receive automated abuse within minutes. `[vendor][M]`
  - Verizon Data Breach Investigations Report (DBIR) 2024 — credential-based attacks remain the top initial-access vector in 38% of breaches. `[institutional][H]`
- **What would change this call:**
  - Major revision of OWASP ASVS that softens §14.1 or §10.2 (extremely unlikely).
  - Emergence of a peer-reviewed envelope-encryption-at-rest pattern that makes per-file credential storage in git safe (also extremely unlikely; current consensus is "secrets in source = breach").

## Runtime counterpart

Subagent file at [`../../../../.claude/agents/secrets.md`](../../../../.claude/agents/secrets.md) — the user-facing prompt that Claude Code invokes. Eval rubric at [`../../../../observability/eval-suite/subagents/secrets.md`](../../../../observability/eval-suite/subagents/secrets.md). Restart Claude Code after PR-M lands so the registry picks up the new specialist.
