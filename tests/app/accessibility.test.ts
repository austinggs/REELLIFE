/**
 * M8 — the UI/UX 21 accessibility pass.
 *
 * UI/UX 21 asks for six things. Three were already satisfied structurally by
 * M3 (motion is world-time, density is a real choice, notification volume is
 * filtered); this file covers those *and* the three the spec named but nothing
 * had been built for: adjustable text size, motor requirements, and
 * localisation readiness.
 *
 * These are assertions about policy, not about rendered pixels. That is
 * deliberate: a rule that lives inside a React render function cannot be tested,
 * so it is written as plain functions in `src/app/ui/accessibility.ts` and the
 * shell consumes them. A policy that cannot be asserted is a policy that will
 * quietly regress.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_UI_PREFERENCES,
  TEXT_SCALES,
  densityClasses,
  motionEnabled,
  parseUiPreferences,
  resolveUiPreferences,
  sectionDensityClasses,
  serializeUiPreferences,
  shouldSurfaceNotification,
  type TextScale,
} from "../../src/app/ui/prefs.ts";
import {
  DEFAULT_LOCALE_FORMATTING,
  FOCUS_ORDER,
  MINIMUM_TARGET_PX,
  TERMINOLOGY,
  decisionDeadline,
  focusPrecedes,
  isLocalizationReady,
  meetsTargetSize,
  playerMessage,
  requiresTextAlternative,
  term,
  textScaleClass,
  toneLabel,
} from "../../src/app/ui/accessibility.ts";
import { knowledgeLabel, knowledgeTone } from "../../src/app/ui/knowledge.ts";
import { KNOWLEDGE_STATES } from "../../src/engine/primitives/information.ts";

describe("accessibility pass (UI/UX 21, M8)", () => {
  describe("1. Visual — adjustable text size", () => {
    it("offers a real scale, defaulting to the platform's own sizing", () => {
      expect(TEXT_SCALES).toEqual(["small", "default", "large", "x-large"]);
      // Default means "do not touch the tokens", so a platform text-size or
      // screen-reader setting keeps working rather than being overridden.
      expect(DEFAULT_UI_PREFERENCES.textScale).toBe("default");
      expect(textScaleClass("default")).toBe("");
    });

    it("gives each non-default step its own root class", () => {
      const classes = TEXT_SCALES.map(textScaleClass);
      // One class per step, and no two steps share one: a duplicate would make
      // two settings indistinguishable in the UI.
      expect(new Set(classes).size).toBe(TEXT_SCALES.length);
      for (const step of TEXT_SCALES) {
        if (step === "default") continue;
        expect(textScaleClass(step)).toMatch(/^reellife-text-/);
      }
    });

    it("no meaningful status is carried by colour alone", () => {
      // Every knowledge state already has a text label — that is the property
      // that makes a colour-coded badge readable without colour.
      for (const state of KNOWLEDGE_STATES) {
        expect(knowledgeLabel(state).length).toBeGreaterThan(0);
      }
      // And the destructive tone, the one that marks a problem, says so in words.
      expect(toneLabel("destructive")).toBe("problem");
      // A tone with no meaning of its own is allowed to be unlabelled.
      expect(toneLabel("default")).toBeUndefined();
      expect(toneLabel("secondary")).toBe("secondary");
    });

    it("density is about air, not legibility", () => {
      expect(densityClasses("compact")).not.toBe(densityClasses("comfortable"));
      expect(sectionDensityClasses("compact")).not.toBe(sectionDensityClasses("comfortable"));
      // Compact is less spacing, not smaller text: shrinking text would work
      // against the very requirement density exists to serve.
      for (const density of ["comfortable", "compact"] as const) {
        expect(densityClasses(density)).not.toMatch(/text-(xs|sm)/);
        expect(sectionDensityClasses(density)).not.toMatch(/text-(xs|sm)/);
      }
    });

  describe("2. Cognitive — terminology and understandable errors", () => {
    it("gives each concept exactly one name", () => {
      expect(term("deceased")).toBe("Deceased");
      expect(term("rumour")).toBe("Rumour");
      // An unknown key still renders as a word rather than as a raw slug.
      expect(term("someNewConcept")).toBe("SomeNewConcept");
      expect(term("")).toBe("");
    });

    it("has no two names for one idea", () => {
      const values = Object.values(TERMINOLOGY);
      expect(new Set(values).size).toBe(values.length);
    });

    it("an error names a remedy, not only a cause", () => {
      const message = playerMessage("Not enough money.", "Try a shorter shift.");
      expect(message).toContain("Not enough money.");
      expect(message).toContain("Try a shorter shift.");
      // A message with no remedy available is still a message, not a stub.
      expect(playerMessage("Something failed.", "")).toBe("Something failed.");
      expect(playerMessage("", "Try again.")).toBe("Try again.");
    });
  });

  describe("3. Motor — targets, focus order, and no timing pressure", () => {
    it("sets a generous minimum target size", () => {
      expect(MINIMUM_TARGET_PX).toBe(44);
      expect(meetsTargetSize(44, 44)).toBe(true);
      expect(meetsTargetSize(80, 32)).toBe(false);
      expect(meetsTargetSize(32, 80)).toBe(false);
      expect(meetsTargetSize(43, 44)).toBe(false);
    });

    it("orders focus the way a person reads the screen", () => {
      // Identity before clock, clock before navigation, navigation before the
      // main region: the order is the reading order, not the DOM's accident.
      expect(focusPrecedes("skipToMain", "worldIdentity")).toBe(true);
      expect(focusPrecedes("worldIdentity", "clock")).toBe(true);
      expect(focusPrecedes("clock", "primaryNavigation")).toBe(true);
      expect(focusPrecedes("primaryNavigation", "mainRegion")).toBe(true);
      expect(focusPrecedes("mainRegion", "worldIdentity")).toBe(false);
      // An unknown region never precedes a known one, so a new surface is
      // reachable rather than silently skipped.
      expect(focusPrecedes("somethingNew", "mainRegion")).toBe(false);
      expect(focusPrecedes("mainRegion", "somethingNew")).toBe(false);
    });

    it("names every focus region exactly once", () => {
      expect(new Set(FOCUS_ORDER).size).toBe(FOCUS_ORDER.length);
      for (const region of FOCUS_ORDER) {
        expect(focusPrecedes(region, region)).toBe(false);
      }
    });

    it("a decision never expires on the player", () => {
      const pending = decisionDeadline(["rest", "work", "socialise"]);
      expect(pending.waiting).toBe(true);
      // No deadline is ever set: a life simulation is not a reaction game, and
      // a surface that closes itself is a decision the player did not get to
      // make.
      expect(pending.expiresAt).toBeUndefined();
      expect(pending.reason).toMatch(/does not expire/);
      expect(decisionDeadline([]).reason).toMatch(/no decision/);
    });

    it("reduced motion is honoured from the player or the OS, never neither", () => {
      expect(motionEnabled({ ...DEFAULT_UI_PREFERENCES, reducedMotion: true }, false)).toBe(false);
      expect(motionEnabled({ ...DEFAULT_UI_PREFERENCES, reducedMotion: false }, true)).toBe(false);
      expect(motionEnabled({ ...DEFAULT_UI_PREFERENCES, reducedMotion: false }, false)).toBe(true);
    });
  });


  describe("4. Auditory — nothing is sound-only", () => {
    it("every delivery class requires a text form", () => {
      for (const delivery of ["interrupt", "passive", "optional"] as const) {
        expect(requiresTextAlternative(delivery)).toBe(true);
      }
    });

    it("notification volume stays manageable", () => {
      const urgent = { delivery: "interrupt" as const, relevance: 1 };
      const inbox = { delivery: "inbox" as const, relevance: 1 };
      const optional = { delivery: "optional" as const, relevance: 1 };
      const prefs = DEFAULT_UI_PREFERENCES;
      // The player's setting may only make the feed stricter, never looser than
      // the rule allows.
      expect(shouldSurfaceNotification({ ...prefs, notificationMode: "all" }, optional)).toBe(true);
      expect(shouldSurfaceNotification({ ...prefs, notificationMode: "actionable" }, optional)).toBe(
        false,
      );
      expect(shouldSurfaceNotification({ ...prefs, notificationMode: "actionable" }, inbox)).toBe(
        true,
      );
      expect(shouldSurfaceNotification({ ...prefs, notificationMode: "urgent" }, inbox)).toBe(
        false,
      );
      expect(shouldSurfaceNotification({ ...prefs, notificationMode: "urgent" }, urgent)).toBe(true);
    });
  });

  describe("6. Localisation readiness", () => {
    it("describes formatting as data, not as pre-rendered English", () => {
      expect(DEFAULT_LOCALE_FORMATTING.locale).toBe("en");
      // The currency *code*, not a symbol: Aurelia's currency is canon, and a
      // symbol would be an invention standing in for one.
      expect(DEFAULT_LOCALE_FORMATTING.currencyDisplay).toBe("code");
      expect(DEFAULT_LOCALE_FORMATTING.usesForeignCalendar).toBe(true);
    });

    it("flags prose that has a number baked into it", () => {
      // `{n} units` cannot become `{n} Einheiten` once the number sits inside
      // the sentence, because word order and plural rules differ per language.
      expect(isLocalizationReady("`${count} units`").ready).toBe(false);
      expect(isLocalizationReady("`${n} days`").ready).toBe(false);
      expect(isLocalizationReady("`${balance} coins`").ready).toBe(false);
      // A formatted value handed in whole is fine.
      expect(isLocalizationReady("`${formatMoney(balance)}`").ready).toBe(true);
      expect(isLocalizationReady("`${label}` is waiting").ready).toBe(true);
    });

    it("explains why a template is not ready", () => {
      const result = isLocalizationReady("`${count} units`");
      expect(result.ready).toBe(false);
      expect(result.reason).toMatch(/formatted value/);
    });
  });


  describe("preference persistence across builds", () => {
    it("restores an older blob field by field rather than discarding it", () => {
      // A blob written before textScale existed must still restore the player's
      // density, motion and authority: losing those because one field is new
      // would reset someone's settings for them.
      const legacy = {
        reducedMotion: true,
        density: "compact",
        notificationMode: "urgent",
        authority: "debug",
      };
      const restored = resolveUiPreferences(legacy);
      expect(restored.reducedMotion).toBe(true);
      expect(restored.density).toBe("compact");
      expect(restored.notificationMode).toBe("urgent");
      expect(restored.authority).toBe("debug");
      // Only the field the old build never had falls back.
      expect(restored.textScale).toBe("default");
    });

    it("round-trips a full preference set", () => {
      const prefs = {
        reducedMotion: true,
        density: "compact" as const,
        textScale: "large" as const,
        notificationMode: "all" as const,
        authority: "system" as const,
      };
      expect(parseUiPreferences(serializeUiPreferences(prefs))).toEqual(prefs);
    });

    it("rejects a corrupt blob without throwing", () => {
      expect(parseUiPreferences(null)).toEqual(DEFAULT_UI_PREFERENCES);
      expect(parseUiPreferences("not json")).toEqual(DEFAULT_UI_PREFERENCES);
      expect(resolveUiPreferences([1, 2, 3])).toEqual(DEFAULT_UI_PREFERENCES);
      // An unknown text scale is ignored rather than half-applied.
      expect(resolveUiPreferences({ textScale: "gigantic" }).textScale).toBe("default");
      const known: TextScale = "x-large";
      expect(resolveUiPreferences({ textScale: known }).textScale).toBe("x-large");
    });

    it("stores no simulation truth in preferences", () => {
      // Preferences are presentation only: they must not be able to smuggle a
      // world fact into the session, and they never enter a `.reel` save.
      const serialized = serializeUiPreferences(DEFAULT_UI_PREFERENCES);
      expect(serialized).not.toMatch(/balance|needs|health|money|seed/i);
    });
  });

  it("knowledge states stay distinguishable without colour", () => {
    // Two states may share a tone, but every one keeps a distinct label: the
    // label is what carries the meaning when colour cannot.
    const labels = KNOWLEDGE_STATES.map(knowledgeLabel);
    expect(new Set(labels).size).toBe(labels.length);
    for (const state of KNOWLEDGE_STATES) {
      expect(knowledgeTone(state)).toBeTruthy();
    }
  });
});

  });
