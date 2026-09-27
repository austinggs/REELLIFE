/**
 * System 52 — international relations: a relationship is several relationships,
 * a sanction is a condition rather than an outcome, a suspended treaty stays on
 * the record, and a global shock names its route and stops.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { InternationalEngine } from "../../src/engine/international/engine.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { addTime, days, type WorldTime } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-international-seed";
const ARDIN = "COUNTRY-ARDIN";
const VALEDON = "COUNTRY-VALEDON";
const HIGHLAND = "COUNTRY-HIGHLAND";
let T0: WorldTime;

function newWorld(): Simulation {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
  T0 = sim.clock.time;
  return sim;
}

function withInternational<T>(
  sim: Simulation,
  fn: (engine: InternationalEngine, ids: IdAllocator) => T,
): T {
  let result: T = undefined as T;
  sim.guard.mutate("international", () => {
    result = fn(new InternationalEngine(sim.scope, sim.world), new IdAllocator());
  });
  return result;
}

describe("international relations and global events (System 52)", () => {
  it("holds a relationship per domain, because allies and rivals are the same pair", () => {
    const sim = newWorld();
    withInternational(sim, (engine, ids) => {
      // Ardin and Valedon are close allies and vicious trading competitors, and
      // one "how do they feel" number could not say that.
      engine.recordStanding(
        { countryA: ARDIN, countryB: VALEDON, domain: "diplomatic", standing: 0.9 },
        T0,
        ids,
      );
      engine.recordStanding(
        { countryA: ARDIN, countryB: VALEDON, domain: "trade", standing: -0.7 },
        T0,
        ids,
      );
      engine.recordStanding(
        { countryA: ARDIN, countryB: VALEDON, domain: "military", standing: 0.2 },
        T0,
        ids,
      );

      const reading = engine.standingBetween(ARDIN, VALEDON);
      expect(reading.byDomain.diplomatic).toBe(0.9);
      expect(reading.byDomain.trade).toBe(-0.7);
      // Unmeasured is undefined, not 0: nobody assessed their cultural standing.
      expect(reading.byDomain.cultural).toBeUndefined();
      expect(reading.measuredDomains).toBe(3);
      expect(reading.overall).toBe(0.1333);
      // Asking in the other order gives the same pair, not a rival one.
      expect(engine.standingBetween(VALEDON, ARDIN).pairId).toBe(reading.pairId);
    });
  });

  it("will not record a country standing with itself", () => {
    const sim = newWorld();
    withInternational(sim, (engine, ids) => {
      expect(() =>
        engine.recordStanding(
          { countryA: ARDIN, countryB: ARDIN, domain: "trade", standing: 1 },
          T0,
          ids,
        ),
      ).toThrow(/cannot stand with itself/);
    });
  });

  it("treats a sanction as a condition that names itself, not as a price change", () => {
    const sim = newWorld();
    withInternational(sim, (engine, ids) => {
      // Before the sanction, and with a standing trade agreement.
      engine.signTreaty(
        {
          id: "TREATY-ARDIN-VALEDON-TRADE",
          kind: "trade_agreement",
          partyIds: [ARDIN, VALEDON],
          terms: ["grain at the fenwick rate", "no toll on the river road"],
        },
        T0,
        ids,
      );
      const before = engine.tradeConditions(ARDIN, VALEDON, T0);
      expect(before.blocked).toBe(false);
      expect(before.supportedByTreatyId).toBe("TREATY-ARDIN-VALEDON-TRADE");

      const sanction = engine.imposeSanction(
        {
          imposedBy: VALEDON,
          on: ARDIN,
          scope: "trade",
          reason: "the river toll was doubled overnight",
        },
        T0,
        ids,
      );
      const during = engine.tradeConditions(ARDIN, VALEDON, T0);
      // Blocked, with the instrument and the reason named — and the treaty still
      // visible, because "we are allies and they have sanctioned us" is the
      // whole story, and a reading that dropped either half would mislead.
      expect(during.blocked).toBe(true);
      expect(during.reasons[0]).toContain(sanction.id);
      expect(during.reasons[0]).toContain("toll was doubled");
      expect(during.supportedByTreatyId).toBe("TREATY-ARDIN-VALEDON-TRADE");
      // A financial sanction is not a trade sanction.
      engine.imposeSanction(
        { imposedBy: VALEDON, on: ARDIN, scope: "financial", reason: "overdue debts" },
        T0,
        ids,
      );
      expect(engine.tradeConditions(ARDIN, VALEDON, T0).reasons).toHaveLength(1);

      engine.liftSanction(sanction.id, addTime(T0, days(30)), ids);
      expect(engine.tradeConditions(ARDIN, VALEDON, addTime(T0, days(30))).blocked).toBe(false);
    });
  });

  it("keeps a suspended treaty on the record, and stops relying on it", () => {
    const sim = newWorld();
    withInternational(sim, (engine, ids) => {
      engine.signTreaty(
        {
          id: "TREATY-ARDIN-VALEDON-TRADE",
          kind: "trade_agreement",
          partyIds: [ARDIN, VALEDON],
          terms: ["grain at the fenwick rate"],
        },
        T0,
        ids,
      );
      expect(() => engine.endTreaty("TREATY-ARDIN-VALEDON-TRADE", "suspended", "  ", T0, ids)).toThrow(
        /must say why/,
      );
      const suspended = engine.endTreaty(
        "TREATY-ARDIN-VALEDON-TRADE",
        "suspended",
        "the river toll was doubled",
        T0,
        ids,
      );
      // "We were party to this until we were not" is a fact about the past.
      expect(suspended.terms).toEqual(["grain at the fenwick rate"]);
      expect(engine.activeTreaties()).toEqual([]);
      expect(engine.treaties()).toHaveLength(1);
      expect(engine.tradeConditions(ARDIN, VALEDON, T0).supportedByTreatyId).toBeUndefined();
    });
  });

  it("refuses a treaty with one party", () => {
    const sim = newWorld();
    withInternational(sim, (engine, ids) => {
      expect(() =>
        engine.signTreaty(
          { id: "TREATY-SOLO", kind: "treaty", partyIds: [ARDIN], terms: ["be nice"] },
          T0,
          ids,
        ),
      ).toThrow(/needs at least two/);
    });
  });

  it("declares a shock's route per country and refuses one it cannot deliver", () => {
    const sim = newWorld();
    withInternational(sim, (engine, ids) => {
      expect(() =>
        engine.declareShock(
          {
            id: "SHOCK-FEVER",
            kind: "pandemic",
            summary: "fever along the river",
            affectedCountryIds: [ARDIN],
            magnitude: 0.7,
            // Ardin is hit but nothing is said about how the shock reaches it.
            channels: {},
          },
          T0,
          ids,
        ),
      ).toThrow(/declares no route into it/);

      const shock = engine.declareShock(
        {
          id: "SHOCK-FEVER",
          kind: "pandemic",
          summary: "fever along the river",
          affectedCountryIds: [ARDIN, VALEDON],
          magnitude: 0.7,
          channels: {
            [ARDIN]: ["markets", "employment", "households"],
            [VALEDON]: ["markets", "supplyChains"],
          },
          originCountryId: HIGHLAND,
        },
        T0,
        ids,
      );
      expect(shock.magnitude).toBe(0.7);
      // The route is declared, per country, and is read back rather than walked.
      expect(engine.shockExposure("SHOCK-FEVER", ARDIN)).toEqual({
        exposed: true,
        channels: ["markets", "employment", "households"],
        magnitude: 0.7,
      });
      expect(engine.shockExposure("SHOCK-FEVER", VALEDON).channels).toEqual([
        "markets",
        "supplyChains",
      ]);
      // A country the shock never reached reads nothing and carries no magnitude.
      expect(engine.shockExposure("SHOCK-FEVER", HIGHLAND)).toEqual({
        exposed: false,
        channels: [],
        magnitude: 0,
      });
    });
  });

  it("records migration pressure without recording that anybody moved", () => {
    const sim = newWorld();
    withInternational(sim, (engine) => {
      const pressure = engine.recordMigrationPressure(
        {
          countryId: HIGHLAND,
          fromCountryIds: [ARDIN],
          pressure: 0.6,
          causes: ["the flood took the lower fields"],
        },
        T0,
      );
      expect(pressure.pressure).toBe(0.6);
      // It is a tendency with a direction and a cause, and nothing else: who
      // crosses a border is System 45's decision, and this record moves nobody.
      const state = engine.serialize();
      expect(state.migration).toHaveLength(1);
      expect(JSON.stringify(state)).not.toContain("moved");
      expect(Object.keys(state)).toEqual([
        "standings",
        "treaties",
        "sanctions",
        "shocks",
        "migration",
        "organizations",
        "history",
      ]);
      expect(() =>
        engine.recordMigrationPressure(
          { countryId: HIGHLAND, fromCountryIds: [HIGHLAND], pressure: 0.5, causes: [] },
          T0,
        ),
      ).toThrow(/pressured from itself/);
    });
  });

  it("references an international organization rather than duplicating it", () => {
    const sim = newWorld();
    withInternational(sim, (engine) => {
      const body = engine.registerOrganization(
        {
          id: "INTORG-RIVER-CONVENTION",
          organizationId: "ORG-RIVER-CONVENTION",
          memberCountryIds: [ARDIN, VALEDON, HIGHLAND],
          mandate: "the river road, the tolls and the floods",
        },
        T0,
      );
      // A membership list over a System 32 organization — no second structure
      // with its own members, lifecycle or roles.
      expect(body.organizationId).toBe("ORG-RIVER-CONVENTION");
      expect(Object.keys(body).sort()).toEqual([
        "foundedAt",
        "id",
        "mandate",
        "memberCountryIds",
        "organizationId",
      ]);
      expect(engine.organizations()).toHaveLength(1);
    });
  });

  it("keeps international state under single ownership and refuses a foreign writer", () => {
    const sim = newWorld();
    withInternational(sim, (engine, ids) => {
      engine.recordStanding(
        { countryA: ARDIN, countryB: VALEDON, domain: "trade", standing: 0.1 },
        T0,
        ids,
      );
    });

    const reader = new InternationalEngine(sim.scope, sim.world);
    expect(reader.standings()).toHaveLength(1);
    expect(() =>
      reader.recordStanding(
        { countryA: ARDIN, countryB: VALEDON, domain: "trade", standing: 0.2 },
        T0,
        new IdAllocator(),
      ),
    ).toThrow(MissingWriterContextError);
    expect(() =>
      sim.guard.mutate("markets", () => {
        new InternationalEngine(sim.scope, sim.world).imposeSanction(
          { imposedBy: ARDIN, on: VALEDON, scope: "trade", reason: "not ours to write" },
          T0,
          new IdAllocator(),
        );
      }),
    ).toThrow(OwnershipViolationError);
  });
});