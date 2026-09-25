import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * ReelLife build configuration.
 *
 * Boundary note: the ReelLife planning corpus lives in
 * "REEL LIFE FULL PLAN SOURCE/" and is reference material only. It is never
 * imported, bundled or type-checked as part of the application. Source globs
 * below are deliberately narrowed to src/ and tests/.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "REEL LIFE FULL PLAN SOURCE/**"],
    testTimeout: 30_000,
  },
});
