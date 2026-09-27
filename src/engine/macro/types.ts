/**
 * System 36 — Macroeconomic Layer.
 *
 * "Macroeconomics describes aggregate conditions that emerge from many
 * lower-level interactions" (System 36 core principle). Nothing here decides
 * anyone's prices, hiring or spending: the system *samples* lower-level
 * activity (fed by its callers from Systems 24/25/33/35/47), stores those
 * observations with their timestamps, and derives the indicators the spec
 * lists — inflation, unemployment, growth, productivity, aggregate
 * demand/supply, the interest/credit environment and the currency's
 * purchasing-power context.
 *
 * Two rules shape the model:
 *
 *   1. **Indicators are derived with explicit windows.** An inflation
 *      reading is "the price index now against the index `window` ago", and
 *      if the window is not spanned by observations there is *no reading*
 *      (`undefined`) rather than a guessed one. Lag is therefore visible:
 *      an observation only affects readings whose window has reached it.
 *   2. **Shocks are conditions, not rewrites.** A macro shock enters
 *      explicitly through `raiseShock`, is listed wherever conditions are
 *      read, and never edits any observation — the spec's "influence lower
 *      levels but do not magically rewrite them".
 */

import type { WorldTime } from "../primitives/time.ts";

/** A price-index observation (base 100 at the world's first sample). */
export interface PriceIndexSample {
  readonly at: WorldTime;
  readonly index: number;
}

/** Labour-market observation: who is in the force, who is working. */
export interface LaborSample {
  readonly at: WorldTime;
  readonly laborForce: number;
  readonly employed: number;
}

/** Output observation; hours make productivity measurable. */
export interface OutputSample {
  readonly at: WorldTime;
  readonly outputIndex: number;
  readonly hoursWorked?: number;
}

/** Aggregate demand vs aggregate supply, as index levels. */
export interface AggregateSample {
  readonly at: WorldTime;
  readonly demandIndex: number;
  readonly supplyIndex: number;
}

/**
 * The interest/credit environment (System 36 owns the *context*, not the
 * policy mechanics — a government system sets this through an explicit
 * call, and the history is what makes a policy change observable).
 */
export interface CreditEnvironment {
  readonly at: WorldTime;
  readonly policyRateBasisPoints: number;
  readonly lendingSpreadBasisPoints: number;
  /** How easy credit is to obtain, 0..1. */
  readonly creditAvailability: number;
  readonly note?: string;
}

/**
 * A macro shock: an explicit condition with severity, raised and lifted by
 * its owner. `kind` is a slug ("supply_disruption", "demand_surge", …).
 */
export interface MacroShock {
  readonly id: string;
  readonly kind: string;
  /** 0..1. */
  readonly severity: number;
  readonly raisedAt: WorldTime;
  readonly liftedAt?: WorldTime;
  readonly note?: string;
}

export interface MacroSystemState {
  readonly priceIndex: readonly PriceIndexSample[];
  readonly labor: readonly LaborSample[];
  readonly output: readonly OutputSample[];
  readonly aggregates: readonly AggregateSample[];
  /** Latest credit environment; `creditHistory` keeps every change. */
  readonly creditEnvironment?: CreditEnvironment;
  readonly creditHistory: readonly CreditEnvironment[];
  readonly shocks: readonly MacroShock[];
}

/** Default indicator windows (provisional; see docs/CONTENT_GAPS.md). */
export const MACRO_WINDOWS = {
  /** Year-on-year style window for inflation and output growth. */
  annualDays: 365,
  /** Quarter-ish window for productivity. */
  productivityDays: 90,
} as const;

/** One named downturn fact; a list of these is *not* a declared recession. */
export interface DownturnSignal {
  readonly signal: string;
  readonly detail: string;
}
