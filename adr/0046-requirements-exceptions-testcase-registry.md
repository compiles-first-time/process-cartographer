# ADR-0046: Requirements & Exceptions Test-Case Registry

**Status:** Accepted (approved by Nick, 2026-07-05)
**Date:** 2026-07-05
**Author:** Builder (Opus 4.8) — approved by Nick
**Confidence:** [M] on schema shape; [H] that this is the correct extension of ADR-0022

---

## Context

[ADR-0022](./0022-xlsx-docs-convention.md) adopted the user's Credit Validation Requirements & Exceptions spreadsheet as Loom's canonical **register** format — but scoped it to **static documentation** (specialist `SKILL.md` "Failure modes" tables + `discovery/risk-register.md`), and it **dropped `BR` (Business Requirement) and `TR` (Technical Requirement)** from the Type enum, keeping only `SE` / `BE` / `---`.

The architect wants to close the loop that 0022 left open: the same register discipline, but as **live, executable, requirement-traceable test cases** that (a) capture *actual* input/output at run time — not just expected, (b) render in the L9 Observatory, and (c) persist for regression. This is the container into which validated research items land: each accepted research finding becomes a Business Requirement (`BR`), whose solution's failure modes (`SE`/`BE`) and prerequisites (`TR`) are enumerated as test cases.

No existing ADR (0001–0045) provides this. The aggregator's `test_result` event carries only `suite/name/status/assert-counts/duration/error_preview` — no requirement linkage, type, expected/actual I/O, or justification. [ADR-0021](./0021-subagent-evals.md) (subagent behavior evals, human-graded) is a distinct concern; [ADR-0044](./0044-verifier-gates-for-agent-tasks.md) (verifier gates) is adjacent — a passing test case *is* the binary success signal a verifier checks.

## Decision

Promote ADR-0022's static register into a **Requirements & Exceptions Test-Case Registry**.

### 1. Type taxonomy (restores BR + TR to the 0022 enum)

| Type | Meaning |
|---|---|
| `BR` | **Business Requirement** — an "ask." For Loom, a validated research item / architect requirement. |
| `TR` | **Technical Requirement** — an infrastructure/access prerequisite for a BR's solution. |
| `---` | A **solution step** implementing a BR (not itself an exception). |
| `BE` | **Business Exception** — a business-rule failure mode of a solution step. |
| `SE` | **System Exception** — a technical failure mode of a solution step. |

### 2. Schema (extends the 0022 column set)

Carries forward all ADR-0022 columns (`ID · Type · Framework Location · Usecase · Assets/Cred · Input Source/Condition · Expected Input · Expected Output · Input Format · Output Format · Next Step · Justifications`) and **adds four execution fields**:

- `actual_input` — what was actually fed in at run time
- `actual_output` — what actually came out
- `status` — `pass` | `fail` | `pending` | `blocked`
- `run_timestamp` — ISO-8601 of the last execution

