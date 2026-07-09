#!/usr/bin/env node
// `loom discover` — interactive Discovery flow.
//
// Per ADR-0025 / L8.
//
// Two modes:
//   --quick   5-question scan during bootstrap; writes discovery/quick-scan.md.
//   (default) Full flow producing discovery/{requirements,risk-register,open-questions}.md.
//   --non-interactive  Skip prompts; stamp the template files only.
//
// Outputs follow the xlsx convention (ADR-0022) for risk-register.md:
// per-risk rows with SE/BE classification + Justifications.

import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const ROOT = process.cwd();
const DISCOVERY = path.join(ROOT, "discovery");

const args = new Set(process.argv.slice(2));
const QUICK = args.has("--quick");
const NON_INTERACTIVE = args.has("--non-interactive");

// `main()` is invoked at the bottom of the file so module-level `const`s
// (QUICK_QUESTIONS, render functions) are initialized first. Top-level await
// runs before subsequent const declarations are reached.

async function main() {
  await fs.mkdir(DISCOVERY, { recursive: true });

  if (QUICK) {
    await runQuickScan();
  } else {
    await runFullDiscovery();
  }
}

// ── Quick-scan: 5 questions, populates discovery/quick-scan.md ───────────

const QUICK_QUESTIONS = [
  {
    key: "project_type",
    prompt: "Project type? (web-app / CLI / library / API / mobile / desktop / agentic-system / other)",
    default: "web-app",
  },
  {
    key: "scale",
    prompt: "Scale expectation? (solo-use / team-of-N / public-N-users-target / unknown)",
    default: "solo-use",
  },
  {
    key: "compliance",
    prompt: "Compliance regime? (none / GDPR / HIPAA / SOC2 / PCI / FERPA / other)",
    default: "none",
  },
  {
    key: "primary_user",
    prompt: "Primary user? (you / internal-team / customers / general-public / mixed)",
    default: "you",
  },
  {
    key: "deploy_target",
    prompt: "Deploy target? (vercel / netlify / fly / render / self-hosted / TBD)",
    default: "TBD",
  },
];

async function runQuickScan() {
  const out = path.join(DISCOVERY, "quick-scan.md");
  const answers = {};

  if (NON_INTERACTIVE || !process.stdin.isTTY) {
    for (const q of QUICK_QUESTIONS) answers[q.key] = q.default;
    process.stderr.write(`[discover --quick] non-interactive; stamped defaults\n`);
  } else {
    process.stdout.write("\nloom discover --quick — 5 questions (~2 min)\n\n");
    for (const q of QUICK_QUESTIONS) {
      const ans = await prompt(`  ${q.prompt}\n  [default: ${q.default}]: `);
      answers[q.key] = ans.trim() || q.default;
    }
    process.stdout.write("\n");
  }

  const date = new Date().toISOString().slice(0, 10);
  const content = renderQuickScan(answers, date);
  await fs.writeFile(out, content, "utf8");
  process.stdout.write(`wrote ${path.relative(ROOT, out)}\n`);
}

function renderQuickScan(a, date) {
  return `# Quick discovery scan

> Stamped by \`scripts/discover.{sh,ps1} --quick\` at bootstrap. Per [L8](../layers/L8-discovery.md) / [ADR-0025](../adr/0025-discovery-scaffolding.md).
>
> This is the **5-minute** scan that informs initial skeleton choices.
> The full discovery flow (\`scripts/discover.{sh,ps1}\` without \`--quick\`)
> produces \`requirements.md\`, \`risk-register.md\`, \`open-questions.md\`
> and may propose skeleton amendments (PR-O / ADR-0026).

Generated: ${date}

## Answers

| Question | Answer |
|---|---|
| Project type | ${a.project_type} |
| Scale expectation | ${a.scale} |
| Compliance regime | ${a.compliance} |
| Primary user | ${a.primary_user} |
| Deploy target | ${a.deploy_target} |

## Implied initial setup

*(Loom uses these answers to suggest skeleton defaults. The user reviews and adjusts.)*

- **Specialists likely needed:** ${impliedSpecialists(a).join(", ") || "(none beyond base agents)"}
- **Recommended next step:** run \`scripts/discover.{sh,ps1}\` (full mode) for requirements + risk register + open questions
- **Compliance implications:** ${complianceNote(a.compliance)}

## What this is not

- Not authoritative — answers may be wrong; revise as discovery deepens.
- Not exhaustive — full discovery produces \`requirements.md\` and \`risk-register.md\` next.
- Not a contract — the skeleton may be rebuilt as deeper research changes the answers (per user note 2026-05-20).
`;
}

