# ADR-0041: Update Bus → Observatory integration

**Status:** Accepted (Nick, 2026-07-07 — Observatory shipped & operational)
**Date:** 2026-06-04
**Author:** Builder — proposed to Nick
**Confidence:** [M]

## Context

The Update Bus (ADR-0016) defines an inbox-based approval pipeline: proposals arrive as markdown files with YAML frontmatter in `update-bus/inbox/`, flow through Critic review and Human Replica recommendation, then await user decision. The Observatory (ADR-0039) renders these proposals in its Update Bus panel with Accept/Reject buttons, but the decision endpoint is currently a stub that acknowledges without writing back.

Two integration gaps exist:

1. **Inbound:** The observatory watches `update-bus/inbox/` for file changes but doesn't parse inbox items into the `update_bus` projection on startup or on file change.
2. **Outbound:** The `POST /api/update-bus/:id/decision` endpoint returns a stub response instead of writing the `user_decision` sub-object back to the inbox file.

This ADR closes both gaps, completing the observatory's role as the user-facing terminal for the Update Bus pipeline.

## Decision

### Inbound: inbox file parsing

On startup replay and on `file_changed` events for `update-bus/inbox/*.md` files, the observatory parses each inbox item's YAML frontmatter and populates the `update_bus.inbox` projection (schema per ADR-0040 §8).

**Parsing contract:**

1. Read all `.md` files in `update-bus/inbox/`.
2. Extract YAML frontmatter (between `---` delimiters).
3. Map frontmatter fields to the `update_bus.inbox` item schema. Fields not present in frontmatter default to `null`.
4. The `id` field is the filename stem (e.g., `add-caching-layer-a1b2.md` → `add-caching-layer-a1b2`).
5. Items with a `user_decision` sub-object where `verdict` is `approve` or `reject` are excluded from the inbox (they've been decided). Archive handling is out of scope — decided items move to `update-bus/archive/` via the Update Bus tick script.

**File-watch behavior:** When `fs.watch` fires for the inbox directory, the aggregator re-reads all inbox files and replaces the `update_bus.inbox` array. This is a full rebuild, not a diff — acceptable given the expected inbox size (single-digit items).

### Outbound: decision write-back

When the user clicks Accept or Reject in the observatory UI:

1. `POST /api/update-bus/:id/decision` receives `{ verdict, decided_by, note }`.
2. The server reads the inbox file at `update-bus/inbox/<id>.md`.
3. It parses the YAML frontmatter, adds or replaces the `user_decision` sub-object:
   ```yaml
   user_decision:
     verdict: approve | reject | defer
     decided_at: <ISO-8601 now>
     decided_by: <from request body>
     note: <from request body>
   ```
4. It writes the updated file back to disk.
5. The `fs.watch` on the inbox directory fires, triggering a projection rebuild that removes the decided item from the active inbox.
6. The endpoint returns `{ status: "recorded", id, verdict }`.

**Error cases:**
- File not found → `404 { error: "Inbox item not found" }`.
- Malformed frontmatter → `500 { error: "Failed to parse inbox item" }`.
- File already has a `user_decision` → overwrites (user may change their mind before the tick script archives).

### Write-path justification

This is the observatory's only write path (per ADR-0039 §Write paths). The write is:
- **User-initiated** — requires an explicit button click + confirmation dialog.
- **Scoped** — only modifies a single field (`user_decision`) in a single file.
- **Auditable** — the file diff is visible in `git diff` and the decision timestamp provides provenance.
- **Consistent with Kernel Rule 19** — self-modification only via transparent, consent-based process.

### SSE notification

After a decision write-back, the normal `file_changed` → projection rebuild → SSE `delta` flow notifies all connected clients. No special SSE event type is needed.

## Evidence basis

- **Primary:** The Update Bus schema at `update-bus/schema.json` (ADR-0016) defines the `user_decision` sub-object shape. The observatory's file-watch mechanism (ADR-0039) is proven for JSONL tailing; extending it to YAML frontmatter parsing is a bounded addition. `[base][H]`
- **Corroborating:** The L7 pipeline (§Update Bus flow) explicitly defines the user decision as the terminal step before archival. The observatory is the designated UI surface for this decision. `[base][M]`
- **What would change this call:** If the Update Bus moves to a database or API backend instead of filesystem-based inbox, the file-watch + YAML parsing approach would need replacement. However, ADR-0016 commits to the filesystem model for v0.2–v0.3.

## Consequences

**Locks in:**
- Filesystem-based read/write for Update Bus integration (aligned with ADR-0016).
- YAML frontmatter as the inbox item format (aligned with `update-bus/README.md`).
- Full rebuild on file-watch events (not incremental diff).

**Locks out:**
- Real-time collaborative decision-making (the observatory is localhost-only per ADR-0039; multi-user would require a separate ADR with auth).

**Migration path:** If a future ADR introduces an API-based Update Bus backend, the observatory's inbound parsing swaps from file-read to API-fetch; the outbound write-back swaps from file-write to API-POST. The projection schema (ADR-0040 §8) remains unchanged.

## Alternatives considered

1. **Polling instead of file-watch** — Poll inbox directory every N seconds. Rejected: `fs.watch` is already proven in the observatory for JSONL; polling adds latency and complexity for no benefit.
2. **Separate decision log file** — Write decisions to `update-bus/decisions.jsonl` instead of modifying inbox files. Rejected: the schema already has `user_decision` as a sub-object on the inbox item; splitting it creates schema divergence and complicates the tick script's archive logic.
3. **No write-back from observatory** — Keep the stub, require users to edit inbox files manually. Rejected: defeats the purpose of the dashboard UI. The Accept/Reject buttons are the primary value proposition of the Update Bus panel.

## Affects / Affected by

**This ADR affects:**
- `observatory/lib/aggregator.mjs` — adds inbox file parsing to projection population
- `observatory/lib/router.mjs` — replaces stub decision handler with file write-back
- `observatory/server.mjs` — passes inbox directory path to aggregator for startup parsing
- `update-bus/inbox/` — files are modified by the decision write-back

**This ADR is affected by:**
- ADR-0016 — Update Bus schema (defines inbox item shape and `user_decision` sub-object)
- ADR-0039 — Observatory architecture (defines the write-path constraint and file-watch mechanism)
- ADR-0040 — Projection schemas (defines the `update_bus` projection shape this integration populates)
- L7 — Self-extension layer (defines the Update Bus pipeline this completes)
- Kernel Rule 19 — Self-modification constraint (write-back must be user-initiated)

## References

- [ADR-0039: Observatory architecture](./0039-observatory-architecture.md)
- [ADR-0040: Observatory projection schemas](./0040-observatory-projection-schemas.md)
- [ADR-0016: Update Bus stub](./0016-update-bus-stub.md)
- [update-bus/schema.json](../update-bus/schema.json)
- [update-bus/README.md](../update-bus/README.md)
- [L7-extension.md](../layers/L7-extension.md)
