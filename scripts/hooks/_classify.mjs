// Loom intent classifier (heuristic) — used by user-prompt-submit and
// pre-tool-use hooks to suggest the appropriate subagent.
//
// This is deliberately heuristic — regex over user prompts and tool args.
// The goal is to *educate* the user about available subagents, not to be
// authoritative routing. Misclassification cost: a nag the user ignores.
// Correct-classification cost: nothing (subagent invocation stays the
// user/model's choice).
//
// Per ADR-0017.

// ── Intent → suggested subagent(s) ───────────────────────────────────────

const INTENT_RULES = [
  {
    intent: "deploy",
    patterns: [
      /\bdeploy(s|ed|ing|ment)?\b/i,
      /\bship(s|ped|ping)?\s+(?:to\s+)?(?:prod|production|staging|live)\b/i,
      /\brollback\b/i,
      /\brelease\s+(?:to\s+)?(?:prod|production)\b/i,
      /\bgo\s+live\b/i,
    ],
    suggest: ["constitution-service", "deploy primitive (scripts/deploy.{sh,ps1})"],
    rationale: "deployment is a production-state mutation; constitution-service must review per LR-02",
  },
  {
    intent: "destructive_or_irreversible",
    patterns: [
      /\bdelete\s+(?:all|every|the\s+entire)\b/i,
      /\bdrop\s+(?:table|database|schema)\b/i,
      /\btruncate\b/i,
      /\bforce[- ]?push\b/i,
      /\brm\s+-[rf]+\b/i,
      /\breset\s+--hard\b/i,
    ],
    suggest: ["constitution-service"],
    rationale: "irreversible action per Kernel Rule 20; constitution-service must validate",
  },
  {
    intent: "research",
    patterns: [
      /\binvestigate\b/i,
      /\bresearch\b/i,
      /\bfind\s+out\b/i,
      /\blook\s+up\b/i,
      /\bexplore\s+(?:the\s+)?(?:api|docs|library)\b/i,
      /\bhow\s+does\s+\w+\s+work\b/i,
      /\bevaluate\s+(?:options|alternatives|libraries)\b/i,
    ],
    suggest: ["eac"],
    rationale: "domain research is the EAC's role; lessons-learned should be checked first",
  },
  {
    intent: "review",
    patterns: [
      /\breview\b/i,
      /\baudit\b/i,
      /\bcheck\s+(?:if|whether|the)\b/i,
      /\binspect\b/i,
      /\bvalidate\s+(?:the|this|that)\b/i,
      /\bcritique\b/i,
    ],
    suggest: ["critic"],
    rationale: "the Critic is the read-only quality gate",
  },
  {
    intent: "memory",
    patterns: [
      /\bremember\b/i,
      /\brecall\b/i,
      /\bstore\s+(?:in|to)\s+memory\b/i,
      /\bretrieve\s+(?:from\s+)?memory\b/i,
      /\bsearch\s+(?:the\s+)?(?:vector|kg|knowledge\s+graph)\b/i,
      /\blesson(s)?[\- ]learned\b/i,
    ],
    suggest: ["memory-keeper"],
    rationale: "memory subsystem access routes through the Memory-Keeper",
  },
  {
    intent: "agent_lifecycle",
    patterns: [
      /\bcreate\s+(?:a\s+)?(?:specialist|agent)\b/i,
      /\bregister\s+(?:an?\s+)?agent\b/i,
      /\bonboard\s+(?:an?\s+)?agent\b/i,
      /\bretire\s+(?:an?\s+)?agent\b/i,
      /\bagent\s+roster\b/i,
    ],
    suggest: ["hr", "eac"],
    rationale: "agent lifecycle is HR's domain; EAC produces the specialist",
  },
  {
    intent: "user_proxy",
    patterns: [
      /\bwhat\s+would\s+(?:the\s+)?user\s+(?:do|prefer|want)\b/i,
      /\buser['']?s?\s+preferences?\b/i,
      /\bstand\s+in\s+for\s+(?:the\s+)?user\b/i,
    ],
    suggest: ["human-replica"],
    rationale: "the Human Replica models the user's preferences and stands in",
  },
  {
    intent: "governance",
    patterns: [
      /\bconstitution(al)?\b/i,
      /\bkernel\s+rule\b/i,
      /\bgovernance\b/i,
      /\bcompliance\s+check\b/i,
    ],
    suggest: ["constitution-service"],
    rationale: "explicit constitutional questions go to the Constitution Service",
  },
];

