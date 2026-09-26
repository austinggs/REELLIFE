/**
 * UI presentation preferences (UI/UX 21 accessibility, UI/UX 03 section 7).
 *
 * Everything here is *presentation state*: it never enters the simulation, is
 * never saved into a `.reel` world and cannot change an outcome. It is kept in
 * the browser so the shell remembers how the player likes to read the world,
 * not what the world is doing.
 *
 * Reduced motion is honoured from two independent sources: the operating
 * system's own preference and the player's explicit choice — either one is
 * enough, because motion intolerance is a hard constraint, not a taste.
 */

import type { ConsoleAuthority } from "@/engine/primitives/index.ts";
import type { NotificationView } from "@/engine/query/index.ts";

export const UI_DENSITIES = ["comfortable", "compact"] as const;
export type UiDensity = (typeof UI_DENSITIES)[number];

/** How loudly notifications may interrupt (UI/UX 08 section 3). */
export const NOTIFICATION_MODES = ["all", "actionable", "urgent"] as const;
export type NotificationMode = (typeof NOTIFICATION_MODES)[number];

export interface UiPreferences {
  readonly reducedMotion: boolean;
  readonly density: UiDensity;
  readonly notificationMode: NotificationMode;
  /**
   * Console authority. Defaults to `player`: debug tools must be *granted*
   * (UI/UX 22 section 7), never assumed.
   */
  readonly authority: ConsoleAuthority;
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  reducedMotion: false,
  density: "comfortable",
  notificationMode: "actionable",
  authority: "player",
};

export const UI_PREFERENCES_STORAGE_KEY = "reellife.ui.preferences";

function isDensity(value: unknown): value is UiDensity {
  return typeof value === "string" && (UI_DENSITIES as readonly string[]).includes(value);
}

function isNotificationMode(value: unknown): value is NotificationMode {
  return typeof value === "string" && (NOTIFICATION_MODES as readonly string[]).includes(value);
}

function isAuthority(value: unknown): value is ConsoleAuthority {
  return value === "player" || value === "debug" || value === "system";
}

/** Defensive load: a corrupt or stale value falls back per field, never throws. */
export function resolveUiPreferences(raw: unknown): UiPreferences {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_UI_PREFERENCES;
  }
  const record = raw as Record<string, unknown>;
  return {
    reducedMotion: typeof record.reducedMotion === "boolean"
      ? record.reducedMotion
      : DEFAULT_UI_PREFERENCES.reducedMotion,
    density: isDensity(record.density) ? record.density : DEFAULT_UI_PREFERENCES.density,
    notificationMode: isNotificationMode(record.notificationMode)
      ? record.notificationMode
      : DEFAULT_UI_PREFERENCES.notificationMode,
    authority: isAuthority(record.authority) ? record.authority : DEFAULT_UI_PREFERENCES.authority,
  };
}

export function parseUiPreferences(serialized: string | null): UiPreferences {
  if (serialized === null || serialized.length === 0) return DEFAULT_UI_PREFERENCES;
  try {
    return resolveUiPreferences(JSON.parse(serialized) as unknown);
  } catch {
    return DEFAULT_UI_PREFERENCES;
  }
}

export function serializeUiPreferences(preferences: UiPreferences): string {
  return JSON.stringify(preferences);
}

/** The OS setting, read from the platform rather than assumed. */
export function systemPrefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Effective motion policy: player choice OR operating system, never neither. */
export function motionEnabled(
  preferences: UiPreferences,
  systemPreference = systemPrefersReducedMotion(),
): boolean {
  return !preferences.reducedMotion && !systemPreference;
}

/**
 * Spacing classes per density. Compact is not "smaller text"; it is less air,
 * because the accessibility requirement is legibility, not scale.
 */
export function densityClasses(density: UiDensity): string {
  return density === "compact" ? "space-y-3" : "space-y-6";
}

export function sectionDensityClasses(density: UiDensity): string {
  return density === "compact" ? "p-3" : "p-4";
}

/**
 * Interruption policy (UI/UX 08 section 3): only urgent or high-value
 * notifications may interrupt; everything else accumulates in the feed, and the
 * player's setting can only make that stricter or looser within the same rule.
 */
export function shouldSurfaceNotification(
  preferences: UiPreferences,
  notification: Pick<NotificationView, "delivery" | "relevance">,
): boolean {
  switch (preferences.notificationMode) {
    case "urgent":
      return notification.delivery === "interrupt";
    case "actionable":
      return notification.delivery !== "optional";
    case "all":
      return true;
  }
}

/** Status label shown next to the clock so authority is never implicit. */
export function authorityLabel(authority: ConsoleAuthority): string {
  switch (authority) {
    case "player":
      return "Player mode";
    case "debug":
      return "Debug mode";
    case "system":
      return "System mode";
  }
}
