import { describe, expect, it } from "vitest";
import { HealthEngine } from "../../src/engine/health/engine.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { atTime, MINUTES_PER_HOUR } from "../../src/engine/primitives/time.ts";
import { permissiveScope } from "../../src/engine/core/access.ts";
import { createWorldState } from "../../src/engine/core/worldState.ts";
import type { HealthCondition } from "../../src/engine/health/types.ts";

function makeWorld() {
  return createWorldState({
    worldId: "test",
    worldName: "test",
    createdAtLabel: "t",
    startTime: atTime(0),
    masterSeed: "test",
    mode: "standard",
    difficulty: "standard",
    schemaVersion: 1,
    simulationVersion: 1,
    contentVersion: "1",
    rngVersion: 1,
    config: {} as never,
    idAllocator: { counters: {} },
  });
}

function makeCondition(overrides?: Partial<HealthCondition>): HealthCondition {
  return {
    id: "cond-001",
    name: "Mild Flu",
    type: "acute",
    status: "active",
    severity: "mild",
    onsetAt: atTime(0),
    symptoms: ["fever", "fatigue"],
    functionalImpairment: 0.2,
    progressionRate: -0.2, // improving
    ...overrides,
  };
}

describe("physical health & medicine (System 11)", () => {
  it("registers a person starting healthy", () => {
    const engine = new HealthEngine(permissiveScope(), makeWorld());
    const ids = new IdAllocator();
    const personId = ids.next("person");

    const hs = engine.registerPerson(personId);
    expect(hs.overallCondition).toBe("healthy");
    expect(hs.vitalState).toBe("stable");
    expect(hs.conditions).toHaveLength(0);
    expect(hs.functionalCapacity.physical).toBe(1.0);
  });

  it("adding a condition degrades overall condition and functional capacity", () => {
    const engine = new HealthEngine(permissiveScope(), makeWorld());
    const ids = new IdAllocator();
    const personId = ids.next("person");
    engine.registerPerson(personId);

    engine.addCondition(personId, makeCondition({ severity: "severe" }));

    const hs = engine.getPerson(personId)!;
    expect(hs.overallCondition).toBe("severe");
    expect(hs.functionalCapacity.physical).toBeLessThan(1.0);
  });

  it("resolving a condition restores health", () => {
    const engine = new HealthEngine(permissiveScope(), makeWorld());
    const ids = new IdAllocator();
    const personId = ids.next("person");
    engine.registerPerson(personId);
    engine.addCondition(personId, makeCondition());

    engine.resolveCondition(personId, "cond-001", atTime(5000));

    const hs = engine.getPerson(personId)!;
    expect(hs.overallCondition).toBe("healthy");
    expect(hs.conditions[0]!.status).toBe("resolved");
  });

  it("diagnosis is separate from body truth — symptoms don't equal diagnosis", () => {
    // The engine stores symptoms as evidence; 'name' (diagnosis) is the interpretation.
    // A condition can exist without a diagnosis name being accurate.
    const engine = new HealthEngine(permissiveScope(), makeWorld());
    const ids = new IdAllocator();
    const personId = ids.next("person");
    engine.registerPerson(personId);
    engine.addCondition(
      personId,
      makeCondition({ name: "Unknown Illness", symptoms: ["fever"] }),
    );

    const hs = engine.getPerson(personId)!;
    // Body truth: condition exists and has symptoms.
    expect(hs.conditions[0]!.symptoms).toContain("fever");
    // Diagnosis could be anything — the engine doesn't enforce correctness.
    expect(hs.conditions[0]!.name).toBe("Unknown Illness");
  });

  it("worsening condition progresses severity during tick", () => {
    const engine = new HealthEngine(permissiveScope(), makeWorld());
    const ids = new IdAllocator();
    const personId = ids.next("person");
    engine.registerPerson(personId);
    engine.addCondition(
      personId,
      makeCondition({ severity: "mild", progressionRate: 2.0 }), // rapidly worsening
    );

    // Tick 2 hours — should push severity from mild → moderate or worse
    engine.tick(personId, MINUTES_PER_HOUR * 2);

    const hs = engine.getPerson(personId)!;
    expect(["moderate", "severe", "critical"]).toContain(hs.conditions[0]!.severity);
  });

  it("multiple conditions compound functional impairment", () => {
    const engine = new HealthEngine(permissiveScope(), makeWorld());
    const ids = new IdAllocator();
    const personId = ids.next("person");
    engine.registerPerson(personId);

    engine.addCondition(personId, makeCondition({ id: "c1", functionalImpairment: 0.3 }));
    engine.addCondition(personId, makeCondition({ id: "c2", functionalImpairment: 0.3 }));

    const hs = engine.getPerson(personId)!;
    expect(hs.functionalCapacity.physical).toBeCloseTo(0.4);
  });
});
