/**
 * Coverage labels and tones (UI/UX 02 §3, UI/UX 24 §8).
 *
 * A projection's *coverage* says how much of a system the viewer is actually
 * seeing: `complete` (real, canon-seeded data), `partial` (engine built and
 * tested, but the playable slice does not populate it), or `not-stated` (the
 * World Bible does not author the value at all). It is the UI's honest
 * empty-state vocabulary: a screen must be able to say "nothing recorded yet"
 * without inventing content to fill the gap.
 *
 * This mirrors `knowledge.ts`, which colours *how well* the viewer knows a
 * fact; coverage colours *how much* of a fact exists to know. The two axes are
 * independent and both must stay visible.
 */

import type { KnowledgeTone } from "./knowledge.ts";

export const COVERAGE_LEVELS = ["complete", "partial", "not-stated"] as const;
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number];

export function isCoverageLevel(value: unknown): value is CoverageLevel {
  return typeof value === "string" && (COVERAGE_LEVELS as readonly string[]).includes(value);
}

const COVERAGE_LABELS: Readonly<Record<CoverageLevel, string>> = {
  complete: "Complete",
  partial: "Partial",
  "not-stated": "Not stated",
};

const COVERAGE_TONES: Readonly<Record<CoverageLevel, KnowledgeTone>> = {
  complete: "default",
  partial: "outline",
  "not-stated": "secondary",
};

/** The label for a coverage level; every level names itself, never colour-only. */
export function coverageLabel(level: CoverageLevel): string {
  return COVERAGE_LABELS[level];
}

export function coverageTone(level: CoverageLevel): KnowledgeTone {
  return COVERAGE_TONES[level];
}