function impliedSpecialists(a) {
  const out = new Set();
  if (a.deploy_target !== "TBD" && a.deploy_target !== "self-hosted") out.add("deploy");
  if (a.scale.includes("public") || a.primary_user === "customers" || a.primary_user === "general-public") {
    out.add("auth");
    out.add("monitoring");
    out.add("error-tracking");
  }
  if (a.compliance === "PCI") out.add("payments");
  if (a.compliance !== "none") out.add("secrets");
  return [...out];
}

function complianceNote(c) {
  switch (c) {
    case "GDPR": return "EU data subject rights apply. Lawful basis, consent mode (RUM), data minimization, retention limits.";
    case "HIPAA": return "PHI handling. BAA required with every vendor touching PHI. Audit log non-negotiable.";
    case "SOC2": return "SOC2 Type II takes ~12 months of evidence. Logging, access control, vendor management start now.";
    case "PCI": return "Provider tokenization keeps you out of full PCI scope. NEVER store raw card / CVV.";
    case "FERPA": return "Student educational records. Limited disclosure; written consent for non-routine disclosure.";
    case "none": return "No regulated data, per the answer. Re-check during full discovery — answers shift.";
    default: return `Unknown regime "${c}" — escalate to discovery flow.`;
  }
}

// ── Full discovery: requirements + risk-register + open-questions ────────

async function runFullDiscovery() {
  const date = new Date().toISOString().slice(0, 10);
  const files = [
    { name: "requirements.md", render: renderRequirements },
    { name: "risk-register.md", render: renderRiskRegister },
    { name: "open-questions.md", render: renderOpenQuestions },
  ];

  if (NON_INTERACTIVE || !process.stdin.isTTY) {
    process.stderr.write(`[discover] non-interactive; stamping templates\n`);
    for (const f of files) {
      const p = path.join(DISCOVERY, f.name);
      if (existsSync(p)) {
        process.stdout.write(`  exists: discovery/${f.name} (not overwritten)\n`);
        continue;
      }
      await fs.writeFile(p, f.render(date), "utf8");
      process.stdout.write(`  wrote:  discovery/${f.name}\n`);
    }
    return;
  }

  // Interactive: walk through the three artifacts as guided fill-ins.
  process.stdout.write(`\nloom discover — full Discovery flow\n\n`);
  process.stdout.write(`This walks you through three artifacts (~30–60 min):\n`);
  process.stdout.write(`  1. requirements.md (functional + NFR)\n`);
  process.stdout.write(`  2. risk-register.md (xlsx convention: SE/BE failure modes)\n`);
  process.stdout.write(`  3. open-questions.md (what you don't yet know)\n\n`);
  const proceed = await prompt(`  Proceed? [Y/n]: `);
  if (/^n/i.test(proceed.trim())) {
    process.stdout.write(`\nAborted. Run \`scripts/discover.{sh,ps1}\` again when ready.\n`);
    return;
  }

  for (const f of files) {
    const p = path.join(DISCOVERY, f.name);
    if (existsSync(p)) {
      const overwrite = await prompt(`  discovery/${f.name} exists. Overwrite? [y/N]: `);
      if (!/^y/i.test(overwrite.trim())) {
        process.stdout.write(`    kept existing.\n`);
        continue;
      }
    }
    await fs.writeFile(p, f.render(date), "utf8");
    process.stdout.write(`  wrote:  discovery/${f.name} (template — fill in)\n`);
  }
  process.stdout.write(`\nNext: open each file in discovery/ and fill in the guided sections.\n`);
  process.stdout.write(`The Critic reviews requirements.md once you've filled it (PR-O — ADR-0026).\n`);
}

