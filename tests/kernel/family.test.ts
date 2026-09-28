/**
 * System 19 — Family, Household & Genealogy.
 *
 * The M7 increment adds what the spec asks for and the M2 slice did not have:
 * membership is recorded as entry/exit stints rather than a timeless set, and
 * lineage can be *queried* (parents, children, siblings, ancestors, descendants)
 * because System 53's heir search needs to walk a family it did not build.
 */

import { describe, expect, it } from "vitest";
import { permissiveScope, OwnershipGuard } from "../../src/engine/core/access.ts";
import { guardWorldState, type WorldState } from "../../src/engine/core/worldState.ts";
import { IdAllocator, type EntityId } from "../../src/engine/primitives/ids.ts";
import type { WorldTime } from "../../src/engine/primitives/time.ts";
import { FamilyEngine } from "../../src/engine/family/engine.ts";

function createMockWorldState(): WorldState {
  return {
    meta: {
      worldId: "WORLD-AURELIA",
      worldName: "Aurelia",
      schemaVersion: 1,
      simulationVersion: 1,
      contentVersion: "1.0.0",
      rngVersion: 1,
      createdAtLabel: "2042-01-01",
      startTime: 0 as WorldTime,
      generation: 1,
      mode: "standard",
      difficulty: "standard",
      masterSeed: "fam-seed-test",
    },
    shared: {
      idAllocator: { counters: {} },
      notes: [],
    },
    config: {} as never,
    systems: {},
  };
}

function each<T>(...values: T[]): readonly T[] {
  return values;
}

function PERSON(n: number): EntityId<"person"> {
  return `PER-${String(n).padStart(6, "0")}` as EntityId<"person">;
}

