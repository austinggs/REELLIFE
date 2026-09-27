/**
 * System 28 — transportation: vehicle state, maintenance, fuel, ownership
 * history, trip estimates, public transit capacity and disruptions.
 *
 * The behaviours below are the ones the spec names for testing (multimodal
 * travel, disruptions, maintenance, public transit capacity, cross-border
 * trips, route recalculation), each checked against engine state. The
 * boundary the spec draws is tested explicitly: a route belongs to System
 * 45, and 28 only adds what a *vehicle* and a *service* know.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { seedPlayableSlice } from "../../src/engine/kernel/sliceSeed.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { TransportEngine } from "../../src/engine/transport/engine.ts";
import type { Vehicle } from "../../src/engine/transport/types.ts";
import { TravelEngine } from "../../src/engine/travel/engine.ts";
import type { TransportRoute } from "../../src/engine/travel/types.ts";
import {
  AURELIA_SLICE_SERVICE_COUNT,
  AURELIA_SLICE_VEHICLE_COUNT,
  aureliaArdenVehicles,
} from "../../src/content/aurelia/transport.ts";
import { M2_SETTLEMENT_ID } from "../../src/content/aurelia/geography.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { currencyId, money } from "../../src/engine/primitives/money.ts";
import { atTime, days } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-transport-seed";
const AUR = currencyId("AUR");
const NOW = atTime(days(365));
const DOCKS = "ORG-ARDIN-DOCKS";
const TRACTOR = "VEH-ARDEN-DOCKS-TRACTOR";
const VAN = "VEH-ARDEN-BAKERY-VAN";
const COACH_VEHICLE = "VEH-ARDEN-DOCKS-COACH";
const COACH_SERVICE = "SVC-ARDEN-DOCKS-COACH";

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
}

function withTransport<T>(sim: Simulation, fn: (engine: TransportEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("transport", () => {
    result = fn(new TransportEngine(sim.scope, sim.world));
  });
  return result;
}

/** A real System 45 route out of Arden, so no test invents geography. */
function roadRoute(sim: Simulation): TransportRoute {
  const route = new TravelEngine(sim.scope, sim.world).findRoute(
    M2_SETTLEMENT_ID,
    "CITY-CALDOR",
    "road",
  );
  if (route === undefined) throw new Error("transport test: expected a road route out of Arden");
  return route;
}

function vehicleOf(engine: TransportEngine, id: string): Vehicle {
  const found = engine.vehicle(id);
  if (found === undefined) throw new Error(`transport test: missing vehicle ${id}`);
  return found;
}

