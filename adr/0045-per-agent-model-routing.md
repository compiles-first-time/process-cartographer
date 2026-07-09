# ADR-0045: Per-agent model routing and LiteLLM proxy

**Status:** Accepted
**Date:** 2026-06-24
**Author:** Nick / Builder
**Confidence:** [H] on model-tier assignments; [M] on exact cost-reduction estimates

> **Update (2026-07-07 audit):** The Sonnet-tier ID was bumped from `claude-sonnet-4-6` (this ADR's original pin) to `claude-sonnet-5` (current generation) across the 15 Sonnet agents + LiteLLM config. The `model-id-current` doctor check proposed below to catch exactly this staleness remains **unbuilt** — recommended follow-up.

---

## Context

Loom delegates all LLM inference to the Claude Code runtime, but without explicit model selection every subagent defaults to whatever model the user has open in their Claude Code session (often Opus). This means:

1. Mechanical agents (constitution-service, hr, human-replica) use a frontier model for simple pattern-matching and CRUD operations — spending ~20× more than necessary per call.
2. No automatic fallback if a provider is unavailable.
3. Projects built on Loom that add direct API calls (LangGraph.js orchestration, custom tools) have no router to enforce provider discipline or collect per-call cost telemetry.

## Decision

### 1. Per-agent model tiers via `model:` frontmatter

Each `.claude/agents/<name>.md` file now carries a `model:` field in its YAML frontmatter. Claude Code respects this field when invoking the subagent.

| Tier | Model | Agents | Rationale |
|---|---|---|---|
| **Haiku** | claude-haiku-4-5-20251001 | constitution-service, hr, human-replica | Read-only pattern-matching, CRUD, preference lookup. Deterministic rules → no frontier reasoning needed. ~20× cheaper than Opus. |
| **Sonnet** | claude-sonnet-5 | critic, memory-keeper, auth, ci, credential-setup, db-migration, deploy, email, error-tracking, file-storage, monitoring, oauth, payments, queues, secrets | Standard engineering tasks: code generation, schema design, config wiring. Sonnet covers these reliably at ~4× lower cost than Opus. |
| **Opus** | claude-opus-4-8 | eac | Expert Agent Creator performs deep domain research, multi-source synthesis, and novel specialist design. Frontier reasoning quality is load-bearing for this agent. |

**Estimated savings:** In orchestration-heavy sessions where governance agents (constitution-service, hr) are invoked frequently, routing them to Haiku reduces per-session token cost by an estimated 30–50% relative to an all-Opus session. Actual savings depend on invocation frequency.

### 2. LiteLLM proxy for direct API code

For code that makes LLM calls directly (LangGraph.js orchestration, custom tool agents, scripts), Loom ships a LiteLLM proxy at `tools/litellm/config.yaml`. It exposes three OpenAI-compatible aliases backed by Anthropic, with OpenAI fallbacks:

- `loom-haiku` → claude-haiku-4-5 (fallback: gpt-4o-mini → loom-local)
- `loom-sonnet` → claude-sonnet-5 (fallback: gpt-4o)
- `loom-opus` → claude-opus-4-8 (fallback: o1-preview → loom-sonnet)

Endpoint: `http://localhost:4000`. Start with `scripts/router.ps1 start` (Windows) or `scripts/router.sh start`.

### 3. Prompt caching convention

Anthropic's prompt caching applies automatically to stable content. For maximum cache hit rate in agent prompts and direct API code:

- Place the system prompt + tool schemas BEFORE any dynamic content.
- Keep the static prefix stable across calls (avoid injecting session-specific IDs or timestamps at the top).
- Cache reads cost 0.1× base input (90% savings on the cached portion). This is automatic — no code change required beyond prefix stability.

## Consequences

**Positive:**
- Governance agents (constitution-service, hr, human-replica) on Haiku — estimated 30–50% cost reduction for orchestration-heavy sessions.
- EAC retains Opus quality where it matters most.
- LiteLLM proxy provides provider fallbacks, per-call cost logging, and a clean abstraction for all future direct API code.

**Constraint — model ID staleness:** Model strings are pinned to current identifiers (e.g., `claude-haiku-4-5-20251001`). These must be validated at `loom init` time and updated when new model generations release. A future `loom doctor` check (`model-id-current`) should automate this validation. See L4 open work.

**Constraint — LiteLLM requires Docker:** A no-Docker alternative is available (`pip install litellm && litellm --config tools/litellm/config.yaml`), documented in `scripts/router.ps1` and `scripts/router.sh`.

## Evidence basis

- **Primary:** Anthropic prompt caching documentation (docs.anthropic.com/en/docs/build-with-claude/prompt-caching, 2025) — cache reads at 0.1× base input cost (90% reduction), cache writes 1.25×/2× for 5-min/1-hour TTL; designed explicitly for agentic tool-definition reuse. `[primary][H]`
- **Primary:** arXiv 2601.06007 (Lam et al., 2025) — prompt caching reduces total API cost 41–80% on long-horizon agentic tasks; TTFT improvement 13–31% across providers. `[primary][H]`
- **Primary:** LiteLLM documentation (litellm.ai/docs, 2025) — MIT-licensed proxy with 100+ provider support, cost tracking, fallback chains, Docker deployment. `[primary][H]`
- **Corroborating:** Model pricing differentials (Anthropic console, 2026-06-25) — Haiku input/output costs approximately 20× cheaper than Opus per token; Sonnet approximately 4× cheaper. `[primary][H]`
- **Supporting:** RouteLLM (arXiv:2406.18665, LMSYS 2024) — automatic complexity routing achieves ~40% cost reduction at negligible quality loss on benchmark tasks. Deferred pending GPU availability and call-volume training data. `[primary][M]`
- **Supporting:** LLMLingua-2 (arXiv:2403.12968, Microsoft 2024) — 20× compression at ~1.5-point performance loss on downstream tasks; 5–10× compression near-lossless. `[primary][M]`
- **What would change this call:** Evidence that Haiku quality is insufficient for governance agents (constitution-service misclassifying rule violations) would require upgrading those agents to Sonnet. Monitor via `loom doctor` `constitution-coverage` check.

## Affects / Affected by

**This ADR affects:**
- [`layers/L4-tooling.md`](../layers/L4-tooling.md) — two new sections: per-agent model tiers + LiteLLM proxy
- [`scripts/lib/doctor.mjs`](../scripts/lib/doctor.mjs) — new `checkAgentModelTiers` soft check
- `.claude/agents/*.md` (19 files) — `model:` frontmatter field added to each

**This ADR is affected by:**
- [ADR-0012](./0012-base-subagents.md) — base subagent definitions; model tier follows from each agent's declared role
- [ADR-0015](./0015-loom-doctor.md) — loom doctor extension protocol; new check follows the soft-warning convention
- [LR-06](../constitution/local-rules.md#lr-06) — token-cost awareness; per-agent tiers are the operational implementation
- [ADR-0044](./0044-verifier-gates-for-agent-tasks.md) — verifier gates; `checkAgentModelTiers` follows the same soft-check pattern as `checkSkillVerifiers`

## References

- [ADR-0045 implementation commit](https://github.com/compiles-first-time/loom-template/commit/be20029)
- [`tools/litellm/config.yaml`](../tools/litellm/config.yaml) — LiteLLM proxy configuration
- [`scripts/router.ps1`](../scripts/router.ps1) / [`scripts/router.sh`](../scripts/router.sh) — start/stop wrapper

## Alternatives considered

- **RouteLLM automatic complexity routing:** rejected for v1 — requires GPU inference for the routing classifier and Loom-specific training data. Revisit after accumulating ≥1,000 call samples and validating routing accuracy on the observed prompt distribution.
- **LLMLingua prompt compression:** deferred — Loom has no direct API call sites yet. Wire as LiteLLM middleware when LangGraph.js orchestration is implemented; verified savings at 5–10× compression with negligible quality loss.
- **Anthropic Batch API for async tasks:** deferred — 50% cost reduction for 24-hour SLA work. Wire when background tasks are identified (progress-ledger summaries, lessons-learned generation, eval-suite runs).
- **All agents on Sonnet:** valid intermediate option; Haiku assignment for governance agents was chosen because their tasks are provably mechanical (rule lookup + pattern match) with low failure-mode impact from model quality reduction.
