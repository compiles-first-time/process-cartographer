# L4 — Tooling Layer

> **Canonical source:** §B.5 of [`../spec/loom-spec-v0.1-full.md`](../spec/loom-spec-v0.1-full.md).

---

## Four-protocol stack

| Protocol | Purpose | Loom priority |
|---|---|---|
| **MCP** (Model Context Protocol) | Tool/data access | **v1 — required** |
| **A2A** (Agent-to-Agent) | Delegation between autonomous agents | v2 — defer until multi-process |
| **ACP** (Agent Communication Protocol) | Lightweight REST-based agent messaging | v2 — defer until in-process IPC is a bottleneck |
| **UCP** (Universal Commerce Protocol) | Agent-to-agent payments | v3 — defer |

`[base][H]` MCP is genuinely production-grade. Other protocols carry weaker evidence; see [§E.3 of the spec](../spec/loom-spec-v0.1-full.md).

## MCP server roster

Configured in [`../tools/mcp-servers/config.yaml`](../tools/mcp-servers/config.yaml). Default Loom set:

| Server | Purpose | Required? |
|---|---|---|
| filesystem | Read/write project files | Yes |
| git | Repository operations | Yes |
| web-search | Web research | Yes |
| database | Project state DB ops | Yes |
| chat-gateway | Telegram/Slack/Signal user interface | Yes |
| github | Code review, issue tracking | Recommended |
| project-specific | Figma, Stripe, Salesforce, etc. | As needed |

## Orchestration framework selection

| Framework | Verdict |
|---|---|
| **LangGraph.js** | **v1 default** — most established TS option |
| Mastra | Watch — promising but immature |
| OpenAI Agents SDK TS | Avoid as primary — vendor-locked |

This decision is itself an ADR. Revisable; see [`../adr/0002-orchestration-framework.md`](../adr/0002-orchestration-framework.md).

## LLM provider routing

> Model identifiers below are **role-based**, not version-pinned. Concrete model strings (`claude-...`, `gpt-...`, `gemini-...`) are stale within months and must be validated at `loom init` time, not hardcoded in the spec.

| Role | Provider | Use case |
|---|---|---|
| Frontier reasoning model | Anthropic (Claude family) | Default — complex tasks, coding, document synthesis |
| Fallback reasoning model | OpenAI | When the primary provider is rate-limited or unavailable |
| Long-context model | Google (Gemini family) | Long-context — **but see the effective-context caveat below** |
| Local model | Open-weights, consumer GPU (Llama / Qwen family) | Embeddings, guardrails, sensitive data |

**Effective-context caveat `[research-p1][H]` (per [ADR-0005](../adr/0005-effective-context-routing.md)):** advertised context windows are **not** effective windows. Effective length can be 1–2 orders of magnitude smaller on hard retrieval (NoLiMa, Modarressi et al., ICML 2025 — e.g., a 200K-window model reliably retrieves only ~4K tokens on lexical-overlap-free tasks; a 2M-window model only ~2K). The earlier "Gemini degrades ~800K" claim from a podcast was imprecise and is superseded by this finding.

**Routing rule:** if a task's required context exceeds the effective budget for the chosen model, route it through the L3 retrieval pipeline (chunk → retrieve → rerank → assemble, [ADR-0003](../adr/0003-retrieval-pipeline.md)). **Do not** "solve" oversized context by selecting a larger-window model — that is the silent-failure path.

**Critical:** All routing decisions logged. No model grades its own output (information-theoretic collapse — `[LLM-A][H]`).

## Per-agent model tiers (v0.4, ADR-0045)

> Model IDs must be validated at `loom init` — they are stale within months. See open work below.

Each base agent and specialist carries a `model:` field in its `.claude/agents/<name>.md` frontmatter. Claude Code routes subagent invocations to the declared tier automatically.

| Tier | Model | Agents |
|---|---|---|
| **Haiku** | claude-haiku-4-5 | constitution-service, hr, human-replica |
| **Sonnet** | claude-sonnet-5 | critic, memory-keeper, all 12 specialists |
| **Opus** | claude-opus-4-8 | eac |

Governance agents (constitution-service, hr) perform rule lookup and CRUD — Haiku is sufficient and ~20× cheaper than Opus per token. Specialists do focused engineering work — Sonnet handles these reliably. EAC requires frontier reasoning for deep domain synthesis — Opus only. See [ADR-0045](../adr/0045-per-agent-model-routing.md).

## LiteLLM proxy (v0.4, ADR-0045)

For code that calls LLMs directly (LangGraph.js orchestration, custom tools), route through the Loom LiteLLM proxy at `http://localhost:4000`. Configuration: [`../tools/litellm/config.yaml`](../tools/litellm/config.yaml).

| Alias | Primary | Fallback chain |
|---|---|---|
| `loom-haiku` | claude-haiku-4-5 | gpt-4o-mini → loom-local |
| `loom-sonnet` | claude-sonnet-5 | gpt-4o |
| `loom-opus` | claude-opus-4-8 | o1-preview → loom-sonnet |

**Start:** `scripts/router.ps1 start` (Windows) or `scripts/router.sh start` (Linux/macOS).

**Prompt caching convention:** Place the system prompt and tool schemas before any dynamic content. Anthropic caches the static prefix automatically — cache reads cost 0.1× base input (90% savings on that portion). No code changes needed beyond prefix stability.

**Deferred (implement when direct API call sites exist):**
- **LLMLingua compression** — 5–10× document compression via `pip install llmlingua`; wire as LiteLLM middleware. Negligible quality loss at ≤10×.
- **Anthropic Batch API** — 50% cost reduction for async 24-hour-SLA tasks (progress-ledger summaries, lessons-learned, eval-suite runs).
- **RouteLLM** — automatic complexity-based routing (Haiku vs Opus) via a trained classifier. Requires GPU + ≥1,000 call samples to calibrate; revisit post-production.

