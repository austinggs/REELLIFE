/**
 * Console read parsing, re-exported through the query boundary (System 57).
 *
 * The implementation lives in `../console/parser.ts` and stays
 * engine-internal. Presentation code must import from `@/engine/query` —
 * never from `@/engine/console` — so the architecture invariant
 * ("command surface on the correct side of the boundary") keeps holding
 * while the console itself keeps one canonical implementation.
 */

export {
  CONSOLE_READ_COMMANDS,
  parseConsoleInput,
  type ConsoleCommandInstruction,
  type ConsoleEmptyInstruction,
  type ConsoleErrorInstruction,
  type ConsoleInstruction,
  type ConsoleReadCommand,
  type ConsoleReadInstruction,
  type ConsoleRegistry,
} from "../console/parser.ts";
