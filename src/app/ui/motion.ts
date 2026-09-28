/**
 * Motion policy tiers (brief §11).
 *
 * The atmospheric direction needs motion, but motion must be *policy*, not a
 * sprinkling of arbitrary animations. Three tiers, each gated:
 *
 *   Tier 1 "response" — opening panels, confirming commands, expanding rows.
 *       Short, purposeful, allowed everywhere, always reduced-motion aware.
 *   Tier 2 "moment"    — orchestrated life-stage / death / estate / succession
 *       moments. Skippable, never blocks input, no time pressure, and always has
 *       a plain-text equivalent carrying the same information.
 *   Tier 3 "ambient"   — background particles/texture. Off by default, cheap,
 *       disabled under reduced motion or low power.
 *
 * `motionAllowed` is the single gate. `motionEnabled` (prefs.ts) already folds
 * the operating-system preference and the player's choice into one boolean;
 * ambient motion is *additionally* opt-in because it must never impose cost on
 * a player who did not ask for it.
 */

export const MOTION_TIERS = ["response", "moment", "ambient"] as const;
export type MotionTier = (typeof MOTION_TIERS)[number];

export function isMotionTier(value: unknown): value is MotionTier {
  return typeof value === "string" && (MOTION_TIERS as readonly string[]).includes(value);
}

/**
 * Whether a motion tier may run, given the global motion state and the ambient
 * opt-in. Response and moment motion run whenever motion is on; ambient motion
 * is always opt-in and never runs by default.
 */
export function motionAllowed(
  tier: MotionTier,
  options: { readonly motion: boolean; readonly ambient: boolean },
): boolean {
  if (!options.motion) return false;
  if (tier === "ambient") return options.ambient;
  return true;
}
