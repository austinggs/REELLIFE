/**
 * System 43 — government: budgets as authorizations, service quality with a
 * named binding constraint, policy implementation gaps, and emergency
 * coordination across agencies.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { GovernmentEngine } from "../../src/engine/government/engine.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { currencyId, money } from "../../src/engine/primitives/money.ts";
import { addTime, days, type WorldTime } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-government-seed";
const AUR = currencyId("AUR");
const CLINIC = "AGENCY-ARDEN-CLINIC";
let T0: WorldTime;

function newWorld(): Simulation {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
  T0 = sim.clock.time;
  return sim;
}

function withGovernment<T>(sim: Simulation, fn: (engine: GovernmentEngine, ids: IdAllocator) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("government", () => {
    result = fn(new GovernmentEngine(sim.scope, sim.world), new IdAllocator());
  });
  return result;
}

function clinic(engine: GovernmentEngine, at: WorldTime): void {
  engine.establishGovernment(
    { countryId: "COUNTRY-ARDIN", name: "Government of Ardin", legitimacy: 0.6 },
    at,
  );
  engine.createAgency(
    {
      id: CLINIC,
      countryId: "COUNTRY-ARDIN",
      name: "Riverfront clinic",
      mandate: "primary care for the riverfront",
      serviceKind: "health",
      budget: money(AUR, 500_000),
      capacity: 0.8,
    },
    at,
  );
  engine.recordServicePeriod(CLINIC, { demandUnits: 200, servedUnits: 180 }, at);
}

describe("government (System 43)", () => {
  it("names the constraint that is actually binding", () => {
    const sim = newWorld();
    withGovernment(sim, (engine) => {
      clinic(engine, T0);
      // Fully staffed and funded, but the clinic's own capacity is 0.8 —
      // so even in good conditions capacity is what binds.
      const healthy = engine.serviceReading(CLINIC, {
        infrastructure: 1,
        integrity: 1,
        staffingRatio: 1,
      });
      expect(healthy.quality).toBe(0.95);
      expect(healthy.bindingConstraint).toBe("capacity");
      expect(healthy.unmetDemand).toBeGreaterThan(0);
      // A perfect clinic would serve everyone asked.
      engine.setCapacity(CLINIC, 1, T0, "second doctor appointed");
      const ideal = engine.serviceReading(CLINIC, {
        infrastructure: 1,
        integrity: 1,
        staffingRatio: 1,
      });
      expect(ideal.quality).toBe(1);
      expect(ideal.bindingConstraint).toBeUndefined();
      expect(ideal.unmetDemand).toBe(0);

      // The water is off: infrastructure is the weakest input, and the
      // reading says so rather than just reporting a number.
      const dry = engine.serviceReading(CLINIC, {
        infrastructure: 0.2,
        integrity: 1,
        staffingRatio: 1,
      });
      expect(dry.quality).toBeLessThan(healthy.quality);
      expect(dry.bindingConstraint).toBe("infrastructure");
      expect(dry.unmetDemand).toBeGreaterThan(0);
      expect(dry.overload).toBeGreaterThan(0);

      // Cutting the budget to nothing makes funding the constraint.
      engine.setBudget(CLINIC, money(AUR, 0), addTime(T0, days(30)), "appropriations frozen");
      const unfunded = engine.serviceReading(CLINIC, {
        infrastructure: 1,
        integrity: 1,
        staffingRatio: 1,
      });
      expect(unfunded.bindingConstraint).toBe("funding");
      // A budget is an authorization: the agency still holds no money.
      const bag = (sim.serializedWorld() as { readonly systems?: Record<string, unknown> }).systems;
      const state = bag?.["government"] as {
        readonly governments: readonly { agencies: readonly { balance?: unknown }[] }[];
      };
      expect(state.governments[0]?.agencies[0]?.balance).toBeUndefined();
    });
  });

  it("records policy gaps, officials, and coordinated emergencies", () => {
    const sim = newWorld();
    withGovernment(sim, (engine, ids) => {
      clinic(engine, T0);
      engine.assignOfficial(CLINIC, "PER-CLINICIAN-1", T0);
      expect(() => engine.assignOfficial(CLINIC, "PER-CLINICIAN-1", T0)).toThrow(/already holds/);

      // A policy cites the rules it implements and admits how far it got.
      const policy = engine.implementPolicy(
        ids,
        {
          countryId: "COUNTRY-ARDIN",
          title: "riverfront clinic licensing",
          ruleIds: ["RULE-ARDIN-STEVEDORE-CERT"],
          implementation: 0.4,
        },
        T0,
      );
      expect(policy.ruleIds).toEqual(["RULE-ARDIN-STEVEDORE-CERT"]);
      expect(policy.implementation).toBe(0.4);
      expect(() =>
        engine.implementPolicy(ids, { countryId: "COUNTRY-ARDIN", title: "x", ruleIds: [] }, T0),
      ).toThrow(/cite the rules/);

      // An emergency coordinates across agencies and is recorded as one.
      const government = engine.declareEmergency(
        "COUNTRY-ARDIN",
        { kind: "flood", agencyIds: [CLINIC], note: "riverfront evacuated" },
        addTime(T0, days(1)),
      );
      expect(government.history.at(-1)?.kind).toBe("emergency");
      expect(government.history.at(-1)?.note).toMatch(/flood across AGENCY-ARDEN-CLINIC/);

      // A phantom country is refused: government follows the world map.
      expect(() =>
        engine.establishGovernment(
          { countryId: "COUNTRY-NOWHERE", name: "x", legitimacy: 0.5 },
          T0,
        ),
      ).toThrow(/not a known country/);
      expect(() => engine.recordServicePeriod(CLINIC, { demandUnits: 1, servedUnits: 5 }, T0)).toThrow(
        /cannot serve more/,
      );
    });
  });

  it("keeps government state under single ownership and in the save format", () => {
    const sim = newWorld();
    withGovernment(sim, (engine) => {
      clinic(engine, T0);
    });
    const reader = new GovernmentEngine(sim.scope, sim.world);
    expect(reader.agenciesOf("COUNTRY-ARDIN")).toHaveLength(1);
    expect(() => reader.setBudget(CLINIC, money(AUR, 1), T0, "x")).toThrow(MissingWriterContextError);
    expect(() =>
      sim.guard.mutate("markets", () => {
        new GovernmentEngine(sim.scope, sim.world).setBudget(CLINIC, money(AUR, 1), T0, "x");
      }),
    ).toThrow(OwnershipViolationError);
    const bag = (sim.serializedWorld() as { readonly systems?: Record<string, unknown> }).systems;
    const state = bag?.["government"] as {
      readonly governments: readonly { agencies: readonly unknown[] }[];
    };
    expect(state.governments[0]?.agencies).toHaveLength(1);
  });
});
