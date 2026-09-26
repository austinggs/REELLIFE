/**
 * Console execution, re-exported through the command boundary (System 57).
 *
 * The implementation lives in `../console/execute.ts` and stays
 * engine-internal. Presentation code must import from `@/engine/commands` —
 * never from `@/engine/console` — so the architecture invariant
 * ("command surface on the correct side of the boundary") keeps holding
 * while the console itself keeps one canonical implementation.
 */

export {
  executeConsoleInstruction,
  type ConsoleContext,
  type ConsoleResult,
} from "../console/execute.ts";