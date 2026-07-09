# ADR-0013: Bootstrap unification — YAML is the MCP source of truth

**Status:** Accepted
**Date:** 2026-05-18
**Author:** Architect handoff — Loom v0.2 enforcement runtime — approved by Nick
**Confidence:** [H]

## Context

The real-session findings flagged that `tools/mcp-servers/config.yaml` and `.claude/settings.json` were a "parallel universe" — configuring an MCP server in the YAML had no runtime effect, because Claude Code only reads `.claude/settings.json#mcpServers`. The two files agreed by coincidence at v0.1, drifted at the first edit, and there was no mechanism to keep them aligned.

The bootstrap script also stopped after placeholder substitution. Today's event-log JSONL was never created until the first hook fired, and there was no clear "summary of what just happened" at the end.

## Decision

Pick a direction and ship the plumbing:

1. **`tools/mcp-servers/config.yaml` is the source of truth.** The YAML is human-friendly, spec-as-codebase canonical, and what the L4 spec already points to.
2. **`.claude/settings.json#mcpServers` is generated** from the YAML by `scripts/lib/mcp-yaml-to-settings.mjs` — a one-way transform that preserves the rest of the file (hooks block stays untouched). A `// _generated_mcp` sentinel key annotates the JSON so a human knows not to hand-edit the block.
3. **Bootstrap runs the generator** at the end of stamping. It also `touch`es today's JSONL so hooks have somewhere to write from the very first session, and prints a one-screen summary (project, root, stamped count, event-log path, subagent count, hook count, next steps).
4. **`loom doctor`** (PR-5 / C) will re-run the generator with `--check` to detect drift between YAML and JSON.

## Consequences

**Locks in:**
- One canonical place to add or disable an MCP server (the YAML). Bootstrap + doctor enforce JSON alignment automatically.
- Every bootstrap produces a working JSONL log path and a `.claude/settings.json` whose `mcpServers` block matches the project's declared MCP set.
- The bootstrap summary is the obvious "did it work?" artifact for users.

**Locks out:**
- Editing `.claude/settings.json#mcpServers` by hand. The block is marked generated and will be overwritten on next bootstrap/doctor run.
- Silent YAML/JSON drift.

**Migration path if it fails:** the generator is one-way and idempotent. Reverting just stops running it; the JSON the generator produced stays valid until hand-edited (or until the next generator run).

## Alternatives considered

- **JSON as source of truth, generate YAML.** Rejected: YAML is what L4 documents; users edit the YAML; flipping the direction would force users to learn a generated-file workflow on the wrong file.
- **No generator — keep the two files manually aligned.** Rejected: that's the v0.1 state that produced the bug.
- **Drop the YAML, use only `.claude/settings.json`.** Rejected: throws away the human-friendliness and spec-as-codebase consistency of the YAML, and would force projects with non-Claude-Code agents to have no canonical MCP config.
- **Use a YAML library (`js-yaml`).** Rejected: violates the "no external deps" constraint. The YAML schema here is small and fixed; a deterministic targeted parser (~140 lines) handles it without dependencies.

## References

- [`../scripts/lib/mcp-yaml-to-settings.mjs`](../scripts/lib/mcp-yaml-to-settings.mjs) — the generator
- [`../scripts/bootstrap.sh`](../scripts/bootstrap.sh), [`../scripts/bootstrap.ps1`](../scripts/bootstrap.ps1) — bootstrap calls the generator + touches JSONL + prints summary
- [`../tools/mcp-servers/config.yaml`](../tools/mcp-servers/config.yaml) — source of truth
- [`../.claude/settings.json`](../.claude/settings.json) — generated `mcpServers` block + hooks block (the hooks block is hand-authored per ADR-0011)
- ADR-0011 — hooks block in the same file; preserved across regeneration
- ADR-0015 (planned, PR-5 / C) — `loom doctor` will check YAML/JSON alignment via `--check` mode
