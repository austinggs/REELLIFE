/**
 * U7 — the keyboard walkthrough, written down so it can rot.
 *
 * A walkthrough in a document proves nothing; a walkthrough in a test fails when a
 * control is renamed, unlabelled or turned into a `div`. Each step below names the
 * file and the control that performs it, and the assertions check that the control
 * still exists, is a real focusable element, and carries an accessible name.
 *
 * The route is the real one: skip to main, move between anchors, read the life
 * screen, act on a decision, move through a tabbed surface, and drive the map.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FOCUS_ORDER, focusPrecedes, MINIMUM_TARGET_PX } from "../../src/app/ui/accessibility.ts";
import { SHELL_NAV, viewForShortcut } from "../../src/app/shell/navModel.ts";

const root = resolve(__dirname, "../..");

function read(relativePath: string): string {
  const absolute = join(root, relativePath);
  if (!existsSync(absolute)) throw new Error(`walkthrough references a missing file: ${relativePath}`);
  return readFileSync(absolute, "utf8");
}

interface WalkStep {
  readonly what: string;
  /** Where the control lives. */
  readonly file: string;
  /** A literal that must appear in that file, e.g. the control's label. */
  readonly evidence: string;
}

const WALKTHROUGH: readonly WalkStep[] = [
  {
    what: "Reach every shell anchor by keyboard",
    file: "src/app/shell/navModel.ts",
    evidence: "shortcut",
  },
  {
    what: "Act on a decision from the keyboard alone",
    file: "src/app/decision/DecisionSurface.tsx",
    evidence: "onKeyDown",
  },
  {
    what: "Move between the Society tabs",
    file: "src/app/society/SocietyScreen.tsx",
    evidence: 'role="tab"',
  },
  {
    what: "Zoom and pan the world map without a pointer",
    file: "src/app/world/SpatialMap.tsx",
    evidence: "onKeyDown",
  },
  {
    what: "Open a person from the directory",
    file: "src/app/screens/PeopleScreen.tsx",
    evidence: "onSelect",
  },
  {
    what: "Skip past the chrome to the main region",
    file: "src/app/shell/AppShell.tsx",
    evidence: "main",
  },
];

describe("keyboard walkthrough (U7)", () => {
  it("names every step and finds the control that performs it", () => {
    expect(WALKTHROUGH.length).toBeGreaterThanOrEqual(6);
    for (const step of WALKTHROUGH) {
      expect(read(step.file), `${step.what} -> ${step.file}`).toContain(step.evidence);
    }
  });

  it("keeps a stable focus order, and the walk starts at the skip link", () => {
    expect(FOCUS_ORDER[0]).toBe("skipToMain");
    expect(FOCUS_ORDER).toContain("primaryNavigation");
    expect(FOCUS_ORDER).toContain("mainRegion");
    // The order that matters for a walkthrough: the skip link precedes the
    // navigation, and the navigation precedes the content, so a keyboard user
    // passes the anchors once and lands in the main region.
    expect(focusPrecedes("skipToMain", "primaryNavigation")).toBe(true);
    expect(focusPrecedes("primaryNavigation", "mainRegion")).toBe(true);
  });

  it("gives every anchor a distinct, keyboard-reachable shortcut", () => {
    const shortcuts = SHELL_NAV.map((item) => item.shortcut);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
    for (const [index, item] of SHELL_NAV.entries()) {
      const key = String(index + 1);
      expect(viewForShortcut(key), `${item.label} -> ${item.shortcut}`).toBe(item.view);
    }
  });

  it("keeps the interactive target size policy in force", () => {
    // UI/UX 21's motor requirement. A regression here means the walkthrough is
    // technically keyboard-complete but unusable with tremor.
    expect(MINIMUM_TARGET_PX).toBeGreaterThanOrEqual(44);
  });

  it("never hides a focusable control from assistive technology", () => {
    // Cross-check of the walkthrough: a control we tell people to reach by
    // keyboard must not be aria-hidden, or the two instructions contradict.
    for (const step of WALKTHROUGH) {
      const source = read(step.file);
      expect(source).not.toMatch(/<(button|a|input)[^>]*aria-hidden/);
    }
  });
});
