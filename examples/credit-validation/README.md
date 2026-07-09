# Credit-validation pipeline — the Loom dogfood

A small **real project built ON Loom**, used to answer the question that unit tests can't: *is Loom a usable backbone for building software, or just internally consistent?* It mirrors the original **Credit Validation Requirements & Exceptions** xlsx — the domain the whole requirements/exceptions discipline came from.

## What it does

`validate.py` reads a CSV of records and validates headers, data presence, and per-field correctness, producing an auditable report — handling:

- **Business Exceptions (BE):** missing required header, no data rows, invalid field (name/email/amount/card_last4).
- **System Exceptions (SE):** file not found / unreadable, CSV parse/decode error.

## How it exercises Loom (the point of the dogfood)

1. **Governed by the Loom policy** — `governed_cleanup()` consults the **Python** Loom guard (`adapters/python/loom_guard.py`) before a destructive cleanup: an op inside a `.worktrees/` scratch is `allow`ed and proceeds; a broad path returns `ask` and the pipeline **defers to a human** (does not delete). Same policy as the Claude Code + LangGraph adapters — model- and language-independent.
2. **Registered in the Loom registry** — `validate_test.py` emits this pipeline's `BR_CV_01` + its SE/BE/TR as `test_case` events into the *same* Loom event log the JS suite writes (cross-language registry). They render in the Observatory **Requirements** panel alongside Loom's own BR_01–BR_05.
3. **In the always-green suite** — `pipeline.test.mjs` runs `validate_test.py` when a real Python runtime is present (skips gracefully otherwise).

## Run

```bash
python examples/credit-validation/validate_test.py     # 10 passed, 0 failed
node scripts/test.mjs                                   # pipeline.test.mjs runs it in-suite
```

## What the dogfood surfaced

Building it exercised the discipline honestly: the pipeline's own test **caught a real bug** (a header-only file was misclassified as "missing header" instead of "no data rows", because `csv.DictReader` yields no rows to read headers from — fixed by reading `fieldnames`). That is exactly the requirements/exceptions loop working as intended.
