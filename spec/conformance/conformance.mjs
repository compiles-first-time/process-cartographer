// Adapter-agnostic conformance runner (ADR-0048 OB-P1-04).
//
// `decide` maps a scenario → a decision string ("deny" | "ask" | "allow" | "none").
// Each adapter supplies its own `decide` (its policy-evaluation path). Passing
// this suite is the DEFINITION of a "Loom-compliant adapter". "model-agnostic"
// is claimed only once a SECOND adapter passes it (OB-P2-03).

export function runConformance(decide, scenarios) {
  const results = scenarios.map((sc) => {
    let actual = null;
    let error = null;
    try {
      actual = decide(sc);
    } catch (e) {
      error = String((e && e.message) || e);
    }
    return {
      id: sc.id,
      description: sc.description,
      expected: sc.expected,
      actual,
      requires_hard: !!sc.requires_hard,
      ok: actual === sc.expected,
      error,
    };
  });
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results };
}
