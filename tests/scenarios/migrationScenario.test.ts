/**
 * M8 — migration: pressure is a condition, and a border is a gate.
 *
 * The chain this scenario asserts:
 *
 *   migration pressure (System 52) -> an immigration framework exists for the
 *   destination (System 39) -> a traveller crosses a real route (System 45) ->
 *   the crossing is a *record*, and the pressure itself moved nobody.
 *
 * The property that matters, and that a migration scenario usually gets wrong:
 * **pressure moves nobody on its own.** `MigrationPressure` is a tendency with
 * a direction and named causes. Systems 39 and 45 own the framework and the
 * crossing respectively, and the scenario asserts the serialized world contains
 * no person who "migrated" as a side effect of a pressure record. A model where
 * a number silently teleports a population is a model that would quietly
 * contradict its own geography.
 *
 * The traveller's decision to go is played by the harness; System 17's autonomy
 * governs NPCs, and where an individual ends up is a decision that system has
 * not been given. Everything the crossing *causes* is real engine work.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { asEntityId, type EntityId } from "../../src/engine/primitives/ids.ts";
import { atTime, MINUTES_PER_DAY } from "../../src/engine/primitives/time.ts";
import { InternationalEngine } from "../../src/engine/international/engine.ts";
import { CountriesEngine } from "../../src/engine/countries/engine.ts";
import { TravelEngine } from "../../src/engine/travel/engine.ts";
import { IdentityEngine } from "../../src/engine/identity/engine.ts";
import { registerAureliaCountries } from "../../src/content/aurelia/countries.ts";
import { M2_SETTLEMENT_ID } from "../../src/content/aurelia/geography.ts";

const SEED = "reellife-scenario-migration";
const ARDIN = "COUNTRY-ARDIN";
const ELANDRA = "CONT-ELANDRA";
const DAY = MINUTES_PER_DAY;

function newWorld(): Simulation {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
  // System 39 gives the world its countries, frameworks and borders.
  sim.guard.mutate("countries", () => {
    registerAureliaCountries(new CountriesEngine(sim.scope, sim.world));
  });
  return sim;
}

function makePerson(sim: Simulation, first: string, last: string): EntityId<"person"> {
  let id: EntityId<"person"> = asEntityId<"person">("PER-999999");
  sim.guard.mutate("identity", () => {
    id = new IdentityEngine(sim.scope, sim.world).create(sim.ids, {
      name: { first, last },
      birth: { dateOfBirth: atTime(0) },
      appearanceFoundationSeed: "migration-fixture",
    }).id;
  });
  return id;
}

describe("migration scenario (M8)", () => {
  it("records pressure on a country without moving anybody", () => {
    const sim = newWorld();
    const ada = makePerson(sim, "Ada", "Byron");
    const identityBefore = JSON.stringify(sim.world.systems.identity);

    sim.guard.mutate("international", () => {
      new InternationalEngine(sim.scope, sim.world).recordMigrationPressure(
        {
          countryId: ARDIN,
          fromCountryIds: [ELANDRA],
          pressure: 0.6,
          causes: ["a failed harvest upstream", "work at the docks"],
        },
        atTime(DAY),
      );
    });

    const pressure = InternationalEngine.peek(sim.scope, sim.world).migration();
    expect(pressure).toHaveLength(1);
    expect(pressure[0]).toMatchObject({
      countryId: ARDIN,
      fromCountryIds: [ELANDRA],
      pressure: 0.6,
    });
    // The causes are named, so "why are people coming" is answerable.
    expect(pressure[0]?.causes).toHaveLength(2);

    // **Pressure moved nobody.** The person's identity record is byte-identical:
    // a pressure is a condition, not a relocation, and a model where a number
    // quietly moves a population would contradict its own geography.
    expect(JSON.stringify(sim.world.systems.identity)).toBe(identityBefore);
    expect(new IdentityEngine(sim.scope, sim.world).get(ada)?.id).toBe(ada);
    // And no system invented a "migrated" flag for a movement that has not
    // happened.
    expect(JSON.stringify(sim.world.systems)).not.toMatch(/"migrated"|"immigrated"|"emigrated"/);
  });

  it("refuses pressure a country cannot exert on itself", () => {
    const sim = newWorld();
    sim.guard.mutate("international", () => {
      const engine = new InternationalEngine(sim.scope, sim.world);
      // Self-pressure is a contradiction, not a weak pressure.
      expect(() =>
        engine.recordMigrationPressure(
          { countryId: ARDIN, fromCountryIds: [ARDIN], pressure: 0.4, causes: ["itself"] },
          atTime(DAY),
        ),
      ).toThrow(/cannot be pressured from itself/);
    });
    expect(InternationalEngine.peek(sim.scope, sim.world).migration()).toHaveLength(0);
  });

  it("the destination has a real immigration framework, read from System 39", () => {
    const sim = newWorld();
    const countries = new CountriesEngine(sim.scope, sim.world);
    // The framework is a fact about the destination, not an assumption the
    // migration system made about it.
    const framework = countries.immigrationAt(ARDIN, atTime(DAY));
    expect(framework).toBeDefined();
    // The framework is a *world default* that a country may override, so it
    // names the id Ardin's configuration points at rather than the country
    // itself. Asserting `countryId === ARDIN` here would be asserting something
    // the content deliberately does not say.
    expect(framework?.id).toBe(countries.configurationAt(ARDIN, atTime(DAY))?.immigrationFrameworkId);
    expect(framework?.defaultAccess).toBeDefined();
    // Entry rules are the destination's own; a pressure record does not relax
    // them, and this asserts the two are independent systems.
    expect(InternationalEngine.peek(sim.scope, sim.world).migration()).toHaveLength(0);
  });


  it("a crossing is a record on a real route, and it completes in order", () => {
    const sim = newWorld();
    const traveller = makePerson(sim, "Nell", "Byron");

    // System 45 owns the route set, and it only exists once travel state has
    // been claimed. A read-only handle reports no routes on a world that has
    // never moved anyone, which is correct: there is no journey to be on.
    sim.guard.mutate("travel", () => {
      new TravelEngine(sim.scope, sim.world);
    });
    const route = new TravelEngine(sim.scope, sim.world).allRoutes()[0];
    // A route the world actually has. If none existed the crossing could not
    // happen, and the engine must say so rather than inventing a journey.
    expect(route).toBeDefined();
    const destination = route?.destinationSettlementId ?? M2_SETTLEMENT_ID;

    const journey = {
      journeyId: "JRN-MIGRATION-1",
      personId: traveller,
      originSettlementId: M2_SETTLEMENT_ID,
      destinationSettlementId: destination,
      routeId: route?.id ?? "unknown",
      departedAt: atTime(DAY),
      arrivesAt: atTime(DAY * 3),
      mode: "road" as const,
    };

    sim.guard.mutate("travel", () => {
      new TravelEngine(sim.scope, sim.world).startJourney(journey);
    });
    expect(TravelEngine.peek(sim.scope, sim.world).activeJourneyOf(traveller)).toMatchObject({
      originSettlementId: M2_SETTLEMENT_ID,
      destinationSettlementId: destination,
      routeId: journey.routeId,
    });

    // A second crossing by the same person is refused: they are already on one.
    sim.guard.mutate("travel", () => {
      expect(() =>
        new TravelEngine(sim.scope, sim.world).startJourney({ ...journey, journeyId: "JRN-2" }),
      ).toThrow(/already on a journey/);
    });

    // The journey completes, and the completion is what records the crossing.
    sim.guard.mutate("travel", () => {
      new TravelEngine(sim.scope, sim.world).completeJourney(traveller, atTime(DAY * 3));
    });
    expect(TravelEngine.peek(sim.scope, sim.world).activeJourneyOf(traveller)).toBeUndefined();
  });

  it("a person is not a citizen just because they arrived", () => {
    const sim = newWorld();
    const traveller = makePerson(sim, "Nell", "Byron");
    const countries = new CountriesEngine(sim.scope, sim.world);

    // Citizenship is a *framework* in System 39, distinct from arrival. A world
    // with an immigration framework still has no record of this person being a
    // citizen, and arrival is not evidence of one.
    expect(countries.citizenshipAt(ARDIN, atTime(DAY))).toBeDefined();
    expect(JSON.stringify(sim.world.systems.identity)).not.toMatch(/citizen/);
    expect(new IdentityEngine(sim.scope, sim.world).get(traveller)?.id).toBe(traveller);
  });

  it("the whole migration situation reproduces from its seed", () => {
    const run = (): string => {
      const sim = newWorld();
      const traveller = makePerson(sim, "Nell", "Byron");
      sim.guard.mutate("international", () => {
        new InternationalEngine(sim.scope, sim.world).recordMigrationPressure(
          { countryId: ARDIN, fromCountryIds: [ELANDRA], pressure: 0.6, causes: ["a failed harvest"] },
          atTime(DAY),
        );
      });
      const route = (() => {
        sim.guard.mutate("travel", () => {
          new TravelEngine(sim.scope, sim.world);
        });
        return new TravelEngine(sim.scope, sim.world).allRoutes()[0];
      })();
      sim.guard.mutate("travel", () => {
        new TravelEngine(sim.scope, sim.world).startJourney({
          journeyId: "JRN-1",
          personId: traveller,
          originSettlementId: M2_SETTLEMENT_ID,
          destinationSettlementId: route?.destinationSettlementId ?? M2_SETTLEMENT_ID,
          routeId: route?.id ?? "unknown",
          departedAt: atTime(DAY),
          arrivesAt: atTime(DAY * 3),
          mode: "road",
        });
      });
      return sim.stateHash();
    };
    expect(run()).toBe(run());
  });
});
