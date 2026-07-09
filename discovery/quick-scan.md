# Quick discovery scan

> Stamped by `scripts/discover.{sh,ps1} --quick` at bootstrap. Per [L8](../layers/L8-discovery.md) / [ADR-0025](../adr/0025-discovery-scaffolding.md).
>
> This is the **5-minute** scan that informs initial skeleton choices.
> The full discovery flow (`scripts/discover.{sh,ps1}` without `--quick`)
> produces `requirements.md`, `risk-register.md`, `open-questions.md`
> and may propose skeleton amendments (PR-O / ADR-0026).

Generated: 2026-07-09

## Answers

| Question | Answer |
|---|---|
| Project type | web-app |
| Scale expectation | solo-use |
| Compliance regime | none |
| Primary user | you |
| Deploy target | TBD |

## Implied initial setup

*(Loom uses these answers to suggest skeleton defaults. The user reviews and adjusts.)*

- **Specialists likely needed:** (none beyond base agents)
- **Recommended next step:** run `scripts/discover.{sh,ps1}` (full mode) for requirements + risk register + open questions
- **Compliance implications:** No regulated data, per the answer. Re-check during full discovery — answers shift.

## What this is not

- Not authoritative — answers may be wrong; revise as discovery deepens.
- Not exhaustive — full discovery produces `requirements.md` and `risk-register.md` next.
- Not a contract — the skeleton may be rebuilt as deeper research changes the answers (per user note 2026-05-20).
