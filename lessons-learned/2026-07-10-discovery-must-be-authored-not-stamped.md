---
date: 2026-07-10
agent: builder (Opus 4.8)
severity: medium
share: true
upstream: loom-template
---

# Discovery is "done" only when authored — stamped template defaults are the silent-skip trap in disguise

## What happened

`scripts/discover.{ps1,sh}` in non-interactive mode (and the bootstrap quick-scan) **stamp default/template content**: `quick-scan.md` gets `project_type=web-app, primary_user=you, deploy_target=TBD`, and the full-discovery files get placeholder rows (`FR-01 (e.g., User signs up…)`, `RISK-01 (e.g., database connection lost…)`). For this project the quick-scan defaults were partly wrong (it's not a typical web app; there's a `uipath-xaml` specialist need it couldn't infer), and the full-discovery files were pure templates.

The whole premise of Phase-1 is that **skipping discovery is what silently broke prior dogfoods**. A stamped-but-unauthored `requirements.md` is functionally the same failure wearing a "done" costume: `doctor` sees the file exists, the discovery gate can pass, and everything looks green — while the requirements are boilerplate.

We avoided it by authoring real functional/NFR requirements, a real SE/BE risk register, and real open questions, then running the **critic** against them (it returned APPROVE-WITH-FLAGS and surfaced genuine gaps we folded back in).

## Why it happens

The stamping is deliberate scaffolding (gives you the right structure to fill). But nothing distinguishes "scaffolded" from "authored," so a fast run can treat scaffolding as completion.

## What we'd do differently (recommendations for loom-template)

1. **A `doctor` soft-check for un-authored discovery:** flag `discovery/requirements.md` / `risk-register.md` if they still contain the template's tell-tale placeholder strings (`e.g., User signs up`, `RISK-01 | SE | *(e.g.`, the `FR-02 | | | |` empty row). Cheap grep; converts a silent skip into a visible warning.
2. **Quick-scan honesty:** when stamped non-interactively, write a banner in `quick-scan.md` — *"Defaults stamped without input; treat as unverified until full discovery is authored."* (The file already says "not authoritative," but a machine-checkable marker is stronger.)
3. **Tie the discovery gate to authored-ness, not existence:** the deploy/PR gate should check the placeholder-absence check above, not just file presence.
4. **Make "critic reviews requirements" a first-class step in the bootstrap next-steps list**, not just an option — it was the step that turned scaffolding into real requirements here.

## Related

- [ADR-0025 — discovery scaffolding](../adr/0025-discovery-scaffolding.md)
- [ADR-0026 — critic reviews requirements](../adr/0026-discovery-gate.md)
- Discovery authored this session: `discovery/requirements.md`, `discovery/risk-register.md`, `discovery/open-questions.md`
- [[project-state]]
