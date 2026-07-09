// Shared secret-shape patterns — used by both pre-tool-use.mjs (value-shape
// redaction) and scripts/lib/secrets-doctor.mjs (retrospective scan).
//
// Per ADR-0018.
//
// Each entry:
//   - `pattern`: a RegExp that matches the secret shape
//   - `label`:   a short tag used in redactions and doctor output
//   - `confidence`: "high" (well-defined prefix; very few false positives)
//                 | "medium" (shape is recognizable but JWT-like, false-positive risk)
//
// HIGH-confidence patterns are redacted at the hook layer and reported by the
// doctor. MEDIUM-confidence patterns are reported by the doctor only (the
// hook risks redacting legitimate non-secret JWTs).

export const SECRET_PATTERNS = [
  // GitHub
  { pattern: /\bghp_[A-Za-z0-9]{30,}\b/g, label: "GitHub PAT (classic)", confidence: "high" },
  { pattern: /\bgho_[A-Za-z0-9]{30,}\b/g, label: "GitHub OAuth token", confidence: "high" },
  { pattern: /\bghs_[A-Za-z0-9]{30,}\b/g, label: "GitHub server token", confidence: "high" },
  { pattern: /\bghu_[A-Za-z0-9]{30,}\b/g, label: "GitHub user token", confidence: "high" },
  { pattern: /\bghr_[A-Za-z0-9]{30,}\b/g, label: "GitHub refresh token", confidence: "high" },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g, label: "GitHub fine-grained PAT", confidence: "high" },

  // Anthropic / OpenAI
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{30,}\b/g, label: "Anthropic API key", confidence: "high" },
  { pattern: /\bsk-(?!ant-)[A-Za-z0-9]{40,}\b/g, label: "OpenAI-style API key", confidence: "high" },

  // AWS
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, label: "AWS access key ID", confidence: "high" },
  { pattern: /\bASIA[0-9A-Z]{16}\b/g, label: "AWS temporary access key ID", confidence: "high" },

  // npm / PyPI / GitLab
  { pattern: /\bnpm_[A-Za-z0-9]{30,}\b/g, label: "npm token", confidence: "high" },
  { pattern: /\bpypi-AgEIcHlwaS5vcmcCJ[A-Za-z0-9_-]{40,}\b/g, label: "PyPI token", confidence: "high" },
  { pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, label: "GitLab PAT", confidence: "high" },

  // Slack
  { pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g, label: "Slack token", confidence: "high" },

  // Stripe
  { pattern: /\b(?:sk|rk|pk)_(?:test|live)_[0-9A-Za-z]{20,}\b/g, label: "Stripe key", confidence: "high" },

  // Vercel — 24-char alphanumeric tied to a vercel context word
  {
    pattern: /\bvercel[_-]?(?:token|api[_-]?key)\s*[=:]\s*["']?([A-Za-z0-9]{24})["']?/gi,
    label: "Vercel token (contextual)",
    confidence: "high",
  },

  // JWT shape — could be a Supabase service-role key, a session token, or
  // a non-secret ID token. Medium-confidence: doctor flags; hook does not redact.
  {
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    label: "JWT shape (possibly Supabase service-role key, session token, or non-secret ID)",
    confidence: "medium",
  },

  // Generic "looks-like-a-secret" assignment in env/config
  {
    pattern: /\b(?:secret|password|token|api[_-]?key|access[_-]?key|private[_-]?key)\s*[:=]\s*["']?([A-Za-z0-9_/+=-]{20,})["']?/gi,
    label: "Generic secret assignment",
    confidence: "medium",
  },
];

// ── Redaction helper (high-confidence only) ──────────────────────────────

const HIGH_PATTERNS = SECRET_PATTERNS.filter((p) => p.confidence === "high");

export function redactSecrets(text) {
  if (typeof text !== "string") return text;
  let out = text;
  for (const { pattern, label } of HIGH_PATTERNS) {
    out = out.replace(pattern, `<redacted:${label}>`);
  }
  return out;
}

// ── Scan helper (all patterns) ───────────────────────────────────────────
//
// Returns [{ label, confidence, sample }] — sample is the matched value
// truncated and partially masked.

export function scanForSecrets(text) {
  if (typeof text !== "string") return [];
  const hits = [];
  for (const { pattern, label, confidence } of SECRET_PATTERNS) {
    // Reset lastIndex since we use the `g` flag.
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const raw = m[0];
      hits.push({
        label,
        confidence,
        sample: maskSample(raw),
      });
      if (!pattern.global) break;
    }
  }
  return hits;
}

function maskSample(s) {
  if (s.length <= 12) return s.slice(0, 4) + "…";
  return s.slice(0, 6) + "…(masked)…" + s.slice(-4);
}
