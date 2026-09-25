import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";

/**
 * ReelLife System 13 — Personality, Traits & Aptitudes.
 *
 * Models relatively persistent tendencies (personality dimensions, temperament)
 * and domain-specific aptitudes. Personality changes only gradually through
 * meaningful experience — never abrupt random jumps — and it is a tendency,
 * not destiny: it feeds decisions and learning but does not dictate them.
 *
 * This system owns the underlying trait STATE. Self-perception (which can
 * differ from the truth recorded here) is a knowledge-filtered projection
 * concern, not part of this module (architectural law 4).
 */

/**
 * Data-driven personality dimensions (spec §Model). The list is open: content
 * files may add contextual dimensions; the engine treats them uniformly.
 */
export type TraitDimension =
  | "sociability"
  | "assertiveness"
  | "conscientiousness"
  | "openness"
  | "emotionalReactivity"
  | "patience"
  | "riskTolerance"
  | "adaptability"
  | "independence"
  | "competitiveness"
  | "empathy"
  | "trust"
  | "persistence";

export const TRAIT_DIMENSIONS: readonly TraitDimension[] = [
  "sociability",
  "assertiveness",
  "conscientiousness",
  "openness",
  "emotionalReactivity",
  "patience",
  "riskTolerance",
  "adaptability",
  "independence",
  "competitiveness",
  "empathy",
  "trust",
  "persistence",
] as const;

/** Coarse temperamental pattern; a derived summary, not an independent axis. */
export type TemperamentKind =
  | "sanguine"
  | "choleric"
  | "melancholic"
  | "phlegmatic";

/** Personality dimensions, each normalised to 0.0 .. 1.0. */
export type PersonalityDimensions = Readonly<Record<TraitDimension, number>>;

/**
 * A domain-specific aptitude. Aptitude is NOT a universal IQ-like stat: it is
 * per-domain potential that influences learning but never replaces practice,
 * education, health, motivation or opportunity.
 */
export interface Aptitude {
  readonly domain: string;
  /** 0.0 .. 1.0 */
  readonly level: number;
}

/**
 * A temporary expression modifier on a dimension. Culture and roles can change
 * how a trait is expressed without changing the underlying trait state; such
 * modifiers are tracked here so the base personality stays single-owned.
 */
export interface TraitExpressionModifier {
  readonly id: string;
  readonly sourceSystem: string;
  readonly dimension: TraitDimension;
  /** Applied to the expressed (not base) value: -1.0 .. +1.0. */
  readonly delta: number;
  readonly expiresAt?: WorldTime;
}

export interface TraitChangeEntry {
  readonly timestamp: WorldTime;
  readonly dimension: TraitDimension;
  readonly from: number;
  readonly to: number;
  readonly cause: string;
}

export interface PersonTraitsState {
  readonly personId: EntityId<"person">;
  readonly personality: PersonalityDimensions;
  readonly temperament: TemperamentKind;
  readonly aptitudes: readonly Aptitude[];
  readonly expressionModifiers: readonly TraitExpressionModifier[];
  readonly history: readonly TraitChangeEntry[];
}

export interface TraitsSystemState {
  readonly persons: readonly PersonTraitsState[];
}
