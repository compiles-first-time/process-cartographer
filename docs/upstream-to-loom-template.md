# Upstream to loom-template — findings from the Phase-1 build (process-cartographer)

> **Purpose:** a single carry-over doc. process-cartographer was built as Loom's Phase-1 proof vehicle. These are the framework-level lessons/fixes discovered here that belong back in `loom-template` — do **not** edit loom-template from this repo; bring these over (as PRs / Update-Bus items) in the loom-template repo itself.
>
> Each item links the full lesson under `lessons-learned/`. Verdict on Phase-1: **the governed discipline held** on a novel, non-web project (doctor green throughout, discovery authored + critic-reviewed, an EAC specialist authored for a brand-new domain, Loom's own suite 420/420). These are the sharp edges worth filing down.

## 1. `bootstrap.ps1` crashes on Windows PowerShell 5.1 (confirmed bug, fix ready)

`scripts/bootstrap.ps1` uses `Get-Date -AsUTC` (PS 6+ only) → `ParameterBindingException` on Windows PowerShell 5.1 (the Windows default), aborting **after** placeholder-stamping but **before** runtime-artifact generation (event log, MCP settings, sentinel, quick-scan). Silent partial bootstrap.

- **Fix (drop-in):** `"$((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd'))"`.
- **Also:** add a `doctor` soft-check grepping `scripts/*.ps1` for PS-6+-only tokens (`-AsUTC`, `-AsHashtable`, ` ?? `, `?.`, `&&`, `||`).
- Full write-up: `lessons-learned/2026-07-08-bootstrap-ps1-getdate-asutc-ps51.md`

## 2. The first governed session can't self-govern (cold-start gap)

Bootstrapping Loom into a new dir **inside a running Claude Code session** means hooks don't fire and subagents aren't invokable until a restart (ADR-0020). The founding session's audit trail is silent unless hand-authored.

- **Recommendations:** louder bootstrap banner ("hooks NOT active this session; use ADR-0034 path 2b; audit trail is hand-authored until restart"); a `bootstrapped_this_session` marker event; document the fresh-clone path as the clean case; consider a two-step bootstrap (copy+stamp, then restart *before* discovery/M0).
- Full write-up: `lessons-learned/2026-07-10-first-governed-session-cold-start.md`

## 3. Discovery is "done" only when authored, not stamped

Non-interactive `discover` stamps template/default content. A stamped-but-unauthored `requirements.md` passes existence checks while being boilerplate — the silent-skip failure in a "done" costume.

- **Recommendations:** `doctor` soft-check flagging tell-tale template placeholder strings in `discovery/*.md`; tie the discovery gate to authored-ness (placeholder-absence) not file presence; a "defaults stamped, unverified" banner in `quick-scan.md`; promote "critic reviews requirements" to a first-class bootstrap next-step.
- Full write-up: `lessons-learned/2026-07-10-discovery-must-be-authored-not-stamped.md`

## 4. Inherited-ADR link check warns on files a fresh project won't have (minor)

`doctor`'s `bidirectional-adr-links` soft-check warns about targets referenced by *inherited* ADRs that a new project legitimately doesn't have (e.g. Loom's own `orchestration/work-graph.json`, `task-ledger.md`, curated out of a fresh copy). It's noise, not a real defect.

- **Recommendation:** scope the check to project-authored ADRs (numbering ≥ the project's first local ADR), or have the check treat inherited-ADR targets as informational. Low priority; soft-check only.

## 5. What worked well (keep / lean into)

- **ADR-0034 path 2b** (invoke a subagent via the Agent tool seeded with its definition) made critic + EAC usable in the pre-restart session — a genuinely useful escape hatch; document it as the standard cold-start pattern.
- **The EAC → specialist flow left the web lane cleanly** (authored `uipath-xaml`, a non-web domain, with `verifier_type` + runtime counterpart, both doctor-clean). Phase-2b proven.
- **Versioned IR + generated JSON Schema from a single zod source** kept the parser↔renderer contract drift-free — a pattern worth recommending in Loom's guidance for any project with an internal data contract.

## 6. Bigger idea (its own proposal): a shared lessons-learned service

Storing every lesson in every Loom repo doesn't scale. See the design proposal: **`docs/proposals/lessons-learned-service.md`** — a central canonical store + semantic index that projects pull-what-they-need from, query on demand, and push updates back to. Recommend adopting as a loom-template ADR.
