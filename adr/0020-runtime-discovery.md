# ADR-0020: Runtime discovery — MCPs + subagent staleness + bootstrap restart message

**Status:** Accepted
**Date:** 2026-05-18
**Author:** Architect handoff — Loom v0.3 — approved by Nick
**Confidence:** [H]

## Context

Two related findings from a real v0.2 downstream session:

**Finding #3 — MCP discovery gap.** `tools/mcp-servers/config.yaml` is the project's *desired* MCP set. The user's Claude environment may already have Anthropic-marketplace MCPs (Supabase, Vercel, GitHub, Linear, Slack) wired up — but the project doesn't know about them. They surface only via a system reminder mid-session.

**Finding #6 — Subagent registry is built at session start.** This is the load-bearing one. The six base subagents at `.claude/agents/*.md` are NOT available to Claude Code's `Agent` tool when added mid-session (via `git pull` of the template, or by `loom init`). Attempting `Agent(subagent_type="eac", ...)` returns "Agent type 'eac' not found." This is why the v0.2 session that "passed loom doctor" never spawned a single subagent — they weren't just un-invoked, they were **un-invokable**.

Both findings share a root: the runtime state of "what's actually available to this session" is opaque, and Loom didn't surface it.

## Decision

### A. `scripts/discover-runtime.{sh,ps1}` + `scripts/lib/discover-runtime.mjs`

Reads the standard Claude Code MCP config locations (in priority order):

1. `$LOOM_MCP_CONFIG_PATH` (env override)
2. `~/.claude/mcp.json`
3. `$XDG_CONFIG_HOME/claude/mcp.json`
4. `~/.config/claude/mcp.json`
5. `$APPDATA/Claude/mcp.json` (Windows)
6. `~/Library/Application Support/Claude/mcp.json` (macOS)

Writes `tools/discovered-runtime.md` with two sections:

- **MCP servers available** — names + commands from the first config location that exists. If none found, lists the searched paths so the user can correct.
- **Subagents at `.claude/agents/`** — for each `.md` file, marks **STALE** if mtime > `.last-discovered-at` sentinel mtime, otherwise ✓.

Manual additions are preserved below an `<!-- end-of-generated -->` marker. Marketplace/runtime-injected MCPs that don't appear in static config files can be hand-added there.

### B. Subagent staleness sentinel

`.claude/agents/.last-discovered-at` is a zero-byte sentinel whose **mtime** is the discovery baseline. The model is:

