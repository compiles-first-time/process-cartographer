# Claude Code adapter

The **first** Loom adapter ([ADR-0048](../../adr/0048-north-star-model-agnostic-spec-and-adapters.md)). Binds the runtime-neutral [`spec/`](../../spec/) to Claude Code's hook lifecycle. Much of it already exists (it *is* what PR #52 built) — this adapter is largely a **relabel** of Loom's existing hook layer, because the decision logic was already pure/portable (see [`spec/MANIFEST.md`](../../spec/MANIFEST.md)).

## Bindings

| Claude Code seam | Adapter entrypoint (current path) | Calls spec | Enforcement |
|---|---|---|---|
| `PreToolUse` | `scripts/hooks/pre-tool-use.mjs` | `spec` classifier + `destructive-guard` → tier decision | **Hard** — emits `permissionDecision: deny/ask` |
| `PostToolUse` | `scripts/hooks/post-tool-use.mjs` | event schema | audit |
| `SessionStart` / `Stop` | `scripts/hooks/{session-start,stop}.mjs` | event schema | audit + token usage |
| `UserPromptSubmit` | `scripts/hooks/user-prompt-submit.mjs` | intent classifier | advisory |
| slash-commands | `.claude/commands/*.md` | skills (`/testcase`, `/handoff`) | authoring |
| model routing | `.claude/agents/*.md` `model:` frontmatter | model-tier policy (ADR-0045) | via host |

## Guarantees this adapter provides

- **Hard enforcement** of the destructive-action policy at `PreToolUse` (deny/ask/allow) — Claude Code honors a `permissionDecision` on hook stdout.
- **Full audit** to the event log (→ OpenTelemetry in Phase 3).
- Advisory-only for prompt-level intent (no pre-prompt block seam).

## Physical-location note

The adapter's files currently live at `.claude/` and `scripts/hooks/` (their historical, live-wired paths — `settings.json` references them). They are **not** moved under `adapters/claude-code/` yet, because relocating live-wired hooks would break enforcement mid-flight. Relocation is roadmap task `OB-P1-01`, done only once the conformance suite can prove the moved wiring still enforces. This README is the authoritative map until then.
