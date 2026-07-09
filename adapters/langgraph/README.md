# LangGraph adapter

The **second** Loom adapter ([ADR-0050](../../adr/0050-second-adapter-langgraph.md)) — and the one that turns "model-agnostic" from a claim into a **fact**: it passes the *same* [`spec/conformance/`](../../spec/conformance/) suite as the Claude Code adapter, proving one spec + policy governs two architecturally different hosts.

## What it binds

`guard.mjs` reuses the portable spec evaluator (ADR-0049 — one JS evaluator serves all JS hosts) and maps each Loom decision to a **LangGraph control primitive**:

| Loom decision | LangGraph mechanism |
|---|---|
| `deny` | **block** — a conditional edge routes away from the ToolNode; the tool is not executed |
| `ask` | **`interrupt(payload)`** — pause the graph for human approval (resume via `Command({ resume })`) |
| `allow` / `none` | **proceed** — continue to the ToolNode |

`preToolGuard({ tool, input, hits })` is what a graph node calls before a tool runs; it returns `{ action, proceed, interrupt, payload, reason, decision }`.

## Dependency-free core, dependency-gated demo

- **`guard.mjs` + `guard.test.mjs`** import **nothing** from LangChain — they run in Loom's always-green suite and are the conformance proof. This keeps the template zero-dep; a downstream project adds `@langchain/langgraph` itself.
- **`example.run.mjs`** is a *live* demo: a real `StateGraph` driven by a **fake model** (no API key needed) whose proposed tool calls are governed by `preToolGuard`. It is **not** in the auto-run suite (it needs the dep). Run it with:

  ```bash
  cd adapters/langgraph
  npm install          # installs @langchain/langgraph (declared in package.json)
  node example.run.mjs
  ```

## What this adapter proves — and doesn't

- ✅ **Host-agnosticism**: the same policy governs Claude Code hooks *and* a LangGraph graph, via different enforcement seams.
- ✅ **Model-agnostic governance**: the guard sits at the tool-call seam, independent of the model — so a LangGraph graph bound to Gemini / OpenAI / Ollama (via LangChain integrations or LiteLLM) is governed identically.
- ✅ **Cross-language portability** — now proven: the Python evaluator (`adapters/python/`) reaches identical decisions from the same policy JSON (`spec/conformance/cross-language.test.mjs`, live). OPA remains the future option only if a *third* language or complex policy composition arrives (ADR-0049).

## Durable execution (ADR-0052)

`durable.mjs` runs a **checkpointer-backed** graph: when the guard returns `ask` on a destructive op, it calls the real LangGraph **`interrupt()`** (execution pauses, state **persisted**), then resumes via **`Command({ resume })`** with the human's decision — `approve` executes, `reject` skips. Verified live (`durable.test.mjs`; `node durable.run.mjs` for the demo). `MemorySaver` in the demo; a persistent saver (Sqlite/Postgres) is the drop-in for crash-recovery in production.
