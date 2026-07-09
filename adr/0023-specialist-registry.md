# ADR-0023: Specialist registry — bundled `_registry/` + project-local overrides

**Status:** Accepted
**Date:** 2026-05-20
**Author:** Architect handoff (v0.4 PR-L) — approved by Nick
**Confidence:** [H]

## Context

v0.3 finding #1 surfaced: specialist subagents are invoked manually, not triggered. The intent classifier shipped in PR-G (ADR-0017) suggests **base subagents** (HR, EAC, Critic, etc.) via heuristic patterns, but for project-bootstrap tasks — OAuth, payments, deploy, DB migration, CI, monitoring — there's no specialist to suggest. The session does the work directly, and the lessons-learned + reusability story of Loom is bypassed.

The user's proposal: a **specialist registry** that the classifier consults. Each registry entry binds a trigger pattern to a SKILL.md describing a specialist that handles that task class. The classifier suggests the specialist; the user dispatches (or doesn't); the specialist's SKILL.md ships with failure-modes in the xlsx convention (ADR-0022).

Two namespaces emerged in design:
- **Bundled** registry (`agents/specialists/_registry/`) — ships with Loom, imported as-is, updated via template upgrades.
- **Project-local** (`agents/specialists/<name>/`) — project-specific specialists or overrides of bundled ones.

## Decision

### A. Directory layout

```
agents/specialists/
├── _registry/                  # Bundled with Loom
│   ├── README.md                # Authoring checklist
│   ├── manifest.yaml            # Index of all bundled specialists + triggers
│   ├── <name>/SKILL.md          # Each bundled specialist's role
│   └── ...
└── <name>/SKILL.md             # Project-local specialists / overrides
```

PR-L ships only the directory structure + manifest schema (`manifest.yaml` with `specialists: []`). PR-M ships the first 12 starter specialists (auth, oauth, deploy, db-migration, secrets, email, file-storage, error-tracking, monitoring, queues, payments, CI). The remaining 8 from the user's list (search, cron, cdn, dns, push-notifications, analytics, feature-flags, A/B testing) land in a v0.4.1 follow-up once we've seen the first 12 perform.

### B. Manifest schema (per `manifest.yaml`)

```yaml
version: "1.0"
specialists:
  - name: <kebab-case-id>           # unique; matches directory name
    summary: <one-line>             # shown by classifier in additionalContext
    skill_md: _registry/<name>/SKILL.md
    tier: bundled | community | local
    triggers:
      patterns:                     # regex strings; matched against user prompt
        - "<regex>"
      tools:                        # tool names that hint invocation
        - "<tool-name>"
      keywords: []                  # exact lowercased tokens in tool args
    context_budget: <int>           # advisory; per ADR-0004
    evidence_basis:                 # per LR-05
      primary: <citation>
      confidence: H | M | L | S
      supersedability: <what would change the call>
    eval_source: observability/eval-suite/subagents/<name>.md
```

### C. Project-local override semantics

A project-local SKILL.md at `agents/specialists/<name>/SKILL.md` can override the bundled `_registry/<name>` by setting frontmatter:

```yaml
---
name: <name>
extends: _registry/<name>
context_budget: 24000              # narrower than registry default
tools: [Read, Glob, Grep]          # tightened
---
```

Override semantics: project-local fields **win**; registry fields fill remaining gaps. The classifier prefers the project-local version when present.

Per ADR-0023 disagreement-resolution from the v0.4 plan: this is a **shallow merge** — the project-local file is the source of truth for any field it declares; it doesn't deep-merge nested objects.

### D. Classifier integration

`scripts/hooks/_classify.mjs` `classifyIntent` becomes async. It still matches the built-in `INTENT_RULES` (base subagents) first; then calls `loadRegistry()` (in `scripts/lib/registry-loader.mjs`) to read the manifest + project-local overrides; then matches each specialist's `triggers.patterns` against the user prompt. All hits land in the `subagent_suggestion` event + `additionalContext` injection.

If `manifest.yaml` is missing or malformed, the classifier returns only built-in hits — fail-quiet, no regression from v0.3.

### E. Doctor checks (added in PR-L)

- `adr-template-conformance` — soft check that v0.4+ ADRs include the `Evidence basis` and `Affects / Affected by` sections.
- `bidirectional-adr-links` — soft check that every "This ADR affects: <path>" entry in a v0.4+ ADR has a back-reference to the ADR's number in the target file.

Both checks run on ADRs numbered ≥ 0022; older ADRs predate the convention and are exempt.

## Evidence basis

