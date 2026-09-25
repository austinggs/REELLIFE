import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * ReelLife lint configuration.
 *
 * The rules below are not style preferences: they enforce ReelLife
 * architectural laws that would otherwise decay silently.
 *
 *  1. The authoritative engine must never use uncontrolled randomness.
 *     (Shared law 8: authoritative RNG is seeded, serialized, reproducible.)
 *  2. The engine must stay DOM-free and framework-free so it can run headless.
 *  3. The presentation layer must not import engine mutation paths directly;
 *     it goes through the command dispatcher and the query layer.
 */
export default tseslint.config(
  {
    // External tool worktrees (e.g. .kilo/worktrees/*) contain full project
    // copies; they are never linted from here.
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "REEL LIFE FULL PLAN SOURCE/**",
      ".kilo/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Pin the tsconfig root so the typescript parser never has to guess.
    // Without this, a stray tsconfig.json anywhere in the workspace (an
    // external tool's worktree copy, for instance) makes every file fail
    // with "multiple candidate TSConfigRootDirs are present".
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message:
            "Do not use Math.random() in ReelLife. Use the seeded RNG streams (src/engine/rng).",
        },
        {
          object: "Date",
          property: "now",
          message:
            "Do not use Date.now() for simulation decisions. Use the authoritative clock (WorldClock).",
        },
      ],
    },
  },
  {
    // Authoritative simulation: no DOM, no framework, no UI imports.
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "@/app/*", "@/ui/*", "@/platform/*", "@/tools/*"],
              message:
                "The engine is authoritative, DOM-free and framework-free. It may not import UI, platform adapters or React.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "window", message: "The engine must stay DOM-free (System 01/55 boundary)." },
        { name: "document", message: "The engine must stay DOM-free (System 01/55 boundary)." },
        { name: "localStorage", message: "Use a SaveStore adapter in src/platform instead." },
        { name: "fetch", message: "The engine performs no network I/O." },
      ],
    },
  },
  {
    // The vendored shadcn source is kept as close to upstream as possible.
    files: ["src/ui/components/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // hostClock is the single sanctioned wall-clock boundary (System 02/06): it
    // supplies non-authoritative metadata labels and UI pacing only, and can never
    // influence simulation outcomes. Date.now() is therefore allowed here, while
    // uncontrolled randomness stays banned everywhere.
    files: ["src/platform/hostClock.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message:
            "Do not use Math.random() in ReelLife. Use the seeded RNG streams (src/engine/rng).",
        },
      ],
    },
  },
);
