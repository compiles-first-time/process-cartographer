---
date: 2026-07-18
agent: builder (Fable 5)
severity: medium
share: true
---

# Vite dev discovers a dynamically-imported dep mid-session and force-reloads — eating the user's in-flight action

## What happened

Nick pasted a GitHub URL and clicked **Map repo** — and "nothing happened." No error banner, no city; the page just ended up back at the hero screen.

The dev-server log had the exact story, timestamped at his click:

```
2:07:46 AM [vite] ✨ new dependencies optimized: web-tree-sitter
2:07:46 AM [vite] ✨ optimized dependencies changed. reloading
```

The click actually **worked**: the ingest fetched the repo's files, then `handleResult` hit the code-split syntax tier — `await import("./repo/syntax/browserEnv.ts")` — which statically imports `web-tree-sitter`. That was the **first time in the dev session** this dependency was ever requested (it is reachable *only* through the dynamic import, so vite's startup crawl never saw it). Vite's dep optimizer kicked in at runtime, pre-bundled the package, declared its optimized-deps set changed, and **force-reloaded the page** — discarding all in-flight state: the fetched files, the pending promise, the busy flag. React state evaporated; the app rebooted to the hero screen. To the user: a dead button.

Two compounding factors made it look worse than it was:
1. **The hero screen never rendered the busy overlay** (it was only mounted in the post-load layout), so the multi-second fetch phase had almost no feedback even when things were working — the only signal was the button's own "Loading…" label.
2. A second click would have succeeded (the dep was optimized by then), but nothing communicated that.

## Why it happens

Vite pre-bundles (`optimizeDeps`) the dependencies it can discover by crawling static imports at server start. Dependencies reachable **only via dynamic `import()`** are invisible to that crawl and get discovered lazily, at the moment of first use — and a change in the optimized-deps set triggers a full page reload by design. Production builds are immune (rollup bundles everything ahead of time); this is strictly a dev-server behavior. Our own architecture made it likely: we deliberately code-split the wasm-heavy syntax tier so UiPath-only sessions never pay for it — which guaranteed the dep would be dynamically discovered mid-action for the first repo ingest of every fresh dev session.

## What we did

1. **`vite.config.ts` → `optimizeDeps.include: ["web-tree-sitter"]`** — the canonical fix: pre-bundle at startup what you know you'll dynamically import later. Verified: after restart, `/node_modules/.vite/deps/web-tree-sitter.js` returns 200 before any user action, and no mid-session "optimized dependencies changed" reload can occur.
2. **Busy overlay on the hero screen too** (it existed only post-load), with a spinner (reduced-motion aware).
3. **Real progress feedback**: the GitHub adapter now reports per-file fetch progress ("fetching 87/213 files…") and the syntax tier reports parse progress ("parsing 141 JS/TS files…") through to the overlay — long ingests are visibly alive.

## What we'd do differently

1. **Whenever a dependency is reachable only via dynamic `import()`, add it to `optimizeDeps.include` in the same commit.** The code-split boundary that saves bundle cost in prod is exactly the thing that triggers lazy dep discovery in dev.
2. **Every async user action needs visible feedback from the moment of the click** — a disabled button label is not feedback when the wait is multi-second. The overlay must exist on every screen the action can start from.
3. **The dev-server log is the first diagnostic stop** for "nothing happened" reports — the reload line was unambiguous and timestamped; no reproduction was needed to find the cause.
4. E2E tests in Node bypass vite's dev pipeline entirely, so this class of bug (dev-harness behavior, not app logic) is invisible to them — a Playwright smoke test against the **dev server** (not just the build) would have caught it.

## Related

- `vite.config.ts` (the fix + pointer to this lesson)
- `src/App.tsx`, `src/ui/IngestPanel.tsx`, `src/ingest/fromGithub.ts`, `src/ingest/buildIR.ts` (overlay + progress plumbing)
- [ADR-0055](../adr/0055-universal-repo-cartography-computed-not-generated.md) (the code-split syntax tier this interacted with)
- Vite docs: dep pre-bundling / `optimizeDeps.include` (discovery of dynamically-imported deps causes reload)