- Bootstrap stamps the sentinel at the end of stamping.
- SessionStart hook runs discovery (which auto-creates the sentinel on first run, so a fresh clone doesn't falsely report all subagents as stale).
- When a subagent file's mtime exceeds the sentinel mtime, the discovery report flags it STALE with a restart message.
- After restarting Claude Code, the user runs `touch .claude/agents/.last-discovered-at` to update the sentinel and suppress the nag.

The staleness signal is **best-effort** — it doesn't introspect Claude Code's actual subagent registry (no API for that). It detects "files newer than the last time the user said discovery was good." Good enough for the "you just `git pull`ed; restart Claude Code" case.

### C. Bootstrap "RESTART CLAUDE CODE NOW" message

`scripts/bootstrap.{sh,ps1}` end with a loud "RESTART CLAUDE CODE NOW" banner. Reason: even the *current* session that ran bootstrap can't invoke the subagents bootstrap just stamped onto disk — the session's registry was built before. This is the #1 v0.3 footgun and the banner exists to prevent it.

### D. SessionStart hook integration

The PR-1 SessionStart hook now spawns `node scripts/lib/discover-runtime.mjs --quiet` after auto-bootstrap. The result emits a `runtime_discovery_run` event with exit code and preview. The actual nag (if any) is in `tools/discovered-runtime.md`, not in the hook output — the user reviews the file when they wonder "wait, why isn't this subagent working?"

### E. Upstream Anthropic issue (not implementable in template)

Proposal B from the v0.3 finding: file an issue with Anthropic asking for dynamic subagent registry reload. Without it, projects using Loom must restart their IDE/CLI on every v0.x → v0.y upgrade. **The user files this issue** from their GitHub account — not me. Draft text for the issue is in this ADR's "Upstream issue draft" section below for copy-paste convenience.

## Consequences

**Locks in:**
- One canonical view of "what's actually wired up right now" at `tools/discovered-runtime.md`, regenerated on SessionStart and at bootstrap.
- Subagent staleness is detectable before the user wonders why `Agent(subagent_type="...")` returns "not found."
- Bootstrap's restart message makes the #1 v0.3 footgun obvious.

**Locks out:**
- Quiet "subagents on disk but not in registry" failures.
- Reliance on the user finding marketplace MCPs through a system reminder.

**Migration path if it fails:** the discovery script is read-only and standalone — deleting it disables nothing else. The sentinel is harmless if absent (first-run logic recreates it).

**Limitations (documented in the generated file and the ADR):**
- Marketplace / runtime-injected MCPs may not appear in static config files. Manual additions go below the `<!-- end-of-generated -->` marker.
- The staleness check is mtime-based, not registry-introspection — accurate enough for the common case, not authoritative.

## Alternatives considered

- **Skip mcp discovery; tell users to run `/mcp` in Claude Code.** Rejected: that's exactly the v0.1 situation that made the gap surface only via system reminders. Project artifacts should know what's wired up.
- **Hook into Claude Code's `/mcp` slash command output.** Rejected: hooks don't have access to slash-command output. Reading the static config file is the right boundary.
- **Block tool calls if subagents are stale.** Rejected: too aggressive. The discovery report nags; the user resolves on their schedule.
- **Auto-restart Claude Code from the bootstrap script.** Rejected: a script killing the IDE that's running it is hostile. The banner is the right primitive.

## Upstream issue draft (copy-paste for the user to file)

```
Title: [Feature] Dynamic subagent registry reload (without session restart)

Body:
When a `.claude/agents/<name>.md` file is added or modified mid-session,
the change is not visible to the Agent tool until Claude Code is restarted.
Attempting `Agent(subagent_type="<new>", ...)` returns "Agent type '<new>'
not found."

This makes every template upgrade or new-subagent commit require a full
session restart, which is friction for projects using Claude Code as the
runtime for an agentic framework (e.g., Loom — github.com/<owner>/loom-template).

Concretely, the template ships six subagents. When a user clones the template
and runs `loom bootstrap`, the SAME session that ran bootstrap cannot invoke
the subagents bootstrap just wrote to disk. They must restart.

Feature request: re-scan `.claude/agents/` on each `Agent` tool invocation
(or on a file-watch event). The cost is one directory listing + frontmatter
parse per dispatch — negligible compared to the LLM call that follows.

Workaround we ship today: `tools/discovered-runtime.md` flags stale subagent
files, and the bootstrap script ends with a "RESTART CLAUDE CODE NOW" banner.
But this is a workaround.
```

## References

- [`../scripts/lib/discover-runtime.mjs`](../scripts/lib/discover-runtime.mjs) — discovery logic
- [`../scripts/discover-runtime.sh`](../scripts/discover-runtime.sh), [`../scripts/discover-runtime.ps1`](../scripts/discover-runtime.ps1) — wrappers
- [`../tools/discovered-runtime.md`](../tools/discovered-runtime.md) — generated report
- [`../.claude/agents/.last-discovered-at`](../.claude/agents/.last-discovered-at) — staleness sentinel
- [`../scripts/hooks/session-start.mjs`](../scripts/hooks/session-start.mjs) — SessionStart integration
- [`../scripts/bootstrap.sh`](../scripts/bootstrap.sh), [`../scripts/bootstrap.ps1`](../scripts/bootstrap.ps1) — restart banner
- ADR-0012 — the subagents whose staleness is being detected
