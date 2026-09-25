import { describe, expect, it } from "vitest";
import { permissiveScope, OwnershipGuard } from "../../src/engine/core/access.ts";
import { guardWorldState, type WorldState } from "../../src/engine/core/worldState.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
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

  it("creates households and manages household membership", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new FamilyEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });

    const hh = engine.createHousehold(ids, "Vance Household", "PER-0001" as never, 100 as WorldTime);
    expect(hh.name).toBe("Vance Household");
    expect(hh.members).toHaveLength(1);
    expect(hh.members[0]?.personId).toBe("PER-0001");
    expect(hh.members[0]?.role).toBe("head");

    // Add spouse
    engine.addHouseholdMember(hh.id, "PER-0002" as never, "spouse", 150 as WorldTime);
    let updated = engine.getHousehold(hh.id);
    expect(updated?.members).toHaveLength(2);

    // Lookup by person
    const found = engine.householdForPerson("PER-0002" as never);
    expect(found?.id).toBe(hh.id);

    // Remove member
    engine.removeHouseholdMember(hh.id, "PER-0002" as never);
    updated = engine.getHousehold(hh.id);
    expect(updated?.members).toHaveLength(1);
  });

  it("records biological and adoptive parentage in lineage", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new FamilyEngine(scope, world);

    engine.recordParentChild("PER-0001" as never, "PER-0003" as never, "biological");
    engine.recordParentChild("PER-0002" as never, "PER-0003" as never, "adoptive");

    const childLineage = engine.getLineage("PER-0003" as never);
    expect(childLineage?.parentIds).toEqual(["PER-0001", "PER-0002"]);
    expect(childLineage?.biologicalParentIds).toEqual(["PER-0001"]);
    expect(childLineage?.adoptiveParentIds).toEqual(["PER-0002"]);

    const parentLineage = engine.getLineage("PER-0001" as never);
    expect(parentLineage?.childIds).toEqual(["PER-0003"]);
  });
});
