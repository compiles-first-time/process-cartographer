# ADR-0022: xlsx-derived documentation convention — failure-modes register format

**Status:** Accepted
**Date:** 2026-05-20
**Author:** Architect handoff (v0.4 PR-L) — approved by Nick
**Confidence:** [H]

## Context

The user supplied a Credit Validation Requirements & Exceptions spreadsheet as the canonical example of how Loom should document use cases. The format decomposes each business requirement (BR_NN) into:

1. A high-level requirement row (the BR itself) — Usecase, Assets/Credentials, Input Source, Expected Input/Output, formats, Next Step, Justifications.
2. Sub-step rows that break the BR into individual implementation files (XAML in the source; SKILL.md sections in Loom's adaptation).
3. **Exception rows** tied to each step:
   - **SE** (System Exception) — technical failures: credentials, network, selectors, downloads, file corruption.
   - **BE** (Business Exception) — business-rule failures: missing data, classification failures, format violations.

Each exception row enumerates the failure condition, the input that should have produced it, the expected output of the failure handler, the *next step* on failure, and the **Justifications** for why that handler exists.

Loom v0.1–v0.3 documented specialist roles informally (prose-style SKILL.md sections). That works for the six base agents but breaks down at the v0.4 specialist registry, where 12+ specialists need uniform failure-mode documentation that humans, the Critic, and future specialists can scan cheaply.

## Decision

**The xlsx format is the canonical documentation pattern for:**

1. **Specialist `SKILL.md` "Failure modes" sections** (per ADR-0023 / PR-M onwards).
2. **`discovery/risk-register.md`** (per ADR-0025 / PR-N).
3. **Any future "register" artifact** Loom produces — incident registers, deprecation registers, etc.

### Required columns (carried forward from the xlsx, with the user's rename)

| Column | Type | Notes |
|---|---|---|
| `ID` | string | Stable identifier, e.g. `OAUTH-EX-01`, `SE-03` |
| `Type` | enum | `SE` (System Exception) / `BE` (Business Exception) / `---` (the step/requirement row, not an exception) |
| `Framework Location` | string | Where in the lifecycle this applies (e.g., `Init State`, `Dispatch`, `Post-commit`) |
| `Usecase` | string | One-sentence description of the case |
| `Assets / Cred / Other` | string | Credentials, env vars, MCP servers, repo paths involved |
| `Input Source or Condition` | string | What triggers this case |
| `Expected Input` | string | The input shape that should produce this case |
| `Expected Output` | string | What the handler / next-step receives |
| `Input Data Format` | string | Type / schema (e.g., `MailMessage`, `DataTable`, `String`, `System.Exception`) |
| `Output Data Format` | string | Same |
| `Next Step` | string | Reference to the next ID / file / agent on this outcome |
| **`Justifications`** | string | **(Renamed from "Why" in the source xlsx, per user note.)** Why this case exists; the rationale a future maintainer needs to keep the handler load-bearing |

### Markdown rendering

In SKILL.md files, the register lives in a `## Failure modes` section as a markdown table. For long entries, the table cells link out to detail sections below the table. Example:

```markdown
## Failure modes

| ID | Type | Framework Location | Usecase | Assets/Cred | Input Source | Expected Input | Expected Output | Input Format | Output Format | Next Step | Justifications |
|---|---|---|---|---|---|---|---|---|---|---|---|
| OAUTH-EX-01 | SE | Init | OAuth provider unreachable | Provider URL | Network call | HTTP request | `network.error` event | HTTP | Object | Retry with backoff, max 3 | Provider outages are transient; retries beat hard-fails for solo-dev UX |
| OAUTH-EX-02 | BE | Validate | State param mismatch | Session state | Callback | `state` query param | `auth.csrf_violation` event | String | Boolean | Reject + audit | CSRF protection per OAuth 2.1 §10.2 |
| ... | | | | | | | | | | | |
```

### Interoperability tracking (cross-cutting, v0.4+)

Each ADR (this one included) ships with an **Affects / Affected by** section listing the downstream artifacts that need to update when this ADR changes and the upstream constraints that constrain this ADR. `loom doctor` verifies the links are bidirectional via the `bidirectional-adr-links` soft check (PR-L). The ADR template (`adr/0000-template.md`) requires this section in v0.4+ ADRs.

## Evidence basis

- **Primary evidence:** the supplied Credit Validation xlsx (87 KB; 1 sheet; ~1000-row failure-mode register from a real UiPath RPA project). Captures a mature exception-handling discipline from a domain (RPA) where unhandled exceptions cost real money. `[primary][H]`
- **Corroborating sources:**
  - ISO 25010 quality model — "reliability" sub-characteristic includes fault tolerance + recoverability, both of which require explicit failure-mode enumeration. `[institutional][H]`
  - Microsoft Azure architecture center — "transient fault handling" pattern documents the SE/BE split (under "transient" vs. "permanent") for distributed systems. `[institutional][H]`
- **Synthesizer reasoning:** the xlsx format generalizes cleanly from RPA to agentic-system specialist documentation because both deal with the same fundamental shape (stepwise process with per-step failure handlers). `[synth][M]`
- **What would change this call:** a measurably better register format from a peer-reviewed source (e.g., a study comparing exception-documentation formats by maintainer comprehension or by handler-coverage metrics) finding a different decomposition outperforms SE/BE.

## Consequences

**Locks in:**
- All v0.4+ specialist SKILL.md files follow this format.
- The discovery risk register (PR-N) follows this format.
- The Critic monthly audit can mechanically check coverage (does each Usecase row have a non-empty handler in Next Step?).

**Locks out:**
- Free-form failure documentation that's hard to scan or audit.
- Hidden SE/BE conflation (the typed split forces the author to be explicit).

**Migration path if it fails:** the format is markdown — projects can hand-edit if the runner fails. The Critic's audit degrades to manual review. The columns are independent — removing any one is non-breaking for the others.

## Alternatives considered

- **Free-form prose `## Failure modes` sections.** Rejected: v0.1–v0.3 used this; the inconsistency surfaces only when you try to audit across specialists.
- **JSON Schema-validated failure registers.** Considered. Deferred to v0.5+: the xlsx-derived markdown table is human-friendlier; a future ADR can add a JSON-Schema mirror if mechanical validation becomes load-bearing.
- **Adopt ISO 25010's full quality model.** Rejected: too broad for failure-mode documentation alone. The xlsx columns are a tighter fit for "what does this specialist do when X goes wrong."
- **Use OpenAPI's response schemas as the register format.** Rejected: OpenAPI is request/response-centric; specialist failure modes include non-HTTP outcomes (credential failures, file-format issues, time-outs).

## Affects / Affected by

**This ADR affects** *(downstream — when this ADR changes, these must be reviewed)*:

- `adr/0000-template.md` — Evidence basis + Affects sections required v0.4+
- `agents/specialists/_registry/README.md` — specialist authoring checklist references the failure-modes section
- `scripts/lib/doctor.mjs` — `checkAdrTemplateConformance` + `checkBidirectionalAdrLinks` soft checks enforce this
- `adr/0023-specialist-registry.md` — PR-M's specialists ship in this format
- `adr/0025-discovery-scaffolding.md` *(planned)* — `discovery/risk-register.md` uses this format (generated at bootstrap/runtime — absent in a template repo)

**This ADR is affected by** *(upstream)*:

- `constitution/local-rules.md` — LR-05 (decisions are best-current-call)
- `constitution/kernel-v6.md` — Kernel Rule 22 (epistemic transparency)
- The user-supplied Credit Validation xlsx (primary evidence)

## References

- The user-supplied "Credit Validation Requirements and Exceptions.xlsx" — primary
- ISO 25010 — institutional corroboration
- Microsoft Azure architecture center transient-fault patterns — institutional corroboration
- ADR-0009 (research standards / source tiering) — informs the corroborating-sources discipline
- LR-05 (decisions supersedable by evidence) — co-shipped in PR-L
