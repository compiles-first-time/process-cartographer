# Requirements registry — index

Per [ADR-0046](../../../adr/0046-requirements-exceptions-testcase-registry.md). Each **Business Requirement (BR)** Loom has delivered, decomposed into its solution + Business/System Exceptions (BE/SE), with test cases that emit `test_case` events → the Observatory **Requirements** panel renders the full, live, regression-tracked view.

| BR | Title | ADR | Validated by | Register |
|---|---|---|---|---|
| **BR_01** | Hook-enforced confirmation for destructive actions | 0047 | `scripts/lib/destructive-guard.test.mjs` | [BR_01.md](./BR_01.md) (full exemplar) + `BR_01.cases.mjs` |
| **BR_02** | Requirements & Exceptions Test-Case Registry | 0046 | `observatory/lib/aggregator.test.mjs` | `registry.cases.mjs` |
| **BR_03** | Kanban action-item tracking (time-in-state) | 0048 (OB-X-01) | `observatory/lib/aggregator.test.mjs` | `registry.cases.mjs` |
| **BR_04** | Model-agnostic governance (spec + adapters) | 0048 | `adapters/langgraph/guard.test.mjs` | `registry.cases.mjs` |
| **BR_05** | Conformance suite (adapter contract) | 0048 (OB-P1-04) | `spec/conformance/conformance.test.mjs` | `registry.cases.mjs` |

## How it works

- **Full exemplar:** [`BR_01.md`](./BR_01.md) is the human-readable register in the ADR-0022 table form (ID · Type · Expected/Actual I/O · Why · status), with `BR_01.cases.mjs` asserting the guard AND emitting on every `node scripts/test.mjs`.
- **BR_02–BR_05:** defined as data in `registry.cases.mjs`; `registry.test.mjs` asserts each traces to a real validating test and emits its rows. The rich per-column view is the **Observatory Requirements panel** (the live source of truth); this index is the human map.
- **Regression:** every `node scripts/test.mjs` re-emits all rows (upserted by id), so the panel always reflects current status.

## Convention for new requirements

New validated work becomes a `BR_NN` here (via `/testcase`): decompose into solution + BE/SE exceptions, wire cases to emit, add a row above. This is the traceability spine — every requirement's exceptions are enumerated and every case shows expected-vs-actual.
