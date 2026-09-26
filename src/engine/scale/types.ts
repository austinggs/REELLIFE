/**
 * Scale state (System 07): aggregate population and materialized residents.
 *
 * Two layers live side by side:
 *  - the *aggregate* (a settlement's total population and age structure) is
 *    the low-resolution truth that survives compression, and
 *  - *residents* are the individuals already revealed inside that aggregate.
 *
 * Materialization never grows the aggregate: revealing a person is a change
 * of resolution, not an invention of a new life (System 07).
 */

import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";

export const AGE_BANDS = ["child", "youngAdult", "adult", "senior"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/** Shares of a settlement's population per age band; must sum to 1. */
export interface AgeStructureBand {
  readonly band: AgeBand;
  readonly share: number;
}

export interface SettlementAggregate {
  readonly settlementId: string;
  readonly totalPopulation: number;
  readonly ageStructure: readonly AgeStructureBand[];
}

/**
 * The persisted aggregate context a materialized person is *revealed* from —
 * re-materializing later must restore this life, not invent another one.
 */
export interface ResidentContext {
  readonly personId: EntityId<"person">;
  readonly settlementId: string;
  readonly householdId?: string;
  readonly ageBand: AgeBand;
  readonly materializedAt: WorldTime;
}

export interface ScaleSystemState {
  readonly settlements: readonly SettlementAggregate[];
  readonly residents: readonly ResidentContext[];
}
