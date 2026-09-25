import { describe, expect, it } from "vitest";
import { permissiveScope, OwnershipGuard } from "../../src/engine/core/access.ts";
import { guardWorldState, type WorldState } from "../../src/engine/core/worldState.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import type { WorldTime } from "../../src/engine/primitives/time.ts";
import { GoalsEngine } from "../../src/engine/goals/engine.ts";

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
      masterSeed: "goals-seed-test",
    },
    shared: {
      idAllocator: { counters: {} },
      notes: [],
    },
    config: {} as never,
    systems: {},
  };
}

describe("System 16 — Goals, Aspirations & Motivation", () => {
  it("enforces ownership via OwnershipGuard", () => {
    const rawWorld = createMockWorldState();
    const guard = new OwnershipGuard();
    const world = guardWorldState(rawWorld, guard);

    expect(() => new GoalsEngine(guard, world)).toThrow();

    guard.mutate("goals", () => {
      const engine = new GoalsEngine(guard, world);
      expect(engine.all()).toEqual([]);
    });
  });

  it("creates goals and establishes sub-goal hierarchy", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new GoalsEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });
    engine.registerPerson("PER-0001" as never);

    const parent = engine.createGoal(
      ids,
      "PER-0001" as never,
      {
        title: "Become a Master Artisan",
        domain: "craft",
        horizon: "life_scale",
        motivation: "achievement",
        priority: 0.9,
        urgency: 0.2,
        commitment: 0.85,
      },
      100 as WorldTime,
    );

    const sub = engine.createGoal(
      ids,
      "PER-0001" as never,
      {
        title: "Complete Apprenticeship",
        domain: "craft",
        horizon: "long_term",
        motivation: "responsibility",
        priority: 0.8,
        urgency: 0.6,
        commitment: 0.9,
        parentGoalId: parent.id,
      },
      100 as WorldTime,
    );

    const updatedParent = engine.getGoal("PER-0001" as never, parent.id);
    expect(updatedParent?.subGoalIds).toContain(sub.id);
    expect(sub.parentGoalId).toBe(parent.id);
  });

  it("updates progress towards completion", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new GoalsEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });
    engine.registerPerson("PER-0001" as never);

    const goal = engine.createGoal(
      ids,
      "PER-0001" as never,
      {
        title: "Read Book",
        domain: "education",
        horizon: "immediate",
        motivation: "curiosity",
        priority: 0.5,
        urgency: 0.4,
        commitment: 0.5,
      },
      100 as WorldTime,
    );

    engine.updateProgress("PER-0001" as never, goal.id, 0.4, 110 as WorldTime);
    let current = engine.getGoal("PER-0001" as never, goal.id);
    expect(current?.progress).toBeCloseTo(0.4);
    expect(current?.status).toBe("active");

    engine.updateProgress("PER-0001" as never, goal.id, 0.7, 120 as WorldTime);
    current = engine.getGoal("PER-0001" as never, goal.id);
    expect(current?.progress).toBe(1.0);
    expect(current?.status).toBe("completed");
  });

  it("handles deadlines and expiration via tick", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new GoalsEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });
    engine.registerPerson("PER-0001" as never);

    const goal = engine.createGoal(
      ids,
      "PER-0001" as never,
      {
        title: "Pay Rent",
        domain: "housing",
        horizon: "short_term",
        motivation: "security",
        priority: 0.95,
        urgency: 0.95,
        commitment: 1.0,
        deadline: 500 as WorldTime,
      },
      100 as WorldTime,
    );

    engine.tick("PER-0001" as never, 400 as WorldTime);
    let current = engine.getGoal("PER-0001" as never, goal.id);
    expect(current?.status).toBe("active");

    engine.tick("PER-0001" as never, 600 as WorldTime);
    current = engine.getGoal("PER-0001" as never, goal.id);
    expect(current?.status).toBe("expired");
  });

  it("records status transition history", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new GoalsEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });
    engine.registerPerson("PER-0001" as never);

    const goal = engine.createGoal(
      ids,
      "PER-0001" as never,
      {
        title: "Run Marathon",
        domain: "health",
        horizon: "long_term",
        motivation: "identity",
        priority: 0.7,
        urgency: 0.3,
        commitment: 0.6,
      },
      100 as WorldTime,
    );

    engine.setStatus("PER-0001" as never, goal.id, "abandoned", "injury", 200 as WorldTime);
    const pgs = engine.getPerson("PER-0001" as never);
    expect(pgs?.history.some((h) => h.goalId === goal.id && h.newStatus === "abandoned" && h.reason === "injury")).toBe(true);
  });
});
