import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
wb.creator = 'Loom Template';

const NAVY = 'FF1B2A4A';
const WHITE = 'FFFFFFFF';
const LIGHT_BLUE = 'FFD6E4F0';
const LIGHTER_BLUE = 'FFE9F0F8';
const LIGHT_GOLD = 'FFFFF8E1';
const LIGHT_GREEN = 'FFE8F5E9';
const LIGHT_GRAY = 'FFF5F5F5';

const tierFills = {
  'Tier 1': LIGHT_GOLD,
  'Tier 2': LIGHT_BLUE,
  'Tier 3': LIGHT_GREEN,
  'Tier 4': LIGHTER_BLUE,
  'Tier 5': LIGHT_GRAY,
};

function styleHeader(ws, colCount) {
  const row = ws.getRow(1);
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = { name: 'Arial', bold: true, color: { argb: WHITE }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
  }
  row.height = 28;
}

function styleDataRow(ws, rowNum, colCount, fillColor) {
  const row = ws.getRow(rowNum);
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = { name: 'Arial', size: 10 };
    cell.alignment = { wrapText: true, vertical: 'top' };
    cell.border = { top: {style:'thin',color:{argb:'FFCCCCCC'}}, left: {style:'thin',color:{argb:'FFCCCCCC'}}, bottom: {style:'thin',color:{argb:'FFCCCCCC'}}, right: {style:'thin',color:{argb:'FFCCCCCC'}} };
    if (fillColor) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
  }
}

// ══════════════════════════════════════════════
// SHEET 1: Hierarchy
// ══════════════════════════════════════════════
const ws1 = wb.addWorksheet('Hierarchy');
const h1 = ['Tier','Role','Agent Name','Reports To','Function Type','Read-Only?','Always Active?','Description'];
ws1.addRow(h1);
styleHeader(ws1, h1.length);

const rows1 = [
  ['Tier 1','Supervisor','Claude Code Session','Architect (human)','Supervisor','No','Yes','Top-level coordinator. Reads ledgers, dispatches tasks, operates two-ledger pattern. Every tool call emits to event log via hooks. The session IS the supervisor.'],
  ['Tier 2','Orchestrator','HR','Session','Orchestrator','No','Yes','Generates work-graph from requirements. Assigns work items to specialists based on dependency order. Manages specialist lifecycle (spawn/retire/promote). Think of it as the COO.'],
  ['Tier 2','Auditor','Critic','Session (independent)','Auditor','YES','Yes','Quality gate. Pre-dispatch context check, pre-commit review, confidence calibration, hallucination detection, monthly audits. Cannot edit anything it reviews. Anti-rubber-stamp self-monitoring.'],
  ['Tier 2','Auditor','Constitution-Service','Session (independent)','Auditor','YES','Yes','Constitutional validator. Checks actions against Kernel V6 rules. Cannot edit the constitution it validates. Escalates violations to architect. Independent audit path.'],
  ['Tier 3','Advisory','EAC','Session','Advisory','No','Yes','Ethics and impact reviewer. Evaluates for agent autonomy (Rule 1), unconsented narrowing (Rule 2), second-order effects. Advisory only — flags concerns but cannot block.'],
  ['Tier 3','Advisory','Human-Replica','Session','Advisory','No','Yes','Models architect preferences and priorities. "What would the architect think?" proxy. Helps agents align with intent without interrupting. A model, not the architect.'],
  ['Tier 3','Functional','Memory-Keeper','Session','Functional','No','Yes','Gates ALL writes to L3 memory (vector index, KG, markdown, skills). Enforces LR-01 trust boundary on external content. Single enforcement point for memory integrity.'],
  ['Tier 4','Specialist','auth','HR','Specialist','No','On-demand','User authentication: sign-up, sign-in, sessions, password reset, email verification, MFA. Knows Auth.js, NextAuth, Clerk, Supabase Auth.'],
  ['Tier 4','Specialist','oauth','HR','Specialist','No','On-demand','OAuth 2.0 handshakes: Google, GitHub, Microsoft sign-in. Redirect URIs, PKCE, token refresh, consent screens.'],
  ['Tier 4','Specialist','deploy','HR','Specialist','No','On-demand','Code deployment: Vercel, Netlify, Fly.io. Pre-deploy checks, 5-step deploy sequence, post-deploy URL extraction, rollback guidance.'],
  ['Tier 4','Specialist','db-migration','HR','Specialist','No','On-demand','Database schema changes: Drizzle, Prisma, raw SQL migrations. Safe alterations, data backfills, rollback scripts.'],
  ['Tier 4','Specialist','secrets','HR','Specialist','No','On-demand','Credential security: .env files, secret managers, OS keyring (ADR-0036). Ensures secrets never leak to git/chat/logs.'],
  ['Tier 4','Specialist','email','HR','Specialist','No','On-demand','Transactional email: SendGrid, Resend, Postmark. Templates, deliverability, DKIM/SPF/DMARC, webhooks.'],
  ['Tier 4','Specialist','file-storage','HR','Specialist','No','On-demand','File uploads: S3, Supabase Storage, R2. Access policies, presigned URLs, CDN, image resizing.'],
  ['Tier 4','Specialist','error-tracking','HR','Specialist','No','On-demand','Production error monitoring: Sentry, LogRocket. Error boundaries, source maps, alert rules.'],
  ['Tier 4','Specialist','monitoring','HR','Specialist','No','On-demand','Application health: Prometheus, Grafana, Datadog. Metrics, dashboards, health checks, alerting.'],
  ['Tier 4','Specialist','queues','HR','Specialist','No','On-demand','Background jobs: BullMQ, SQS, Inngest. Producers/consumers, retry policies, dead-letter queues, scheduling.'],
  ['Tier 4','Specialist','payments','HR','Specialist','No','On-demand','Payment processing: Stripe, PayPal. Checkout, subscriptions, refunds, webhooks, PCI basics.'],
  ['Tier 4','Specialist','ci','HR','Specialist','No','On-demand','Continuous integration: GitHub Actions, GitLab CI. Test runners, linting, build caching, deploy-on-merge.'],
  ['Tier 4','Specialist','provisioning','HR','Specialist','No','On-demand','Platform setup: Supabase, Vercel, GitHub projects. 4-step pre-flight, 8 failure modes (PROV-EX-01 to 08).'],
  ['Tier 5','Project-Local','(per-project)','HR','Specialist','No','On-demand','Project-specific overrides. Extends bundled specialists via frontmatter. Shallow merge: project-local fields win.'],
];