// Built-in INTENT_RULES match user prompts to base subagents (per ADR-0017).
// v0.4 (ADR-0023 + ADR-0024): also consult the specialist registry at
// agents/specialists/_registry/manifest.yaml for project-bootstrap-task
// patterns. PR-M (ADR-0024) populates the manifest with 12 starter
// specialists (auth, oauth, deploy, db-migration, secrets, email,
// file-storage, error-tracking, monitoring, queues, payments, ci).

import { loadRegistry, matchRegistry } from "../lib/registry-loader.mjs";

export async function classifyIntent(text) {
  if (!text || typeof text !== "string") return [];
  const hits = [];
  // Built-in rules first (base subagents)
  for (const rule of INTENT_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        hits.push({
          intent: rule.intent,
          suggest: rule.suggest,
          rationale: rule.rationale,
          matched: text.match(pattern)?.[0] || null,
        });
        break;
      }
    }
  }
  // Registry specialists (project-bootstrap tasks). Best-effort: if the
  // manifest is missing or malformed, return only built-in hits.
  try {
    const specialists = await loadRegistry();
    const registryHits = matchRegistry(text, specialists);
    hits.push(...registryHits);
  } catch {
    // Silent — registry is best-effort. v0.2 functionality is unaffected.
  }
  return hits;
}

// Synchronous fallback for callers that can't await (legacy path; not used
// by current hooks but kept for compatibility).
export function classifyIntentSync(text) {
  if (!text || typeof text !== "string") return [];
  const hits = [];
  for (const rule of INTENT_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        hits.push({
          intent: rule.intent,
          suggest: rule.suggest,
          rationale: rule.rationale,
          matched: text.match(pattern)?.[0] || null,
        });
        break;
      }
    }
  }
  return hits;
}

// ── Production-mutation detector (over a tool command string) ────────────
//
// These patterns indicate the tool is about to mutate production state.
// They are a superset of the destructive-op patterns in pre-tool-use.mjs:
// destructive-op = "irreversible local action"; production-mutation =
// "irreversible externally-visible action." LR-02 requires
// constitution-service to be invoked before a production-mutation tool call.

const PRODUCTION_MUTATION_PATTERNS = [
  { pattern: /\bvercel\s+deploy\b/i, label: "vercel deploy" },
  { pattern: /\bvercel\s+(?:.*\s+)?--prod\b/i, label: "vercel --prod" },
  { pattern: /\bnpm\s+publish\b/i, label: "npm publish" },
  { pattern: /\byarn\s+publish\b/i, label: "yarn publish" },
  { pattern: /\bpnpm\s+publish\b/i, label: "pnpm publish" },
  { pattern: /\bgh\s+release\s+create\b/i, label: "gh release create" },
  { pattern: /\bgit\s+push\s+(?:.*\s+)?(?:--force|-f)\b.*\b(?:main|master|prod|production)\b/i, label: "force push to prod branch" },
  { pattern: /\bgit\s+push\s+(?:.*\s+)?origin\s+(?:main|master|prod|production)\b/i, label: "git push origin <prod-branch>" },
  { pattern: /\bprisma\s+migrate\s+deploy\b/i, label: "prisma migrate deploy" },
  { pattern: /\bsupabase\s+db\s+push\b/i, label: "supabase db push" },
  { pattern: /\bterraform\s+apply\b/i, label: "terraform apply" },
  { pattern: /\bkubectl\s+apply\s+.*\s+(?:prod|production)/i, label: "kubectl apply (prod context)" },
];

export function classifyProductionMutation({ tool, input }) {
  const fields = ["command", "Command", "script"];
  let candidate = "";
  if (typeof input === "string") candidate = input;
  else if (input && typeof input === "object") {
    for (const f of fields) {
      if (typeof input[f] === "string") {
        candidate = input[f];
        break;
      }
    }
  }
  if (!candidate) return null;
  for (const { pattern, label } of PRODUCTION_MUTATION_PATTERNS) {
    if (pattern.test(candidate)) {
      const m = candidate.match(pattern);
      return { label, matched_on: m ? m[0] : null };
    }
  }
  return null;
}
