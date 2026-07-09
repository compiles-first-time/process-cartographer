// Loom keyring helper — thin wrapper around @napi-rs/keyring.
//
// Per ADR-0036: Loom's canonical OS keyring abstraction. Wraps Windows
// Credential Manager (DPAPI), macOS Keychain, Linux Secret Service (D-Bus).
//
// Service-key convention: `loom-<project-name>` (per project).
// Account-key convention: `<platform>-<credential-type>` (per credential).
//
// @napi-rs/keyring is a peer dependency. If it's not installed, every export
// here throws a clear, actionable error with the install command. Consumers
// (collect-credentials, load-env) should catch + present the error to the
// architect rather than swallow it.

import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const INSTALL_HINT =
  'OS keyring support requires @napi-rs/keyring. From your project root: npm install --save-optional @napi-rs/keyring';

// Lazy dynamic import — keyring is optional, so we don't fail at module
// load time if it's missing. Only the actual get/set/delete calls require it.
//
// IMPORTANT — resolution scope: @napi-rs/keyring is installed in the
// USER'S project (e.g., ravenwise/node_modules/), not in loom-template's
// node_modules (which doesn't exist — loom-template is a template, not a
// package). Node's default resolution looks relative to THIS file's
// location, which would fail. We use createRequire bound to the user's
// cwd so resolution walks up THEIR project's node_modules tree.
let _keyringModule = null;
async function loadKeyring() {
  if (_keyringModule) return _keyringModule;
  try {
    // Anchor createRequire to a path inside the user's project. We pass a
    // file path (not a directory) so Node treats it as the importer location;
    // it doesn't have to actually exist — only the directory's resolution
    // chain matters.
    const anchorDir = process.env.LOOM_KEYRING_PROJECT_DIR || process.cwd();
    const anchor = path.join(anchorDir, "noop.js");
    const requireFromUserProject = createRequire(anchor);
    const resolvedPath = requireFromUserProject.resolve("@napi-rs/keyring");
    _keyringModule = await import(pathToFileURL(resolvedPath).href);
    return _keyringModule;
  } catch (e) {
    const err = new Error(
      `${INSTALL_HINT}\n\nResolved from cwd: ${process.cwd()}\nUnderlying error: ${e.message}`
    );
    err.code = "KEYRING_NOT_INSTALLED";
    throw err;
  }
}

