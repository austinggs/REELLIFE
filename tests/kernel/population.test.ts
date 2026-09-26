/**
 * System 47 — population & demographics.
 *
 * Verifies the canonical 6.8B aggregate is distributed deterministically across
 * Aurelia's 6 continents / 48 countries / 36 regions / 34 settlements with exact
 * integer sums at every additive level, and that the engine registers idempotently.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { PopulationEngine } from "../../src/engine/population/engine.ts";
import type { PopulationAggregate } from "../../src/engine/population/types.ts";
import {
  CANON_CONTINENTS,
  CANON_COUNTRIES,
} from "../../src/content/aurelia/canon.ts";
import {
  AURELIA_AGE_DISTRIBUTION,
  distributeAureliaPopulation,
  registerAureliaPopulation,
} from "../../src/content/aurelia/population.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";

const SEED = "reellife-population-seed";
const GLOBAL_POPULATION = 6_800_000_000;

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
}

function ofLevel(aggregates: readonly PopulationAggregate[], level: string): PopulationAggregate[] {
  return aggregates.filter((aggregate) => aggregate.level === level);
}

function sum(populations: readonly number[]): number {
  return populations.reduce((a, b) => a + b, 0);
}

describe("population engine (System 47)", () => {
  it("distributes the canonical 6.8B with exact continent totals", () => {
    const aggregates = distributeAureliaPopulation();
    const continents = ofLevel(aggregates, "continent");
    expect(continents).toHaveLength(6);
    expect(sum(continents.map((c) => c.totalPopulation))).toBe(GLOBAL_POPULATION);
    for (const continent of CANON_CONTINENTS) {
      expect(continents.find((c) => c.locationId === continent.id)?.totalPopulation).toBe(
        continent.targetPopulation,
      );
    }
  });

  it("makes country totals sum exactly to their continent target", () => {
    const aggregates = distributeAureliaPopulation();
    for (const continent of CANON_CONTINENTS) {
      const countryTotals = aggregates
        .filter((a) => a.level === "country" && a.parentId === continent.id)
        .map((a) => a.totalPopulation);
      expect(sum(countryTotals)).toBe(continent.targetPopulation);
    }
    expect(ofLevel(aggregates, "country")).toHaveLength(48);
  });

  it("makes region totals sum exactly to their country total", () => {
    const aggregates = distributeAureliaPopulation();
    for (const country of CANON_COUNTRIES) {
      const regionTotals = aggregates
        .filter((a) => a.level === "region" && a.parentId === country.id)
        .map((a) => a.totalPopulation);
      const countryTotal =
        aggregates.find((a) => a.locationId === country.id && a.level === "country")?.totalPopulation ?? 0;
      if (regionTotals.length > 0) {
        expect(sum(regionTotals)).toBe(countryTotal);
      }
    }
    expect(ofLevel(aggregates, "region")).toHaveLength(36);
  });

  it("makes settlement totals sum to the country's urbanised population", () => {
    const aggregates = distributeAureliaPopulation();
    for (const country of CANON_COUNTRIES) {
      const countryAggregate = aggregates.find((a) => a.locationId === country.id && a.level === "country");
      expect(countryAggregate).toBeDefined();
      if (!countryAggregate) continue;
      const settlementTotals = aggregates
        .filter((a) => a.level === "settlement" && a.parentId === country.id)
        .map((a) => a.totalPopulation);
      if (settlementTotals.length > 0) {
        expect(sum(settlementTotals)).toBe(
          Math.round(countryAggregate.totalPopulation * countryAggregate.urbanizationRate),
        );
      }
    }
    expect(ofLevel(aggregates, "settlement")).toHaveLength(34);
  });

  it("is deterministic and every aggregate has a valid age distribution", () => {
    const first = distributeAureliaPopulation();
    const second = distributeAureliaPopulation();
    expect(second).toEqual(first);

    for (const aggregate of first) {
      expect(aggregate.urbanizationRate).toBeGreaterThanOrEqual(0);
      expect(aggregate.urbanizationRate).toBeLessThanOrEqual(1);
      const shareSum = sum(aggregate.ageDistribution.map((band) => band.share));
      expect(Math.abs(shareSum - 1)).toBeLessThan(1e-9);
    }
    expect(AURELIA_AGE_DISTRIBUTION.map((band) => band.share).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("registers aggregates idempotently and answers queries", () => {
    const sim = newWorld();
    sim.guard.mutate("population", () => {
      const engine = new PopulationEngine(sim.scope, sim.world);
      registerAureliaPopulation(engine);
      const expectedCount = 6 + 48 + 36 + 34;
      expect(engine.aggregates()).toHaveLength(expectedCount);

      // Idempotent re-registration.
      registerAureliaPopulation(engine);
      expect(engine.aggregates()).toHaveLength(expectedCount);

      // Continent totals are additive over their countries.
      expect(engine.totalUnder("CONT-ELANDRA")).toBe(1_350_000_000);
      expect(engine.aggregateFor("CITY-ARDEN")?.level).toBe("settlement");
      expect(engine.aggregateFor("WORLD-AURELIA")).toBeUndefined();
    });
  });
});
