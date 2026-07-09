# Python adapter — cross-language proof (Phase 3)

Per [ADR-0050](../../adr/0050-second-adapter-langgraph.md) §"cross-language" + [ADR-0049](../../adr/0049-policy-engine-native-first.md). This is the **cross-language** step: a Python host can't `import` the JS evaluator, so it needs its own — which is exactly the ADR-0049 trigger. Rather than adopt OPA yet, the tractable proof is a **thin Python evaluator that reads the same policy data**.

## What's here

- **`loom_guard.py`** — a Python re-implementation of the tier logic in `scripts/lib/destructive-guard.mjs`, reading the **same** `spec/policy/destructive-actions.policy.json`. Stdlib only, no deps.
- **`conformance_check.py`** — runs `loom_guard.decide` against the **same** `spec/conformance/scenarios.json` and exits non-zero on any mismatch.

## The proof

`spec/conformance/cross-language.test.mjs` (in Loom's Node suite) detects a real Python runtime; if present, it runs `conformance_check.py` and asserts it passes — i.e. **the Python evaluator and the JS evaluator reach identical decisions from one shared policy.** That is language-neutral portability: JS + Python, one source of truth.

## Status

> ⚠️ **Not yet executed in this environment** — the checkout has only the Windows Store *stub* `python` (no real runtime), so the Node suite **skips** the cross-language test (stays green). Install a real Python and it activates automatically:

```bash
winget install Python.Python.3.12      # or python.org / your package manager
python adapters/python/conformance_check.py   # expect: 8 passed, 0 failed
node scripts/test.mjs                          # cross-language.test.mjs now runs + asserts parity
```

## Next (the dogfood)

Once Python runs here, the small **data-validation pipeline** (mirroring the Credit-Validation xlsx) gets built on top of this guard, governed + observed through Loom, with its BR/BE/SE registered — the usability dogfood.
