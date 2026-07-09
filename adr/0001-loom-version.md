# ADR-0001: Loom v0.1 scaffold

**Status:** Accepted
**Date:** 2026-05-14
**Author:** Loom template
**Confidence:** [H]

> **Update (2026-07-08 audit):** The canonical `Loom version` is now **1.0.0** — the first *stable* release (model-agnostic spec + adapters, conformance-tested, dogfooded). The "v0.3 upgrade ADR" promised below never shipped as a standalone doc; the version history *is* the ADR cascade itself (ADR-0011 = v0.2 runtime → the informal v0.3–v1.0 PR cascades → ADR-0048–0053 Option-B). The `v0.2.0` baseline in the Decision is retained as the historical instantiation point; CLAUDE.md's header now reads `1.0.0`. Minor bumps (v1.0.1, v1.1.0, …) from here.

## Context

A new project is being bootstrapped from the Loom Architectural Base Spec Template. We need an explicit record of which version of Loom this project was instantiated from, so that future Update Bus propagation can compute deltas.

## Decision

This project is instantiated from **Loom v0.2.0** (originally v0.1; v0.2 adds the enforcement runtime per [ADR-0011](./0011-claude-code-enforcement-runtime.md) without changing the v0.1 architectural conclusions), paired with **Kernel V6**.

## Consequences

- Future updates flowing through the Update Bus are computed against the v0.2.0 baseline
- The canonical spec lives at [`../spec/loom-spec-v0.1-full.md`](../spec/loom-spec-v0.1-full.md); v0.2 amendments are tracked in Part J of that file. The v0.1 architectural conclusions remain intact — v0.2 is additive runtime, not a re-synthesis
- When Loom v0.3 ships, a fresh upgrade ADR will document the deltas

## Alternatives considered

- *Not version-pinning* — rejected because Update Bus propagation depends on knowing the baseline
- *Version-pinning each layer independently* — rejected as premature complexity

## References

- [`../README.md`](../README.md) (template root)
- [`../spec/loom-spec-v0.1-full.md`](../spec/loom-spec-v0.1-full.md) §B.8 (Update Bus)
- [`../layers/L7-extension.md`](../layers/L7-extension.md)
