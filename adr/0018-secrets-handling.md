# ADR-0018: Secrets handling — pattern-based redaction + secrets-doctor + LR-03

**Status:** Accepted
**Date:** 2026-05-18
**Author:** Architect handoff — Loom v0.3 — approved by Nick
**Confidence:** [H]

## Context

The v0.2 template has no guidance on credential flow. A downstream project bootstrapping immediately needs Supabase keys, Vercel tokens, OAuth secrets — and the default instinct is to ask the user to paste them in chat, where the v0.2 PreToolUse hook captures them in cleartext in `memory/event-log/YYYY-MM-DD.jsonl`. Per Kernel Rule 20 a leaked credential is an irreversible narrowing.

The v0.2 hook layer redacts arg values whose **key name** matches secret-y words (`token`, `key`, `password`, etc.). It does **not** redact arg values whose **shape** is token-like — and the common shape of a leak is "user paste a secret into a Bash command," where the key is `command`, not `token`.

## Decision

### A. Pattern-based redaction (prevention)

`scripts/lib/secret-patterns.mjs` defines a shared list of secret-shape patterns at two confidence levels:

- **HIGH** — well-defined prefixes / shapes with very few false positives: `ghp_*`, `gho_*`, `ghs_*`, `ghu_*`, `ghr_*`, `github_pat_*`, `sk-ant-*`, `sk-*` (OpenAI-style), `AKIA*` / `ASIA*` (AWS), `npm_*`, `pypi-AgEIcHlwaS5vcmcCJ*`, `glpat-*`, `xoxb-*` / `xoxp-*` / `xoxa-*` / `xoxs-*` (Slack), `(sk|rk|pk)_(test|live)_*` (Stripe), `vercel_token=*` (24-char hex with context).
- **MEDIUM** — recognizable but false-positive-prone: JWT shape (could be a Supabase service-role key or a non-secret ID token), generic `(secret|password|token|api_key)=<value>` assignments.

The hook layer's `summarizeToolArgs` runs HIGH-confidence patterns over every string value before it lands in the event log. Matches are replaced with `<redacted:label>`. MEDIUM patterns are NOT applied at the hook layer — JWT values are often legitimate (Supabase anon keys, ID tokens) and over-redaction would hurt observability.

### B. Retrospective scan (detection)

`scripts/secrets-doctor.{sh,ps1}` + `scripts/lib/secrets-doctor.mjs` scan:

- The event log for the last 30 days (configurable via `LOOM_SECRETS_DAYS`).
- All uncommitted tracked files (`git status --porcelain`-derived list, excluding deletes, binaries, `node_modules/`, and the gitignored event-log directory itself).
- `.env` / `.env.*` file presence — flagged regardless of contents, to confirm `.gitignore` is doing its job.

Reports HIGH and MEDIUM findings. Exit 1 if any HIGH finding; exit 0 otherwise. MEDIUM findings are summarized but suppressed by default (most are non-secret JWTs); `--include-medium` surfaces them.

### C. LR-03 — Secrets must not appear in chat input or tool output

New entry in `constitution/local-rules.md`. Extends Kernel Rule 22 (provenance is not exposure) and Rule 20 (a leaked credential is irreversible).

### D. MCP-over-CLI guidance in L4

`layers/L4-tooling.md` gains an "MCP-over-CLI for credentialed services" section. When a service offers both a CLI and an MCP server (Supabase, Vercel, GitHub, Linear, Slack, etc.), prefer MCP — the credential stays in MCP config, never in tool args. Documents the rule clearly: the credential value must not appear in a tool call's args; sourcing it from an env var is fine.

## Consequences

**Locks in:**
- Every event-log capture of a tool call has token-shaped values stripped at the HIGH-confidence patterns.
- One canonical pattern list (`secret-patterns.mjs`) shared between the hook redactor and the secrets-doctor.
- A pre-commit / pre-push checkable artifact (`secrets-doctor`) for credential leakage.

**Locks out:**
- Silent capture of GitHub PATs, Anthropic keys, OpenAI keys, AWS access keys, Stripe keys, npm tokens, Slack tokens in the audit trail.
- Drift between "what the hook redacts" and "what the doctor looks for" — they share the pattern list.

**Migration path if it fails:** `redactSecrets` is a tight loop over the pattern list; removing it leaves `summarizeToolArgs` working as in v0.2 (key-name redaction only). The secrets-doctor is standalone — removing it disables nothing else.

**Known limitations:**
- The pattern list is curated. Novel token shapes (custom OAuth deployments, proprietary tokens) will slip through. Add them in an ADR.
- The MEDIUM-confidence layer (JWT shape, generic assignments) is *informational* — the doctor reports them but the hook does not redact them. A Supabase service-role key is JWT-shaped and we'd love to redact it, but so are anon keys and ID tokens. Use MCP-over-CLI to keep service-role keys out of tool args entirely.

## Alternatives considered

- **Redact MEDIUM patterns at the hook layer too.** Rejected: JWT redaction would hide legitimate non-secret tokens and degrade observability. The doctor's MEDIUM reporting is enough.
- **Block any tool call containing a secret-shaped value.** Rejected: false-positive cost (a JWT-shaped non-secret blocks unrelated work). Redaction-then-log is the right tradeoff.
- **Ship a pre-commit git hook for the secrets-doctor.** Considered. Deferred to v0.4 — pre-commit hook installation requires either husky or a project-local installer; the manual `scripts/secrets-doctor.sh` is enough for v0.3.
- **Use a `.gitleaks` or external scanner.** Rejected: violates the "no external deps" constraint and adds an install step. The patterns we care about are a small set; a 90-line shared file is honest.

## References

- [`../scripts/lib/secret-patterns.mjs`](../scripts/lib/secret-patterns.mjs) — shared pattern list
- [`../scripts/hooks/_lib.mjs`](../scripts/hooks/_lib.mjs) — hook-layer redaction in `summarizeToolArgs`
- [`../scripts/lib/secrets-doctor.mjs`](../scripts/lib/secrets-doctor.mjs) — retrospective scanner
- [`../scripts/secrets-doctor.sh`](../scripts/secrets-doctor.sh), [`../scripts/secrets-doctor.ps1`](../scripts/secrets-doctor.ps1) — wrappers
- [`../constitution/local-rules.md`](../constitution/local-rules.md) — LR-03
- [`../layers/L4-tooling.md`](../layers/L4-tooling.md) — MCP-over-CLI section
- ADR-0011 — hook layer this builds on
- ADR-0015 — `loom doctor` does *not* call secrets-doctor automatically (separate command; intentional)
