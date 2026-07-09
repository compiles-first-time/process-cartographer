# Discovered runtime

> **Auto-generated** by `scripts/discover-runtime.{sh,ps1}` at SessionStart and at bootstrap. Per [ADR-0020](../adr/0020-runtime-discovery.md).

> Manual additions: write below the `<!-- end-of-generated -->` marker. The auto-generated section above will be overwritten on next run; your manual section will be preserved.

Generated: 2026-07-09T01:35:02.982Z

## MCP servers available to this Claude Code installation

_No MCP servers discovered._ Loom checked these locations:

- `$LOOM_MCP_CONFIG_PATH` (env override)
- `~/.claude/mcp.json`
- `$XDG_CONFIG_HOME/claude/mcp.json`
- `~/.config/claude/mcp.json`
- `$APPDATA/Claude/mcp.json` (Windows)
- `~/Library/Application Support/Claude/mcp.json` (macOS)

Marketplace / runtime-injected MCPs may not appear in static config files. Add them manually below the marker.

## Subagents at `.claude/agents/`

| File | Status |
|---|---|
| `auth.md` | **STALE** — newer than discovery sentinel; not invokable until Claude Code restart |
| `ci.md` | ✓ in registry (assumed loaded at session start) |
| `constitution-service.md` | **STALE** — newer than discovery sentinel; not invokable until Claude Code restart |
| `credential-setup.md` | ✓ in registry (assumed loaded at session start) |
| `critic.md` | ✓ in registry (assumed loaded at session start) |
| `db-migration.md` | ✓ in registry (assumed loaded at session start) |
| `deploy.md` | **STALE** — newer than discovery sentinel; not invokable until Claude Code restart |
| `eac.md` | ✓ in registry (assumed loaded at session start) |
| `email.md` | ✓ in registry (assumed loaded at session start) |
| `error-tracking.md` | ✓ in registry (assumed loaded at session start) |
| `file-storage.md` | ✓ in registry (assumed loaded at session start) |
| `hr.md` | ✓ in registry (assumed loaded at session start) |
| `human-replica.md` | **STALE** — newer than discovery sentinel; not invokable until Claude Code restart |
| `memory-keeper.md` | ✓ in registry (assumed loaded at session start) |
| `monitoring.md` | ✓ in registry (assumed loaded at session start) |
| `oauth.md` | ✓ in registry (assumed loaded at session start) |
| `payments.md` | ✓ in registry (assumed loaded at session start) |
| `queues.md` | ✓ in registry (assumed loaded at session start) |
| `secrets.md` | ✓ in registry (assumed loaded at session start) |

**Action:** Restart Claude Code so the Agent tool can see the newer subagent files. After restarting and confirming the agents work (try `Agent(subagent_type="critic", ...)`), run:

```bash
touch .claude/agents/.last-discovered-at
```

to update the sentinel and suppress this nag.

<!-- end-of-generated -->

## Manual additions




_(add marketplace MCPs / project-specific runtime details below)_
