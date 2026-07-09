# L0 — Constitutional Substrate

> **Canonical source:** §B.1 of [`../spec/loom-spec-v0.1-full.md`](../spec/loom-spec-v0.1-full.md). This file is the project-local working surface; defer to the spec for design rationale.

---

## Purpose

Every Loom project inherits the same substrate-neutral governance — the same rules apply to humans, AI agents, and any future automated participants. The substrate is loaded at boot and consulted before every consequential action.

## Components in this project

| Component | Location | Status |
|---|---|---|
| Trajectory Kernel V6 (verbatim) | [`../constitution/kernel-v6.md`](../constitution/kernel-v6.md) | ⚠ placeholder — install the real text before first run |
| Local rule extensions | [`../constitution/local-rules.md`](../constitution/local-rules.md) | empty (add as needed) |
| Constitution Service agent | [`../agents/constitution-service/`](../agents/constitution-service/) | stub |
| Amendment ADR template | use the template in [`../adr/`](../adr/) | available |
| Override authority registry | recorded in [`../constitution/kernel-v6.md`](../constitution/kernel-v6.md) | replace `<USER_NAME>` |

## Operationally critical rules

Rules 1, 2, 8, 19, 20, 22, 23 — summarized in [`../constitution/kernel-v6.md`](../constitution/kernel-v6.md) and again at the top of [`../CLAUDE.md`](../CLAUDE.md). Read them before any consequential action.

## Enforcement modes

| Mode | When |
|---|---|
| Hard block | Safety-critical rule violation |
| Soft warning | Advisory rule violation |
| Escalation | Ambiguous case → human approver queue |

> Destructive operations (file deletion, force-push, schema drops) additionally require an explicit confirmation gate, hook-enforced per [ADR-0047](../adr/0047-hook-enforced-destructive-action-confirmation.md) (Kernel Rule 20). On model-agnostic hosts, this constitutional policy is enforced at the host's pre-action seam by a Loom adapter per [ADR-0048](../adr/0048-north-star-model-agnostic-spec-and-adapters.md) — hard where the host exposes a real seam, advisory + logged otherwise.

## Project-local overrides

Local extensions go in [`../constitution/local-rules.md`](../constitution/local-rules.md). They may extend the kernel but never contradict it.

---

## Open work for this layer

- [ ] Install verbatim Trajectory Kernel V6 text in `../constitution/kernel-v6.md`
- [ ] Replace `<USER_NAME>` placeholder for override authority
- [ ] Decide cryptographic-signing vs. honor-system for kernel amendments (spec §H Q10)
