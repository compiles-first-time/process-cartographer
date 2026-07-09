# Spec / Adapter / Adopted-component manifest

The primitive-vs-opinion line ([ADR-0048](../adr/0048-north-star-model-agnostic-spec-and-adapters.md) §2), drawn on **real files**. Until physical relocation (roadmap `OB-P1-01/02`), this table is the source of truth for what is *logically* portable spec vs host adapter.

## Portable spec (runtime-neutral — the durable asset)

| Artifact (current path) | Role |
|---|---|
| `constitution/kernel-v6.md`, `constitution/local-rules.md` | Governance policy (→ policy-as-data in `spec/policy/`, `OB-P1-02`) |
| `.claude/loom-permissions.yaml` | Permission categories + tiers — **already declarative data** (misnamed by path; it's spec, not adapter) |
| `spec/policy/*` | Extracted policy data + pure evaluators |
| `scripts/lib/destructive-guard.mjs` | **Pure** tiered decision — no host dependency → *spec*, not adapter |
| `scripts/lib/permissions-classifier.mjs` | Pure classifier over policy data → *spec* |
| `scripts/lib/testcase.mjs` (`buildTestCaseFields`) | Pure schema normalizer → *spec* (the `emitTestCase` side-effect is adapter-ish) |
| `observability/eval-suite/requirements/*` | Requirements/exceptions registers (ADR-0046 schema) |
| `adr/`, `layers/` | The specification-as-codebase itself |

## Claude Code adapter (host-specific — binds spec to Claude Code)

| Artifact | Binds |
|---|---|
| `.claude/settings.json` (`hooks`) | Registers Loom's hook entrypoints on Claude Code lifecycle events |
| `scripts/hooks/pre-tool-use.mjs` | Reads Claude Code's stdin payload → calls spec (`destructive-guard`) → emits Claude Code `permissionDecision` |
| `scripts/hooks/{post-tool-use,session-start,stop,user-prompt-submit}.mjs` | Translate Claude Code lifecycle → spec event schema |
| `scripts/hooks/_lib.mjs` | Claude-Code-shaped I/O (stdin JSON, event-log append) |
| `.claude/commands/*.md` | Claude Code slash-commands (skills) |

## Adopted components (proven, vendor-neutral — rent, don't build)

| Component | Role | Status |
|---|---|---|
| **LiteLLM** (`tools/litellm/`) | Model-agnostic inference/routing | ✅ adopted (ADR-0045) |
| **MCP** (`tools/mcp-servers/`) | Tool protocol | ✅ native |
| **OPA/Rego** | Policy language + engine | ☐ evaluating (`OB-P1-03`) |
| **OpenTelemetry** | Vendor-neutral audit/observability | ☐ Phase 3 |
| **LangGraph / Temporal** | Production orchestration + durability | ☐ Phase 2/4 |

## Key insight

The *decision logic* (`destructive-guard.mjs`, `permissions-classifier.mjs`) is already **pure and portable** — it's spec. Only the *plumbing* (`pre-tool-use.mjs`, `settings.json`) is Claude-Code-coupled — that's the adapter. So the decoupling is mostly a **relabel + a thin seam**, not a rewrite. That's the good news of ADR-0048.
