---
date: 2026-07-06
agent: builder (Opus 4.8)
severity: medium
share: true
---

# Hand-rolled `file://` URL → path conversion is fragile on Windows — always use `fileURLToPath`

## What happened

`scripts/lib/permissions-classifier.test.mjs` was intermittently reporting **52 vs 60** assertions passed with **0 failures** (`OB-X-05`) — a flaky test that eroded the "always-green" reliability story. It was flaky *in the full suite*, fine *standalone*.

Root cause: the test computed the repo root with a hand-rolled regex on the URL pathname:

```js
const repoRoot = path.resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"), "../..");
```

`import.meta.url` was `file:///c:/Users/…` — a **lowercase** drive letter — but the regex `/^\/([A-Z]:)/` only matches **UPPERCASE**. On lowercase it was a no-op, leaving the leading slash → `path.resolve` produced the malformed `c:\c:\Users\…\loom-template` → `existsSync(yamlPath)` returned **false** → the entire 8-assertion integration block **silently skipped** via its `else` branch (→ 52). When the drive letter happened to be uppercase (varies by how Node is invoked / cwd casing), the regex worked → 60. Hence the intermittency — and the integration coverage was silently *not running* much of the time.

A grep for the same pattern found it in **two more places**, each a latent bug of the same class:

- `observatory/server.mjs` — `CONFIG_PATH` → on a lowercase drive the Observatory silently fell back to **default cost-rates** instead of loading `config.yaml`.
- `scripts/lib/deploy.mjs` — `isMain` detection → `path.resolve` on the malformed path could misidentify direct invocation.

## Why it happened

Converting a `file://` URL to a filesystem path is deceptively non-trivial on Windows: the drive-letter **case** is not guaranteed, there's a leading `/` before the drive, and path segments are **percent-encoded** (a space becomes `%20`). A regex that patches one of those (the leading slash) silently mishandles the others. Node provides `fileURLToPath()` precisely to get all of it right.

## What we did

Replaced all three with the standard API:

```js
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
```

Verified: the flaky test is now **stably 60 across repeated runs**; `CONFIG_PATH` resolves to the real `observatory/config.yaml`; `deploy.test.mjs` (37) still green; full suite 415/415.

## What we'd do differently

1. **Never hand-roll `file://` → path.** Always `fileURLToPath(import.meta.url)`. (ADR-0043's project-root resolver already does this correctly — the fragile copies predated/ignored it.)
2. **A test that skips assertions based on a path/existence check is a silent-coverage landmine** — worse than a loud failure. Make presence checks robust, or fail loudly, so the assert *count* can't drift unnoticed.
3. **Candidate `loom doctor` soft-check:** flag any `import.meta.url).pathname` usage (grep-able) to prevent recurrence.

## Related

- `scripts/lib/permissions-classifier.test.mjs`, `observatory/server.mjs`, `scripts/lib/deploy.mjs` (all fixed 2026-07-06)
- [ADR-0043 — cwd-robust project-root resolution](../adr/0043-cwd-robust-project-root-resolution.md) (same spirit; uses `fileURLToPath`)
- roadmap `OB-X-05`
