# ADR-0027: Permissions protocol — LR-04 as meta-rule subsuming LR-02 + LR-03

**Status:** Accepted
**Date:** 2026-05-20
**Author:** Architect handoff (v0.6 PR-P) — approved by Nick
**Confidence:** [H]

> **Update (2026-07-07 audit):** §Alternatives' *"Auto-block at the hook layer … Rejected for v0.6 … v0.7+ may add per-rule blocking"* was **realized by [ADR-0047](./0047-hook-enforced-destructive-action-confirmation.md)** for the `destructive_actions` category — the hook now enforces (deny/ask), not just event-log signalling.

## Context

v0.3 shipped two narrow rules:

- **LR-02** (ADR-0017): production-mutation tool calls require constitution-service consultation.
- **LR-03** (ADR-0018): secrets must not appear in chat input or tool args.

Real v0.4 sessions showed both rules applying to overlapping cases. `vercel env add SUPABASE_SERVICE_ROLE_KEY <value>` is **both** a production mutation **and** a secrets-in-args case. The current code emits both `production_mutation_attempted` (LR-02) and silently redacts the value (LR-03) — correct but reactive, and the rules are drifting in parallel.

The v0.5 PR-O Critic-checklist + discovery-gate work made it obvious that we need a **unified policy classifier**: "what category of action is this tool call?" with categories that compose with each other and with the discovery / risk-register flows.

v0.4 plan disagreement #3 settled the framing: LR-04 is the meta-rule; LR-02 and LR-03 are specializations.

## Decision

### A. `.claude/loom-permissions.yaml`

Project-level policy config with three categories:

- `external_service_setup` — `supabase link`, `vercel domains`, `gh repo create`, `aws ... create`, etc. **Soft** enforcement.
- `destructive_actions` — `rm -rf`, `DROP TABLE`, `git push --force`, `vercel deploy`, `npm publish`, `prisma migrate deploy`. **Hard** enforcement (constitution-service required). **Subsumes LR-02 production-mutation patterns.**
- `credentials` — `--token`, `npm login`, `gh auth`, `vercel env add`, etc. **Soft** enforcement. **Subsumes LR-03 secrets-in-args.**

Each category declares:

- `triggers` — `command_patterns` (regex on the tool command), `mcp_patterns` (regex on tool name for MCP tools), `keywords` (literal substring match).
- `required_protocol` — list of `{ key: "guidance" }` pairs the acting agent must satisfy.
- `enforcement` — `soft` (event-log only) or `hard` (also requires constitution-service claim).

Project-local overrides at `.claude/loom-permissions.local.yaml` (gitignored; shallow merge).

### B. `scripts/lib/permissions-classifier.mjs`

- `loadPermissions(root)` — reads bundled + override YAML.
- `classifyToolCall({ tool, input, permissions })` — returns `[{ category, enforcement, matched_on, required_protocol }]`.
- Targeted YAML parser for the known schema (no external deps).

### C. `pre-tool-use.mjs` integration

Replaces (functionally — keeps backward-compatible event emission for `production_mutation_attempted`) the LR-02-specific path with the LR-04 classifier. For each matched category:

- Emit `<category>_attempted` event with `enforcement` + `matched_on` + `required_protocol`.
- If `enforcement === "hard"` AND no `constitution-service` claim in this session, emit `constitution_check_missing` referencing `rule: "LR-04"`.

### D. LR-04 in `constitution/local-rules.md`

Documents the meta-rule. LR-02 + LR-03 remain in the file as historical records and continue to govern their specific concerns; LR-04 is the umbrella the runtime classifier checks against.

## Evidence basis

- **Primary evidence:** v0.4-plan disagreement #3 and v0.4-plan response confirmation 2026-05-20 ("Lets go with your recommendation here"). `[user-direction][H]`
- **Corroborating sources:**
  - Capability-based security (Dennis & Van Horn, 1966) — "smallest needed credential scope" is the *principle of least privilege* operationalized. `[primary][H]`
  - OWASP ASVS v4.0.3 §1.4 (Access Control Architecture) — separation of duties + least privilege as defaults. `[institutional][H]`
  - NIST SP 800-53 AC-6 (Least Privilege) — same principle in federal control framework. `[institutional][H]`
- **Synthesizer reasoning:** the three-category split mirrors the user's original proposal (external_service_setup / destructive_actions / credentials). The user's instinct matches real-session failure modes. `[synth][M]`
- **What would change this call:**
  - Real sessions reveal a fourth category that doesn't fit the three (e.g., "long-running compute" — minutes-to-hours of paid work).
  - Hard-enforcement causes too many false-positive blocks; promote to require explicit `--allow-once` flag.

## Consequences

**Locks in:**
- One unified mental model: "what category of action is this?" → expected protocol.
- LR-02 and LR-03 stay as historical records; LR-04 is the operational entry point.
- Project teams can extend categories via the YAML without touching code.

**Locks out:**
- Three-rule drift. Future "this action needs careful handling" rules become *category specializations*, not parallel rules.

**Migration path if it fails:** disable per-category by setting `enforcement: off` or by deleting the YAML. The original LR-02 production-mutation classifier code (`classifyProductionMutation` in `_classify.mjs`) is still wired and still emits `production_mutation_attempted` — so consumers that grepped for that pattern continue working unchanged.

**Continuity caveat:** `production_mutation_attempted` events continue to fire (backward compatibility); new consumers should prefer the LR-04 `destructive_actions_attempted` events.

## Alternatives considered

- **Three parallel LRs instead of meta-rule.** Rejected per v0.4-plan disagreement #3.
- **Single rule per tool name.** Rejected: tool-name granularity is too coarse (a single `Bash` tool can run thousands of distinct commands).
- **Hard-enforcement across all three categories.** Rejected: external-service-setup is reversible most of the time (deleting the Vercel domain just removes it); blocking would create more friction than warning. Hard-enforcement is reserved for irreversibility.
- **Auto-block at the hook layer for hard-enforcement categories.** Rejected for v0.6: Claude Code's `PreToolUse` hook does support blocking (returning JSON with `decision: "block"`), but false-positive cost is high. v0.6 stays at the event-log signal layer; v0.7+ may add per-rule blocking with explicit allowlist.

## Affects / Affected by

**This ADR affects** *(downstream)*:

- `.claude/loom-permissions.yaml` — the policy config
- `scripts/lib/permissions-classifier.mjs` — implementation
- `scripts/hooks/pre-tool-use.mjs` — wires LR-04 classifier
- `constitution/local-rules.md` — LR-04 entry + LR-02/LR-03 continuity notes
- `adr/0028-oauth-preference.md` *(planned, PR-Q)* — extends `credentials` category with OAuth-vs-API-key detection

**This ADR is affected by** *(upstream)*:

- `adr/0017-intent-nag.md` / LR-02 — subsumed
- `adr/0018-secrets-handling.md` / LR-03 — subsumed
- `adr/0019-deploy-primitive.md` — deploy gate references LR-02/LR-04
- `constitution/local-rules.md` — LR-05 (decisions supersedable)
- `constitution/kernel-v6.md` — Kernel Rule 20 (temporal weighting), Rule 22 (epistemic transparency)

## References

- v0.4-plan disagreement #3 (LR-04 subsumes LR-02 + LR-03)
- ADR-0017 (LR-02, production-mutation)
- ADR-0018 (LR-03, secrets-in-args)
- OWASP ASVS v4.0.3 §1.4
- NIST SP 800-53 AC-6 (Least Privilege)
- Dennis & Van Horn (1966), "Programming Semantics for Multiprogrammed Computations"