Traceability: every non-`BR` row carries a `parent_id` linking to its `BR` (generalizing 0022's "Next Step" chain).

### 3. Storage (dual, per the human/machine split ADR-0022 §Alternatives anticipated)

- **Human-facing register:** one markdown file per requirement at `observability/eval-suite/requirements/<BR-id>.md` — an ADR-0022-style table (the source of truth a maintainer reads/edits).
- **Machine-facing runtime:** each execution emits a `test_case` event to `memory/event-log/`. The Observatory replays these; regression history lives in the append-only log. **No new persisted DB** (honors the L9 in-memory constraint, ADR-0039).

### 4. Observatory panel (additive to ADR-0040)

A new `test_case` aggregator event + handler, and a dashboard panel rendering the architect's requested columns: **ID · Type · Expected In/Out · Actual In/Out · Why (Justifications) · status**. Additive-only per [ADR-0040](./0040-observatory-projection-schemas.md); zero-dep, SSE, in-memory per [ADR-0039](./0039-observatory-architecture.md).

### 5. `/testcase` skill (authoring; agent deferred)

A slash-command skill that, given a `BR`, scaffolds its register file, prompts enumeration of `SE`/`BE`/`TR` rows, and emits `test_case` events when tests run. A dedicated **requirements/test-case author specialist agent** is explicitly **deferred** to a future ADR (build once the pattern is proven on 2–3 requirements — architect's "skill now, agent later" decision, 2026-07-05).

## Evidence basis

> Required v0.4+ per [LR-05](../constitution/local-rules.md#lr-05).

- **Primary evidence:** the supplied Credit Validation Requirements & Exceptions.xlsx (87 KB; ~1000-row REFramework failure-mode register from a production UiPath RPA project) — the same primary source ADR-0022 cites. `[primary][H]`
- **Corroborating sources:** ISO 25010 reliability sub-characteristic (fault tolerance + recoverability require explicit failure-mode enumeration) `[institutional][H]`; ADR-0022's own accepted rationale for the SE/BE split `[internal][H]`.
- **Synthesizer reasoning:** the only *novel* claim here vs 0022 is that a register gains value when expected I/O is paired with captured actual I/O and rendered live — standard test-management practice (requirements traceability matrices). `[synth][M]`
- **What would change this call:** a measured finding that maintainers get no regression benefit from actual-vs-expected capture over 0022's expected-only static tables.

## Cost model

Not an iterative LLM pattern. The `/testcase` skill is single-pass authoring; test execution is deterministic code emitting events. The deferred author-agent (future ADR) is where any fan-out cost would be priced per LR-06. **No loop introduced here.**

## Consequences

**Locks in:** a single register format spanning documentation *and* live tests; BR/TR restored as first-class types; the Observatory as the regression surface; every accepted research item expressible as a traceable BR.

**Locks out:** untyped/expected-only ad-hoc test tracking; a separate test-management dependency.

**Migration path if it fails:** registers are markdown (hand-editable); the `test_case` event is additive (removing it degrades to the existing `test_result` view); the panel is one additive projection.

**Honest limitation:** *actual* I/O is trivially captured for **code-level** tests (the runner has it). For **BR-level** validation ("did the built feature satisfy the ask?"), actuals require **model-emitted** `test_case` events — the known L9 visibility gap (hooks can't see reasoning). v1 scope: code-level actuals + opt-in model-emitted BR events, mirroring the Claim convention.

## Alternatives considered

- **Extend `test_result` in place** (add fields). Rejected: `test_result` is a lightweight pass/fail record capped at 500; overloading it with requirement traceability conflates two concerns. A distinct `test_case` event keeps both clean.
- **JSON-Schema-validated registers only** (no markdown). Rejected: 0022 already chose human-friendly markdown; a JSON mirror can be added later if mechanical validation becomes load-bearing.
- **Build the author-agent now.** Rejected: architect chose skill-first; avoids speculative EAC fan-out cost (LR-06).

## Affects / Affected by

**This ADR affects** *(downstream)*:

- `layers/L6-observability.md` — new `observability/eval-suite/requirements/` register location + `test_case` event schema
- `layers/L9-observatory.md` — new test-case panel
- `observatory/lib/aggregator.mjs` — new `test_case` EVENT_HANDLER + state shape
- `observatory/public/js/app.mjs` — new panel
- `adr/0047-*` — BR_01 is the first register entry authored in this format

**This ADR is affected by** *(upstream)*:

- `adr/0022-xlsx-docs-convention.md` — the register format this extends
- `adr/0040-observatory-projection-schemas.md` — additive-only projection evolution
- `adr/0039-observatory-architecture.md` — zero-dep / SSE / in-memory constraints
- `constitution/kernel-v6.md` — Rule 22 (every claim has provenance; test cases carry Justifications)
- `constitution/local-rules.md` — LR-05 (best-current-call)

## References

- Credit Validation Requirements and Exceptions.xlsx — primary `[primary][H]`
- ADR-0022 (xlsx-docs-convention) — the format extended
- ADR-0021 (subagent-evals), ADR-0044 (verifier-gates) — adjacent test/verification concerns
- ISO 25010 — institutional corroboration `[institutional][H]`
