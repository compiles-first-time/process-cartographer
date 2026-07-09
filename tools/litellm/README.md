# Loom LLM Router (LiteLLM)

An OpenAI-compatible proxy at `http://localhost:4000` that routes to three cost tiers.
See [ADR-0045](../../adr/0045-per-agent-model-routing.md) and [L4-tooling.md](../../layers/L4-tooling.md).

## Quick start

**With Docker (recommended):**
```
scripts\router.ps1 start        # Windows
scripts/router.sh start         # Linux / macOS
```

**Without Docker:**
```
pip install litellm
litellm --config tools/litellm/config.yaml --port 4000
```

## Model aliases

| Alias | Default model | Use for |
|---|---|---|
| `loom-haiku` | claude-haiku-4-5 | Mechanical tasks, classification, CRUD |
| `loom-sonnet` | claude-sonnet-5 | Standard code generation, engineering tasks |
| `loom-opus` | claude-opus-4-8 | Deep research, synthesis, complex reasoning |

Fallback chains are defined in `config.yaml` — Anthropic → OpenAI → local Ollama.

## Example call

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.LITELLM_MASTER_KEY ?? "sk-loom-dev",
  baseURL: "http://localhost:4000",
});

const response = await client.chat.completions.create({
  model: "loom-sonnet",
  messages: [{ role: "user", content: "Hello" }],
});
```

## Prompt caching

When calling `loom-haiku/sonnet/opus`, structure requests so the system prompt
and tool schemas come **before** any dynamic content. Anthropic caches the static
prefix automatically — cache reads cost 0.1× base input (90% savings on that
portion). No code change needed beyond prefix stability.

## Enabling observability

Uncomment the Langfuse lines in `config.yaml` and set `LANGFUSE_PUBLIC_KEY` /
`LANGFUSE_SECRET_KEY` in `.env` to trace every call through the proxy.