// Detect whether @napi-rs/keyring is available + the OS keyring is reachable.
// Returns true / false; never throws. Used by bootstrap + collect-credentials
// to decide whether to offer the keyring path or fall back to .env.local
// literals.
export async function isKeyringAvailable() {
  try {
    const mod = await loadKeyring();
    // Attempt a no-op read to verify the OS keyring is reachable. The
    // sentinel service/account need not exist; we just want to confirm
    // the backend doesn't throw on access.
    const entry = new mod.Entry("loom-availability-probe", "sentinel");
    try {
      entry.getPassword();
    } catch (e) {
      // "no entry" / "not found" errors are FINE — they mean the keyring
      // is reachable; the sentinel just doesn't exist (expected).
      // Backend-unreachable errors (D-Bus down, Keychain locked, etc.)
      // produce different messages.
      const msg = String(e.message || "").toLowerCase();
      if (
        msg.includes("no entry") ||
        msg.includes("not found") ||
        msg.includes("no matching entry") ||
        msg.includes("could not find")
      ) {
        return true;
      }
      // Any other error = keyring backend is reachable but unhappy.
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Read a credential from the OS keyring.
// Returns the password string, or null if no entry exists for service/account.
// Throws KEYRING_NOT_INSTALLED if @napi-rs/keyring is missing.
// Throws KEYRING_BACKEND_ERROR on other OS-level failures (locked keychain, etc.).
export async function getCredential(service, account) {
  validateArgs(service, account);
  const mod = await loadKeyring();
  const entry = new mod.Entry(service, account);
  try {
    return entry.getPassword();
  } catch (e) {
    const msg = String(e.message || "").toLowerCase();
    if (
      msg.includes("no entry") ||
      msg.includes("not found") ||
      msg.includes("no matching entry") ||
      msg.includes("could not find")
    ) {
      return null;
    }
    const err = new Error(`keyring read failed for ${service}/${account}: ${e.message}`);
    err.code = "KEYRING_BACKEND_ERROR";
    err.cause = e;
    throw err;
  }
}

// Write a credential to the OS keyring. Overwrites any existing entry.
// Returns void on success.
// Throws KEYRING_NOT_INSTALLED if @napi-rs/keyring is missing.
// Throws KEYRING_BACKEND_ERROR on other OS-level failures.
//
// SECURITY: the `password` argument is the actual credential value. It must
// only ever be sourced from terminal stdin (collect-credentials.{sh,ps1}),
// NEVER from chat input or tool args. LR-03 invariant.
export async function setCredential(service, account, password) {
  validateArgs(service, account);
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("setCredential: password must be a non-empty string");
  }
  const mod = await loadKeyring();
  const entry = new mod.Entry(service, account);
  try {
    entry.setPassword(password);
  } catch (e) {
    const err = new Error(`keyring write failed for ${service}/${account}: ${e.message}`);
    err.code = "KEYRING_BACKEND_ERROR";
    err.cause = e;
    throw err;
  }
}

// Delete a credential from the OS keyring.
// Returns true if an entry was deleted, false if no entry existed.
// Throws KEYRING_NOT_INSTALLED if @napi-rs/keyring is missing.
export async function deleteCredential(service, account) {
  validateArgs(service, account);
  const mod = await loadKeyring();
  const entry = new mod.Entry(service, account);
  try {
    entry.deletePassword();
    return true;
  } catch (e) {
    const msg = String(e.message || "").toLowerCase();
    if (
      msg.includes("no entry") ||
      msg.includes("not found") ||
      msg.includes("no matching entry") ||
      msg.includes("could not find")
    ) {
      return false;
    }
    const err = new Error(`keyring delete failed for ${service}/${account}: ${e.message}`);
    err.code = "KEYRING_BACKEND_ERROR";
    err.cause = e;
    throw err;
  }
}

// Derive the canonical service-key for a project (per ADR-0036 §G).
// Reads the project name from package.json (preferred) or tools/runtime.yaml
// (fallback). Returns `loom-<project-name>` ready to pass as the service arg.
export async function getServiceKey(projectRoot = process.cwd()) {
  const pkgPath = path.join(projectRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const { promises: fs } = await import("node:fs");
      const text = await fs.readFile(pkgPath, "utf8");
      const pkg = JSON.parse(text);
      if (pkg.name && typeof pkg.name === "string") {
        // package.json names like "@scope/pkg" — strip scope for the keyring service key.
        const name = pkg.name.includes("/") ? pkg.name.split("/").pop() : pkg.name;
        return `loom-${name}`;
      }
    } catch {
      // fall through to runtime.yaml
    }
  }

  const runtimePath = path.join(projectRoot, "tools", "runtime.yaml");
  if (existsSync(runtimePath)) {
    try {
      const { promises: fs } = await import("node:fs");
      const text = await fs.readFile(runtimePath, "utf8");
      const m = text.match(/^project:\s*["']?([^"'\n]+)["']?\s*$/m);
      if (m) return `loom-${m[1].trim()}`;
    } catch {
      // fall through
    }
  }

  // Last resort — use the directory name.
  return `loom-${path.basename(projectRoot)}`;
}

// Synchronous keyring-ref resolver — for entry points that cannot be async.
// Per ADR-0036 §C + R3: use this when your config loader runs synchronously
// (e.g., a plain CJS require chain). For async entry points, use loadEnv()
// from scripts/lib/load-env.mjs instead — it resolves keyring: refs into
// process.env non-destructively at startup.
//
// Usage:
//   import { resolveKeyringRefSync } from "./scripts/lib/keyring.mjs";
//   const apiKey = resolveKeyringRefSync(process.env.MY_KEY, __dirname);
//
// Literal values (non-keyring: strings) pass through unchanged.
// Throws KEYRING_NOT_INSTALLED, KEYRING_ENTRY_MISSING, or KEYRING_BACKEND_ERROR.
// LR-03 invariant: never log the return value.
export function resolveKeyringRefSync(ref, projectDir = process.cwd()) {
  const m = String(ref || "").match(/^keyring:([^/]+)\/(.+)$/);
  if (!m) return ref; // literal value — pass through
  const [, service, account] = m;

  let Entry;
  try {
    const anchor = path.join(projectDir, "noop.js");
    Entry = createRequire(anchor)("@napi-rs/keyring").Entry;
  } catch (e) {
    const err = new Error(
      `resolveKeyringRefSync: @napi-rs/keyring not found.\nInstall in your project: npm install --save-optional @napi-rs/keyring\nResolved from: ${projectDir}\nUnderlying: ${e.message}`
    );
    err.code = "KEYRING_NOT_INSTALLED";
    throw err;
  }

  let password;
  try {
    password = new Entry(service, account).getPassword();
  } catch (e) {
    const err = new Error(`resolveKeyringRefSync: keyring read failed for ${service}/${account}: ${e.message}`);
    err.code = "KEYRING_BACKEND_ERROR";
    throw err;
  }
  if (password == null) {
    const err = new Error(
      `resolveKeyringRefSync: no keyring entry for ${service}/${account}. Re-run: pwsh scripts/collect-credentials.ps1 <platform>`
    );
    err.code = "KEYRING_ENTRY_MISSING";
    throw err;
  }
  return password;
}

// ─── helpers ─────────────────────────────────────────────────────────────

function validateArgs(service, account) {
  if (typeof service !== "string" || service.length === 0) {
    throw new Error("keyring: service must be a non-empty string");
  }
  if (typeof account !== "string" || account.length === 0) {
    throw new Error("keyring: account must be a non-empty string");
  }
  // Reject obvious LR-03 violations: service/account args containing
  // password-shaped tokens (very-long strings, base64-ish characters).
  // Heuristic only; not authoritative.
  if (service.length > 100 || account.length > 100) {
    throw new Error(
      "keyring: service or account is suspiciously long — did you pass a credential value by mistake?"
    );
  }
}
