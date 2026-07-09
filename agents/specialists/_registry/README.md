# Specialist registry — `_registry/`

> Per [ADR-0023](../../../adr/0023-specialist-registry.md).

The `_registry/` directory holds **bundled specialists** that ship with the Loom template. Each specialist gets a `<name>/SKILL.md` describing its role, tool scope, context budget, **failure modes** (in the [xlsx convention](../../../adr/0022-xlsx-docs-convention.md) — SE/BE rows with Justifications), and decline triggers.

The [manifest.yaml](./manifest.yaml) is the index. The intent classifier ([`scripts/hooks/_classify.mjs`](../../../scripts/hooks/_classify.mjs)) reads it on every user prompt to surface specialist suggestions via the UserPromptSubmit hook.

## Two namespaces

| Location | Purpose | When to use |
|---|---|---|
| `agents/specialists/_registry/<name>/SKILL.md` | **Bundled** — ships with Loom; never edit in a downstream project | Imported as-is; updated via Loom template upgrades |
| `agents/specialists/<name>/SKILL.md` | **Project-local** — may override a registry entry | Override by adding `extends: _registry/<name>` in the project-local SKILL.md frontmatter; only re-specify what differs |

Override semantics (per ADR-0023): if a project-local entry exists at `agents/specialists/<name>/`, the classifier prefers it; the registry version is the fallback inheritance source for fields the project-local file doesn't define.

## Adding a project-local override

1. Create `agents/specialists/<name>/SKILL.md`.
2. Frontmatter: `extends: _registry/<name>`.
3. Re-specify only the fields you need to change (e.g., a project-specific tool allowlist or a tighter context budget).
4. Open an ADR documenting the override and its evidence basis (LR-05).

## Specialist authoring checklist

- [ ] Role + scope (one paragraph)
- [ ] Tool allowlist (what the specialist may call)
- [ ] Context budget (per [ADR-0004](../../../adr/0004-context-budget.md))
- [ ] Failure modes section in xlsx convention (SE / BE rows)
- [ ] Decline / escalate triggers
- [ ] Evidence basis (per LR-05): what backs the specialist's design + what would change the call
- [ ] Canonical-prompt eval file at `observability/eval-suite/subagents/<name>.md`
