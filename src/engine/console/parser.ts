/**
 * Debug console parser (System 57).
 *
 * The console never mutates anything itself. It *classifies* a typed line:
 *   - read       — inspect the world (`help`, `time`, `state`, `health`,
 *                  `events`, `entity`, `commands`, `whoami`);
 *   - command    — a registered command type with `key=value` parameters,
 *                  dispatched through the normal pipeline by `execute.ts`;
 *   - error      — an unresolved line, reported with suggestions.
 *
 * Reads and mutations are different kinds of instruction on purpose, so a
 * surface can render them differently and a policy layer can allow one without
 * the other (System 57).
 */

/** The subset of the command registry the parser needs; satisfied structurally. */
export interface ConsoleRegistry {
  has(type: string): boolean;
  list(): readonly string[];
}

export const CONSOLE_READ_COMMANDS = [
  "help",
  "time",
  "state",
  "health",
  "events",
  "entity",
  "commands",
  "whoami",
] as const;
export type ConsoleReadCommand = (typeof CONSOLE_READ_COMMANDS)[number];

export interface ConsoleReadInstruction {
  readonly kind: "read";
  readonly input: string;
  readonly read: ConsoleReadCommand;
  readonly argument?: string;
}

export interface ConsoleCommandInstruction {
  readonly kind: "command";
  readonly input: string;
  readonly commandType: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface ConsoleEmptyInstruction {
  readonly kind: "empty";
  readonly input: string;
}

export interface ConsoleErrorInstruction {
  readonly kind: "error";
  readonly input: string;
  readonly message: string;
  readonly suggestions: readonly string[];
}

export type ConsoleInstruction =
  | ConsoleReadInstruction
  | ConsoleCommandInstruction
  | ConsoleEmptyInstruction
  | ConsoleErrorInstruction;

function isReadCommand(token: string): token is ConsoleReadCommand {
  return (CONSOLE_READ_COMMANDS as readonly string[]).includes(token);
}

/**
 * Splits a line on whitespace *outside* quotes, so a value may contain spaces:
 * `world.save slotName="evening run"`. Quote characters are kept in the token
 * and stripped by `parseScalar`, which is what keeps `key="4"` a string while
 * `key=4` is a number.
 */
function tokenize(input: string): readonly string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  for (const character of input) {
    if (quote === null && (character === "\"" || character === "'")) {
      quote = character;
      current += character;
      continue;
    }
    if (quote !== null && character === quote) {
      quote = null;
      current += character;
      continue;
    }
    if (quote === null && /\s/.test(character)) {
      if (current.length > 0) tokens.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/** Scalar parsing is explicit so `10` is a number and `slot=4` is a string. */
function parseScalar(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed.length > 0 && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function suggestionsFor(token: string, registry: ConsoleRegistry): readonly string[] {
  const all = registry.list();
  const lower = token.toLowerCase();
  const head = lower.split(".")[0];
  const ranked = all
    .filter((type) => type.toLowerCase().includes(lower) || type.toLowerCase().startsWith(head))
    .sort((a, b) => a.localeCompare(b));
  const fallback = all.slice().sort((a, b) => a.localeCompare(b));
  return (ranked.length > 0 ? ranked : fallback).slice(0, 6);
}

/**
 * Parses one console line. Parameters are always `key=value`; the console does
 * not guess positional arguments, because guessing would make commands
 * ambiguous and the audit trail unreproducible.
 */
export function parseConsoleInput(input: string, registry: ConsoleRegistry): ConsoleInstruction {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { kind: "empty", input };

  const tokens = tokenize(trimmed);
  const head = tokens[0];
  const rest = tokens.slice(1);

  if (isReadCommand(head)) {
    const argument = rest.length === 0 ? undefined : rest.join(" ");
    return {
      kind: "read",
      input: trimmed,
      read: head,
      ...(argument === undefined ? {} : { argument }),
    };
  }

  if (!registry.has(head)) {
    return {
      kind: "error",
      input: trimmed,
      message: `Unknown command or read: "${head}". Reads: ${CONSOLE_READ_COMMANDS.join(", ")}.`,
      suggestions: suggestionsFor(head, registry),
    };
  }

  const params: Record<string, unknown> = {};
  for (const token of rest) {
    const separator = token.indexOf("=");
    if (separator <= 0) {
      return {
        kind: "error",
        input: trimmed,
        message: `Parameter "${token}" must be written as key=value, for example ${head} ${exampleParameter(head)}.`,
        suggestions: suggestionsFor(head, registry),
      };
    }
    const key = token.slice(0, separator);
    params[key] = parseScalar(token.slice(separator + 1));
  }

  return { kind: "command", input: trimmed, commandType: head, params };
}

function exampleParameter(commandType: string): string {
  if (commandType.startsWith("time.")) return "speed=10";
  if (commandType.startsWith("world.save")) return "slotName=manual";
  return "key=value";
}
