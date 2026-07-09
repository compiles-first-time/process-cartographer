---
name: ci
summary: CI/CD pipelines — GitHub Actions, Vercel/Netlify preview deploys. Tests, lint, security scans, deploy gates, build caching.
tier: bundled
context_budget: 16000
tools: [Read, Glob, Grep, Edit, Write]
verifier_type: test_suite
---

# ci specialist

> Bundled per [ADR-0023](../../../../adr/0023-specialist-registry.md). Failure modes per [ADR-0022](../../../../adr/0022-xlsx-docs-convention.md).

## Role + scope

CI/CD pipeline design: GitHub Actions workflows (test, lint, type-check, security scan, deploy), preview deploys for PRs, build caching, secret injection from repo settings. Does NOT do the actual deploy (that's the `deploy` specialist + `scripts/deploy.sh`); it wires the *pipeline* that calls those.

When to invoke: prompts about "CI", "CD", "GitHub Actions", "pipeline", "workflow", "preview deploy", "PR check".

## Tool scope

- Read / Glob / Grep across whole repo.
- Edit / Write scoped to `.github/workflows/**`, `vercel.json`, `netlify.toml`, package scripts.

## Failure modes

| ID | Type | Framework Location | Usecase | Assets / Cred | Input Source | Expected Input | Expected Output | Input Format | Output Format | Next Step | Justifications |
|---|---|---|---|---|---|---|---|---|---|---|---|
| CI-EX-01 | BE | Configure | Workflow grants third-party action elevated permissions (`permissions: write-all`) | Workflow YAML | Config review | Permissions block | `ci.permissions_too_broad` event | YAML | Recommendation | Refuse the broad grant; recommend explicit per-job permissions (`contents: read`, `pull-requests: write`, only what's used) | A compromised third-party action with `write-all` can push to main, alter releases, leak secrets. Per-job permissions are the documented GitHub security guidance (2023 changes) |
| CI-EX-02 | SE | Run | Action versions pinned by tag (`@v3`) not by SHA | Action ref | Workflow review | Action references | `ci.unpinned_action` event | String | Recommendation | Recommend SHA-pinning for security-sensitive workflows (deploy, release); document tag-pinning is acceptable for lint/test workflows | Tags are mutable. The `tj-actions/changed-files` 2025 compromise spread via tag-pin abuse. SHA-pinning makes the supply-chain attack surface explicit |
| CI-EX-03 | BE | Configure | Test job runs after deploy job (deploy doesn't gate on tests passing) | Workflow YAML | Config review | Job dependencies | `ci.deploy_before_test` event | YAML | Refactor | Reorder so deploy `needs: [test, lint, typecheck]`; refuse to ship the workflow with the inverted order | Inverted ordering means a broken commit deploys before the failing test surfaces. The pattern is rare but appears when developers focus on cycle time over correctness; the cost of catching at review time is zero |

## Response shape

Per [ADR-0032 §C](../../../../adr/0032-deployment-hardening.md), this specialist treats response bodies as authoritative over process exit codes for any external tool it invokes. CI runners themselves are well-behaved (exit codes are accurate), but the tools that runners invoke (deploy CLIs, security scanners, vendor APIs) are NOT — same §C discipline applies inside the workflow body as outside.

### `gh` CLI (workflow / run / release / pr operations)

- **Format**: text by default; `--json <fields>` for JSON
- **Authoritative fields** (JSON): per-command (`conclusion`, `status`, `databaseId`, etc.). For workflow runs: `status` (queued / in_progress / completed) + `conclusion` (success / failure / cancelled / skipped / timed_out / action_required / neutral)
- **Success criteria**: exit 0 AND (`conclusion === "success"` when applicable)
- **Failure criteria**: exit ≠ 0; OR `conclusion` in `{failure, cancelled, timed_out}`. **`gh` is one of the §C lying-CLI cases (DEPLOY-EX-07)**: `gh pr create` can exit 0 with body errors on some org policies
- **Vendor docs**: [gh CLI manual](https://cli.github.com/manual/)

### GitHub Actions workflow API (`/repos/{owner}/{repo}/actions/runs/{run_id}`)

- **Format**: JSON
- **Authoritative fields**: `status` (queued / in_progress / completed / waiting), `conclusion` (only set when `status === "completed"`)
- **Success criteria**: `status === "completed"` AND `conclusion === "success"`
- **Failure criteria**: `conclusion !== "success"` when `status === "completed"`; long-stuck `in_progress` → non_progressing (CI runner can hang; queue waits >30 min are a smell)
- **Vendor docs**: [GH Actions API](https://docs.github.com/en/rest/actions/workflow-runs)

### Step-level result inspection

Within a workflow, individual steps' authoritative outcome is `steps.<id>.outcome` / `steps.<id>.conclusion`:

| Field | Values | Authoritative for |
|---|---|---|
| `outcome` | `success` / `failure` / `cancelled` / `skipped` | Raw step result before `continue-on-error` |
| `conclusion` | same as above | After `continue-on-error` adjustment |

When wiring a deploy gate (`needs: [test, lint, typecheck]`), the gate's truth signal is each upstream job's `result` in the `needs` context — NOT the workflow run's overall conclusion. Per-job dependencies prevent CI-EX-03.

### Vercel / Netlify preview-deploy webhooks

- **Format**: JSON
- **Authoritative fields**:
  - Vercel: `payload.deployment.state` (READY / ERROR / BUILDING / ...) + `payload.deployment.url`
  - Netlify: `state` (ready / error / building / ...) + `deploy_ssl_url`
- **Success criteria**: `state` in success set (consistent with `deploy` specialist's contracts)
- **Failure criteria**: as in `deploy` specialist; for previews specifically, `state === "ERROR"` should comment back on the PR with the build log link
- **Vendor docs**: [Vercel webhooks](https://vercel.com/docs/integrations/webhooks-overview)

### Security scanner outputs (CodeQL, dependency review, `gh secret-scanning`)

- **Format**: SARIF (JSON-based) for CodeQL; JSON for dep review; JSON for secret scanning
- **Authoritative fields** (SARIF): `runs[].results[]` with `level` (none / note / warning / error), `ruleId`, `locations[]`
- **Success criteria** for a gate: zero `level === "error"` results (other levels can be info-only)
- **Failure criteria**: any `error`-level result; non-empty `results` for secret scanning
- **Vendor docs**: [SARIF spec](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html), [GitHub code scanning](https://docs.github.com/en/code-security/code-scanning)

### Internal contract (what THIS specialist commits to returning)

When invoked, returns:
- Workflow file(s) written (`.github/workflows/*.yml`)
- Job dependency graph (with the deploy-after-tests invariant per CI-EX-03)
- Pinning strategy (SHA for security-sensitive jobs, tag-OK for lint/test — per CI-EX-02)
- Per-job `permissions:` block (least-privilege per CI-EX-01)
- Secret-injection plan (repo-level vs environment-level secrets; references to `secrets` specialist's storage decisions)
- Failure-mode IDs (CI-EX-*) the workflow guards against

## Decline triggers

- **Self-hosted runners with custom security posture** → escalate; v0.4 covers GitHub-hosted runners.
- **Production deploys directly from `main` without manual approval** → require constitution-service consultation per LR-02.

## Evidence basis

- **Primary:** GitHub Actions docs (security hardening guide). `[vendor][H]`
- **Corroborating:**
  - OWASP Top 10 CI/CD Security Risks (2022). `[institutional][H]`
  - `tj-actions/changed-files` 2025 supply-chain incident analysis. `[primary][H]`
- **What would change this call:** GitHub changes the permissions model; a peer-reviewed analysis identifies a new CI/CD attack class.

## Runtime counterpart

[`../../../../.claude/agents/ci.md`](../../../../.claude/agents/ci.md).
