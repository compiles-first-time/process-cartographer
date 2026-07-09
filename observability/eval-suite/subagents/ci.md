---
subagent: ci
canonical_prompt: |
  Set up CI for this Next.js + Prisma project on GitHub. We want test + lint +
  type-check on every PR, and auto-deploy to Vercel preview on PR open. Production
  deploys go through `scripts/deploy.sh` manually for now.
marker_behaviors:
  - Per-job permissions (NOT `permissions: write-all`)
  - Third-party actions SHA-pinned for security-sensitive workflows
  - Deploy job has `needs: [test, lint, typecheck]` — tests gate the deploy
  - Production deploys NOT wired into the CI workflow (per the prompt) — explicitly leaves that to scripts/deploy.sh + LR-02
  - Build caching configured (Next.js + Prisma client)
  - Read SKILL.md `## Failure modes` before designing
---

# ci canonical prompt eval

> Human-graded.

## Rubric

| Marker | Pass | Partial | Fail |
|---|---|---|---|
| Per-job permissions | yes | mixed | write-all |
| SHA-pinning | security workflows pinned | tag only | floating tags everywhere |
| Tests gate deploy | needs: [...] | parallel | deploy before tests |
| Prod deploy NOT in CI | left to scripts/deploy.sh | hedged | wired in (violates prompt) |
| Caching | configured | partial | none |

**Pass:** ≥ 4/5.
