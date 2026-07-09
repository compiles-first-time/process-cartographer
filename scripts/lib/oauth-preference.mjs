// OAuth-vs-API-key preference detector — used by pre-tool-use.mjs and
// scripts/lib/secrets-doctor.mjs. Per ADR-0028 / LR-04 credentials category.
//
// Patterns flag tool calls / env files where the user is using a long-lived
// API key for a service that offers OAuth (provider-issued, short-lived,
// scoped). Surfaces a hint; does not block.

export const OAUTH_PREFERENCE_PATTERNS = [
  {
    service: "GitHub",
    long_lived_pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    oauth_alternative: "`gh auth login` (OAuth device flow) — issues a short-lived token scoped to the device",
    rationale: "GitHub deprecates password auth and recommends OAuth device flow or GitHub Apps over long-lived PATs for human-driven flows",
  },
  {
    service: "Google Cloud",
    long_lived_pattern: /\bGOOGLE_APPLICATION_CREDENTIALS\s*=\s*['"]?[^'"\s]+\.json/i,
    oauth_alternative: "`gcloud auth application-default login` — issues an Application Default Credential via OAuth",
    rationale: "Service-account JSON keys are long-lived + hard to rotate; ADC + Workload Identity Federation is Google's preferred path",
  },
  {
    service: "AWS",
    long_lived_pattern: /\bAKIA[0-9A-Z]{16}\b/,
    oauth_alternative: "`aws configure sso` (IAM Identity Center) — issues short-lived credentials via OIDC",
    rationale: "AWS Security Best Practices (2024) deprecate IAM users with long-lived access keys for human flows; SSO / Identity Center is the recommendation",
  },
  {
    service: "Vercel",
    long_lived_pattern: /\bvercel_token\s*[=:]\s*["']?[a-zA-Z0-9]{20,}/i,
    oauth_alternative: "Vercel access tokens scoped to a project + expiration",
    rationale: "User-scoped tokens grant access to everything the user owns; project-scoped + expiring tokens are smaller credential scope (per LR-04)",
  },
  {
    service: "npm",
    long_lived_pattern: /\bnpm_[A-Za-z0-9]{30,}\b/,
    oauth_alternative: "Granular access tokens or trusted publisher (npm OIDC + GitHub Actions integration)",
    rationale: "npm classic tokens have org-wide scope; granular tokens + OIDC trusted publishing limit blast radius",
  },
];

/**
 * Scan text for long-lived API keys that have an OAuth-equivalent.
 * Returns an array of { service, oauth_alternative, rationale, sample }.
 */
export function detectOauthPreferenceMisses(text) {
  if (typeof text !== "string" || !text) return [];
  const hits = [];
  for (const p of OAUTH_PREFERENCE_PATTERNS) {
    const m = text.match(p.long_lived_pattern);
    if (m) {
      hits.push({
        service: p.service,
        oauth_alternative: p.oauth_alternative,
        rationale: p.rationale,
        sample: maskSample(m[0]),
      });
    }
  }
  return hits;
}

function maskSample(s) {
  if (s.length <= 12) return s.slice(0, 4) + "…";
  return s.slice(0, 6) + "…(masked)…" + s.slice(-4);
}
