/**
 * Console authority terms (System 57; UI/UX 22 section 7).
 *
 * Lives in primitives so presentation code can name the authority level
 * without importing the console implementation itself: the app is allowed
 * to import `@/engine/primitives`, but never `@/engine/console`.
 */

export const CONSOLE_AUTHORITIES = ["player", "debug", "system"] as const;
export type ConsoleAuthority = (typeof CONSOLE_AUTHORITIES)[number];

export type ConsoleLineKind = "read" | "mutation" | "error" | "info";

export interface ConsoleLine {
  readonly kind: ConsoleLineKind;
  readonly text: string;
}

