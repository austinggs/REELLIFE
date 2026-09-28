/**
 * Coverage presentation vocabulary (U1; UI/UX 02 §3, UI/UX 24 §8).
 *
 * Coverage is the UI's honest-empty-state axis, distinct from knowledge (which
 * says *how well* a fact is known). These tests pin the pure helpers so a
 * screen can never render an empty state that hides whether a system is
 * complete, partial, or simply not stated by the World Bible.
 */

import { describe, expect, it } from "vitest";
import {
  COVERAGE_LEVELS,
  coverageLabel,
  coverageTone,
  isCoverageLevel,
} from "../../src/app/ui/coverage.ts";

describe("coverage (UI presentation)", () => {
  it("offers exactly three levels, mirroring the content ledger", () => {
    expect(COVERAGE_LEVELS).toEqual(["complete", "partial", "not-stated"]);
  });

  it("gives every level a non-empty, distinct label (colour never the only signal)", () => {
    const labels = COVERAGE_LEVELS.map(coverageLabel);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(COVERAGE_LEVELS.length);
  });

  it("labels the canon-not-stated level as 'Not stated', never a guess", () => {
    expect(coverageLabel("not-stated")).toBe("Not stated");
  });

  it("maps every level to a badge tone, leaving none without one", () => {
    for (const level of COVERAGE_LEVELS) {
      expect(coverageTone(level)).toBeDefined();
    }
  });

  it("recognises valid levels and rejects unknown or non-string values", () => {
    expect(isCoverageLevel("partial")).toBe(true);
    expect(isCoverageLevel("not-stated")).toBe(true);
    expect(isCoverageLevel("nonsense")).toBe(false);
    expect(isCoverageLevel(42)).toBe(false);
  });
});
