/**
 * Accessibility policy (M8; UI/UX 21).
 *
 * UI/UX 21 has six sections. The shell already satisfies three of them
 * structurally — motion is a world-time concern rather than an animation, density
 * has a real comfortable/compact choice, and notification volume is already
 * filtered. This module supplies the parts the spec *named but nothing had been
 * built for*, and it does so as plain, testable policy rather than JSX, because
 * a rule that only exists inside a render function cannot be asserted and will
 * quietly regress.
 *
 * What is here:
 *
 *   1. Visual      — text scale applied at the root, and tones that carry a text
 *                    label so nothing critical is distinguished by colour alone.
 *   2. Cognitive   — one canonical term per concept, and errors that name a remedy.
 *   3. Motor       — focus order, minimum target size, and decisions that never
 *                    expire on the player.
 *   4. Auditory    — every alert has a text form; sound is never the only carrier.
 *   6. Localisation— formatting inputs as *data*, not as pre-rendered English.
 *
 * Nothing here mutates simulation state or derives a fact. It is presentation
 * policy, and the shell's business only.
 */

import { TEXT_SCALES, type TextScale } from "./prefs.ts";

/** Root-level text-scale classes; empty means "leave the tokens alone". */
const TEXT_SCALE_CLASSES: Readonly<Record<TextScale, string>> = {
  small: "reellife-text-small",
  default: "",
  large: "reellife-text-large",
  "x-large": "reellife-text-x-large",
};

/**
 * The class the root element needs for a text scale.
 *
 * Applied once at the root rather than threaded through every component, so
 * every existing `text-sm` on every screen moves with the setting. A control that
 * only affects the screen it was added to is not an accessibility feature.
 */
export function textScaleClass(scale: TextScale): string {
  return TEXT_SCALE_CLASSES[scale];
}

/** The ordered scale, for a control that steps through it. */
export const TEXT_SCALE_ORDER: readonly TextScale[] = TEXT_SCALES;

/**
 * Minimum interactive target in CSS pixels (UI/UX 21 section 3, "generous
 * interaction targets").
 *
 * 44 is the figure WCAG 2.2 asks for and the one touch platforms settle on. It
 * is a floor for the *control*, not a comment about layout: a 40px target padded
 * to 44px passes, and a 44px target cropped by an overflow container does not.
 */
export const MINIMUM_TARGET_PX = 44;

/** True when a control meets the minimum target size in both dimensions. */
export function meetsTargetSize(widthPx: number, heightPx: number): boolean {
  return widthPx >= MINIMUM_TARGET_PX && heightPx >= MINIMUM_TARGET_PX;
}

/**
 * Focus order for the shell, coarseest to finest (UI/UX 21 section 3).
 *
 * Ordered the way a person reads: identity first, then time, then the world they
 * are in, then the things they can do. This is the *expected* order and the
 * shell's DOM follows it; a mismatch is a bug in the shell, not here.
 */
export const FOCUS_ORDER = [
  "skipToMain",
  "worldIdentity",
  "clock",
  "notificationBar",
  "primaryNavigation",
  "mainRegion",
  "notificationFeed",
] as const;
export type FocusRegion = (typeof FOCUS_ORDER)[number];

/**
 * Whether a focus region comes before another. Unknown regions never precede a
 * known one, so a newly added surface is reachable rather than silently skipped.
 */
export function focusPrecedes(candidate: string, other: string): boolean {
  const a = (FOCUS_ORDER as readonly string[]).indexOf(candidate);
  const b = (FOCUS_ORDER as readonly string[]).indexOf(other);
  if (a === -1 || b === -1) return false;
  return a < b;
}

/**
 * Decisions never expire (UI/UX 21 section 3, "avoidance of unnecessary timing
 * pressure").
 *
 * A life simulation is not a reaction game, and a decision surface that closes
 * itself is a decision the player did not get to make. Returning the waiting
 * state with a reason lets the shell *show* that it is waiting, rather than
 * silently holding state open and leaving the player unsure.
 */
export function decisionDeadline(options: readonly string[]): {
  readonly expiresAt?: undefined;
  readonly waiting: true;
  readonly reason: string;
} {
  return {
    waiting: true,
    reason:
      options.length === 0
        ? "no decision is available right now"
        : "this decision waits for you; it does not expire",
  };
}

