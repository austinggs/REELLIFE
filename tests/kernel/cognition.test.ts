import { describe, expect, it } from "vitest";
import { permissiveScope, OwnershipGuard } from "../../src/engine/core/access.ts";
import { guardWorldState, type WorldState } from "../../src/engine/core/worldState.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import type { WorldTime } from "../../src/engine/primitives/time.ts";
import type { InformationClaim } from "../../src/engine/primitives/information.ts";
import { CognitionEngine } from "../../src/engine/cognition/engine.ts";

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
      masterSeed: "cognition-seed-test",
    },
    shared: {
      idAllocator: { counters: {} },
      notes: [],
    },
    config: {} as never,
    systems: {},
  };
}

describe("System 15 — Cognition & Knowledge", () => {
  it("enforces ownership via OwnershipGuard", () => {
    const rawWorld = createMockWorldState();
    const guard = new OwnershipGuard();
    const world = guardWorldState(rawWorld, guard);

    // Creating engine without writer scope should fail because initializing world.systems.cognition is a write
    expect(() => new CognitionEngine(guard, world)).toThrow();

    guard.mutate("cognition", () => {
      const engine = new CognitionEngine(guard, world);
      expect(engine.all()).toEqual([]);
    });
  });

  it("registers a person and stores attention capacity", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new CognitionEngine(scope, world);

    const pcs = engine.registerPerson("PER-0001" as never, 3);
    expect(pcs.personId).toBe("PER-0001");
    expect(pcs.attention.capacity).toBe(3);
    expect(pcs.attention.focalSubjects).toHaveLength(0);
  });

  it("manages attention focus subject capacity and eviction", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new CognitionEngine(scope, world);
    engine.registerPerson("PER-0001" as never, 2);

    engine.focusAttention("PER-0001" as never, "job");
    engine.focusAttention("PER-0001" as never, "rent");
    let pcs = engine.getPerson("PER-0001" as never);
    expect(pcs?.attention.focalSubjects).toEqual(["rent", "job"]);

    // Third subject evicts oldest
    engine.focusAttention("PER-0001" as never, "groceries");
    pcs = engine.getPerson("PER-0001" as never);
    expect(pcs?.attention.focalSubjects).toEqual(["groceries", "rent"]);
  });

  it("forms beliefs from direct observations and rumors with distinct status", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new CognitionEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });
    engine.registerPerson("PER-0001" as never);

    // Direct observation
    const obs = engine.absorbBelief(
      ids,
      "PER-0001" as never,
      "person:PER-0002",
      "location",
      "market",
      { kind: "observation", description: "Saw in market" },
      0.9,
      100 as WorldTime,
    );
    expect(obs.status).toBe("known");
    expect(obs.confidence).toBeGreaterThan(0.4);

    // Rumor from low trust source
    const rumor = engine.absorbBelief(
      ids,
      "PER-0001" as never,
      "person:PER-0002",
      "employed",
      "false",
      { kind: "rumor", description: "Street chatter" },
      0.6,
      100 as WorldTime,
    );
    expect(rumor.status).toBe("rumor");
  });

  it("revises beliefs when conflicting evidence is stronger than prior confidence", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new CognitionEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });
    engine.registerPerson("PER-0001" as never);

    // Initial weak belief
    engine.absorbBelief(
      ids,
      "PER-0001" as never,
      "weather:forecast",
      "rain",
      "yes",
      { kind: "rumor", description: "Someone said it might rain" },
      0.3,
      100 as WorldTime,
    );

    let belief = engine.getBelief("PER-0001" as never, "weather:forecast", "rain");
    expect(belief?.value).toBe("yes");

    // Strong contradictory direct observation: sunny sky
    engine.absorbBelief(
      ids,
      "PER-0001" as never,
      "weather:forecast",
      "rain",
      "no",
      { kind: "observation", description: "Clear blue skies" },
      1.0,
      120 as WorldTime,
    );

    belief = engine.getBelief("PER-0001" as never, "weather:forecast", "rain");
    expect(belief?.value).toBe("no");
    expect(belief?.status).toBe("known");
  });

  it("resists belief revision when incoming conflicting evidence is weaker than prior", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new CognitionEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });
    engine.registerPerson("PER-0001" as never);

    // Strong established belief
    engine.absorbBelief(
      ids,
      "PER-0001" as never,
      "math:principle",
      "2+2",
      "4",
      { kind: "observation", description: "Definite truth" },
      1.0,
      100 as WorldTime,
    );

    const initialConfidence = engine.getBelief("PER-0001" as never, "math:principle", "2+2")?.confidence ?? 0;

    // Weak contradictory rumor: 2+2=5
    engine.setSourceTrust("PER-0001" as never, { kind: "rumor", description: "random" }, 0.1);
    engine.absorbBelief(
      ids,
      "PER-0001" as never,
      "math:principle",
      "2+2",
      "5",
      { kind: "rumor", description: "Someone said 5" },
      0.5,
      120 as WorldTime,
    );

    const belief = engine.getBelief("PER-0001" as never, "math:principle", "2+2");
    expect(belief?.value).toBe("4"); // Value unchanged
    expect(belief?.confidence).toBeLessThan(initialConfidence); // Confidence slightly eroded
  });

  it("learns claims from InformationClaim primitives", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new CognitionEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });
    engine.registerPerson("PER-0001" as never);

    const claim: InformationClaim = {
      id: "claim-01" as never,
      subject: "gov:tax-policy",
      statement: "Taxes increasing next quarter",
      source: { kind: "media", description: "Herald" },
      assertedAt: 50 as WorldTime,
      sourceConfidence: 0.8,
      actuality: "true",
      visibility: "public",
      knownBy: [],
      accessList: [],
      transmissionCount: 1,
    };

    const learned = engine.learnClaim(ids, "PER-0001" as never, claim, 60 as WorldTime);
    expect(learned.subject).toBe("gov:tax-policy");
    expect(learned.value).toBe("Taxes increasing next quarter");
    expect(learned.claimId).toBe("claim-01");
  });

  it("records memories and applies decay and emotional salience protection over time", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new CognitionEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });
    engine.registerPerson("PER-0001" as never);

    // Memory 1: Low emotional salience (mundane errand)
    const memMundane = engine.recordMemory(
      ids,
      "PER-0001" as never,
      "Bought bread",
      "daily",
      0.1,
      0 as WorldTime,
    );

    // Memory 2: High emotional salience (wedding)
    const memSalient = engine.recordMemory(
      ids,
      "PER-0001" as never,
      "Wedding day",
      "life",
      0.9,
      0 as WorldTime,
    );

    // Tick forward 100 days (100 * 1440 minutes = 144000)
    const laterTime = (100 * 1440) as WorldTime;
    const updated = engine.tick("PER-0001" as never, laterTime, 0.005);

    const updatedMundane = updated?.memories.find((m) => m.id === memMundane.id);
    const updatedSalient = updated?.memories.find((m) => m.id === memSalient.id);

    expect(updatedMundane?.vividness).toBeLessThan(1.0);
    expect(updatedSalient?.vividness).toBeLessThan(1.0);
    // Salient memory decays much slower than mundane
    expect(updatedSalient!.vividness).toBeGreaterThan(updatedMundane!.vividness);

    // Recalling restores vividness
    const recalled = engine.recallMemory("PER-0001" as never, memMundane.id, laterTime);
    expect(recalled!.vividness).toBeGreaterThan(updatedMundane!.vividness);
  });
});
