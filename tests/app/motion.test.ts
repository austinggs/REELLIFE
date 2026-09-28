/**
 * Motion tier policy (U1-c; brief §11).
 *
 * These tests pin the single gate so a screen can never enable ambient motion by
 * default, and so reduced motion always disables every tier.
 */

import { describe, expect, it } from "vitest";
import { MOTION_TIERS, isMotionTier, motionAllowed } from "../../src/app/ui/motion.ts";

describe("motion tiers (UI presentation policy)", () => {
  it("defines exactly three tiers: response, moment, ambient", () => {
    expect(MOTION_TIERS).toEqual(["response", "moment", "ambient"]);
  });

  it("allows response and moment motion only when motion is on", () => {
    for (const tier of ["response", "moment"] as const) {
      expect(motionAllowed(tier, { motion: true, ambient: false })).toBe(true);
      expect(motionAllowed(tier, { motion: false, ambient: false })).toBe(false);
      expect(motionAllowed(tier, { motion: false, ambient: true })).toBe(false);
    }
  });

  it("gates ambient motion behind an explicit opt-in, never by default", () => {
    expect(motionAllowed("ambient", { motion: true, ambient: false })).toBe(false);
    expect(motionAllowed("ambient", { motion: true, ambient: true })).toBe(true);
    expect(motionAllowed("ambient", { motion: false, ambient: true })).toBe(false);
  });

  it("recognises valid tiers and rejects unknown or non-string values", () => {
    expect(isMotionTier("moment")).toBe(true);
    expect(isMotionTier("ambient")).toBe(true);
    expect(isMotionTier("nonsense")).toBe(false);
    expect(isMotionTier(42)).toBe(false);
  });
});
