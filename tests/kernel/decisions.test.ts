import { describe, expect, it } from "vitest";
import { permissiveScope, OwnershipGuard } from "../../src/engine/core/access.ts";
import { guardWorldState, type WorldState } from "../../src/engine/core/worldState.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import type { WorldTime } from "../../src/engine/primitives/time.ts";
import { DecisionsEngine } from "../../src/engine/decisions/engine.ts";
import type { CandidateAction } from "../../src/engine/decisions/types.ts";

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
      masterSeed: "decisions-seed-test",
    },
    shared: {
      idAllocator: { counters: {} },
      notes: [],
    },
    config: {} as never,
    systems: {},
  };
}

describe("System 17 — NPC Decision-Making & Autonomy", () => {
  it("enforces ownership via OwnershipGuard", () => {
    const rawWorld = createMockWorldState();
    const guard = new OwnershipGuard();
    const world = guardWorldState(rawWorld, guard);

    expect(() => new DecisionsEngine(guard, world)).toThrow();

    guard.mutate("decisions", () => {
      const engine = new DecisionsEngine(guard, world);
      expect(engine.all()).toEqual([]);
    });
  });

  it("filters ineligible candidate actions before evaluation", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new DecisionsEngine(scope, world);
    engine.registerPerson("PER-0001" as never);

    const candidates: CandidateAction[] = [
      { id: "act-1", type: "eat", label: "Eat meal", domain: "needs", baseScore: 10, estimatedCost: 5 },
      { id: "act-2", type: "buy_house", label: "Buy house", domain: "housing", baseScore: 100, estimatedCost: 50000 },
    ];

    const context = {
      personId: "PER-0001" as never,
      now: 100 as WorldTime,
      mode: "utility" as const,
    };

    // Check money constraint
    const currentFunds = 20;
    const evaluated = engine.evaluateActions(candidates, context, (action) => {
      if ((action.estimatedCost ?? 0) > currentFunds) {
        return { eligible: false, reason: "insufficient_funds" };
      }
      return { eligible: true };
    });

    expect(evaluated[0]?.eligible).toBe(true);
    expect(evaluated[1]?.eligible).toBe(false);
    expect(evaluated[1]?.ineligibilityReason).toBe("insufficient_funds");
  });

  it("selects highest utility action and forms an intention", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new DecisionsEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });
    engine.registerPerson("PER-0001" as never);

    const candidates: CandidateAction[] = [
      { id: "act-rest", type: "rest", label: "Rest", domain: "needs", baseScore: 2 },
      { id: "act-eat", type: "eat", label: "Eat", domain: "needs", baseScore: 8 },
    ];

    const context = {
      personId: "PER-0001" as never,
      now: 100 as WorldTime,
      mode: "reactive" as const,
    };

    const intention = engine.decide(ids, context, candidates);
    expect(intention).toBeDefined();
    expect(intention?.actionId).toBe("act-eat");
    expect(intention?.actionType).toBe("eat");

    const pds = engine.getPerson("PER-0001" as never);
    expect(pds?.activeIntention?.actionId).toBe("act-eat");
    expect(pds?.history.length).toBe(1);
  });

  it("does not autonomously decide for player_controlled entities", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new DecisionsEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });
    engine.registerPerson("PER-0001" as never, "player_controlled");

    const candidates: CandidateAction[] = [
      { id: "act-eat", type: "eat", label: "Eat", domain: "needs", baseScore: 10 },
    ];

    const intention = engine.decide(ids, { personId: "PER-0001" as never, now: 100 as WorldTime, mode: "reactive" }, candidates);
    expect(intention).toBeUndefined();
  });
});
