#!/usr/bin/env node
// `wait-for-deploy` — wait for a deploy operation to reach a terminal state,
// treating "non-progressing" as a first-class outcome (not silence).
//
// Per Finding 3 of the AnonForum deployment session (2026-05-21): a naïve
// `until grep -qE "Production|Error|Ready"` loop hung for 12 hours because
// Vercel's quiet-fail state is `UNKNOWN` — not matched by any of those
// tokens. The wait loop never terminated, and nothing else surfaced the stall.
//
// This primitive supplies the missing third category. Three outcomes:
//   - succeeded             — the platform reported a known success state
//   - failed                — the platform reported a known failure state
//   - non_progressing       — the deploy is neither succeeding nor failing
//                             (explicit unknown-class state, BUILDING for
//                             too long, or no state change for too long)
//
// Non-progressing fires a LOUD onProgress event before returning, so the
// caller can surface it to the user. The whole point of the primitive is
// that silence is the bug — every code path here either returns a terminal
// outcome or emits a progress event.
//
// Used by:
//   - scripts/lib/deploy.mjs (planned integration in a follow-up)
//   - agents/specialists/_registry/deploy/SKILL.md (specialists call this
//     instead of writing their own wait loops; see ADR-0032)
//
// Cross-platform: Node 22+. No external deps.

// ── Terminal-state registry per platform ─────────────────────────────────
//
// Each entry classifies states a platform may report:
//   succeeded       — terminal; the deploy is live
//   failed          — terminal; the deploy hard-failed
//   in_progress     — non-terminal; deploy is still working (no event fires)
//   non_progressing — terminal once observed; deploy is stuck
//
// Adding a new platform: enumerate its states. Source-of-truth is the
// platform's CLI/API documentation. Cite the source in the comment.
//
// State matching is CASE-INSENSITIVE and matches WHOLE TOKENS in raw text
// (word-boundary regex). This means "Ready" inside "Ready in 3s" matches
// `READY` because the matcher uppercases both sides before comparing.

export const TERMINAL_STATES = {
  // Vercel — observed via `vercel deploy` stdout, `vercel ls`, `vercel inspect`.
  // Reference: https://vercel.com/docs/deployments/states
  vercel: {
    succeeded: ["READY"],
    failed: ["ERROR", "CANCELED"],
    in_progress: ["BUILDING", "QUEUED", "INITIALIZING"],
    non_progressing: ["UNKNOWN"],
  },

  // Netlify — observed via `netlify deploy` stdout, `netlify status`.
  // Reference: https://docs.netlify.com/api/get-started/#deploys
  netlify: {
    succeeded: ["READY", "CURRENT"],
    failed: ["ERROR", "REJECTED"],
    in_progress: ["UPLOADING", "UPLOADED", "PREPARING", "PROCESSING", "ENQUEUED"],
    non_progressing: ["NEW"],
  },

  // Fly.io — observed via `flyctl deploy` stdout and `flyctl status`.
  // Reference: https://fly.io/docs/reference/release-states/
  fly: {
    succeeded: ["RUNNING", "SUCCEEDED"],
    failed: ["FAILED", "DEAD", "CANCELLED"],
    in_progress: ["PENDING", "STARTING", "RELEASING"],
    non_progressing: ["UNKNOWN"],
  },

  // Render — observed via `render deploys` and dashboard.
  // Reference: https://render.com/docs/deploys#deploy-statuses
  render: {
    succeeded: ["LIVE"],
    failed: ["FAILED", "CANCELED", "DEACTIVATED"],
    in_progress: ["BUILD_IN_PROGRESS", "UPDATE_IN_PROGRESS"],
    non_progressing: ["BUILD_FAILED", "UPDATE_FAILED"],
  },
};

// ── Defaults ─────────────────────────────────────────────────────────────

// Time a deploy may spend in an `in_progress` state before being treated
// as non_progressing. 20 min covers a worst-case clean cold build on
// Vercel Hobby; longer than that is almost always stuck.
export const DEFAULT_MAX_IN_PROGRESS_MS = 20 * 60 * 1000;

// Time without a state observation (i.e. no new tick) before stall fires.
// 5 min is generous — CLI tools that report nothing for 5 minutes are
// almost always wedged.
export const DEFAULT_STALL_MS = 5 * 60 * 1000;

// ── Outcome shape ────────────────────────────────────────────────────────
//
// { outcome: "succeeded" | "failed" | "non_progressing" | "aborted",
//   state: "<last-observed-state>" | null,
//   reason: "explicit_state" | "in_progress_timeout" | "stall" | undefined,
//   first_observed_at: <ms>,
//   last_observed_at: <ms>,
//   duration_ms: <ms>,
//   transitions: [{state, at}, ...]    // for audit / lessons-learned
// }

