import { describe, expect, it } from "vitest";
import { permissiveScope, OwnershipGuard } from "../../src/engine/core/access.ts";
import { guardWorldState, type WorldState } from "../../src/engine/core/worldState.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import type { WorldTime } from "../../src/engine/primitives/time.ts";
import { RelationshipsEngine } from "../../src/engine/relationships/engine.ts";

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
      masterSeed: "rel-seed-test",
    },
    shared: {
      idAllocator: { counters: {} },
      notes: [],
    },
    config: {} as never,
    systems: {},
  };
}

describe("System 18 — Relationship & Social Interaction Core", () => {
  it("enforces ownership via OwnershipGuard", () => {
    const rawWorld = createMockWorldState();
    const guard = new OwnershipGuard();
    const world = guardWorldState(rawWorld, guard);

    expect(() => new RelationshipsEngine(guard, world)).toThrow();

    guard.mutate("relationships", () => {
      const engine = new RelationshipsEngine(guard, world);
      expect(engine.all()).toEqual([]);
    });
  });

  it("establishes directional relationships with contexts and turning points", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new RelationshipsEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });

    const rel = engine.establish(
      ids,
      "PER-0001" as never,
      "PER-0002" as never,
      ["acquaintance", "coworker"],
      "Met at work orientation",
      100 as WorldTime,
      { closeness: 20, trust: 30 },
    );

    expect(rel.from).toBe("PER-0001");
    expect(rel.to).toBe("PER-0002");
    expect(rel.contexts).toEqual(["acquaintance", "coworker"]);
    expect(rel.evaluation.closeness).toBe(20);
    expect(rel.turningPoints).toHaveLength(1);
    expect(rel.turningPoints[0]?.kind).toBe("met");
  });

  it("updates evaluations and records significant turning points on interaction", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new RelationshipsEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });

    engine.establish(
      ids,
      "PER-0001" as never,
      "PER-0002" as never,
      ["friend"],
      "Met at cafe",
      100 as WorldTime,
      { affection: 40, trust: 50 },
    );

    const updated = engine.recordInteraction(
      "PER-0001" as never,
      "PER-0002" as never,
      { affection: 15, trust: 10, closeness: 25 },
      200 as WorldTime,
      { kind: "sharedExperience", summary: "Helped move apartments" },
    );

    expect(updated?.evaluation.affection).toBe(55);
    expect(updated?.evaluation.trust).toBe(60);
    expect(updated?.evaluation.closeness).toBe(25);
    expect(updated?.turningPoints).toHaveLength(2);
    expect(updated?.turningPoints[1]?.kind).toBe("sharedExperience");
  });
});
