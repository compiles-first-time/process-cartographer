# `spec/` — Loom's portable, runtime-neutral core

Per [ADR-0048](../adr/0048-north-star-model-agnostic-spec-and-adapters.md). This is the part of Loom that is **model- and host-agnostic**: it must run identically whether the host is Claude Code, a LangGraph app, or a raw Gemini/Ollama loop.

## What belongs here

- **Policy** — the constitution, permission categories, and BR enforcement tiers, expressed as *data + pure functions* (see [`policy/`](./policy/)).
- **Schemas** — the requirements/exceptions test-case schema (ADR-0046), the event schema, ticket schema.
- **Conventions** — memory tiers, RAG pipeline, eval discipline.

## The one hard rule

> **Nothing in `spec/` may import a host SDK or assume a runtime.** Pure data and pure functions only. If it needs a hook, a `permissionDecision` format, a Claude subagent, or an OTel exporter — it belongs in an **adapter**, not here.

This is what makes the spec portable: an adapter *calls* the spec; the spec never *knows* which adapter called it.

## Transitional note

For now, some portable artifacts still physically live at their historical paths (e.g. `constitution/`, `.claude/loom-permissions.yaml`, `scripts/lib/destructive-guard.mjs`). [`MANIFEST.md`](./MANIFEST.md) is the source of truth for what is *logically* spec vs adapter until the physical relocation tasks (roadmap `OB-P1-*`) run. Relocation is deferred deliberately — moving live-wired files (hooks, settings) would break the Claude Code adapter.
