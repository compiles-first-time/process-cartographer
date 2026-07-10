# Proposal: a shared Lessons-Learned Service for Loom

> **Status:** Draft proposal (for adoption as a `loom-template` ADR). Authored in process-cartographer during Phase-1; carry it to loom-template.
> **Author:** Builder (Opus 4.8), from Nick's idea, 2026-07-10.
> **Relates to:** ADR-0037 (retrieval pipeline evidence review), L3 (memory architecture), L7 (Update Bus / self-extension), Kernel Rule 22 (provenance), LR-05 (supersedability).

## Problem

Today every Loom project carries a **full copy** of `lessons-learned/` (inherited from the template + whatever it authors). This doesn't scale:

- **Redundant & stale.** The same lesson lives in N repos; a fix in one doesn't reach the others. Copies drift.
- **Unshared discoveries.** A lesson learned in project A (e.g. a Windows PowerShell portability bug) is invisible to project B unless a human manually copies it over.
- **No relevance filter.** A new project inherits *all* lessons, most irrelevant to its stack — noise in context and on disk.
- **No on-demand recall.** When an agent hits an unknown, it can only search what's already local; it can't ask "has anyone, in any Loom project, hit this before?"

## Goals

1. **One canonical, versioned, auditable store** of lessons across all Loom projects.
2. **Pull-what-you-need:** a new project fetches only the lessons relevant to its profile (stack, platform, compliance, domain), not everything.
3. **Push-back:** projects add/update lessons and contribute them to the shared store, with quality + dedup gates.
4. **On-demand semantic recall:** any agent/LLM can query the *full* store (beyond its local cache) when it needs info it doesn't have, and materialize a hit locally.
5. **Offline-capable & provenance-preserving:** works without network (cached), every lesson keeps its source + confidence (Rule 22), and lessons are superseded, never silently deleted (LR-05).

## Non-goals (v1)

- Not a general knowledge base for arbitrary docs — scoped to *lessons* (failure → fix, with provenance).
- Not real-time multi-writer sync — contributions are reviewed, batched (PR/Update-Bus cadence).
- Not a replacement for project-local `lessons-learned/` for *project-specific* lessons that shouldn't be shared (those stay local, `share: false`).

## Architecture (two layers + a thin client)

```
        ┌─────────────────────────── Canonical store ───────────────────────────┐
        │  Git repo  loom-lessons/  (or a table)                                  │
        │  - one Markdown file per lesson, standardized frontmatter (below)       │
        │  - PR-reviewed; full history; the source of truth; clone-able offline   │
        └───────────────▲───────────────────────────────────────┬───────────────┘
                        │ ingest on merge                        │ pull (git / API)
        ┌───────────────┴───────────── Index layer ─────────────▼───────────────┐
        │  Vector + metadata index (pgvector / sqlite-vss / hosted)               │
        │  - embedding per lesson (title+body+tags)                               │
        │  - metadata: tags, stack, platform, domain, severity, upstream, dates   │
        │  - prebuilt index artifact downloadable for offline semantic search     │
        └───────────────▲───────────────────────────────────────┬───────────────┘
                        │ search / pull                          │ push (propose)
        ┌───────────────┴──────────────── Client ───────────────▼───────────────┐
        │  `loom lessons` CLI (in every project's scripts/)                       │
        │  pull · search · add · update · push · sync                             │
        │  local cache: lessons-learned/_cache/ (gitignored) + an index shard     │
        └─────────────────────────────────────────────────────────────────────────┘
```

**Why git as canonical + a separate index:** git gives auditability, PR review, full history, and offline clones for free (matches how Loom already treats spec-as-codebase). The index is a *derived*, rebuildable artifact for fast semantic recall — never the source of truth. This mirrors ADR-0037's retrieval discipline (hybrid search + rerank + confidence gating) rather than inventing a new one.

## Lesson schema (standardize the existing format so it's ingestable)

```yaml
---
id: 2026-07-08-bootstrap-ps1-getdate-asutc-ps51   # stable, unique
title: bootstrap.ps1 crashes on Windows PowerShell 5.1 (Get-Date -AsUTC)
domain: [tooling, windows, powershell]             # for relevance filtering
stack: [powershell, node]                          # applicable stacks
platform: [win32]
severity: medium
share: true                                        # false = stays project-local
supersedes: null                                   # or a prior lesson id (LR-05)
provenance:                                         # Rule 22
  origin_project: process-cartographer
  sources: ["PS 5.1 ParameterBindingException", "..."]
  confidence: 0.98
created: 2026-07-08
updated: 2026-07-08
embedding_hash: <sha of embedded text>             # detect re-embed need
---
# What happened / Why / What we did / What we'd do differently / Related
```

