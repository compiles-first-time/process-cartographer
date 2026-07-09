// Built-requirements registry (ADR-0046, OB-X-02).
//
// The requirements Loom itself has delivered, expressed in the Requirements &
// Exceptions format and wired to emit `test_case` events — so the Observatory
// Requirements panel shows the full BR_01..BR_05 lineage. Each requirement
// TRACES to the existing test that validates it (no duplication of the checks;
// registry.test.mjs asserts those test files exist and emits the rows).

export const BUILT_REQUIREMENTS = [
  {
    br: "BR_02",
    title: "Requirements & Exceptions Test-Case Registry",
    adr: "ADR-0046",
    validated_by: "observatory/lib/aggregator.test.mjs",
    justification: "Live, requirement-traceable test cases (expected + ACTUAL I/O), Observatory-rendered, kept for regression.",
    exceptions: [
      { id: "BR-02_SE-01", type: "SE", title: "test_case event without a stable id", justification: "Upsert keys on id; an id-less event must be handled safely, not crash the aggregator." },
      { id: "BR-02_BE-01", type: "BE", title: "case count exceeds the cap (500)", justification: "Unbounded growth risk — the registry caps and keeps the most-recent." },
    ],
  },
  {
    br: "BR_03",
    title: "Kanban action-item tracking with time-in-state",
    adr: "ADR-0048 (OB-X-01)",
    validated_by: "observatory/lib/aggregator.test.mjs",
    justification: "Action items across states, time-in-state accrual across transitions, linked to their requirement + its exceptions.",
    exceptions: [
      { id: "BR-03_SE-01", type: "SE", title: "ticket event without an id", justification: "Cannot upsert — ignored; must not corrupt the board." },
      { id: "BR-03_BE-01", type: "BE", title: "same-state re-emit", justification: "No phantom transition recorded; mutable fields still update." },
    ],
  },
  {
    br: "BR_04",
    title: "Model-agnostic governance via spec + adapters",
    adr: "ADR-0048",
    validated_by: "adapters/langgraph/guard.test.mjs",
    justification: "One portable spec + policy governs multiple hosts — proven by a second adapter passing conformance + a live LangGraph run.",
    exceptions: [
      { id: "BR-04_SE-01", type: "SE", title: "seam-less host (bare model)", justification: "No pre-tool seam → governance degrades to advisory + logged, honestly declared (ADR-0048 §4)." },
      { id: "BR-04_BE-01", type: "BE", title: "adapter disagrees with the spec decision", justification: "Cross-adapter parity is asserted; divergence = a non-compliant adapter." },
    ],
  },
  {
    br: "BR_05",
    title: "Conformance suite — the adapter contract",
    adr: "ADR-0048 (OB-P1-04)",
    validated_by: "spec/conformance/conformance.test.mjs",
    justification: "Runtime-neutral scenarios defining 'Loom-compliant adapter' — the yardstick a new adapter must pass.",
    exceptions: [
      { id: "BR-05_SE-01", type: "SE", title: "adapter throws on a scenario", justification: "The runner captures the error as a failed scenario, not a crash." },
      { id: "BR-05_BE-01", type: "BE", title: "decision mismatch vs expected", justification: "Reported as a conformance failure → the adapter is not compliant." },
    ],
  },
];