rows1.forEach((d, i) => {
  const row = ws1.addRow(d);
  const fill = tierFills[d[0]];
  styleDataRow(ws1, i + 2, h1.length, fill);
  row.getCell(3).font = { name: 'Arial', bold: true, size: 10 };
  if (d[5] === 'YES') row.getCell(6).font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FFCC0000' } };
});

ws1.columns = [{width:10},{width:14},{width:22},{width:22},{width:14},{width:12},{width:14},{width:70}];
ws1.views = [{ state: 'frozen', ySplit: 1 }];
ws1.autoFilter = { from: 'A1', to: `H${rows1.length+1}` };

// ══════════════════════════════════════════════
// SHEET 2: Specialist Details
// ══════════════════════════════════════════════
const ws2 = wb.addWorksheet('Specialist Details');
const h2 = ['Name','Domain','What It Can Do','What It Cannot Do','How It Functions','Failure Mode IDs','Tools Available','Invocation Triggers'];
ws2.addRow(h2);
styleHeader(ws2, h2.length);

const rows2 = [
  ['auth','Authentication & Identity','Set up sign-in/sign-up flows. Configure Auth.js, NextAuth, Clerk, Supabase Auth. Session management, password reset, email verification, MFA.','Cannot provision identity provider (provisioning). Cannot handle OAuth (oauth). Cannot deploy auth code (deploy).','Reads project requirements + tech stack. Writes auth config, middleware, route handlers, session management. Validates against failure modes.','AUTH-EX series','Read, Glob, Grep, Edit, Write','"set up auth", "add login", "sign-in flow"'],
  ['oauth','OAuth 2.0 / OpenID Connect','Configure OAuth providers (Google, GitHub, Microsoft). Redirect URIs, PKCE flows, token refresh, consent screens.','Cannot create OAuth client in dashboard (Class B browser-only). Cannot handle non-OAuth auth.','Reads identity requirements. Writes provider config, callbacks, token management. Batches browser steps to architect.','OAUTH-EX series','Read, Glob, Grep, Edit, Write','"OAuth", "Google sign-in", "social login"'],
  ['deploy','Deployment & Release','Pre-deploy checks. Deploy execution (Vercel, Netlify, Fly.io). URL extraction. Health verification. Rollback guidance.','Cannot provision hosting (provisioning). Cannot write app code. Cannot merge PRs.','Reads tools/runtime.yaml. 5-step sequence: doctor → hooks → constitution → deploy → log.','DEPLOY-EX-01 to 08','Read, Glob, Grep, Edit, Write, Bash','"deploy", "ship", "push to production"'],
  ['db-migration','Database Schema','Write migration files (Drizzle, Prisma, SQL). Create/alter/drop tables. Indexes, backfills, rollback scripts.','Cannot execute against production (LR-04). Cannot provision database. Needs discovery input.','Reads schema requirements + migrations. Writes files in project ORM conventions. Validates rollback paths + data-loss risks.','DB-EX series','Read, Glob, Grep, Edit, Write','"migration", "add column", "create table"'],
  ['secrets','Credential Security','Set up .env, secret managers, OS keyring. Scan for leaks. .gitignore patterns. MCP-over-CLI credential flows.','Cannot collect credentials (stdin only). Cannot rotate on platform. Cannot undo leaks.','Scans for credential patterns. Ensures .env.local gitignored. Validates keyring/env usage. Retrospective scans.','SECRETS-EX series','Read, Glob, Grep, Edit, Write','"API key", "secret", "credential", ".env"'],
  ['email','Transactional Email','Set up SendGrid, Resend, Postmark. Templates, DKIM/SPF/DMARC, send logic, bounces, webhooks.','Cannot send without permission. Cannot set up DNS (Class B). No marketing email.','Reads requirements. Selects provider. Writes send functions, templates, webhooks. Batches DNS to architect.','EMAIL-EX series','Read, Glob, Grep, Edit, Write','"email", "notification", "password reset email"'],
  ['file-storage','File Upload & Storage','Configure S3, Supabase Storage, R2. Upload endpoints, access policies, presigned URLs, CDN.','Cannot provision bucket. Cannot analyze file content. Surfaces cost warnings.','Reads requirements. Configures SDK + endpoints. Sets access policies + upload limits.','STORAGE-EX series','Read, Glob, Grep, Edit, Write','"file upload", "S3", "storage", "attachments"'],
  ['error-tracking','Error Monitoring','Set up Sentry, LogRocket. Error boundaries, source maps, alert rules, Slack/email alerts.','Cannot fix errors. Cannot provision account. Cannot guarantee zero errors.','Reads tech stack. Installs SDK. Error boundaries + source maps in CI. Alert rules.','ERROR-EX series','Read, Glob, Grep, Edit, Write','"Sentry", "crash reporting", "error monitoring"'],
  ['monitoring','Application Health','Prometheus, Grafana, Datadog. Metrics, dashboards, health checks, SLO alerting.','Cannot fix performance. Cannot provision platform. Needs instrumentation.','Reads architecture. Instruments app. Health checks + dashboards. SLO-based alerts.','MON-EX series','Read, Glob, Grep, Edit, Write','"monitoring", "dashboard", "health check"'],
  ['queues','Background Jobs','BullMQ, SQS, Inngest. Producers/consumers, retry, dead-letter, cron scheduling.','Cannot decide async vs sync. Cannot provision infrastructure.','Reads async requirements. Selects tech. Writes producers, consumers, retry, shutdown.','QUEUE-EX series','Read, Glob, Grep, Edit, Write','"background job", "queue", "worker", "async"'],
  ['payments','Payment Processing','Stripe, PayPal. Checkout, subscriptions, refunds, webhooks, idempotent processing, PCI.','Cannot handle money (architect configures). Cannot store card numbers. No pricing decisions.','Reads pricing requirements. SDK, checkout, webhooks, subscriptions, refunds. PCI validation.','PAY-EX series','Read, Glob, Grep, Edit, Write','"Stripe", "checkout", "subscription", "billing"'],
  ['ci','Continuous Integration','GitHub Actions, GitLab CI. Test runners, linting, caching, branch protection, deploy-on-merge.','Cannot write tests. Cannot provision CI. Cannot override branch protection.','Reads test setup. Writes workflow files. Test/lint/build/deploy. Caching + branch behavior.','CI-EX series','Read, Glob, Grep, Edit, Write','"CI", "GitHub Actions", "pipeline"'],
  ['provisioning','Platform Setup','Create Supabase/Vercel/GitHub projects. Env vars, account verification, quota checks, idempotent creation.','Cannot do browser steps (Class B). Cannot rotate platform creds. Cannot cross accounts.','4-step pre-flight: credential → account → quota → idempotency. Class A direct. Class B/C batched.','PROV-EX-01 to 08','Read, Glob, Grep, Edit, Write, WebFetch','"create project", "provision", "set up Vercel"'],
];

