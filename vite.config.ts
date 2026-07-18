/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // web-tree-sitter is reached only via dynamic import (the code-split syntax
    // tier). Without pre-bundling, vite discovers it MID-SESSION on the user's
    // first repo ingest and force-reloads the page — discarding the in-flight
    // ingest ("I clicked and nothing happened", 2026-07-18). Dev-only failure;
    // see lessons-learned/2026-07-18-vite-dynamic-dep-discovery-reload.md.
    include: ["web-tree-sitter", "typescript"],
  },
  test: {
    globals: true,
    environment: "node",
    // The 3D renderer (M1+) will need jsdom; the M0 parser is pure Node.
    // oracle/ = the B2 differential harness's pure math (no network in tests).
    include: ["src/**/*.{test,spec}.{ts,tsx}", "oracle/**/*.{test,spec}.ts"],
  },
});
