Author or update a **Requirements & Exceptions test-case register** for a requirement, per [ADR-0046](../../adr/0046-requirements-exceptions-testcase-registry.md). Turn an ask (a validated research item or an architect requirement) into a traceable Business Requirement (`BR`) with its solution steps and enumerated exceptions (`BE`/`SE`) and prerequisites (`TR`), captured as test cases with expected **and actual** I/O, kept for regression and rendered in the Observatory Requirements panel.

## Input

`$ARGUMENTS` — the requirement to register (a sentence or a reference to a validated research item / ADR). If empty, ask which requirement to register.

## What to do

**Step 1 — Assign the requirement a `BR` id.** Scan `observability/eval-suite/requirements/` for the highest `BR_NN` and use the next. The register file is `observability/eval-suite/requirements/BR_NN.md`.

**Step 2 — Decompose the requirement** (mirror the Credit Validation xlsx pattern that ADR-0022 canonicalized):
- The **`BR` row** — the ask itself: Usecase, Expected Input/Output, Justification (why it matters).
- One or more **solution-step rows** (`---`) — how it's implemented (file / function / hook).
- For each step, enumerate its **exceptions**:
  - **`SE`** (System Exception) — technical/irreversible failure modes (credential/network/selector failures, corrupted input, unrecoverable state).
  - **`BE`** (Business Exception) — business-rule failures (missing data, unmatched conditions, policy violations).
- Any **`TR`** (Technical Requirement) — access/infra prerequisites.

**Step 3 — Write the register** at `observability/eval-suite/requirements/BR_NN.md` as an ADR-0022 table with these columns:

`ID · Type · Framework Location · Usecase · Expected Input · Expected Output · Actual Input · Actual Output · Justification · Status`

Types: `BR` / `TR` / `---` / `BE` / `SE`. Give every row a stable `ID` (e.g. `BR-07_SE-02`) and link each non-`BR` row to its `BR` via the id prefix (traceability).

**Step 4 — Make the cases executable + emit them.** Where the requirement has code-level behavior, put the canonical cases in `observability/eval-suite/requirements/BR_NN.cases.mjs` (one exported array — see `BR_01.cases.mjs` for the pattern) and consume them from a `*.test.mjs` that (a) asserts the actual result matches expected, and (b) calls `emitTestCase(...)` from `scripts/lib/testcase.mjs` so the Observatory Requirements panel + regression history populate on every `node scripts/test.mjs`:

```js
import { emitTestCase } from "../../scripts/lib/testcase.mjs";
emitTestCase({
  id: "BR-07_SE-01", parent_id: "BR_07", type: "SE",
  title: "…", expected_input: "…", expected_output: "…",
  actual_input: "…", actual_output: actual, status: actual === expected ? "pass" : "fail",
  justification: "why this validates the exception",
});
```

For **business-requirement-level** checks that can't be exercised by code (a judgment call), emit the `test_case` event yourself with the observed actual (the honest, model-in-the-loop path — same spirit as the Claim convention).

**Step 5 — Confirm** the full suite is green (`node scripts/test.mjs`) and note the new `BR_NN` in the register index.

## Quality bar

- Every exception a maintainer can foresee has a row, and every row has a non-empty Justification (why the handler/behavior exists).
- Expected vs Actual are both captured — a row with no Actual is `pending`, not `pass`.
- Known limitations are documented as their own `SE` rows (honest, not hidden).
- Cases are stable-id'd so re-runs upsert (regression), never duplicate.

$ARGUMENTS
