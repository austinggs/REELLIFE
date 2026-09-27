/**
 * System 44 — culture: derived strength with a declared sample, probabilistic
 * transmission with inspectable factors, mixing as a property of the person,
 * generational persistence read off the record, and norm conflicts found rather
 * than authored.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { CultureEngine } from "../../src/engine/culture/engine.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { addTime, days, type WorldTime } from "../../src/engine/primitives/time.ts";
import type { RandomSource } from "../../src/engine/rng/distributions.ts";
import { RngRegistry } from "../../src/engine/rng/streams.ts";
import {
  AURELIA_CULTURE_GROUPS,
  AURELIA_CULTURE_TRADITION_COUNT,
  registerAureliaCulture,
} from "../../src/content/aurelia/culture.ts";
import { M2_SETTLEMENT_ID } from "../../src/content/aurelia/geography.ts";

const SEED = "reellife-culture-seed";
const QUAY = "CG-ARDEN-QUAY";
const MILL = "CG-ARDEN-MILL";
const FENWICK = "CG-ARDEN-FENWICK";
const QUIET_DAY = "CG-ARDEN-QUIET-DAY";
const HORN = "TRD-QUAY-OLD-HORN";
const BELL = "TRD-QUAY-SHIFT-BELL";
let T0: WorldTime;

function newWorld(): Simulation {
  // Culture needs no slice: it is about people and groups, and the slice's own
  // culture content is registered explicitly by the tests that want it.
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
  T0 = sim.clock.time;
  return sim;
}

function withCulture<T>(
  sim: Simulation,
  fn: (engine: CultureEngine, ids: IdAllocator) => T,
  random?: RandomSource,
): T {
  let result: T = undefined as T;
  sim.guard.mutate("culture", () => {
    const engine =
      random === undefined
        ? new CultureEngine(sim.scope, sim.world)
        : new CultureEngine(sim.scope, sim.world, random);
    result = fn(engine, new IdAllocator());
  });
  return result;
}

/** A quay group with two traditions, which is all most tests need. */
function seedQuay(engine: CultureEngine, at: WorldTime): void {
  engine.registerGroup(
    { id: QUAY, name: "Quay", kind: "professional", locationId: M2_SETTLEMENT_ID },
    at,
  );
  engine.registerTradition(
    { id: BELL, groupId: QUAY, name: "Bell", kind: "norm", domain: "workday" },
    at,
  );
  engine.registerTradition(
    { id: HORN, groupId: QUAY, name: "Horn", kind: "symbol", domain: "leisure" },
    at,
  );
}

