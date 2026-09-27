/**
 * System 22 — Reputation & Social Perception.
 *
 * "Reputation is socially distributed belief, not a universal morality
 * score" (System 22 core principle).
 *
 * The shape of the system follows that sentence exactly:
 *
 *   1. **Perception, not a score.** A perception is *one observer's* view of
 *      *one domain* — "the docks think the mill is unreliable" is a different
 *      record from "the mill's own staff think it is", and the engine keeps
 *      them apart. There is no global reputation number, because there is
 *      no global observer.
 *   2. **Evidence-based and fallible.** A perception is derived from
 *      weighted evidence: source reliability, directness, corroboration and
 *      recency. Two observers given the same evidence converge; observers
 *      given different evidence diverge, and both readings stay on the
 *      record.
 *   3. **Demonstrated ≠ competent.** Reputation is what people believe was
 *      shown. Nothing here writes a skill (System 14) or a truth, and a
 *      reputation can be well founded, mistaken, or maliciously sustained.
 *   4. **Decay never erases.** A perception fades toward neutrality as it
 *      ages, and the evidence behind it is kept — the spec's "false
 *      reputation can persist when socially supported" and "decays without
 *      automatically erasing history" are both satisfied by storing
 *      evidence and deriving the value.
 */

import type { WorldTime } from "../primitives/time.ts";

/** Domains reputation is had *about*, kept open for other systems. */
export const REPUTATION_DOMAINS = [
  "reliability",
  "competence",
  "honesty",
  "fairness",
  "safety",
  "generosity",
  "authority",
] as const;
export type ReputationDomain = (typeof REPUTATION_DOMAINS)[number];

/** One piece of what an observer believes they saw. */
export interface ReputationEvidence {
  readonly id: string;
  readonly at: WorldTime;
  /** The System 49 claim this belief rests on, when it rests on one. */
  readonly claimId?: string;
  /** What was observed, in the observer's words. */
  readonly note: string;
  /** 0..1: how sound the source is. */
  readonly sourceReliability: number;
  /** 0..1: first-hand versus heard-about. */
  readonly directness: number;
  /** 0..1: how much independent support exists. */
  readonly corroboration: number;
  /** 0..1: how much weight recency gives it, supplied by the caller. */
  readonly recency: number;
  /** -1 damaging, +1 credit-building. */
  readonly valence: number;
}

export interface Perception {
  readonly subjectId: string;
  readonly domain: ReputationDomain;
  /** The observer. `community:<id>` denotes a shared local view. */
  readonly observerId: string;
  readonly evidence: readonly ReputationEvidence[];
  readonly updatedAt: WorldTime;
  /** True when this is the observer's stated view rather than a derivation. */
  readonly asserted?: boolean;
  /**
   * The stated value, when the view was asserted outright.
   *
   * An assertion is a belief put into words, not something observed, so it is
   * stored separately from the evidence and carries no confidence. Evidence
   * takes precedence when both exist: what was seen outranks what was said.
   */
  readonly assertedValue?: number;
  readonly note?: string;
}

export interface ReputationSystemState {
  readonly perceptions: readonly Perception[];
}

/** Evidence weights (provisional; see docs/CONTENT_GAPS.md). */
export const EVIDENCE_WEIGHTS = {
  sourceReliability: 0.35,
  directness: 0.3,
  corroboration: 0.2,
  recency: 0.15,
} as const;

/** How fast an unrefreshed perception fades toward neutrality, per year. */
export const DECAY_RATE_PER_YEAR = 0.5;

/** What one observer thinks of one subject, derived from their evidence. */
export interface ReputationReading {
  readonly subjectId: string;
  readonly domain: ReputationDomain;
  readonly observerId: string;
  /** -1..1, or `undefined` with no evidence at all. */
  readonly value: number | undefined;
  /** How much evidence stands behind the reading, 0..1. */
  readonly confidence: number | undefined;
  readonly evidenceCount: number;
  readonly staleDays: number;
}
