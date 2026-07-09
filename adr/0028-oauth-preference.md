# ADR-0028: OAuth preference over long-lived API keys

**Status:** Accepted
**Date:** 2026-05-20
**Author:** Architect handoff (v0.6 PR-Q) — approved by Nick
**Confidence:** [H]

## Context

LR-04 (PR-P / ADR-0027) declares "smallest needed credential scope" as part of the required protocol for credential-handling tool calls. But "smallest scope" is abstract — what does it look like for GitHub, AWS, Google Cloud, Vercel, npm?

For each of those services, there's a recommended path (OAuth / SSO / short-lived credentials) and a default-but-suboptimal path (long-lived API key with broad scope). The default-suboptimal path is what users reach for first because tutorials and quick-starts surface it. The recommended path requires more setup but yields a credential that:

- Expires automatically.
- Is scoped to a single project / repository / role.
- Is revocable per device / per session.
- Cannot be leaked as broadly as a long-lived token.

PR-Q surfaces the gap.

## Decision

### A. `scripts/lib/oauth-preference.mjs`

Per-service patterns:

| Service | Long-lived shape (detected) | OAuth alternative |
|---|---|---|
| GitHub | `ghp_*`, `gho_*`, etc. | `gh auth login` (OAuth device flow); GitHub App installation tokens |
| Google Cloud | `GOOGLE_APPLICATION_CREDENTIALS=*.json` | `gcloud auth application-default login`; Workload Identity Federation |
| AWS | `AKIA*` access key IDs | `aws configure sso`; STS short-lived creds; IRSA |
| Vercel | `vercel_token = <long string>` | Project-scoped + expiring token |
| npm | `npm_*` classic tokens | Granular tokens; OIDC trusted publishing |

`detectOauthPreferenceMisses(text)` returns hits with `{ service, oauth_alternative, rationale, sample }`.

### B. Pre-tool-use hook integration

When the OAuth-preference detector finds a hit in tool args, the hook emits an `oauth_preference_hint` event:

```json
{
  "event_type": "oauth_preference_hint",
  "service": "GitHub",
  "oauth_alternative": "`gh auth login` (OAuth device flow) — ...",
  "rationale": "GitHub deprecates password auth and recommends OAuth...",
  "rule": "LR-04 / credentials"
}
```

**Non-blocking** — the hint is in the event log. The Critic surfaces it during monthly audit; the user reads it during retrospective review.

### C. Secrets-doctor integration

`scripts/lib/secrets-doctor.mjs` now also runs `detectOauthPreferenceMisses` against the same inputs (event log + uncommitted files) and reports OAuth-preference findings in a separate section. They do NOT trigger the secrets-doctor exit-1 — they are hints, not exposures. Exposures (raw secret values) still exit 1.

### D. L4 update

`layers/L4-tooling.md` gains a "Credential-source hierarchy" section that documents the tier model (OAuth > project-scoped > user-scoped > username/password) and the per-service recommendations.

## Evidence basis

- **Primary evidence:** vendor docs for each service (GitHub Apps + OAuth device flow; Google ADC; AWS Identity Center; Vercel token types; npm granular tokens + OIDC trusted publishing). `[vendor][H]` per service.
- **Corroborating sources:**
  - OWASP ASVS v4.0.3 §1.4 (separation of duties + least privilege). `[institutional][H]`
  - NIST SP 800-53 AC-6 (Least Privilege). `[institutional][H]`
  - GitHub's 2024 announcement deprecating password auth + recommending PATs / GitHub Apps; Google's 2024 deprecation of GCE legacy service-account keys for new orgs. `[vendor][H]`
- **Synthesizer reasoning:** the detector is heuristic — false positives (a legitimate AKIA-key in a CI lock-vault context) are tolerable because the hint is non-blocking. `[synth][M]`
- **What would change this call:**
  - A service deprecates OAuth in favor of long-lived tokens (extremely unlikely — industry direction is opposite).
  - A peer-reviewed analysis identifies a new attack class against OAuth device flow that makes long-lived tokens preferable.
  - GitHub / AWS / Google change their recommended defaults; the per-service pattern list updates accordingly.

## Consequences

**Locks in:**
- The credential-source hierarchy is now documented in L4 and detectable by the hook + doctor.
- New services added to the pattern list (in `oauth-preference.mjs`) extend the detector cleanly.
- The OAuth-preference signal is non-blocking + non-fatal — it's a hint, not a hard gate.

**Locks out:**
- The "I'll just use a PAT, it's easier" pattern silently becoming the default. The hint surfaces in the event log; the Critic flags it monthly.

**Migration path if it fails:** delete `oauth-preference.mjs` or remove the patterns — pre-tool-use + secrets-doctor degrade gracefully. The L4 documentation stays as a reference.

## Alternatives considered

- **Block tool calls with long-lived tokens.** Rejected: too aggressive (legitimate cases exist — CI vault, on-prem service without OAuth provider, etc.).
- **Make OAuth-preference a hard secrets-doctor finding.** Rejected: muddles the secrets-doctor's main job (catching exposed values). Hint section is the right home.
- **Per-service auto-detection of which OAuth flow to use.** Considered. Deferred to v0.7+ — would require maintaining a richer per-service config that's quick to drift.

## Affects / Affected by

**This ADR affects** *(downstream)*:

- `scripts/lib/oauth-preference.mjs` — implementation
- `scripts/hooks/pre-tool-use.mjs` — emits `oauth_preference_hint` events
- `scripts/lib/secrets-doctor.mjs` — reports OAuth-preference findings
- `layers/L4-tooling.md` — Credential-source hierarchy section

**This ADR is affected by** *(upstream)*:

- `adr/0027-permissions-protocol.md` (LR-04 credentials category — this PR is its OAuth specialization)
- `adr/0018-secrets-handling.md` (LR-03 secrets-in-args)
- `constitution/local-rules.md` — LR-04 carries the "smallest needed credential scope" protocol this implements

## References

- GitHub docs: OAuth Apps + GitHub Apps + Personal Access Tokens
- Google Cloud: Application Default Credentials, Workload Identity Federation
- AWS IAM Identity Center docs (2024 best practices)
- Vercel access token docs
- npm granular access tokens + OIDC trusted publishing
- OWASP ASVS v4.0.3 §1.4
- NIST SP 800-53 AC-6
