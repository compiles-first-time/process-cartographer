/**
 * browserEnv — the vite/browser wiring for the syntax tier. Wasm assets are
 * bundled from the SAME pinned npm packages the Node tests verify against
 * (RISK-10: runtime + grammars version-locked from a single source — exact
 * versions pinned in package.json; an ABI smoke test runs in the test suite).
 *
 * This module is imported dynamically (code-split) so the wasm never loads
 * for UiPath-only sessions.
 */
import runtimeWasmUrl from "web-tree-sitter/web-tree-sitter.wasm?url";
import jsWasmUrl from "tree-sitter-javascript/tree-sitter-javascript.wasm?url";
import tsWasmUrl from "tree-sitter-typescript/tree-sitter-typescript.wasm?url";
import tsxWasmUrl from "tree-sitter-typescript/tree-sitter-tsx.wasm?url";
import pyWasmUrl from "tree-sitter-python/tree-sitter-python.wasm?url";
import type { SyntaxEnv, GrammarId } from "./analyze.ts";

const GRAMMAR_URLS: Record<GrammarId, string> = {
  javascript: jsWasmUrl,
  typescript: tsWasmUrl,
  tsx: tsxWasmUrl,
  python: pyWasmUrl,
};

export const browserSyntaxEnv: SyntaxEnv = {
  locateRuntime: () => runtimeWasmUrl,
  grammarSource: async (g) => GRAMMAR_URLS[g],
};