function renderRequirements(date) {
  return `# Requirements

> Per [L8](../layers/L8-discovery.md) / [ADR-0025](../adr/0025-discovery-scaffolding.md).
> Updated: ${date}

## Functional requirements

*(What the system does. One row per user-visible capability. Reference the matching feature spec / ADR.)*

| ID | Capability | User / Actor | Trigger | Outcome | Notes |
|---|---|---|---|---|---|
| FR-01 | *(e.g., User signs up with email + password)* | New user | Visits /signup | Account created; verification email sent | |
| FR-02 | | | | | |

## Non-functional requirements

*(How the system behaves. NFRs surface in design + the Critic's review.)*

| Category | Requirement | Threshold | Source / Driver | Notes |
|---|---|---|---|---|
| Performance | p95 first-byte latency | < 500ms | User patience studies (Nielsen) | |
| Reliability | Availability | 99.9% / quarter | Internal SLO | |
| Security | OWASP ASVS level | L2 minimum | OWASP ASVS v4.0.3 | |
| Accessibility | WCAG | 2.2 AA | EAA / Section 508 | |
| i18n | Locales supported | English first; expand on demand | | |
| Scalability | Concurrent users | 100 / 1k / 10k? | Pick a target now | |
| Compliance | Regime | (from quick-scan.md) | | |
| Observability | Trace coverage | All request handlers | OpenTelemetry GenAI conv. | |

## Out of scope

*(What the system does NOT do, recorded so it doesn't reappear.)*

- *(e.g., real-time chat — defer to v2)*

## References

- [discovery/quick-scan.md](./quick-scan.md) — the 5-minute scan that produced this
- [discovery/risk-register.md](./risk-register.md) — failure-modes register
- [discovery/open-questions.md](./open-questions.md) — what we still don't know
`;
}

function renderRiskRegister(date) {
  return `# Risk register

> Per [L8](../layers/L8-discovery.md) / [ADR-0025](../adr/0025-discovery-scaffolding.md). Format per [ADR-0022](../adr/0022-xlsx-docs-convention.md) — xlsx-derived register with SE/BE classification + Justifications column.
> Updated: ${date}

## Risks

Each row is one identified risk + its mitigation. \`Type\` is **SE** (System Exception: technical / infrastructure failure) or **BE** (Business Exception: business-rule / policy failure).

| ID | Type | Framework Location | Usecase | Assets / Cred | Input Source | Expected Input | Expected Output | Input Format | Output Format | Next Step | Justifications |
|---|---|---|---|---|---|---|---|---|---|---|---|
| RISK-01 | SE | *(e.g., Auth)* | *(database connection lost mid-request)* | DB | Network | Connection pool | Connection refused / timeout | Connection | System.Exception | Surface 503 to client; retry pool; alert ops if persistent | If the app silently swallows DB errors, users see correct-looking but stale data. 503 with retry-after lets clients back off correctly |
| RISK-02 | BE | | | | | | | | | | |

## Risk owners

*(Who is accountable for each risk. May be the user themselves, may be a specialist.)*

| Risk ID | Owner | Review cadence |
|---|---|---|
| RISK-01 | | |

## Acceptance / Mitigation status

*(Living document. As risks are accepted or mitigated, record here.)*

| Risk ID | Status | Decision date | Decision notes |
|---|---|---|---|
| RISK-01 | proposed | | |

## References

- [discovery/requirements.md](./requirements.md) — the NFRs many of these risks attach to
- [ADR-0022](../adr/0022-xlsx-docs-convention.md) — xlsx convention this register follows
`;
}

function renderOpenQuestions(date) {
  return `# Open questions

> Per [L8](../layers/L8-discovery.md) / [ADR-0025](../adr/0025-discovery-scaffolding.md). Things we don't yet know. As they resolve, they fold into requirements.md or risk-register.md.
> Updated: ${date}

| ID | Question | Blocking? | Owner | Target date | Resolution |
|---|---|---|---|---|---|
| OQ-01 | *(e.g., Should the app support multi-tenancy?)* | yes | user | — | |
| OQ-02 | | | | | |

## Resolution log

*(Append-only; never delete a resolved question.)*

| ID | Resolved date | Resolution | Where it landed |
|---|---|---|---|

## References

- [discovery/requirements.md](./requirements.md)
- [discovery/risk-register.md](./risk-register.md)
- [lessons-learned/](../lessons-learned/) — once a question resolves into a non-obvious lesson
`;
}

// ── readline helper ──────────────────────────────────────────────────────

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans);
    });
  });
}

// Run last so all module-level consts above are initialized first.
await main();