describe("culture (System 44)", () => {
  it("derives strength from who actually takes part, non-participants included", () => {
    const sim = newWorld();
    withCulture(sim, (engine) => {
      seedQuay(engine, T0);
      const year = addTime(T0, days(365));
      engine.setParticipation({ personId: "p1", groupId: QUAY, level: "strong" }, T0);
      for (let i = 2; i <= 10; i += 1) {
        engine.setParticipation({ personId: `p${i}`, groupId: QUAY, level: "none" }, year);
      }
      const reading = engine.traditionStrength(BELL);
      // 1.0 weighted out of 10 records, not 1.0 out of the one enthusiast.
      expect(reading.strength).toBe(0.1);
      expect(reading.sampleSize).toBe(10);
      expect(reading.byLevel.none).toBe(9);
    });
  });

  it("reports a thin sample as thin rather than sounding unanimous", () => {
    const sim = newWorld();
    withCulture(sim, (engine) => {
      seedQuay(engine, T0);
      expect(engine.traditionStrength(BELL)).toMatchObject({
        strength: 0,
        sampleSize: 0,
        confidence: 0,
      });

      for (let i = 1; i <= 4; i += 1) {
        engine.setParticipation({ personId: `p${i}`, groupId: QUAY, level: "strong" }, T0);
      }
      const thin = engine.traditionStrength(BELL);
      expect(thin.strength).toBe(1);
      // Full strength, but from four people: the reading says which it is.
      expect(thin.confidence).toBeLessThan(0.5);

      for (let i = 5; i <= 20; i += 1) {
        engine.setParticipation({ personId: `p${i}`, groupId: QUAY, level: "strong" }, T0);
      }
      expect(engine.traditionStrength(BELL).confidence).toBe(1);
    });
  });

  it("lets pathway, exposure and holder intensity each move the number, and names them", () => {
    const sim = newWorld();
    withCulture(sim, (engine) => {
      seedQuay(engine, T0);
      engine.setParticipation({ personId: "holder", groupId: QUAY, level: "strong" }, T0);
      engine.setParticipation(
        { personId: "half", groupId: QUAY, level: "situational", context: "shift" },
        T0,
      );

      const byFamily = engine.resolveTransmission({
        toPersonId: "t",
        traditionId: HORN,
        pathway: "family",
        exposure: 1,
        fromPersonId: "holder",
      });
      const byMedia = engine.resolveTransmission({
        toPersonId: "t",
        traditionId: HORN,
        pathway: "media",
        exposure: 1,
        fromPersonId: "holder",
      });
      expect(byFamily.probability).toBeGreaterThan(byMedia.probability);
      // Every factor is on the record, in the order it was applied.
      expect(byFamily.drivers).toEqual([
        "pathway:family=0.90",
        "exposure=1.00",
        "holder=1.00",
      ]);

      // A weaker holder transmits more weakly, with the pathway untouched.
      const weak = engine.resolveTransmission({
        toPersonId: "t",
        traditionId: HORN,
        pathway: "family",
        exposure: 1,
        fromPersonId: "half",
      });
      expect(weak.probability).toBeLessThan(byFamily.probability);
    });
  });

  it("gives a non-holder nothing to transmit and refuses a holderless guess", () => {
    const sim = newWorld();
    withCulture(sim, (engine) => {
      seedQuay(engine, T0);
      const fromStranger = engine.resolveTransmission({
        toPersonId: "t",
        traditionId: HORN,
        pathway: "community",
        exposure: 1,
        fromPersonId: "stranger",
      });
      expect(fromStranger.probability).toBe(0);

      expect(() =>
        engine.resolveTransmission({
          toPersonId: "t",
          traditionId: HORN,
          pathway: "media",
          exposure: 1,
        }),
      ).toThrow(/neither a holder nor an explicit intensity/);
    });
  });

  it("damps a contested tradition and says that it did", () => {
    const sim = newWorld();
    withCulture(sim, (engine) => {
      seedQuay(engine, T0);
      engine.setParticipation({ personId: "holder", groupId: QUAY, level: "strong" }, T0);
      engine.setTraditionState(BELL, "contested");
      const contested = engine.resolveTransmission({
        toPersonId: "t",
        traditionId: BELL,
        pathway: "family",
        exposure: 1,
        fromPersonId: "holder",
      });
      expect(contested.probability).toBe(0.45);
      expect(contested.drivers.join(" ")).toContain("contested:x0.5");
    });
  });

  it("records exposure without making the recipient a participant", () => {
    const sim = newWorld();
    withCulture(
      sim,
      (engine, ids) => {
        seedQuay(engine, T0);
        engine.setParticipation({ personId: "holder", groupId: QUAY, level: "strong" }, T0);
        const record = engine.transmit(
          {
            toPersonId: "listener",
            traditionId: HORN,
            pathway: "family",
            exposure: 1,
            fromPersonId: "holder",
          },
          ids,
          T0,
        );
        expect(record.probability).toBe(0.9);
        expect(record.accepted).toBe(record.roll < record.probability);
        // Reaching someone is not the same as them holding it: uptake is theirs.
        expect(engine.participationIn("listener", QUAY)).toBeUndefined();
        expect(engine.mixingFor("listener").traditionIds).toEqual([]);
      },
      new RngRegistry(SEED).stream("culture"),
    );
  });

  it("refuses to roll a transmission without an injected source, and is reproducible with one", () => {
    const sim = newWorld();
    withCulture(sim, (engine, ids) => {
      seedQuay(engine, T0);
      expect(() =>
        engine.transmit(
          { toPersonId: "t", traditionId: HORN, pathway: "media", exposure: 1, intensity: 0.5 },
          ids,
          T0,
        ),
      ).toThrow(/no RandomSource was injected/);
    });

    const attempt = (): boolean => {
      const fresh = newWorld();
      return withCulture(fresh, (engine, ids) => {
        seedQuay(engine, T0);
        return engine.transmit(
          { toPersonId: "t", traditionId: HORN, pathway: "media", exposure: 0.5, intensity: 0.5 },
          ids,
          T0,
        ).accepted;
      }, new RngRegistry(SEED).stream("culture"));
    };
    // Same master seed, same stream, same answer.
    expect(attempt()).toBe(attempt());
  });

  it("keeps tenure when intensity changes and insists situational participation names its occasion", () => {
    const sim = newWorld();
    withCulture(sim, (engine) => {
      seedQuay(engine, T0);
      const early = addTime(T0, days(30));
      const later = addTime(T0, days(365 * 3));
      const first = engine.setParticipation(
        { personId: "p1", groupId: QUAY, level: "weak" },
        early,
      );
      const promoted = engine.setParticipation(
        { personId: "p1", groupId: QUAY, level: "strong" },
        later,
      );
      // Three years of belonging is not erased by getting more committed.
      expect(promoted.since).toBe(first.since);
      expect(engine.groupProfile(QUAY).participants).toBe(1);

      expect(() =>
        engine.setParticipation({ personId: "p2", groupId: QUAY, level: "situational" }, T0),
      ).toThrow(/no occasion given/);
    });
  });

  it("treats mixing as a property of the person, not of two group definitions", () => {
    const sim = newWorld();
    withCulture(sim, (engine) => {
      seedQuay(engine, T0);
      engine.registerGroup(
        { id: FENWICK, name: "Fenwick", kind: "geographic", locationId: M2_SETTLEMENT_ID },
        T0,
      );
      engine.registerTradition(
        { id: "TRD-FENWICK-DAWN", groupId: FENWICK, name: "Dawn", kind: "norm", domain: "trade" },
        T0,
      );

      engine.setParticipation({ personId: "loyal", groupId: QUAY, level: "strong" }, T0);
      engine.setParticipation({ personId: "loyal", groupId: FENWICK, level: "weak" }, T0);
      engine.setParticipation({ personId: "quayOnly", groupId: QUAY, level: "strong" }, T0);

      expect(engine.mixingFor("loyal")).toMatchObject({
        groupIds: [QUAY, FENWICK],
        multiGroup: true,
      });
      expect(engine.mixingFor("quayOnly").multiGroup).toBe(false);

      const index = engine.mixingIndex(M2_SETTLEMENT_ID);
      expect(index.participants).toBe(2);
      expect(index.multiGroupCount).toBe(1);
      expect(index.index).toBe(0.5);
    });
  });

  it("changes the menu when someone moves, without changing the person", () => {
    const sim = newWorld();
    withCulture(
      sim,
      (engine, ids) => {
        seedQuay(engine, T0);
        const arriving = engine.availableAt("CITY-ELSEWHERE");
        expect(arriving.groupIds).toEqual([]);
        expect(arriving.traditionIds).toEqual([]);

        // Arriving somewhere offers its traditions; it does not confer them.
        engine.setParticipation({ personId: "mover", groupId: QUAY, level: "moderate" }, T0);
        expect(engine.availableAt(M2_SETTLEMENT_ID).traditionIds).toContain(HORN);

        const record = engine.transmit(
          {
            toPersonId: "mover",
            traditionId: HORN,
            pathway: "family",
            exposure: 1,
            fromPersonId: "mover",
          },
          ids,
          T0,
        );
        expect(record.accepted).toBe(record.roll < record.probability);

        // Leaving is a withdrawal, and the transmissions already happened stand.
        expect(engine.withdraw("mover", QUAY)).toBe(true);
        expect(engine.withdraw("mover", QUAY)).toBe(false);
        expect(engine.transmissionsOf(HORN)).toHaveLength(1);
        expect(engine.mixingFor("mover").traditionIds).toEqual([]);
      },
      new RngRegistry(SEED).stream("culture"),
    );
  });

  it("reads generational persistence off the record and lists what was dropped", () => {
    const sim = newWorld();
    withCulture(sim, (engine) => {
      seedQuay(engine, T0);
      engine.registerGroup(
        { id: FENWICK, name: "Fenwick", kind: "geographic", locationId: M2_SETTLEMENT_ID },
        T0,
      );
      engine.registerTradition(
        { id: "TRD-FENWICK-DAWN", groupId: FENWICK, name: "Dawn", kind: "norm", domain: "trade" },
        T0,
      );
      engine.setParticipation({ personId: "mother", groupId: QUAY, level: "strong" }, T0);

      // The child belongs to the quay, but loosely: the traditions are held at
      // a fraction of the mother's weight rather than being kept or lost whole.
      engine.setParticipation({ personId: "child", groupId: QUAY, level: "mixed" }, T0);
      engine.setParticipation({ personId: "child", groupId: FENWICK, level: "moderate" }, T0);
      const weakened = engine.generationalChange("mother", "child");
      expect(weakened.retained).toEqual([HORN, BELL].sort());
      expect(weakened.dropped).toEqual([]);
      expect(weakened.adopted).toEqual(["TRD-FENWICK-DAWN"]);
      expect(weakened.persistence).toBe(0.5);
      expect(weakened.weights[BELL]).toEqual({ older: 1, younger: 0.5 });

      // A child who never joins the quay drops both, and says so.
      engine.withdraw("child", QUAY);
      const dropped = engine.generationalChange("mother", "child");
      expect(dropped.retained).toEqual([]);
      expect(dropped.dropped).toEqual([HORN, BELL].sort());
      expect(dropped.persistence).toBe(0);
      expect(dropped.weights[HORN]).toEqual({ older: 1, younger: 0 });
    });
  });

  it("finds the slice's norm conflicts in the data rather than in a list of feuds", () => {
    const sim = newWorld();
    withCulture(sim, (engine) => {
      registerAureliaCulture(engine, T0);
      const conflicts = engine.normConflicts(M2_SETTLEMENT_ID);
      // Sorted by kind, then domain, so the same world always reads the same way.
      expect(conflicts.map((entry) => entry.domain)).toEqual(["trade", "reward"]);

      const trade = conflicts.find((entry) => entry.domain === "trade");
      expect(trade?.traditions.map((entry) => entry.traditionId).sort()).toEqual([
        "TRD-FENWICK-DAWN-STALL",
        "TRD-QUIET-DAY-CLOSED",
      ]);
      // The quay's bell and the mill's oven both govern "workday", but one is a
      // norm and the other a practice: different kinds of obedience, not a clash.
      expect(engine.tradition("TRD-MILL-NIGHT-OVEN")?.groupId).toBe(MILL);
      expect(conflicts.some((entry) => entry.domain === "workday")).toBe(false);
    });
  });

  it("does not call one community's two traditions a conflict with itself", () => {
    const sim = newWorld();
    withCulture(sim, (engine) => {
      seedQuay(engine, T0);
      engine.registerTradition(
        {
          id: "TRD-QUAY-LATE-QUIT",
          groupId: QUAY,
          name: "Late quit",
          kind: "norm",
          domain: "workday",
        },
        T0,
      );
      // Same group, same kind, same domain: compatible, because one community
      // can hold both of its own rules.
      expect(engine.normConflicts(M2_SETTLEMENT_ID)).toEqual([]);
    });
  });

  it("ends a conflict by retiring a tradition without erasing that it existed", () => {
    const sim = newWorld();
    withCulture(sim, (engine) => {
      registerAureliaCulture(engine, T0);
      expect(engine.normConflicts(M2_SETTLEMENT_ID).length).toBeGreaterThan(0);
      engine.setTraditionState("TRD-QUIET-DAY-CLOSED", "retired");

      expect(engine.normConflicts(M2_SETTLEMENT_ID).some((e) => e.domain === "trade")).toBe(
        false,
      );
      // Retired is not deleted: the record remains, and it is simply no longer
      // on offer to anyone arriving.
      expect(engine.tradition("TRD-QUIET-DAY-CLOSED")?.state).toBe("retired");
      expect(engine.availableAt(M2_SETTLEMENT_ID).traditionIds).not.toContain(
        "TRD-QUIET-DAY-CLOSED",
      );
      expect(engine.traditions()).toHaveLength(AURELIA_CULTURE_TRADITION_COUNT);
    });
  });

  it("lets culture lean on a decision without ever deciding one", () => {
    const sim = newWorld();
    withCulture(sim, (engine) => {
      seedQuay(engine, T0);
      engine.setParticipation({ personId: "p1", groupId: QUAY, level: "strong" }, T0);
      expect(engine.influence(BELL)).toMatchObject({ influence: 1, sampleSize: 1, contested: false });

      engine.setTraditionState(BELL, "contested");
      // A contested tradition presses more gently, and says it is contested.
      expect(engine.influence(BELL)).toMatchObject({ influence: 0.5, contested: true });

      for (let i = 2; i <= 6; i += 1) {
        engine.setParticipation({ personId: `p${i}`, groupId: QUAY, level: "none" }, T0);
      }
      const diluted = engine.influence(BELL);
      expect(diluted.influence).toBeLessThan(0.25);
      // Whatever the number says, the evidence travels with it.
      expect(diluted.sampleSize).toBe(6);
    });
  });

  it("reports a lopsided community as lopsided", () => {
    const sim = newWorld();
    withCulture(sim, (engine) => {
      seedQuay(engine, T0);
      for (let i = 1; i <= 5; i += 1) {
        engine.setParticipation({ personId: `p${i}`, groupId: QUAY, level: "strong" }, T0);
      }
      engine.setParticipation(
        { personId: "p6", groupId: QUAY, level: "situational", context: "fair" },
        T0,
      );
      const profile = engine.groupProfile(QUAY);
      expect(profile.participants).toBe(6);
      expect(profile.dominant).toBe("strong");
      // A core with a fringe is a real community, not a broken measurement.
      expect(profile.evenness).toBeLessThan(0.5);
      expect(profile.evenness).toBeGreaterThan(0);
      expect(profile.traditionCount).toBe(2);
    });
  });

  it("registers the slice's culture content idempotently", () => {
    const sim = newWorld();
    withCulture(sim, (engine) => {
      registerAureliaCulture(engine, T0);
      registerAureliaCulture(engine, addTime(T0, days(1)));
      expect(engine.groups()).toHaveLength(AURELIA_CULTURE_GROUPS.length);
      expect(engine.traditions()).toHaveLength(AURELIA_CULTURE_TRADITION_COUNT);
      for (const group of AURELIA_CULTURE_GROUPS) {
        expect(engine.group(group.id)?.locationId).toBe(M2_SETTLEMENT_ID);
      }
      // Which of Aurelia's seven faiths this is stays deferred, so the group
      // points at no religion rather than guessing one.
      expect(engine.group(QUIET_DAY)?.religionId).toBeUndefined();
    });
  });

  it("refuses a write with no writer context and a write from another system", () => {
    const sim = newWorld();
    withCulture(sim, (engine) => {
      seedQuay(engine, T0);
      engine.setParticipation({ personId: "p", groupId: QUAY, level: "strong" }, T0);
    });

    // A reader built outside any writer context may read, but not write.
    const reader = new CultureEngine(sim.scope, sim.world);
    expect(reader.groupProfile(QUAY).participants).toBe(1);
    expect(() =>
      reader.setParticipation({ personId: "p", groupId: QUAY, level: "weak" }, T0),
    ).toThrow(MissingWriterContextError);

    expect(() =>
      sim.guard.mutate("government", () => {
        new CultureEngine(sim.scope, sim.world).withdraw("p", QUAY);
      }),
    ).toThrow(OwnershipViolationError);
    expect(sim.guard.recordedViolations.length).toBeGreaterThan(0);
  });
});


