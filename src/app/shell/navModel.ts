/**
 * Shell navigation model (UI/UX 03).
 *
 * A small, stable set of anchors; contextual navigation happens *inside* a
 * screen rather than by growing the anchor list. Two rules matter
 * architecturally:
 *
 *   1. Navigation state (current view, selection, breadcrumb) is presentation
 *      state and never simulation truth (UI/UX 03 section 7) — which is why
 *      this module has no engine import at all.
 *   2. The console and debug surfaces exist only under granted debug authority
 *      (UI/UX 22 section 7), so they are not merely hidden by CSS.
 */

import type { ConsoleAuthority } from "@/engine/primitives/index.ts";

export const SHELL_VIEWS = [
  "life",
  "people",
  "world",
  "history",
  "search",
  "settings",
  "console",
  "debug",
] as const;
export type ShellView = (typeof SHELL_VIEWS)[number];

export interface ShellNavItem {
  readonly view: ShellView;
  readonly label: string;
  readonly description: string;
  /** Debug-only surfaces are gated by authority, not by presentation. */
  readonly requiresDebug: boolean;
  /** Keyboard route; every anchor must be reachable without a pointer. */
  readonly shortcut: string;
}

export const SHELL_NAV: readonly ShellNavItem[] = [
  {
    view: "life",
    label: "Life",
    description: "Your situation now: needs, activity, commitments, people, events.",
    requiresDebug: false,
    shortcut: "Alt+1",
  },
  {
    view: "people",
    label: "People",
    description: "Everyone you can actually identify, and what you know about them.",
    requiresDebug: false,
    shortcut: "Alt+2",
  },
  {
    view: "world",
    label: "World",
    description: "The places you are in and what contains them.",
    requiresDebug: false,
    shortcut: "Alt+3",
  },
  {
    view: "history",
    label: "History",
    description: "What happened, in the world's own chronological order.",
    requiresDebug: false,
    shortcut: "Alt+4",
  },
  {
    view: "search",
    label: "Search",
    description: "Find people, places and events you know about.",
    requiresDebug: false,
    shortcut: "Alt+5",
  },
  {
    view: "settings",
    label: "Settings",
    description: "Pacing, accessibility, saves and console authority.",
    requiresDebug: false,
    shortcut: "Alt+6",
  },
  {
    view: "console",
    label: "Console",
    description: "Read/mutation console (System 57). Requires debug authority.",
    requiresDebug: true,
    shortcut: "Alt+7",
  },
  {
    view: "debug",
    label: "Debug",
    description: "Diagnostics, traces, metrics and the entity inspector (UI/UX 22).",
    requiresDebug: true,
    shortcut: "Alt+8",
  },
];

/** Anchors the current authority may use; player mode never sees debug tools. */
export function visibleNavItems(authority: ConsoleAuthority): readonly ShellNavItem[] {
  const privileged = authority === "debug" || authority === "system";
  return SHELL_NAV.filter((item) => !item.requiresDebug || privileged);
}

export function navItem(view: ShellView): ShellNavItem {
  const item = SHELL_NAV.find((candidate) => candidate.view === view);
  if (item === undefined) throw new Error(`Unknown shell view: ${view}`);
  return item;
}

/** Maps an `altKey` press to a view; returns undefined for anything else. */
export function viewForShortcut(key: string): ShellView | undefined {
  const index = Number(key) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= SHELL_VIEWS.length) return undefined;
  return SHELL_VIEWS[index];
}

/** A one-line breadcrumb: where the player is, and how they got there. */
export function breadcrumb(current: ShellView, trail: readonly string[]): readonly string[] {
  return [navItem(current).label, ...trail];
}
