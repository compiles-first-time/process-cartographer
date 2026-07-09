# Open questions

> Per [L8](../layers/L8-discovery.md) / [ADR-0025](../adr/0025-discovery-scaffolding.md). Things we don't yet know. As they resolve, they fold into requirements.md or risk-register.md.
> Updated: 2026-07-08

| ID | Question | Blocking? | Owner | Target date | Resolution |
|---|---|---|---|---|---|
| OQ-01 | Which exact vanilla REFramework version/source do we vendor as the golden M0 fixture? | yes (M0 test) | Nick | M0 | Vendor a known REFramework template snapshot into `fixtures/reframework/` and pin it; the M0 parser test asserts against it. Resolving this *is* part of M0. |
| OQ-02 | IR schema: semver strategy + how strict is boundary validation (reject vs warn)? | no | Nick | M0 | Decide during M0. Leaning: semver `major.minor`, boundary *rejects* on major mismatch, *warns* on minor. |
| OQ-03 | Graph-layout engine: elkjs vs dagre vs a custom force layout for the 3D positions? | no | Nick | M1 | Prototype in M1; elkjs (layered) is the default hypothesis for REFramework's DAG-ish spine. |
| OQ-04 | How precisely can we infer an activity's "area" (which floor of a building) from a selector/URL? | no | Nick | M2/M3 | Heuristic with confidence tiers; refine against real selectors. Ties to RISK-04. |
| OQ-05 | What columns/shape does Nick's real Requirements & Exceptions xlsx use? | no (blocks M3 only) | Nick | before M3 | Get a sample sheet from Nick; define the ingest mapping then. Not needed for M0/M1/M2. |
| OQ-06 | Does the current interactive Claude Code session need a restart before it is fully governed (hooks auto-fire, subagents invokable)? | no | Nick | now | **Yes** — per ADR-0020, `.claude/agents` + hooks register at session start; this session predates the bootstrap. Verified hooks fire against this CWD manually; a restart makes it automatic. |
| OQ-07 | What is the requirement↔path **matching mechanism** for the coverage overlay (FR-08 / RISK-05), and how do we test it? | no (blocks M3) | Nick | before M3 | Raised by critic (2026-07-08): the coverage claim is the product's core promise, yet the *algorithm* linking a requirement's text to a graph path is undefined, and there's no golden coverage-fixture test (unlike RISK-01/02). Before M3: define the matching mechanism, add a coverage golden fixture + contract test analogous to OQ-01, and make the mapping tri-state (covered / uncovered / ambiguous) with a per-mapping confidence + evidence — mirroring RISK-04's classifier confidence. |
| OQ-08 | Should the M0 IR schema pre-reserve fields for per-mapping coverage confidence/evidence? | no | Nick (builder) | M0 | **Decided (2026-07-08):** No premature fields. The IR is **versioned** and additive-optional fields are a non-breaking minor bump, so adding a `coverage` block at M3 is cheap — not the costly retrofit the critic feared for an unversioned schema. Recorded as a conscious decision, not an oversight. Re-evaluate if M1/M2 reveal a structural (non-additive) dependency. |

## Resolution log

*(Append-only; never delete a resolved question.)*

| ID | Resolved date | Resolution | Where it landed |
|---|---|---|---|
| OQ-06 | 2026-07-08 | Confirmed: restart needed for automatic hook firing + subagent registration. Manual hook invocation this session proves the wiring; ADR-0020 restart makes it ambient. | This session's handoff note to Nick + event-log claim |

## References

- [discovery/requirements.md](./requirements.md)
- [discovery/risk-register.md](./risk-register.md)
- [lessons-learned/](../lessons-learned/) — once a question resolves into a non-obvious lesson