## Credential-source hierarchy (v0.6)

> Per [LR-04](../constitution/local-rules.md#lr-04--permissions-protocol-meta-rule-subsuming-lr-02--lr-03) + [ADR-0028](../adr/0028-oauth-preference.md).

When a service offers multiple authentication methods, Loom recommends:

| Tier | Mechanism | Rationale |
|---|---|---|
| 1 | **OAuth / OIDC / SSO** (provider-issued, short-lived, scoped) | Smallest credential scope; auto-rotating; revocable per device |
| 2 | **Project-scoped + expiring** API tokens | Long-lived but narrow scope + finite lifetime |
| 3 | **User-scoped** API tokens / PATs | Long-lived + broad scope — preferred only when 1+2 aren't available |
| Avoid | **Username + password** for service access | Single-factor; account-takeover impact |

Service-specific recommendations (Loom's OAuth-preference detector flags long-lived keys when an OAuth alternative exists):

| Service | Long-lived (avoid where possible) | Recommended (OAuth / scoped) |
|---|---|---|
| GitHub | Classic PAT `ghp_*` | `gh auth login` (OAuth device flow); GitHub App installation tokens |
| Google Cloud | Service-account JSON key | `gcloud auth application-default login`; Workload Identity Federation |
| AWS | IAM access key `AKIA*` | `aws configure sso` (IAM Identity Center); IRSA / STS short-lived creds |
| Vercel | User-scoped token | Project-scoped + expiring access token |
| npm | Classic publish token | Granular access token; OIDC trusted publishing from CI |

The detector at [`../scripts/lib/oauth-preference.mjs`](../scripts/lib/oauth-preference.mjs) surfaces `oauth_preference_hint` events in the event log when a long-lived pattern appears in tool args. `scripts/secrets-doctor.{sh,ps1}` also reports OAuth-preference findings retrospectively.

## MCP-over-CLI for credentialed services

> Per [LR-03](../constitution/local-rules.md#lr-03-secrets-must-not-appear-in-chat-input-or-tool-output) / [ADR-0018](../adr/0018-secrets-handling.md).

When a service offers both a CLI and an MCP server (Supabase, Vercel, GitHub, Linear, Slack, etc.), **prefer the MCP server**. The credential lives in MCP config (env var or secrets-manager reference) and never reaches the tool args captured in the event log. A CLI invocation like `supabase --service-key=eyJ...` leaks the credential into `memory/event-log/YYYY-MM-DD.jsonl` even with the v0.3 redaction layer (high-confidence patterns are redacted, but novel token shapes can slip through).

Concrete guidance:

| Service | Prefer | Avoid |
|---|---|---|
| Supabase | `mcp__supabase__*` tools | `supabase --service-key=...` on the CLI |
| Vercel | `mcp__vercel__*` tools | `vercel --token=...` on the CLI |
| GitHub | `mcp__github__*` tools | `gh` with `GH_TOKEN` inlined in the command |
| Linear, Slack, etc. | corresponding MCP server | CLI with inline credentials |

This is **not** a ban on CLIs — they're fine when no MCP server exists, or when the CLI reads its credential from an env var sourced outside the chat (`.env`, OS keyring, secrets manager). The rule is: **the credential value must not appear in a tool call's args**.

## Capability matrix for (platform, action) tuples (v0.3.2)

> Per [ADR-0033](../adr/0033-mcp-vs-cli-capability-matrix.md). Authoritative reference at [`../tools/mcp-cli-capability-matrix.md`](../tools/mcp-cli-capability-matrix.md).

The MCP-over-CLI guidance above optimizes for credential hygiene. The matrix at [`../tools/mcp-cli-capability-matrix.md`](../tools/mcp-cli-capability-matrix.md) covers the **prior** axis: capability — does the chosen surface actually complete the action end-to-end? Some MCPs delegate back to their CLI (no credential-hygiene benefit; observed on Vercel MCP per AnonForum 2026-05-21); some actions are entirely browser-gated (billing changes, account verification); some platforms have no MCP at all.

Specialists consult the matrix before picking a tool. The decision algorithm:

1. **Capability**: prefer the surface that completes the action end-to-end. If only one does, pick that.
2. **Credential hygiene** (this section): when both are capable, prefer MCP.
3. **Cost** (per [ADR-0032 §B](../adr/0032-deployment-hardening.md)): a billable action's `pre_flight_quota_check` event fires regardless of surface.

When the matrix lacks a row, the specialist notes the gap in its return and proposes adding the row (architect-approved follow-up PR per ADR-0033 §D maintenance policy).

---

## Open work for this layer

- [ ] Populate [`../tools/mcp-servers/config.yaml`](../tools/mcp-servers/config.yaml) for this project
- [ ] Confirm orchestration framework choice in [`../adr/0002-orchestration-framework.md`](../adr/0002-orchestration-framework.md)
- [ ] Set provider API keys via env vars (never commit secrets)
- [ ] Validate concrete model identifiers (Claude / GPT / Gemini / local) against current vendor catalogs at `loom init`; do not rely on the role-based names above as version strings
- [ ] Record per-model effective-context multipliers used by the router (per [ADR-0005](../adr/0005-effective-context-routing.md))
- [ ] Add `loom doctor` check `model-id-current` — flag agent files whose `model:` value is no longer a current release identifier (per ADR-0045 consequences)
- [ ] Wire LLMLingua as LiteLLM middleware when LangGraph.js orchestration is implemented
- [ ] Wire Anthropic Batch API for async tasks once call sites are identified (eval-suite, ledger summaries)