- **Primary evidence:** the v0.3 real-session finding #1 — AnonForum deploy did OAuth + deploy work without ever invoking EAC. The classifier exists; specialists don't. `[user-report][H]`
- **Corroborating sources:**
  - Anthropic's "claude code subagents" documentation describes static `.claude/agents/*.md` registration. Our manifest is the *project's* declaration of which specialists should exist; the runtime registration happens via `.claude/agents/` files generated from the manifest in a future PR. `[vendor][H]` for the underlying mechanism.
  - User's own existing `research-advisor` skill (referenced in ADR-0009) already implements the source-tiering / specialist pattern at a different layer. `[user-prior-work][H]`
- **Synthesizer reasoning:** the two-namespace split (bundled vs. local) generalizes the v0.2 `_registry`/`local-rules` split that already works for constitutional rules. Same pattern, different domain. `[synth][M]`
- **What would change this call:** if Anthropic ships **dynamic subagent reload** (per the upstream issue draft in ADR-0020), the staleness sentinel becomes redundant and specialists can be added mid-session without the manifest indirection. The manifest still serves as Loom's project-declared specialist set, but the runtime path simplifies. ADR would be amended, not superseded.

## Consequences

**Locks in:**
- One canonical place per project to declare specialists.
- Bundled specialists are updateable via template upgrade; project-local overrides survive.
- Classifier path is async — UserPromptSubmit hook awaits `classifyIntent` (already does).
- The doctor surfaces ADR-template drift mechanically.

**Locks out:**
- Hidden / undeclared specialists. If a project hand-rolls `.claude/agents/foo.md` without registering it in the manifest, the classifier won't suggest it — that's intentional, the manifest is the source of truth.

**Migration path if it fails:** the manifest is YAML; deleting it disables the registry path; built-in classifier rules still work. The `_registry/` and project-local directories are independent of the manifest — they can be migrated to a different indexing scheme without breaking the SKILL.md files themselves.

**Subagent-staleness coupling:** v0.4 specialists ship as `.claude/agents/<name>.md` Claude Code subagent files in PR-M. Those hit ADR-0020's staleness sentinel — fresh-clone bootstrap triggers the "RESTART CLAUDE CODE NOW" banner, which is the right behavior. **Upstream Anthropic issue should be filed before PR-M lands** so users hitting the registry for the first time know the limitation.

## Alternatives considered

- **One namespace only (no bundled / project-local split).** Rejected: projects need to specialize without losing template upgrade path. Single namespace forces either copy-paste-and-drift or no-customization.
- **Deep-merge override semantics.** Rejected: introduces a "what does this specialist actually look like at runtime?" question that's hard to answer mechanically. Shallow-merge is debuggable.
- **Registry in JSON, not YAML.** Rejected: human-edit ergonomics matter more than parser simplicity. The existing `tools/mcp-servers/config.yaml` already established YAML-source-of-truth (ADR-0013), and the same one-way generation path applies if we need a JSON mirror later.
- **Auto-generate `.claude/agents/<name>.md` from manifest at bootstrap.** Considered. Deferred to PR-M — the simpler v0.4 path is "manifest declares; specialist authors hand-craft `.claude/agents/<name>.md` files that match." Auto-generation can land in v0.4.1 if hand-craft drifts.

## Affects / Affected by

**This ADR affects** *(downstream)*:

- `scripts/hooks/_classify.mjs` — `classifyIntent` is now async + consults registry
- `scripts/hooks/user-prompt-submit.mjs` — awaits the classifier
- `scripts/lib/registry-loader.mjs` — implementation
- `scripts/lib/doctor.mjs` — new soft checks `adr-template-conformance` and `bidirectional-adr-links`
- `agents/specialists/_registry/manifest.yaml` — the manifest itself
- `agents/specialists/_registry/README.md` — authoring checklist
- `adr/0024-starter-specialists.md` *(planned, PR-M)* — populates manifest with 12 entries

**This ADR is affected by** *(upstream)*:

- `adr/0017-intent-nag.md` — built-in classifier this extends
- `adr/0022-xlsx-docs-convention.md` — failure-modes format specialists must follow
- `adr/0020-runtime-discovery.md` — subagent-staleness sentinel applies to v0.4 specialist `.claude/agents/` files too
- `constitution/local-rules.md` — LR-05 (evidence basis), LR-02 (production-mutation discipline applies inside specialists)
- `constitution/kernel-v6.md` — Kernel Rule 22 (epistemic transparency on classifier suggestions)

## References

- v0.3 finding #1 (real session: AnonForum deploy without EAC invocation)
- ADR-0017 — intent classifier
- ADR-0020 — runtime discovery + staleness sentinel
- ADR-0022 — xlsx docs convention (sibling PR-L)
- LR-05 — decisions supersedable by evidence (sibling PR-L)
