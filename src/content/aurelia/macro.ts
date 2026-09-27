/**
 * Provisional macro baseline for the playable slice (M5 / System 36).
 *
 * System 36's rule is that indicators are *derived* from lower-level
 * activity, so this module deliberately authors almost nothing: only a
 * price-index baseline (100, by definition) and a credit environment, so
 * the slice has a first frame to read. Labour, output and aggregate
 * demand/supply are **not** seeded — inventing a labour force for 50 000
 * residents would be a fiction wearing data's clothes; those series begin
 * when a caller (scenario, other systems' projections) observes them.
 *
 * The credit environment is the one exception, and it is flagged
 * provisional. Nothing here is canon.
 */

import type { MacroEngine } from "../../engine/macro/engine.ts";
import type { WorldTime } from "../../engine/primitives/time.ts";

/** Index base for a world with no earlier price observations. */
export const AURELIA_PRICE_INDEX_BASE = 100;

/** Provisional published credit environment for the slice. */
export const AURELIA_CREDIT_ENVIRONMENT = {
  policyRateBasisPoints: 450,
  lendingSpreadBasisPoints: 200,
  creditAvailability: 0.7,
  note: "Provisional: the World Bible authors no monetary institutions or rates (M5/S36 gap list).",
} as const;

/**
 * Records the baseline observations. Idempotent: the price index and the
 * credit environment are re-observed at the same instant on re-seed, which
 * updates the sample rather than duplicating it. Returns what it wrote.
 */
export function registerAureliaMacroBaseline(
  engine: MacroEngine,
  now: WorldTime,
): { priceIndex: boolean; credit: boolean } {
  engine.observePriceIndex(AURELIA_PRICE_INDEX_BASE, now);
  engine.setCreditEnvironment(
    {
      policyRateBasisPoints: AURELIA_CREDIT_ENVIRONMENT.policyRateBasisPoints,
      lendingSpreadBasisPoints: AURELIA_CREDIT_ENVIRONMENT.lendingSpreadBasisPoints,
      creditAvailability: AURELIA_CREDIT_ENVIRONMENT.creditAvailability,
      note: AURELIA_CREDIT_ENVIRONMENT.note,
    },
    now,
  );
  return { priceIndex: true, credit: true };
}