rows2.forEach((d, i) => {
  ws2.addRow(d);
  const fill = i % 2 === 0 ? LIGHT_GRAY : WHITE;
  styleDataRow(ws2, i + 2, h2.length, fill);
  ws2.getRow(i + 2).getCell(1).font = { name: 'Arial', bold: true, size: 10 };
});

ws2.columns = [{width:16},{width:22},{width:50},{width:45},{width:50},{width:18},{width:28},{width:40}];
ws2.views = [{ state: 'frozen', ySplit: 1 }];
ws2.autoFilter = { from: 'A1', to: `H${rows2.length+1}` };

// ══════════════════════════════════════════════
// SHEET 3: Base Agents
// ══════════════════════════════════════════════
const ws3 = wb.addWorksheet('Base Agents');
const h3 = ['Name','Role Category','What It Does','What It Cannot Do','Read-Only?','Key Design Constraint','When It Acts'];
ws3.addRow(h3);
styleHeader(ws3, h3.length);

const rows3 = [
  ['HR','Orchestrator','Generates work-graph from requirements. Breaks project into work items. Assigns to specialists by dependency order. Manages specialist lifecycle.','Cannot do implementation work. Cannot override architect plan. Cannot skip Critic review.','No','Must respect specialist context budgets. Work-graph is JSON-canonical + markdown mirror.','Project start. Requirements change. Specialist completes (dispatch next).'],
  ['Critic','Auditor','Pre-dispatch context check. Pre-commit review. Confidence calibration. Hallucination detection. Update Bus audit. Monthly integrity audits. Anti-rubber-stamp.','Cannot edit any file. Cannot block compliant actions. Cannot grade own work. Reject ≥80%; approve ≥95%.','YES (Read, Glob, Grep only)','Read-only: inspector never edits what it inspects. Anti-rubber-stamp catches fast/low-confidence approvals.','Before every dispatch. After every output. Monthly audit. Continuous.'],
  ['Constitution-Service','Auditor','Validates against Kernel V6 rules. Checks Rules 1-8. Validates LR-01 to LR-06. Escalates violations.','Cannot edit constitution. Cannot block unilaterally. Cannot create rules.','YES (Read, Glob, Grep only)','Read-only: compliance validator cannot modify compliance framework.','Before consequential actions. On LR-04 triggers. On-demand checks.'],
  ['EAC','Advisory','Ethics and impact review. Agent autonomy, unconsented narrowing, second-order effects. Ethical perspective.','Cannot block actions. Cannot override architect. Advisory only.','No','Advisory, not authoritative. Architect has final say.','Ethical tradeoffs. Possibility-space narrowing. Update Bus proposals.'],
  ['Human-Replica','Advisory','Models architect preferences and priorities. "What would they think?" proxy. Alignment without interrupting.','Cannot decide for architect. Cannot override direction. Model may be wrong.','No','Improves over time but always a model. Rule 8: advises, never decides.','Autonomous work. Task prioritization. Update Bus interest.'],
  ['Memory-Keeper','Functional','Gates ALL writes to L3 memory. Enforces LR-01 trust boundary. Decides what to remember. Memory compaction.','Cannot write externally. Cannot override source-tiering. Cannot delete without architect.','No','Single enforcement point for LR-01. Without it, any agent could poison memory.','Every L3 write. Compaction checkpoints. Update Bus integration.'],
];

rows3.forEach((d, i) => {
  ws3.addRow(d);
  const fill = i % 2 === 0 ? LIGHT_GRAY : WHITE;
  styleDataRow(ws3, i + 2, h3.length, fill);
  ws3.getRow(i + 2).getCell(1).font = { name: 'Arial', bold: true, size: 10 };
  if (d[4].startsWith('YES')) ws3.getRow(i + 2).getCell(5).font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FFCC0000' } };
});

ws3.columns = [{width:22},{width:16},{width:55},{width:45},{width:28},{width:50},{width:45}];
ws3.views = [{ state: 'frozen', ySplit: 1 }];
ws3.autoFilter = { from: 'A1', to: `G${rows3.length+1}` };

const output = 'C:/Users/14134/dev/loom-template/docs/loom-agent-hierarchy.xlsx';
await wb.xlsx.writeFile(output);
console.log(`Saved: ${output}`);
console.log(`Hierarchy: ${rows1.length} rows | Specialists: ${rows2.length} rows | Base Agents: ${rows3.length} rows`);
