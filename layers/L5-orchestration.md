# L5 — Orchestration

> **Canonical source:** §B.6 of [`../spec/loom-spec-v0.1-full.md`](../spec/loom-spec-v0.1-full.md).

---

## Pattern: Centralized (v1)

| Pattern | Loom verdict |
|---|---|
| **Centralized / Hub-Spoke** | **v1 default** — easy to debug, predictable, auditable, governable under Kernel V6 |
| Mesh / Swarm | v3 escape hatch — hard to debug; hard for Constitution Service to intercept |
| Hybrid | v2 evolution path |

## Who is the supervisor in v0.2?

> **Honest reframe per [ADR-0011](../adr/0011-claude-code-enforcement-runtime.md).** v0.1 referred to a Magentic-One "supervisor" as if it were a separate process. In practice, **the Claude Code session is the supervisor**: it reads the ledgers, dispatches to subagents (`.claude/agents/*.md` from PR-2 of v0.2), and operates the two-ledger pattern through hooks and tool calls. Magentic-One remains the cited *pattern* (Fourney et al. 2024); the *implementation* is the session + hooks + subagents.
>
> Under the model-agnostic north star ([ADR-0048](../adr/0048-north-star-model-agnostic-spec-and-adapters.md)), the supervisor loop belongs to the host runtime; a Loom *adapter* governs it from the host's pre-action seam. Claude Code is the first adapter.

## The two ledgers

| Ledger | File | Schema | Who writes |
|---|---|---|---|
| Task Ledger | [`../orchestration/task-ledger.md`](../orchestration/task-ledger.md) | `{task_id, project, agent_assigned, status, dependencies, deadline, created_at, updated_at}` | Session, on task creation; subagents on status change |
| Progress Ledger | [`../orchestration/progress-ledger.md`](../orchestration/progress-ledger.md) | `{task_id, current_step, last_action, next_action, blockers, confidence, valid_from, valid_to}` plus a v0.2 **Session log** section (`{session_id, started, ended, tool_calls, errors, note}`) written by the Stop hook | Session + Stop hook |

Both are persisted to git and replayable from the [episodic event log](../memory/event-log/), which the v0.2 hooks now populate automatically.

## Long-running task support

The system must support 35-hour autonomous task chains `[transcript][H]`:

- Heartbeat that doesn't timeout on long tasks
- User can interrupt and redirect at any time (Kernel Rule 1)
- All intermediate state recoverable from event log — v0.2 hooks populate this automatically
- Periodic checkpoints summarized to markdown — the "closing the books" pattern from `[LLM-A][H]`. In v0.2, the **Stop hook** writes one Session-log row per session as the closing-the-books artifact ([ADR-0011](../adr/0011-claude-code-enforcement-runtime.md))
- Durable execution — checkpoint / replay of long chains across process restarts — is delegated to the production host runtime, not implemented by Loom itself, per [ADR-0052](../adr/0052-production-host-durable-execution.md)

## Context engineering

> **Canonical default per [ADR-0004](../adr/0004-context-budget.md).**

The supervisor practices **just-in-time context assembly**, not preloading. Concretely, before dispatching a task to an agent the supervisor:

1. **Assembles the agent's context just-in-time** — pulls only the slices relevant to the current task from L3 memory via the retrieval pipeline ([ADR-0003](../adr/0003-retrieval-pipeline.md)); does not preload the agent's full possible context.
2. **Enforces the declared `context_budget:`** from the agent's `SKILL.md` (see [L2](./L2-agents.md#context-budget)) before dispatch. If the assembled context exceeds the budget, the supervisor must compact or re-retrieve, not dispatch.
3. **Triggers compaction for long-running tasks.** The existing "closing the books" checkpoint pattern (see *Long-running task support* above) is the compaction hook: on checkpoint, transient working context is summarized into a structured note in [`../memory/`](../memory/), and the new working context starts from the note rather than the raw history.

`[research-p1][H]` Effective context length runs 1–2 orders of magnitude below the advertised window (NoLiMa, Modarressi et al., ICML 2025). The binding constraint is allocation, not window size. Anthropic's "Effective context engineering for AI agents" (2025) names just-in-time retrieval, compaction, and structured note-taking as the core techniques — Loom adopts all three.

