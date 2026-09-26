/**
 * Debug console (System 57): parse a line, then execute it through the command
 * pipeline. The console is the UI's only "raw" surface, and it is authority
 * gated — see `execute.ts`.
 *
 * Boundary note: this barrel is engine-internal. Presentation code must never
 * import it — that is the architecture invariant asserted in
 * `tests/invariants/architecture.test.ts`. The app reaches the console through
 * `@/engine/query/index.ts` (reads), `@/engine/commands/index.ts` (dispatch) and
 * `@/engine/primitives/index.ts` (authority terms), which re-export exactly what
 * a view is entitled to use.
 */

export * from "./parser.ts";
export * from "./execute.ts";