The existing `lessons-learned/*.md` files are ~90% there already (they have date/agent/severity/share and the What-happened/Why/Fix sections). Adding `id`, `domain`, `stack`, `platform`, and structured `provenance` makes them DB-ready.

## Flows

- **`loom lessons pull`** (on bootstrap / on demand): reads the project's discovery profile (`discovery/quick-scan.md` → project_type, stack, platform, compliance) and fetches the top-relevant lessons (metadata filter + vector similarity to the profile) into `lessons-learned/_cache/`. This is "pull what it likely needs."
- **`loom lessons search "<query>"`** (agent hits an unknown): semantic + keyword search over the **full** index (not just the local cache), returns ranked hits with provenance + confidence; `loom lessons pull <id>` materializes a hit locally. This is the "scan if the info exists that I didn't download" flow. An MCP tool wrapper lets subagents call it directly.
- **`loom lessons add` / `update`**: author locally (normal `lessons-learned/` authoring), tagged `share: true`.
- **`loom lessons push`**: proposes local shareable lessons to the canonical store. Before submission:
  - **Dedup / supersede gate:** embed the new lesson, find nearest neighbors in the index; if similarity > threshold, prompt to **update/supersede** the existing lesson instead of adding a duplicate (kills the "500 copies of the same lesson" problem).
  - **Critic gate:** the `critic` reviews the lesson for provenance, confidence-vs-evidence, and that it's genuinely a shared (not project-secret) lesson.
  - Submission = a PR to `loom-lessons/` (or an Update-Bus item), which on merge re-embeds + updates the index.

## Governance, security, provenance

- **Rule 22:** every lesson keeps `provenance` (origin project, sources, confidence). Retrieval surfaces it so consumers can weigh trust.
- **LR-05 supersedability:** `update`/`supersede` never deletes; history stays in git.
- **Secret hygiene:** `push` runs the existing `secrets-doctor` / redaction over the lesson body; `share: false` keeps project-specific lessons local. Never ship connection strings, tenant names, or creds into the shared store.
- **Human-in-the-loop:** contributions are reviewed (PR/critic), not auto-merged — consistent with Loom's consent-based self-modification (Rule 19) and the Update Bus (L7).

## Phased rollout

- **Phase 0 (now, zero-infra):** standardize the frontmatter schema in loom-template's `lessons-learned/`; add `id`/`domain`/`stack`/`platform`. Ship a `loom lessons search` that works over the **local** files (regex + optional local embeddings). No service yet — just the schema + CLI shape.
- **Phase 1 (canonical store):** create the `loom-lessons` git repo as source of truth. `pull` = sparse-fetch relevant files by metadata. Build a downloadable **prebuilt local index** (sqlite + embeddings) so `search` is offline + fast. `push` = open a PR.
- **Phase 2 (hosted index + on-demand):** stand up a small service (Supabase pgvector — Loom already has a Supabase specialist) fronting the index; `search`/`pull` hit it live; an **MCP tool** exposes `lessons.search`/`lessons.pull` so any subagent recalls on demand. `push` still PR-gated.
- **Phase 3 (auto-contribution):** on a project's `Stop`/handoff, auto-detect newly-authored `share: true` lessons and open the contribution PR automatically (the "automatically pushes lessons to a DB" ask), still landing in a review queue.

## Open questions

1. **Canonical home:** a dedicated `loom-lessons` repo, or a directory in `loom-template`? (Dedicated repo scales better; template dir is simpler to start.)
2. **Embedding model + dimensions**, and whether to pin a local model for offline `search` vs a hosted one for freshness.
3. **Relevance for `pull`:** profile-vector similarity vs explicit tag rules vs both. Start with tag rules + similarity re-rank.
4. **Dedup threshold** and the update-vs-new UX.
5. **Trust weighting:** should lessons from projects with better verifier/reputation scores (ADR-0053) rank higher?
6. **Multi-tenant privacy** if Loom is ever used across orgs — namespacing / visibility scopes on the shared store.

## Why this fits Loom

It's the L3 memory architecture + ADR-0037 retrieval pipeline applied to the *cross-project* tier, propagated via the L7 Update Bus, gated by the critic, and honoring Rule 22 + LR-05. It turns lessons-learned from per-repo dead weight into a living, queryable, shared asset — which is exactly what makes a fleet of Loom projects compound in capability instead of each relearning the same bugs.
