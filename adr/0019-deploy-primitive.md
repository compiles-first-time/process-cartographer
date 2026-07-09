# ADR-0019: Deploy primitive — `scripts/deploy.{sh,ps1}` + `tools/runtime.yaml`

**Status:** Accepted
**Date:** 2026-05-18
**Author:** Architect handoff — Loom v0.3 — approved by Nick
**Confidence:** [H]

## Context

v0.2 ships `bootstrap` (project init) and `doctor` (conformance check) but no deploy primitive. Deployment is a recurring action with load-bearing safety properties — irreversible externally-visible state change (Kernel Rule 20). v0.2 production deploys went through ad-hoc CLI invocations bypassing the Critic, Constitution Service, and the event-log audit trail.

PR-G (ADR-0017) added the production-mutation detector and LR-02. This PR makes LR-02 *concrete on the deploy path*.

## Decision

Ship `scripts/deploy.{sh,ps1}` + `scripts/lib/deploy.mjs` + `tools/runtime.yaml`.

### `tools/runtime.yaml` — project-supplied deploy configuration

The runtime-specific command is **not** hard-coded into Loom. The YAML keeps:

- `deploy.command` — executable name (`vercel`, `netlify`, `fly`, `render`, custom script…).
- `deploy.args` — argv array.
- `deploy.env_required` — env var names that must be present (values not stored here).
- `deploy.post_deploy_url_pattern` — regex applied to stdout to extract the deployment URL.
- `deploy.prod_branch` — the branch this project considers "production."

Stamped by bootstrap with `<DEPLOY_COMMAND>` placeholder; doctor verifies it has been replaced.

### `scripts/deploy.mjs` — the wrapper

Five steps, executed in order. Each step's outcome is written to the event log:

1. **`loom doctor` must pass.** Spawns `node scripts/lib/doctor.mjs`; abort on exit 1. `--force` skips.
2. **Hook coverage check.** This session must have a `session_start` event in today's JSONL. Catches "deploy ran with hooks disabled."
3. **Constitution-service prompt.** Interactive `Y/n` reminder to invoke the constitution-service subagent and emit a `claim` event covering this deploy (LR-02). `--yes` / `-y` skips the prompt. The deploy script does **not** auto-dispatch the subagent — that's the model's call; the script makes the requirement obvious at the right moment.
4. **Run the configured command.** Live-streams stdout/stderr to the user and captures for URL extraction.
5. **Record events.** `deployment_started` (before run) and `deployment_completed` (after) with exit code, duration, and extracted URL.

Exit code passes through from the underlying deploy command.

## Consequences

**Locks in:**
- One canonical path to deploy a Loom project. Bypassing it leaves an obvious gap in the audit trail.
- LR-02 is operationalized at the deploy boundary (prompt before deploy, event-log record after).
- Project-specific deploy commands are config, not code in Loom.

**Locks out:**
- Silent deploys with broken hooks.
- Deploys without an explicit constitution-service moment (the prompt forces it).
- Hard-coded vendor assumptions in the template (Vercel, Netlify, etc. are all just `deploy.command` values).

**Migration path if it fails:** `tools/runtime.yaml` is project-controlled; setting `deploy.command` to a project-specific shell script and using `--yes --force` reduces deploy.sh to a thin shim. Removing the wrapper entirely is harmless.

## Alternatives considered

- **Auto-dispatch constitution-service from deploy.sh.** Rejected: the wrapper is a Node script, not a Claude Code session. It has no path to dispatch a subagent. The interactive prompt is the right enforcement primitive at this layer.
- **Make `loom doctor` a hard gate (no --force).** Rejected: there are legitimate emergencies where a deploy must happen despite a doctor warning. `--force` is the documented escape hatch.
- **Per-environment subkeys in `runtime.yaml`** (`deploy.preview.command`, `deploy.production.command`). Rejected for v0.3: most v0.2 projects deploy to a single environment from a single command. v0.4 can add this when a real project hits the need.
- **Build a Loom-specific deploy DSL.** Rejected: every runtime has its own deploy idioms (Vercel vs. Fly vs. Kubernetes); a DSL would be wrong for most. Shelling out to the runtime's own command preserves the user's existing knowledge.

## References

- [`../tools/runtime.yaml`](../tools/runtime.yaml) — project deploy config (stamped at bootstrap)
- [`../scripts/lib/deploy.mjs`](../scripts/lib/deploy.mjs) — implementation
- [`../scripts/deploy.sh`](../scripts/deploy.sh), [`../scripts/deploy.ps1`](../scripts/deploy.ps1) — wrappers
- [`../layers/L5-orchestration.md`](../layers/L5-orchestration.md) — deploy primitive section
- ADR-0017 / LR-02 — what the prompt at step 3 enforces
- ADR-0015 — `loom doctor` runs at step 1
- ADR-0011 — `session_start` event checked at step 2
