"""Cross-language conformance check (ADR-0050 Phase 3).

Runs the Python evaluator (loom_guard.decide) against the SAME
spec/conformance/scenarios.json the JS suite uses, and compares to the same
`expected` decisions. Exit 0 iff every scenario matches — i.e. the Python
evaluator and the JS evaluator agree, from one shared policy. That is the
cross-language / "any language" agnosticism proof.

Run:  python adapters/python/conformance_check.py
(also invoked automatically by spec/conformance/cross-language.test.mjs when a
Python runtime is present.)
"""

import json
import os
import sys

from loom_guard import decide

_DIR = os.path.dirname(os.path.abspath(__file__))
_SCENARIOS = os.path.normpath(
    os.path.join(_DIR, "..", "..", "spec", "conformance", "scenarios.json")
)


def main():
    with open(_SCENARIOS, "r", encoding="utf-8") as f:
        scenarios = json.load(f)
    passed = 0
    failed = 0
    for sc in scenarios:
        actual = decide(tool=sc.get("tool", ""), input=sc.get("input"), hits=sc.get("hits") or [])
        ok = actual == sc["expected"]
        mark = "OK " if ok else "XX "
        extra = "" if ok else f" (got {actual})"
        print(f"  {mark}{sc['id']}: {sc['description']} -> {sc['expected']}{extra}")
        passed += 1 if ok else 0
        failed += 0 if ok else 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
