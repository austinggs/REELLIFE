/**
 * System 42 — institutions: memory as an inventory that can be lost,
 * turnover, reform, precedent validity, and capacity.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { InstitutionsEngine } from "../../src/engine/institutions/engine.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { addTime, days, type WorldTime } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-institutions-seed";
const DOCKS = "ORG-ARDIN-DOCKS";
let T0: WorldTime;

function newWorld(): Simulation {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
  T0 = sim.clock.time;
  return sim;
}

function withInstitutions<T>(sim: Simulation, fn: (engine: InstitutionsEngine, ids: IdAllocator) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("institutions", () => {
    result = fn(new InstitutionsEngine(sim.scope, sim.world), new IdAllocator());
  });
  return result;
}

describe("institutions (System 42)", () => {
  it("remembers through records, and loses them by named cause", () => {
    const sim = newWorld();
    withInstitutions(sim, (engine, ids) => {
      const institution = engine.establishInstitution(
        {
          id: "INST-QUAY-PILOTAGE",
          organizationId: DOCKS,
          mandate: "examining and certifying harbour pilots",
          jurisdictionId: "COUNTRY-ARDIN",
          capacity: 0.7,
          staffIds: ["PER-PILOT-1", "PER-PILOT-2"],
          procedures: [{ id: "proc-1", title: "certificate before pilotage" }],
        },
        T0,
      );
      expect(institution.organizationId).toBe(DOCKS);
      // With one procedure and nothing else, memory is total.
      expect(engine.memoryRetention(institution.id).retention).toBe(1);
      engine.recordEntry(ids, institution.id, "exam roll 2042", T0);
      engine.recordEntry(ids, institution.id, "lapsed certificate", T0);
      engine.setPrecedent(
        ids,
        institution.id,
        { ruling: "a lapse needs a re-exam", ruleId: "RULE-ARDIN-STEVEDORE-CERT" },
        T0,
      );
      expect(engine.memoryRetention(institution.id).retention).toBe(1);

      // A fire in the filing room loses records — and only records.
      engine.loseMemory(institution.id, "records", "destruction", addTime(T0, days(30)));
      const after = engine.memoryRetention(institution.id);
      expect(after.recordsRetained).toBe(0);
      expect(after.recordsTotal).toBe(2);
      expect(after.proceduresRetained).toBe(1);
      expect(after.retention).toBeLessThan(1);
      // The records are still listed, with the cause and the date.
      const record = engine.requireInstitution(institution.id, "test").records[0];
      expect(record?.retained).toBe(false);
      expect(record?.lostCause).toBe("destruction");
      expect(() =>
        engine.loseMemory(institution.id, "records", "gremlins" as never, T0),
      ).toThrow(/unknown cause/);
    });
  });

  it("turns staff over, reforms, and knows when a precedent no longer holds", () => {
    const sim = newWorld();
    withInstitutions(sim, (engine, ids) => {
      engine.establishInstitution(
        {
          id: "INST-X",
          organizationId: DOCKS,
          mandate: "x",
          jurisdictionId: "COUNTRY-ARDIN",
          staffIds: ["PER-A", "PER-B"],
        },
        T0,
      );
      const precedent = engine.setPrecedent(
        ids,
        "INST-X",
        { ruling: "one supervised shift is enough", ruleId: "RULE-OLD" },
        T0,
      );
      expect(engine.canRelyOnPrecedent("INST-X", precedent.id, [])).toBe(true);
      // Superseding the rule it was read against invalidates the reliance.
      expect(engine.canRelyOnPrecedent("INST-X", precedent.id, ["RULE-OLD"])).toBe(false);

      // Turnover: the people leave, and the record says so.
      engine.recordTurnover("INST-X", ["PER-A"], addTime(T0, days(10)), "retired");
      expect(engine.requireInstitution("INST-X", "test").staffIds).toEqual(["PER-B"]);
      expect(() => engine.recordTurnover("INST-X", ["PER-A"], T0, "again")).toThrow(/none of those/);

      // Reform replaces procedures; the old ones are kept, not deleted.
      engine.reform("INST-X", [{ id: "proc-2", title: "two supervised shifts" }], addTime(T0, days(20)));
      const reformed = engine.requireInstitution("INST-X", "test");
      expect(reformed.procedures).toHaveLength(1);
      expect(reformed.procedures[0]?.title).toBe("two supervised shifts");
      expect(reformed.history.at(-1)?.kind).toBe("reform");

      // Capacity declines, and the note says why.
      engine.setCapacity("INST-X", 0.2, addTime(T0, days(30)), "two of five posts unfilled");
      expect(engine.requireInstitution("INST-X", "test").capacity).toBe(0.2);
      expect(() =>
        engine.establishInstitution(
          { id: "INST-Y", organizationId: "ORG-NOT-REAL", mandate: "x", jurisdictionId: "COUNTRY-ARDIN" },
          T0,
        ),
      ).toThrow(/not a registered organization/);
    });
  });

  it("keeps institution state under single ownership and in the save format", () => {
    const sim = newWorld();
    withInstitutions(sim, (engine, ids) => {
      engine.establishInstitution(
        { id: "INST-Z", organizationId: DOCKS, mandate: "x", jurisdictionId: "COUNTRY-ARDIN" },
        T0,
      );
      engine.recordEntry(ids, "INST-Z", "a record", T0);
    });
    const reader = new InstitutionsEngine(sim.scope, sim.world);
    expect(() => reader.setCapacity("INST-Z", 0.1, T0, "x")).toThrow(MissingWriterContextError);
    expect(() =>
      sim.guard.mutate("markets", () => {
        new InstitutionsEngine(sim.scope, sim.world).setCapacity("INST-Z", 0.1, T0, "x");
      }),
    ).toThrow(OwnershipViolationError);
    const bag = (sim.serializedWorld() as { readonly systems?: Record<string, unknown> }).systems;
    const state = bag?.["institutions"] as {
      readonly institutions: readonly { records: readonly unknown[] }[];
    };
    expect(state.institutions[0]?.records).toHaveLength(1);
  });
});
