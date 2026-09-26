/**
 * Canonical Aurelia population distribution (M4 / System 47).
 *
 * The World Bible fixes the six continental totals (summing to ~6.8B) but
 * deliberately defers per-country/city numbers. This module derives those lower
 * levels deterministically:
 *
 *   continent  →  exact canon target (WORLD_BUILD_11/12)
 *   country    →  continent total split by a stable per-id weight
 *   region     →  its country's total split by a stable per-id weight
 *   settlement →  its country's *urbanised* share split by a stable per-id weight
 *
 * Every split is an exact integer partition (the last share absorbs rounding),
 * so the sums below hold exactly:
 *   - Σ countries per continent === continent target
 *   - Σ regions per country   === country total (when the country has regions)
 *   - Σ settlements per country === round(country total × urbanisation)
 *
 * The weights come from `fnv1a32(locationId)` — a stable, dependency-free hash —
 * not from `Math.random()` or the seeded simulation RNG, because world *definition*
 * is deterministic content, not runtime chance. The urbanisation rate per country
 * is also derived from that hash (band [0.55, 0.85]) with the global average held
 * near the canonical ~70%. All of this is provisional (logged in
 * `docs/CONTENT_GAPS.md`) because the World Bible does not author exact numbers.
 */

import { fnv1a32 } from "../../engine/rng/hash.ts";
import {
  CANON_CONTINENTS,
  CANON_COUNTRIES,
  CANON_REGIONS,
  CANON_SETTLEMENTS,
} from "./canon.ts";
import type { PopulationAggregate, AgeShare } from "../../engine/population/types.ts";
import type { PopulationEngine } from "../../engine/population/engine.ts";

/** Provisional age distribution; mirrors the M2 scale DEFAULT_AGE_STRUCTURE. */
export const AURELIA_AGE_DISTRIBUTION: readonly AgeShare[] = [
  { band: "child", share: 0.24 },
  { band: "youngAdult", share: 0.18 },
  { band: "adult", share: 0.38 },
  { band: "senior", share: 0.2 },
];

/** Canonical global urbanisation (World Build 11/12: ~70%). */
export const AURELIA_URBANIZATION = 0.7;

/** Stable weight in (0, 1) from a location id. */
function weightOf(id: string): number {
  return (fnv1a32(id) + 0.5) / 0x1_0000_0000;
}

/** Deterministic country urbanisation rate, in [0.55, 0.85]. */
function urbanizationOf(id: string): number {
  return 0.55 + 0.3 * weightOf(id);
}

/**
 * Splits `total` into `ids.length` whole-number shares by deterministic weight.
 * The final share absorbs rounding so the parts always sum exactly to `total`.
 */
function split(total: number, ids: readonly string[]): number[] {
  if (ids.length === 0) return [];
  const weights = ids.map(weightOf);
  const sum = weights.reduce((a, b) => a + b, 0);
  const shares: number[] = [];
  let remaining = total;
  for (let index = 0; index < ids.length; index += 1) {
    if (index === ids.length - 1) {
      shares.push(remaining);
    } else {
      const share = Math.floor((total * weights[index]) / sum);
      shares.push(share);
      remaining -= share;
    }
  }
  return shares;
}

/** Builds the complete deterministic aggregate population of Aurelia. */
export function distributeAureliaPopulation(): readonly PopulationAggregate[] {
  const aggregates: PopulationAggregate[] = [];

  for (const continent of CANON_CONTINENTS) {
    aggregates.push({
      locationId: continent.id,
      level: "continent",
      totalPopulation: continent.targetPopulation,
      urbanizationRate: AURELIA_URBANIZATION,
      ageDistribution: AURELIA_AGE_DISTRIBUTION,
    });

    const countries = CANON_COUNTRIES.filter((country) => country.continentId === continent.id);
    const countryTotals = split(continent.targetPopulation, countries.map((country) => country.id));

    countries.forEach((country, countryIndex) => {
      const countryPopulation = countryTotals[countryIndex];
      const urbanization = urbanizationOf(country.id);

      aggregates.push({
        locationId: country.id,
        level: "country",
        parentId: continent.id,
        totalPopulation: countryPopulation,
        urbanizationRate: urbanization,
        ageDistribution: AURELIA_AGE_DISTRIBUTION,
      });

      const regions = CANON_REGIONS.filter((region) => region.countryId === country.id);
      const regionTotals = split(countryPopulation, regions.map((region) => region.id));
      regions.forEach((region, regionIndex) => {
        aggregates.push({
          locationId: region.id,
          level: "region",
          parentId: country.id,
          totalPopulation: regionTotals[regionIndex],
          urbanizationRate: urbanization,
          ageDistribution: AURELIA_AGE_DISTRIBUTION,
        });
      });

      // Settlements are the urbanised share of the country's population.
      const settlements = CANON_SETTLEMENTS.filter((settlement) => settlement.countryId === country.id);
      const urbanPopulation = Math.round(countryPopulation * urbanization);
      const settlementTotals = split(urbanPopulation, settlements.map((settlement) => settlement.id));
      settlements.forEach((settlement, settlementIndex) => {
        aggregates.push({
          locationId: settlement.id,
          level: "settlement",
          parentId: country.id,
          totalPopulation: settlementTotals[settlementIndex],
          urbanizationRate: 1,
          ageDistribution: AURELIA_AGE_DISTRIBUTION,
        });
      });
    });
  }

  return aggregates;
}

/** Registers the canonical distribution on a population engine (idempotent). */
export function registerAureliaPopulation(engine: PopulationEngine): void {
  for (const aggregate of distributeAureliaPopulation()) {
    if (!engine.aggregateFor(aggregate.locationId)) engine.define(aggregate);
  }
}