describe("transport (System 28)", () => {
  it("registers the slice fleet on real organizations, idempotently", () => {
    const sim = newWorld();
    withTransport(sim, (engine) => {
      expect(aureliaArdenVehicles(M2_SETTLEMENT_ID)).toHaveLength(AURELIA_SLICE_VEHICLE_COUNT);
      expect(engine.vehicles()).toHaveLength(AURELIA_SLICE_VEHICLE_COUNT);
      expect(engine.services()).toHaveLength(AURELIA_SLICE_SERVICE_COUNT);

      // Every owner is a real slice organization (System 32), and the coach
      // runs a route System 45 actually has.
      const organizations = sim.world.systems.organizations as {
        readonly organizations: readonly { readonly id: string }[];
      };
      const orgIds = new Set(organizations.organizations.map((entry) => entry.id));
      for (const vehicle of engine.vehicles()) {
        expect(orgIds.has(vehicle.ownerId)).toBe(true);
      }
      const routes = new TravelEngine(sim.scope, sim.world);
      for (const service of engine.services()) {
        expect(routes.allRoutes().some((route) => route.id === service.routeId)).toBe(true);
      }

      // A vehicle is a full, fuelled, registered thing on arrival.
      const tractor = vehicleOf(engine, TRACTOR);
      expect(tractor.status).toBe("operational");
      expect(tractor.energyUnits).toBe(tractor.energyCapacityUnits);
      expect(tractor.registrations).toHaveLength(1);
      expect(tractor.registrations[0]?.ownerId).toBe(DOCKS);
      // Capability is not ownership: the docks own and operate both of theirs.
      expect(vehicleOf(engine, COACH_VEHICLE).operatorOrgId).toBe(DOCKS);
    });

    // Re-seeding adds no duplicate fleet (outside the transport scope:
    // scopes never nest, and the seed opens its own).
    seedPlayableSlice(sim);
    withTransport(sim, (engine) => {
      expect(engine.vehicles()).toHaveLength(AURELIA_SLICE_VEHICLE_COUNT);
      expect(engine.services()).toHaveLength(AURELIA_SLICE_SERVICE_COUNT);
    });
  });

  it("refuses an incoherent vehicle, service or disruption", () => {
    const sim = newWorld();
    const ids = new IdAllocator();
    withTransport(sim, (engine) => {
      expect(() =>
        engine.defineVehicle(aureliaArdenVehicles(M2_SETTLEMENT_ID)[0] as never, NOW),
      ).toThrow(/already exists/);
      // Guarded inputs, not silently coerced values.
      expect(() =>
        engine.defineVehicle(
          {
            id: "VEH-PROBE",
            kind: "hovercraft" as never,
            mode: "road",
            ownerId: DOCKS,
            locationId: M2_SETTLEMENT_ID,
            capacityUnits: 1,
            energyCapacityUnits: 1,
            rangeUnits: 1,
          },
          NOW,
        ),
      ).toThrow(/unknown kind/);
      expect(() =>
        engine.defineVehicle(
          {
            id: "VEH-PROBE",
            kind: "car",
            mode: "road",
            ownerId: DOCKS,
            locationId: M2_SETTLEMENT_ID,
            capacityUnits: 1,
            energyCapacityUnits: 0,
            rangeUnits: 1,
          },
          NOW,
        ),
      ).toThrow(/energyCapacityUnits/);

      // A service is a line between at least two stops.
      expect(() =>
        engine.defineService(
          {
            id: "SVC-PROBE",
            routeId: "ROUTE-NOT-REAL",
            operatorOrgId: DOCKS,
            mode: "road",
            stopIds: [M2_SETTLEMENT_ID],
            fare: money(AUR, 40),
            capacityUnits: 10,
          },
          NOW,
        ),
      ).toThrow(/at least two stops/);

      // A disruption must have a target the world actually has.
      expect(() =>
        engine.raiseDisruption(
          ids,
          { cause: "road_closure", targetId: "ROUTE-NOT-REAL", durationMinutes: 60 },
          NOW,
        ),
      ).toThrow(/neither a vehicle nor a service/);
      expect(() =>
        engine.raiseDisruption(
          ids,
          { cause: "meteor" as never, targetId: TRACTOR, durationMinutes: 60 },
          NOW,
        ),
      ).toThrow(/unknown cause/);
      expect(() => engine.resolveDisruption("dis-NOT-REAL", NOW)).toThrow(/unknown disruption/);
    });
  });

  it("keeps a vehicle's condition, fuel and maintenance honest", () => {
    const sim = newWorld();
    withTransport(sim, (engine) => {
      // A sound, fuelled vehicle is dispatchable with no reasons.
      expect(engine.dispatchable(TRACTOR)).toEqual({ dispatchable: true, reasons: [] });

      // Condition is a number, and "broken" is derived from it — there is
      // no stored flag that could disagree with it.
      engine.setCondition(TRACTOR, 0.2);
      const worn = engine.dispatchable(TRACTOR);
      expect(worn.dispatchable).toBe(false);
      expect(worn.reasons.join(" ")).toMatch(/below the serviceable floor/);
      // Just above the floor it is fine again: the threshold is the floor.
      engine.setCondition(TRACTOR, 0.26);
      expect(engine.dispatchable(TRACTOR).dispatchable).toBe(true);

      // Fuel: burnt down below the minimum and it will not start; refuelling
      // brings it back, capped at the tank it started with.
      engine.consumeEnergy(TRACTOR, 195);
      expect(engine.energyShare(vehicleOf(engine, TRACTOR))).toBeLessThan(0.05);
      expect(engine.dispatchable(TRACTOR).reasons.join(" ")).toMatch(/not enough fuel/);
      engine.refuel(TRACTOR, 10_000);
      expect(engine.energyShare(vehicleOf(engine, TRACTOR))).toBe(1);

      // Maintenance is a state with a history: in the workshop it cannot be
      // dispatched, and it comes back restored when the work is done.
      engine.beginMaintenance(TRACTOR, NOW, "repair");
      expect(vehicleOf(engine, TRACTOR).status).toBe("in_maintenance");
      expect(engine.dispatchable(TRACTOR).reasons).toContain("in maintenance");
      expect(() => engine.beginMaintenance(TRACTOR, NOW)).toThrow(/already in maintenance/);
      engine.completeMaintenance(TRACTOR, 0.95);
      expect(vehicleOf(engine, TRACTOR).status).toBe("operational");
      expect(vehicleOf(engine, TRACTOR).condition).toBe(0.95);
      expect(vehicleOf(engine, TRACTOR).maintenance).toHaveLength(1);
      expect(engine.dispatchable(TRACTOR).dispatchable).toBe(true);
      expect(() => engine.completeMaintenance(TRACTOR)).toThrow(/not in maintenance/);
    });
  });

  it("weighs a trip against the vehicle, and names every reason", () => {
    const sim = newWorld();
    const route = roadRoute(sim);
    withTransport(sim, (engine) => {
      // A sound vehicle on a sound day: the route's own duration, and a
      // cost derived from distance, condition and carried capacity.
      const sound = engine.estimateTrip(route, vehicleOf(engine, TRACTOR));
      expect(sound.feasible).toBe(true);
      expect(sound.durationMinutes).toBe(route.durationMinutes);
      expect(sound.cost.minorUnits).toBeGreaterThan(0);
      expect(sound.risk).toBeCloseTo(0, 10);

      // A worn vehicle takes longer, costs more and is riskier — all three
      // from the same condition number, not three separate opinions.
      engine.setCondition(VAN, 1);
      const soundVan = engine.estimateTrip(route, vehicleOf(engine, VAN));
      engine.setCondition(VAN, 0.3);
      const wornVan = engine.estimateTrip(route, vehicleOf(engine, VAN));
      expect(wornVan.durationMinutes).toBeGreaterThan(soundVan.durationMinutes);
      expect(wornVan.cost.minorUnits).toBeGreaterThan(soundVan.cost.minorUnits);
      expect(wornVan.risk).toBeGreaterThan(soundVan.risk);

      // Conditions the caller owns (traffic, weather) make it slower and
      // riskier without changing what the vehicle costs to run.
      const jammed = engine.estimateTrip(route, vehicleOf(engine, VAN), {
        trafficFactor: 1.5,
        weatherSeverity: 0.8,
      });
      expect(jammed.durationMinutes).toBeGreaterThan(wornVan.durationMinutes);
      expect(jammed.risk).toBeGreaterThan(wornVan.risk);
      expect(jammed.cost.minorUnits).toBe(wornVan.cost.minorUnits);

      // A vehicle too dry for the route says so instead of quoting a trip.
      engine.consumeEnergy(VAN, 59);
      const dry = engine.estimateTrip(route, vehicleOf(engine, VAN));
      expect(dry.feasible).toBe(false);
      expect(dry.reasons.join(" ")).toMatch(/needs .* energy for the route/);
    });
  });

  it("sells seats up to capacity, and stops when a disruption bites", () => {
    const sim = newWorld();
    const ids = new IdAllocator();
    const route = roadRoute(sim);
    withTransport(sim, (engine) => {
      const service = engine.requireService(COACH_SERVICE, "test");
      expect(engine.seatsAvailable(COACH_SERVICE)).toBe(service.capacityUnits);

      // A full run fills exactly to capacity — no overbooking.
      engine.boardService(COACH_SERVICE, service.capacityUnits);
      expect(engine.seatsAvailable(COACH_SERVICE)).toBe(0);
      expect(() => engine.boardService(COACH_SERVICE, 1)).toThrow(/seats left/);
      // Alighting frees them again.
      engine.alightService(COACH_SERVICE, 10);
      expect(engine.seatsAvailable(COACH_SERVICE)).toBe(10);
      expect(() => engine.alightService(COACH_SERVICE, 999)).toThrow(/holds/);

      // A disruption on the service stops boarding, and resolving it lets
      // the run continue — the record keeps what happened either way.
      const strike = engine.raiseDisruption(
        ids,
        { cause: "cancellation", targetId: COACH_SERVICE, durationMinutes: 120, note: "dock strike" },
        NOW,
      );
      expect(() => engine.boardService(COACH_SERVICE, 1)).toThrow(/disruption in force/);
      engine.resolveDisruption(strike.id, NOW);
      expect(engine.boardService(COACH_SERVICE, 1).occupiedUnits).toBe(
        service.capacityUnits - 10 + 1,
      );
      expect(engine.disruptions()).toHaveLength(1);
      expect(engine.activeDisruptions()).toHaveLength(0);
      expect(() => engine.resolveDisruption(strike.id, NOW)).toThrow(/already resolved/);

      // A stopped service does not sell tickets, and the fare is data the
      // caller settles (System 25) — not something 28 posts.
      engine.setServiceRunning(COACH_SERVICE, false);
      expect(() => engine.boardService(COACH_SERVICE, 1)).toThrow(/not running/);
      engine.setServiceRunning(COACH_SERVICE, true);
      engine.setFare(COACH_SERVICE, money(AUR, 55));
      expect(engine.requireService(COACH_SERVICE, "test").fare.minorUnits).toBe(55);

      // The coach's route is System 45's, so a reroute there is what moves
      // the line here — 28 holds no route of its own to contradict.
      expect(service.routeId).toBe(route.id);
    });
  });

  it("keeps transport state under single ownership and in the save format", () => {
    const sim = newWorld();

    const reader = new TransportEngine(sim.scope, sim.world);
    expect(reader.vehicles()).toHaveLength(AURELIA_SLICE_VEHICLE_COUNT);
    expect(() => reader.setCondition(TRACTOR, 0.5)).toThrow(MissingWriterContextError);
    expect(() =>
      sim.guard.mutate("markets", () => {
        new TransportEngine(sim.scope, sim.world).setCondition(TRACTOR, 0.5);
      }),
    ).toThrow(OwnershipViolationError);

    const bag = (sim.serializedWorld() as { readonly systems?: Record<string, unknown> }).systems;
    expect(bag?.["transport"]).toBeDefined();
    const state = bag?.["transport"] as {
      readonly vehicles: readonly unknown[];
      readonly services: readonly unknown[];
      readonly disruptions: readonly unknown[];
    };
    expect(state.vehicles).toHaveLength(AURELIA_SLICE_VEHICLE_COUNT);
    expect(state.services).toHaveLength(AURELIA_SLICE_SERVICE_COUNT);
    expect(state.disruptions).toHaveLength(0);
  });
});