The Critic also performs a pre-dispatch **context admission check** ([ADR-0008](../adr/0008-context-admission-check.md)) on the assembled context.

## Deploy primitive (v0.3)

> Per [ADR-0019](../adr/0019-deploy-primitive.md).

Deployments are recurring, irreversible actions (Kernel Rule 20). Loom ships a wrapper at `scripts/deploy.{sh,ps1}` that enforces the order of operations:

1. **`loom doctor` must pass** (override with `--force`).
2. **Hook coverage check** — this session must have a `session_start` event in today's log (sanity: hooks ran).
3. **Constitution-service consultation prompt** (Y/n) — skip with `--yes`. Closes LR-02 at the deploy boundary.
4. **Run the configured deploy command** from `tools/runtime.yaml` (`deploy.command` + `deploy.args`).
5. **Record** `deployment_started` / `deployment_completed` events in the JSONL log, with exit code, duration, and extracted deployment URL.

The runtime-specific command is **not** hard-coded into Loom. It lives in `tools/runtime.yaml`, stamped at bootstrap. Project-supplied. Examples are documented in the file itself.

## Token-cost-aware orchestration

> **Added per [LR-06](../constitution/local-rules.md#lr-06) and [ADR-0037](../adr/0037-retrieval-pipeline-evidence-review.md) §D.** Token spend is irreversible (Kernel Rule 20) and must be observable (Kernel Rule 22).

### Principles

1. **Targeted over fan-out.** Prefer 2–3 focused agents with specific tasks over a broad fan-out of 10+ agents doing overlapping work. Targeted agents consistently produce better results at 10–20x lower cost than workflow fan-outs.

2. **Staged, not single-pass.** For research or exploration: run a quick scoping pass first (1–2 agents), evaluate what you have, then deep-dive only on gaps. Don't fetch 30 sources before knowing which 5 matter.

3. **Canary before fleet.** Before fanning out N agents for a repetitive task (verification, classification, analysis), run 1 agent first to validate the approach works. If the canary fails (wrong output format, tool errors, empty results), fix the approach before spending N× the tokens.

4. **Right model for the task.** Mechanical tasks (claim extraction, format validation, classification) don't require the most capable model. Use the cheapest model that produces correct output. Reserve expensive models for synthesis, reasoning, and novel problem-solving.

5. **Cross-check with data you already have.** If you've already fetched source text, verify claims by searching within that text — don't spawn new agents to re-fetch and re-read the same sources. The cheapest verification is a string match against context you already hold.

6. **Declare before you spend.** Per LR-06: every iterative LLM pattern must declare its exit condition and estimated token bound before execution. Surface the estimated cost to the architect before running expensive operations.

### Cost reference (approximate, for planning)

| Operation | Typical token cost | Typical wall-clock |
|---|---|---|
| Single targeted agent (fetch + summarize) | 15–25K tokens | 30–70s |
| 3 parallel targeted agents | 50–75K tokens | 30–70s (parallel) |
| Deep-research workflow (30 sources) | 1–1.2M tokens | 7–10 min |
| Adversarial verification (3 votes × N claims) | ~15K × N tokens | 2–5 min |
| Full research arc (workflow + targeted follow-ups) | 1.2–1.5M tokens | 10–15 min |

These numbers are from the 2026-05-31 research arc. Use them to estimate before proposing expensive operations to the architect.

## Verifier contract

> **Canonical default per [ADR-0044](../adr/0044-verifier-gates-for-agent-tasks.md).** Grounded in: DeepSeek-R1/RLVR (arXiv:2501.12948 `[H]`), Lightman et al. process rewards (arXiv:2305.20050 `[H]`), τ-bench reliability ceiling (arXiv:2406.12045 `[H]`).

Every agent task dispatched by the supervisor must declare an explicit verifier — a binary signal confirming correct completion. Tasks without verifiers compound errors silently and cannot be caught by the progress ledger.

### Verifier types (declare one in SKILL.md `verifier_type:`)

| Value | Meaning | Example |
|---|---|---|
| `exit_code` | Terminal command exits 0 on success | `collect-credentials`, any script-backed specialist |
| `schema_check` | Output conforms to a declared schema | ADR frontmatter, manifest.yaml, event-log record |
| `test_suite` | A test suite passes | `npm test`, eval-suite rubric |
| `human_gate` | A human explicitly approves before task closes | credential-setup consent protocol, consequential ADRs |
| `surrogate` | Proxy metric approximating success | Position-size ≤5% NAV, drawdown limit (trading) |

A task may declare more than one (e.g., `exit_code + human_gate`); both must pass.

### Rules

1. **Every SKILL.md must declare `verifier_type:`** in its frontmatter. `loom doctor` soft-warns on missing files (`skill-verifier-declared` check).
2. **Surrogate verifiers count** for domains where ground truth is not available at runtime. Declare the surrogate metric explicitly — an undeclared surrogate is not a verifier.
3. **Open-ended instructions without a declared verifier are a doc violation.** "Manage the portfolio" → rejected. "Review open positions, emit a recommendation, human approves" → accepted (`human_gate`).
4. **The verifier IS the exit condition** for iterative tasks, per [LR-06](../constitution/local-rules.md#lr-06). Declaring both is not redundant — they are the same concept at different levels of abstraction.

## Iterative improvement discipline

> **Grounded in:** scientific method applied to agent loops (practitioner convergence across auto-research experiments and agentic trading systems `[practitioner][M]`). Validated by fractal-search RSI experiments showing agents plateau on local optima without structural intervention (arXiv:2501.12948 §3.2 `[primary][H]`).

When an agent loop is tasked with improving a metric over multiple cycles (trading strategy, model performance, eval score, retrieval quality), apply these two rules:

### Single-variable discipline (scientific method)

**Change one parameter per cycle.** Hold everything else constant. Establish a new baseline only when the change demonstrably improves the target metric. If multiple variables change simultaneously and the metric improves, you cannot attribute the gain — and the system cannot learn from it.

- Log every cycle to a structured ledger (`memory/strategy-log/` or equivalent): what changed, what the metric was before, what it is after.
- "Baseline" is the last configuration that produced a measured improvement, not the initial configuration.
- Each SKILL.md for an iterative-improvement specialist must declare `iteration_log:` (path to the ledger) in frontmatter.

### Exploration forcing

**Every N cycles without metric improvement, force a structurally different approach.** Agents naturally exploit known-good regions of the solution space (local minimum). Without an explicit exploration budget, they will hyperfocus on fine-tuning the same algorithm indefinitely — a plateau masquerading as convergence.

| Plateau length | Required action |
|---|---|
| N = 3 cycles | Try a different hyperparameter region within the current approach |
| N = 5 cycles | Try a structurally different approach (different algorithm, different data source, different model architecture) |
| N = 10 cycles | Escalate to human — the agent has exhausted its known solution space |

The exploration budget is an **exit condition** and must be declared per [LR-06](../constitution/local-rules.md#lr-06). Example: `exit_condition: "10 cycles without improvement OR Sharpe ≥ 2.0, whichever comes first"`.

**Anti-pattern to avoid:** the agent reports "no further improvements possible" before exhausting the exploration budget. This is almost always false — it means the agent has found a local minimum, not a global one. Require explicit exploration attempts before accepting a plateau as final.

## Failure patterns to avoid

- *"A major retailer spent 18 months building a perfect system that was obsolete on launch"* — countered by incremental v0.1 → v0.2 cycles
- *"A financial services firm lost $2M due to poor state management"* — countered by event-sourced audit + bi-temporal progress ledger

---

## Open work for this layer

- [x] Wire the session-as-supervisor to populate the progress ledger via the Stop hook (v0.2, [ADR-0011](../adr/0011-claude-code-enforcement-runtime.md))
- [ ] Wire subagents to update the Task Ledger on dispatch / completion (PR-2 of v0.2)
- [ ] Implement long-running task heartbeat
- [ ] Define checkpoint cadence ("closing the books" interval) beyond once-per-session
- [ ] Wire just-in-time context assembly + `context_budget:` enforcement per [ADR-0004](../adr/0004-context-budget.md)
- [ ] Hook compaction into the checkpoint cadence (summarize → structured note → resume)
- [ ] Surface estimated cost to architect before expensive multi-agent operations per [LR-06](../constitution/local-rules.md#lr-06)
- [ ] Implement canary-before-fleet pattern for repetitive agent fan-outs
