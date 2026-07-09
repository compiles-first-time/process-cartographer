# L1 — Project Skeleton (Spec-as-Codebase)

> **Canonical source:** §B.2 of [`../spec/loom-spec-v0.1-full.md`](../spec/loom-spec-v0.1-full.md).

---

## Purpose

Every Loom project is documented as a **hierarchical directory of small specs**, not a single monolithic document. This is the dataflow boundary between the Architect role (chat-Claude integrating external input) and the Builder role (Claude Code operating on the filesystem).

Empirical motivation: Liu et al. (2024) "Lost in the Middle" — LLMs degrade in recall on long contexts. Asai et al. (2023) "Self-RAG" — modular retrieval outperforms monolithic context loading.

## Project root layout

```
.
├── CLAUDE.md                 # Primary index (≤ 10 KB)
├── AGENTS.md                 # Agent roster (≤ 5 KB)
├── loom-spec.md              # Executive view of the canonical spec
├── spec/                     # Full canonical spec + supporting docs
├── constitution/             # L0
├── layers/                   # L0–L7 layer specs (this directory)
├── agents/                   # L2
├── memory/                   # L3
├── tools/                    # L4
├── orchestration/            # L5
├── observability/            # L6
├── adr/                      # Architecture Decision Records
├── lessons-learned/          # Failure-avoidance events
├── update-bus/               # L7
└── scripts/                  # Bootstrap helpers
```

## Size discipline (mandatory)

| File | Hard cap | Why |
|---|---|---|
| `CLAUDE.md` | ~10 KB | Read every session; must stay small |
| `AGENTS.md` | ~5 KB | Same |
| Per-layer spec | ~15 KB | Loaded on demand; can be larger |
| Per-agent SKILL.md | ~10 KB | Loaded when agent is invoked |

If a file grows past the cap, refactor — split into sub-files or hoist to a layer spec.

## Architecture Decision Records (ADRs)

Every consequential architectural choice gets an ADR. See the template at [`../adr/0000-template.md`](../adr/0000-template.md). ADRs are the atomic unit of the Update Bus (see [L7](./L7-extension.md)).

## What goes in `lessons-learned/`

Append-only record of failures and their resolutions. One file per lesson. Format described in [`../lessons-learned/README.md`](../lessons-learned/README.md).

---

## Open work for this layer

- [ ] Confirm directory layout matches your tooling expectations
- [ ] Review the size caps — relax for projects with unusual needs
