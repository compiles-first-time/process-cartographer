/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    // The 3D renderer (M1+) will need jsdom; the M0 parser is pure Node.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