// ── Main entry point ─────────────────────────────────────────────────────
//
// waitForDeploy({ platform, events, onProgress?, maxInProgressMs?, stallMs?, signal? })
//
// `events` is an AsyncIterable yielding either:
//   - {state: "<NAME>", body?: any, at?: <ms>}            (poll-mode adapter)
//   - {raw_line: "<text>", at?: <ms>}                     (stream-mode adapter; we extract state)
//
// `onProgress(event)` is called for: state_change, non_progressing,
// terminal_outcome. The caller is expected to log + surface non_progressing
// loudly (this primitive does NOT print anything itself).

export async function waitForDeploy({
  platform,
  events,
  onProgress,
  maxInProgressMs = DEFAULT_MAX_IN_PROGRESS_MS,
  stallMs = DEFAULT_STALL_MS,
  signal,
  clock = () => Date.now(),
}) {
  if (!TERMINAL_STATES[platform]) {
    throw new Error(`wait-for-deploy: unknown platform '${platform}'. Known: ${Object.keys(TERMINAL_STATES).join(", ")}`);
  }
  if (!events || typeof events[Symbol.asyncIterator] !== "function") {
    throw new Error("wait-for-deploy: 'events' must be an AsyncIterable");
  }
  const reg = TERMINAL_STATES[platform];
  const start = clock();

  let lastState = null;
  let lastTickAt = start;
  let inProgressSince = null;
  const transitions = [];

  // The stall detector runs on an interval independent of the event stream
  // — it must fire even if `events` produces nothing.
  let stallHandle = null;
  let stallFired = false;
  const stallPromise = new Promise((resolve) => {
    stallHandle = setInterval(() => {
      const now = clock();
      if (now - lastTickAt > stallMs) {
        stallFired = true;
        resolve({ kind: "stall", at: now, silent_ms: now - lastTickAt });
      }
    }, Math.min(stallMs / 4, 30 * 1000));
  });

  // Abort listener (optional)
  let abortFired = false;
  const abortPromise = new Promise((resolve) => {
    if (!signal) return;
    if (signal.aborted) { abortFired = true; resolve({ kind: "abort" }); return; }
    signal.addEventListener("abort", () => { abortFired = true; resolve({ kind: "abort" }); }, { once: true });
  });

  function finalize(outcome, opts = {}) {
    if (stallHandle) clearInterval(stallHandle);
    const now = clock();
    const result = {
      outcome,
      state: lastState,
      reason: opts.reason,
      first_observed_at: start,
      last_observed_at: lastTickAt,
      duration_ms: now - start,
      transitions: transitions.slice(),
      ...opts.extra,
    };
    onProgress?.({ event: "terminal_outcome", ...result });
    return result;
  }

  // Race: event stream vs. stall detector vs. abort
  const iterator = events[Symbol.asyncIterator]();

  while (true) {
    const nextEvent = iterator.next();
    const winner = await Promise.race([
      nextEvent.then((v) => ({ kind: "event", value: v })),
      stallPromise,
      abortPromise,
    ]);

    if (winner.kind === "abort") {
      onProgress?.({ event: "aborted", at: clock() });
      return finalize("aborted");
    }

    if (winner.kind === "stall") {
      onProgress?.({
        event: "non_progressing",
        reason: "stall",
        state: lastState,
        silent_ms: winner.silent_ms,
        at: winner.at,
        message:
          `Deploy is non-progressing: no state observation for ${(winner.silent_ms / 1000).toFixed(0)}s ` +
          `(last state: ${lastState ?? "<none>"}). ` +
          `Investigate — the CLI may have hung, or the platform may not be reporting status.`,
      });
      return finalize("non_progressing", { reason: "stall", extra: { silent_ms: winner.silent_ms } });
    }

    // Event consumed
    if (winner.value.done) {
      // Stream ended without a terminal state — treat as stall outcome.
      onProgress?.({
        event: "non_progressing",
        reason: "stream_ended_without_terminal_state",
        state: lastState,
        at: clock(),
        message:
          `Deploy stream ended without reaching a terminal state ` +
          `(last state: ${lastState ?? "<none>"}). The CLI exited but the deploy outcome was never observed.`,
      });
      return finalize("non_progressing", { reason: "stream_ended_without_terminal_state" });
    }

    const tick = winner.value.value;
    const at = tick.at ?? clock();
    lastTickAt = at;

    // Extract state — either provided directly or scraped from raw_line.
    let state = tick.state ?? null;
    if (!state && tick.raw_line) state = extractStateFromLine(reg, tick.raw_line);
    if (!state) {
      // Tick had no extractable state. Counts as a tick (resets stall) but
      // doesn't change observed state. Useful for keep-alive lines from CLIs.
      continue;
    }
    state = state.toUpperCase();

    // State change?
    if (state !== lastState) {
      transitions.push({ state, at });
      onProgress?.({ event: "state_change", from: lastState, to: state, at });
      lastState = state;
      // Reset the in-progress timer when transitioning into an in_progress state.
      if (reg.in_progress.map((s) => s.toUpperCase()).includes(state)) {
        inProgressSince = at;
      } else {
        inProgressSince = null;
      }
    }

    // Terminal: succeeded
    if (reg.succeeded.map((s) => s.toUpperCase()).includes(state)) {
      return finalize("succeeded", { extra: { body: tick.body } });
    }

    // Terminal: failed
    if (reg.failed.map((s) => s.toUpperCase()).includes(state)) {
      return finalize("failed", { extra: { body: tick.body } });
    }

    // Terminal: non_progressing — explicit unknown-class state
    if (reg.non_progressing.map((s) => s.toUpperCase()).includes(state)) {
      onProgress?.({
        event: "non_progressing",
        reason: "explicit_state",
        state,
        at,
        message:
          `Deploy is non-progressing: platform reported state '${state}', which is the platform's ` +
          `unknown-class signal. This is the "neither succeeding nor failing" case — investigate ` +
          `the platform dashboard directly rather than waiting longer.`,
      });
      return finalize("non_progressing", { reason: "explicit_state", extra: { body: tick.body } });
    }

    // Conditional non_progressing — in_progress for too long
    if (reg.in_progress.map((s) => s.toUpperCase()).includes(state)) {
      if (inProgressSince !== null && at - inProgressSince > maxInProgressMs) {
        onProgress?.({
          event: "non_progressing",
          reason: "in_progress_timeout",
          state,
          in_progress_ms: at - inProgressSince,
          at,
          message:
            `Deploy has been in state '${state}' for ${((at - inProgressSince) / 1000).toFixed(0)}s ` +
            `(threshold ${(maxInProgressMs / 1000).toFixed(0)}s). This usually means the build is ` +
            `wedged. Check the platform dashboard for the actual failure reason.`,
        });
        return finalize("non_progressing", {
          reason: "in_progress_timeout",
          extra: { in_progress_ms: at - inProgressSince, body: tick.body },
        });
      }
    }
    // Loop continues — fetch next event.
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

// Scan a single line of CLI output for any known state token.
// Returns the first matched state (uppercase), or null.
//
// The matcher is intentionally conservative: it requires the state token
// as a whole word with non-alphanumeric boundaries. This avoids matching
// "READY" inside "ALREADY" or "ERROR" inside "MIRRORED".
export function extractStateFromLine(reg, line) {
  if (!line || typeof line !== "string") return null;
  const upper = line.toUpperCase();
  const allStates = []
    .concat(reg.succeeded)
    .concat(reg.failed)
    .concat(reg.in_progress)
    .concat(reg.non_progressing)
    .map((s) => s.toUpperCase());
  // Sort by length descending so "BUILD_FAILED" matches before "FAILED".
  allStates.sort((a, b) => b.length - a.length);
  for (const s of allStates) {
    const re = new RegExp(`(^|[^A-Z0-9_])${escapeRegex(s)}([^A-Z0-9_]|$)`);
    if (re.test(upper)) return s;
  }
  return null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Convenience adapters ─────────────────────────────────────────────────

// Adapter: poll a function on an interval, yielding {state, body, at} events.
export async function* pollEvents(pollFn, { intervalMs = 5000, signal } = {}) {
  while (true) {
    if (signal?.aborted) return;
    const at = Date.now();
    let result;
    try {
      result = await pollFn();
    } catch (err) {
      // Surface errors as raw_line so the matcher can pick up a failure token
      // (e.g., "ERROR: not authorized") rather than crashing the loop.
      yield { raw_line: String(err?.message ?? err), at };
      await sleep(intervalMs);
      continue;
    }
    if (typeof result === "string") yield { raw_line: result, at };
    else if (result && typeof result === "object") yield { ...result, at: result.at ?? at };
    await sleep(intervalMs);
  }
}

// Adapter: turn a Readable line stream into deploy events.
// Caller passes an AsyncIterable<string> of lines.
export async function* lineStreamEvents(lineStream) {
  for await (const line of lineStream) {
    yield { raw_line: String(line), at: Date.now() };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
