/**
 * Population & demographics state (System 47).
 *
 * The population system owns *aggregate* demographic mass: how many people live
 * in each continent, country, region and settlement, how urbanised they are and
 * how their ages are distributed. It never owns individual identity, decisions
 * or relationships — those belong to their own systems. When relevance rises,
 * `scale/materialize.ts` reveals individuals *from* these aggregates rather than
 * inventing them (System 07 / World Build 11).
 */

export const POPULATION_LEVELS = ["continent", "country", "region", "settlement"] as const;
export type PopulationLevel = (typeof POPULATION_LEVELS)[number];

/** One age cohort's share of a population; shares sum to 1 across a distribution. */
export interface AgeShare {
  readonly band: string;
  readonly share: number;
}

/**
 * Aggregate demographic record for one spatial unit.
 *
 * The hierarchy is additive at each parent level except settlements, which are
 * the *urbanised* subset of their country's population (World Build 12: ~70%
 * urban) rather than an additive child of a region. A settlement's `parentId` is
 * therefore its country, and its `totalPopulation` is part of that country's
 * total, not an additional slice on top of the regions.
 */
export interface PopulationAggregate {
  readonly locationId: string;
  readonly level: PopulationLevel;
  readonly parentId?: string;
  readonly totalPopulation: number;
  /** Share of the population living in urban/metropolitan areas, in [0, 1]. */
  readonly urbanizationRate: number;
  readonly ageDistribution: readonly AgeShare[];
}

export interface PopulationSystemState {
  readonly aggregates: readonly PopulationAggregate[];
}