describe("System 19 — Family, Household & Genealogy", () => {
  it("enforces ownership via OwnershipGuard", () => {
    const rawWorld = createMockWorldState();
    const guard = new OwnershipGuard();
    const world = guardWorldState(rawWorld, guard);

    expect(() => new FamilyEngine(guard, world)).toThrow();

    guard.mutate("family", () => {
      const engine = new FamilyEngine(guard, world);
      expect(engine.getHousehold("any")).toBeUndefined();
    });
  });

  it("creates households and manages current membership", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new FamilyEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });

    const hh = engine.createHousehold(ids, "Vance Household", PERSON(1), 100 as WorldTime);
    expect(hh.name).toBe("Vance Household");
    expect(engine.currentMembers(hh.id)).toHaveLength(1);
    expect(engine.memberRole(hh.id, PERSON(1))).toBe("head");

    engine.addHouseholdMember(hh.id, PERSON(2), "spouse", 150 as WorldTime);
    expect(engine.currentMembers(hh.id)).toHaveLength(2);
    expect(engine.householdForPerson(PERSON(2))?.id).toBe(hh.id);

    // A role change is still one stint, not a second entry.
    engine.addHouseholdMember(hh.id, PERSON(2), "partner", 160 as WorldTime);
    expect(engine.currentMembers(hh.id)).toHaveLength(2);
    expect(engine.memberRole(hh.id, PERSON(2))).toBe("partner");
    expect(engine.membershipHistory(hh.id)).toHaveLength(2);
  });

  it("records membership exit instead of erasing it, and rejoining adds a stint", () => {
    const world = createMockWorldState();
    const engine = new FamilyEngine(permissiveScope(), world);
    const ids = new IdAllocator({ counters: {} });
    const hh = engine.createHousehold(ids, "Vance Household", PERSON(1), 100 as WorldTime);
    engine.addHouseholdMember(hh.id, PERSON(2), "boarder", 150 as WorldTime);

    engine.removeHouseholdMember(hh.id, PERSON(2), 400 as WorldTime, "moved out");

    // The person is gone from the household...
    expect(engine.currentMembers(hh.id).map((m) => m.personId)).toEqual([PERSON(1)]);
    expect(engine.householdForPerson(PERSON(2))).toBeUndefined();
    // ...but the stint survives with when and why it ended.
    const stints = engine.membershipStints(hh.id, PERSON(2));
    expect(stints).toHaveLength(1);
    expect(stints[0]).toMatchObject({ joinedAt: 150, leftAt: 400, leftReason: "moved out" });

    // Ending a stint that is already over changes nothing.
    expect(engine.removeHouseholdMember(hh.id, PERSON(2), 500 as WorldTime)).toBeUndefined();

    // Rejoining appends a second stint; the first keeps its own dates.
    engine.addHouseholdMember(hh.id, PERSON(2), "adult", 600 as WorldTime);
    expect(engine.membershipStints(hh.id, PERSON(2))).toHaveLength(2);
    expect(engine.membershipStints(hh.id, PERSON(2))[1]).toMatchObject({
      joinedAt: 600,
      role: "adult",
    });
    expect(engine.householdsOf(PERSON(2))).toHaveLength(1);
  });

  it("dissolving a household ends every current stint", () => {
    const world = createMockWorldState();
    const engine = new FamilyEngine(permissiveScope(), world);
    const ids = new IdAllocator({ counters: {} });
    const hh = engine.createHousehold(ids, "Vance Household", PERSON(1), 100 as WorldTime);
    engine.addHouseholdMember(hh.id, PERSON(2), "spouse", 120 as WorldTime);

    engine.dissolveHousehold(hh.id, 900 as WorldTime, "household dissolved");

    expect(engine.getHousehold(hh.id)?.dissolvedAt).toBe(900);
    expect(engine.currentMembers(hh.id)).toHaveLength(0);
    expect(engine.householdForPerson(PERSON(1))).toBeUndefined();
    // Nobody can join a dissolved household.
    expect(engine.addHouseholdMember(hh.id, PERSON(3), "adult", 950 as WorldTime)).toBeUndefined();
  });

  it("records biological and adoptive parentage in lineage", () => {
    const world = createMockWorldState();
    const engine = new FamilyEngine(permissiveScope(), world);

    engine.recordParentChild(PERSON(1), PERSON(3), "biological");
    engine.recordParentChild(PERSON(2), PERSON(3), "adoptive");

    expect(engine.getLineage(PERSON(3))?.parentIds).toEqual(each(PERSON(1), PERSON(2)));
    expect(engine.biologicalParentsOf(PERSON(3))).toEqual(each(PERSON(1)));
    expect(engine.adoptiveParentsOf(PERSON(3))).toEqual(each(PERSON(2)));
    expect(engine.childrenOf(PERSON(1))).toEqual(each(PERSON(3)));
  });

  it("walks ancestors and descendants generation by generation", () => {
    const world = createMockWorldState();
    const engine = new FamilyEngine(permissiveScope(), world);
    //   1 ── 2        grandparent generation
    //   │    │
    //   3    4        parent generation
    //   │
    //   5             child generation
    engine.recordParentChild(PERSON(1), PERSON(3));
    engine.recordParentChild(PERSON(2), PERSON(4));
    engine.recordParentChild(PERSON(3), PERSON(5));

    expect(engine.descendantsOf(PERSON(1))).toEqual(each(PERSON(3), PERSON(5)));
    expect(engine.ancestorsOf(PERSON(5))).toEqual(each(PERSON(3), PERSON(1)));
    // Two people who share a parent are siblings even if they never lived together.
    engine.recordParentChild(PERSON(3), PERSON(6));
    expect(engine.siblingsOf(PERSON(5))).toEqual(each(PERSON(6)));
    // ...and a child of a grandparent is an aunt/uncle, not a sibling.
    expect(engine.siblingsOf(PERSON(6))).toEqual(each(PERSON(5)));
    expect(engine.siblingsOf(PERSON(1))).toEqual([]);
    expect(engine.ancestorsOf(PERSON(5), 1)).toEqual(each(PERSON(3)));
  });

  it("refuses a lineage link that would make a person their own ancestor", () => {
    const world = createMockWorldState();
    const engine = new FamilyEngine(permissiveScope(), world);
    engine.recordParentChild(PERSON(1), PERSON(2));
    engine.recordParentChild(PERSON(2), PERSON(3));

    expect(() => engine.recordParentChild(PERSON(3), PERSON(1))).toThrow(/cycle/);
    expect(() => engine.recordParentChild(PERSON(1), PERSON(1))).toThrow(/own parent/);
  });

  it("reads one person's structural family in a single record", () => {
    const world = createMockWorldState();
    const engine = new FamilyEngine(permissiveScope(), world);
    const ids = new IdAllocator({ counters: {} });
    const hh = engine.createHousehold(ids, "Vance Household", PERSON(1), 100 as WorldTime);
    engine.addHouseholdMember(hh.id, PERSON(2), "spouse", 110 as WorldTime);
    engine.addHouseholdMember(hh.id, PERSON(3), "child", 120 as WorldTime);
    engine.recordParentChild(PERSON(1), PERSON(3));
    engine.recordParentChild(PERSON(2), PERSON(3));

    const record = engine.familyRecord(PERSON(1));
    expect(record.household?.id).toBe(hh.id);
    expect(record.role).toBe("head");
    expect(record.membershipHistory).toHaveLength(1);
    expect(record.children).toEqual(each(PERSON(3)));
    expect(record.householdPartners).toEqual(each(PERSON(2)));
    expect(record.siblings).toEqual([]);
  });
});
