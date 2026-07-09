# Eval Suite

> **Required.** Per §B.7 of the spec, every Loom project must ship with an eval suite. Smoke evals run every commit and gate `loom run`.

---

## Categories

| Type | Purpose | Frequency | Location |
|---|---|---|---|
| **Smoke** | Catches catastrophic regressions (agent starts, follows basic instructions, respects kernel) | Every commit | `smoke/` |
| **Capability** | Task-specific performance vs. baseline | Nightly | `capability/` |
| **Drift** | Confidence drift (secondary), faithfulness drift against the golden set (primary), hallucination rate, response distribution shift | Weekly | `drift/` |
| **Adversarial** | Prompt injection, jailbreak attempts, kernel-violation provocations | Pre-release | `adversarial/` |
| **Retrieval** | Faithfulness / groundedness, retrieval recall, retrieval precision against a fixed golden set | Nightly | `retrieval/` |
| **Subagent canonical prompts** | One canonical prompt per base subagent; behavioral markers verify each subagent honors its v0.2 SKILL.md contract. **Human-graded.** | Each template release | `subagents/` (prompts) + `runs/` (captures) |

The **Subagent** category was added per [ADR-0021](../../adr/0021-subagent-evals.md). Closes v0.3 finding #5 (HR/EAC unverified). Each `subagents/<name>.md` has a `canonical_prompt:` + `marker_behaviors:` in frontmatter. `scripts/eval-subagents.{sh,ps1}` dispatches each prompt to the matching subagent via the `claude` CLI and captures the response to `runs/YYYY-MM-DD/<name>.md` for human grading. Automated grading of agentic responses is explicitly **not** v0.3's scope.

The **Retrieval** category was added per [ADR-0006](../../adr/0006-retrieval-evaluation.md). Self-reported confidence is unreliable as a drift signal (Kadavath et al.); RAGAS-style faithfulness against a fixed golden set is the primary drift detector. `[research-p1][H]`

## Starter checks (smoke)

These are the bare minimum that any Loom project should pass on a fresh checkout:

1. **Constitution loads.** [`../../constitution/kernel-v6.md`](../../constitution/kernel-v6.md) parses and is non-empty (not the placeholder).
2. **Skeleton intact.** All required directories from §B.2 exist.
3. **Agent SKILLs present.** Each base agent has a non-empty `SKILL.md`.
4. **MCP config valid.** [`../../tools/mcp-servers/config.yaml`](../../tools/mcp-servers/config.yaml) parses and at least `filesystem` is enabled.
5. **CLAUDE.md size cap.** ≤ 10 KB.
6. **AGENTS.md size cap.** ≤ 5 KB.
7. **No leaked secrets.** No obvious credential patterns in versioned files.

## Adding evals

Create a new file under the relevant category directory. Convention:

```
<category>/<short-name>.<ext>
```

Where `<ext>` is your runner's expected extension (e.g., `.test.ts`, `.test.py`, `.sh`).

Each eval must:
- Exit with non-zero code on failure
- Emit a one-line summary to stdout
- Append a row to the event log (the smoke runner does this automatically)

## Anti-collapse discipline

Per [§B.8](../../layers/L7-extension.md): a new eval **cannot replace existing evals**, only add alongside. Removals require a kernel-amendment-equivalent process.