/**
 * Whether an alert needs a text alternative (UI/UX 21 section 4).
 *
 * Always true here, and that is the finding rather than a formality: this build
 * ships no audio, so a sound-only channel does not exist. The rule is written
 * down so that adding audio later has to satisfy it rather than quietly
 * introducing a sound-only alert.
 */
export function requiresTextAlternative(
  _delivery: "interrupt" | "passive" | "optional",
): true {
  return true;
}

/**
 * A tone's text label, so a status is never distinguished by colour alone
 * (UI/UX 21 section 1).
 *
 * `undefined` means the tone carries no meaning on its own. A *meaningful* tone
 * must never be omitted: a red badge that says nothing reads as decoration to a
 * screen reader and as the only signal to a colourblind player.
 */
export function toneLabel(tone: string): string | undefined {
  if (tone === "default") return undefined;
  // The destructive tone is the one that must never be colour-only: it is what
  // marks a problem, so it gets a word rather than a hue.
  if (tone === "destructive") return "problem";
  return tone.length > 0 ? tone : undefined;
}


/**
 * The one name for each concept the shell shows (UI/UX 21 section 2).
 *
 * "Consistent terminology" only means something if it is enforced somewhere, so
 * the canonical term lives here and the screens read it. Two words for one idea
 * is the most common way a simulation's own systems become illegible to a player
 * trying to reason about them.
 */
export const TERMINOLOGY: Readonly<Record<string, string>> = {
  active: "Active",
  deceased: "Deceased",
  historical: "Historical",
  household: "Household",
  resident: "Resident",
  settlement: "Settlement",
  estimate: "Estimate",
  rumour: "Rumour",
  hidden: "Hidden",
  authority: "Authority",
  estate: "Estate",
  heir: "Heir",
};

/** The canonical term for a concept, falling back to a title-cased form. */
export function term(key: string): string {
  const known = TERMINOLOGY[key];
  if (known !== undefined) return known;
  if (key.length === 0) return key;
  return `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

/**
 * A player-facing message, built from a cause and a remedy.
 *
 * UI/UX 21 asks for "understandable error messages". The rule enforced here is
 * that a message names *what to do*, not only what went wrong: an error the
 * player cannot act on is a second problem, not a smaller one.
 */
export function playerMessage(cause: string, remedy: string): string {
  const trimmedCause = cause.trim();
  const trimmedRemedy = remedy.trim();
  if (trimmedRemedy.length === 0) return trimmedCause;
  if (trimmedCause.length === 0) return trimmedRemedy;
  return `${trimmedCause} ${trimmedRemedy}`;
}

/**
 * Locale inputs for a value (UI/UX 21 section 6, localisation readiness).
 *
 * The world's own calendar and currency are *canonical data* from the engine
 * (`src/content/aurelia`); this only says which presentation conventions to use
 * around them. Formatting is expressed as data so adding a locale is a table
 * entry rather than a search-and-replace across every screen.
 */
export interface LocaleFormatting {
  readonly locale: string;
  /** BCP-47 tag the player reads numbers in; presentation only. */
  readonly numberLocale: string;
  readonly currencyDisplay: "code" | "symbol" | "name";
  /** True when the locale's convention is not the engine's own calendar. */
  readonly usesForeignCalendar: boolean;
}

export const DEFAULT_LOCALE_FORMATTING: LocaleFormatting = {
  locale: "en",
  numberLocale: "en-GB",
  // The currency *code*, not a symbol: Aurelia's currency is canon, and a
  // symbol would be an invention standing in for one.
  currencyDisplay: "code",
  usesForeignCalendar: true,
};

/**
 * Whether a string template is ready to be localized (UI/UX 21 section 6).
 *
 * A message built by concatenating a bare number into prose cannot be localized,
 * because the number's position and formatting are already baked in. This flags
 * that pattern in source, where it is checkable, rather than in review, where it
 * is invisible.
 */
export function isLocalizationReady(template: string): {
  readonly ready: boolean;
  readonly reason?: string;
} {
  // `{n} units` cannot become `{n} Einheiten` once the number is inside the
  // sentence, because word order and plural rules differ per language.
  if (/\$\{\s*[A-Za-z_$][\w$]*\s*\}\s+(units|items|people|days|years|coins)\b/.test(template)) {
    return {
      ready: false,
      reason: "a bare value is interpolated directly into prose; pass a formatted value instead",
    };
  }
  return { ready: true };
}
