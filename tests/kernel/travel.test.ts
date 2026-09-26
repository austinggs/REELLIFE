/**
 * System 45 — travel / immigration / borders (and System 38 route generation).
 *
 * The travel engine owns physical transit: the canonical transport network
 * (rail, road, maritime, flight along the six corridors plus intercontinental
 * links), active journeys, and travel history. It never invents geography —
 * routes are generated from the canonical settlements and their coordinates.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { asEntityId } from "../../src/engine/primitives/ids.ts";
import { addTime, durationOf } from "../../src/engine/primitives/time.ts";
import { TravelEngine } from "../../src/engine/travel/engine.ts";
import { generateCanonicalRoutes } from "../../src/engine/travel/routes.ts";
import type { TransportRoute } from "../../src/engine/travel/types.ts";
import { ScaleEngine } from "../../src/engine/scale/engine.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";

const SEED = "reellife-travel-seed";

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
}

function withTravel<T>(sim: Simulation, fn: (engine: TravelEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("travel", () => {
    result = fn(new TravelEngine(sim.scope, sim.world));
  });
  return result;
}

function routeKey(route: { originSettlementId: string; destinationSettlementId: string }): string {
  return `${route.originSettlementId}->${route.destinationSettlementId}`;
}

describe("travel engine (System 45)", () => {
  it("generates canonical routes connecting settlements in both directions", () => {
    const routes = generateCanonicalRoutes();
    expect(routes.length).toBeGreaterThan(0);

    // Every route has a return route, so transit is symmetric in the network.
    const keys = new Set(routes.map(routeKey));
    for (const route of routes) {
      expect(keys.has(`${route.destinationSettlementId}->${route.originSettlementId}`)).toBe(true);
    }

    // All four transport modes are represented.
    const modes = new Set(routes.map((route) => route.mode));
    expect(modes.has("rail")).toBe(true);
    expect(modes.has("road")).toBe(true);
    expect(modes.has("maritime")).toBe(true);
    expect(modes.has("flight")).toBe(true);
  });

  it("finds a route by preferred mode and falls back to the fastest route", () => {
    const sim = newWorld();
    withTravel(sim, (engine) => {
      const flight = engine.findRoute("CITY-ARDEN", "CITY-WESTHAVEN", "flight");
      expect(flight?.mode).toBe("flight");

      // No preferred mode: fastest wins. Flight beats maritime over this distance.
      const fastest = engine.findRoute("CITY-ARDEN", "CITY-WESTHAVEN");
      expect(fastest).toBeDefined();
      expect(fastest?.mode).toBe("flight");

      // An impossible pairing has no route.
      expect(engine.findRoute("CITY-ARDEN", "CITY-NOWHERE")).toBeUndefined();
    });
  });

  it("links settlements along a corridor by rail and road", () => {
    const sim = newWorld();
    withTravel(sim, (engine) => {
      const rail = engine.findRoute("CITY-ARDEN", "CITY-CALDOR", "rail");
      expect(rail?.mode).toBe("rail");
      expect(rail?.corridor).toBe("Ardan Corridor");

      const road = engine.findRoute("CITY-ARDEN", "CITY-CALDOR", "road");
      expect(road?.mode).toBe("road");
    });
  });

  it("runs the active journey lifecycle and records travel history", () => {
    const sim = newWorld();
    withTravel(sim, (engine) => {
      const route: TransportRoute | undefined = engine.findRoute("CITY-ARDEN", "CITY-WESTHAVEN", "flight");
      expect(route).toBeDefined();
      if (!route) return;

      const personId = asEntityId<"person">("PER-000001");
      const now = sim.clock.time;
      const departs = now;
      const arrives = addTime(now, durationOf(route.durationMinutes));

      engine.startJourney({
        journeyId: "JRN-000001",
        personId,
        originSettlementId: "CITY-ARDEN",
        destinationSettlementId: "CITY-WESTHAVEN",
        routeId: route.id,
        departedAt: departs,
        arrivesAt: arrives,
        mode: route.mode,
      });

      expect(engine.activeJourneyOf(personId)?.destinationSettlementId).toBe("CITY-WESTHAVEN");

      // A person cannot be on two journeys at once.
      expect(() =>
        engine.startJourney({
          journeyId: "JRN-000002",
          personId,
          originSettlementId: "CITY-ARDEN",
          destinationSettlementId: "CITY-SARAD",
          routeId: route.id,
          departedAt: departs,
          arrivesAt: arrives,
          mode: route.mode,
        }),
      ).toThrow(/already on a journey/);

      const completed = engine.completeJourney(personId, addTime(now, durationOf(120)));
      expect(completed?.destinationSettlementId).toBe("CITY-WESTHAVEN");
      expect(engine.activeJourneyOf(personId)).toBeUndefined();
    });
  });

  it("relocates a resident between settlements (System 45 × 07)", () => {
    const sim = newWorld();
    const personId = asEntityId<"person">("PER-000001");
    sim.guard.mutate("scale", () => {
      const scale = new ScaleEngine(sim.scope, sim.world);
      scale.defineSettlement("CITY-ARDEN", 50_000);
      scale.defineSettlement("CITY-WESTHAVEN", 80_000);
      scale.recordResident({
        personId,
        settlementId: "CITY-ARDEN",
        ageBand: "adult",
        materializedAt: sim.clock.time,
      });

      scale.relocateResident(personId, "CITY-WESTHAVEN");
      expect(scale.residentFor(personId)?.settlementId).toBe("CITY-WESTHAVEN");
      expect(scale.residentsAt("CITY-ARDEN")).toHaveLength(0);
      expect(scale.residentsAt("CITY-WESTHAVEN")).toHaveLength(1);

      // A person who is not materialized cannot be relocated.
      expect(() => scale.relocateResident(asEntityId<"person">("PER-000999"), "CITY-ARDEN")).toThrow(
        /not a resident/,
      );
    });
  });
});
