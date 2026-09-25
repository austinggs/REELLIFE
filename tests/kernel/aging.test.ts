import { describe, expect, it } from "vitest";
import {
  AgingEngine,
  computeAgeYears,
  resolveLifeStage,
  DEFAULT_LIFE_STAGES,
} from "../../src/engine/aging/engine.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { atTime, yearsApprox } from "../../src/engine/primitives/time.ts";
import { permissiveScope } from "../../src/engine/core/access.ts";
import { createWorldState } from "../../src/engine/core/worldState.ts";

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

describe("aging (System 09)", () => {
  it("registers a birth and sets infancy stage", () => {
    const scope = permissiveScope();
    const engine = new AgingEngine(scope, makeWorld());
    const ids = new IdAllocator();
    const personId = ids.next("person");

    const dev = engine.registerBirth(personId, atTime(0));
    expect(dev.currentLifeStage).toBe("infancy");
    expect(dev.dependencyState).toBe("total");
    expect(dev.physicalGrowthFactor).toBeLessThan(0.4);
  });

  it("age is derived from time, not independently ticked", () => {
    const birth = atTime(0);
    const twoYears = yearsApprox(2);
    const ageYears = computeAgeYears(birth, atTime(twoYears as number));
    expect(ageYears).toBeGreaterThanOrEqual(1.99);
    expect(ageYears).toBeLessThanOrEqual(2.01);
  });

  it("transitions from infancy to toddlerhood at age 2", () => {
    const scope = permissiveScope();
    const world = makeWorld();
    const engine = new AgingEngine(scope, world);
    const ids = new IdAllocator();
    const personId = ids.next("person");
    engine.registerBirth(personId, atTime(0));

    const twoYearsLater = atTime((yearsApprox(2) as number) + 1000);
    const updated = engine.update(personId, twoYearsLater);
    expect(updated?.currentLifeStage).toBe("toddlerhood");
    expect(updated?.stageHistory).toHaveLength(2);
  });

  it("transitions through all life stages in order", () => {
    const scope = permissiveScope();
    const world = makeWorld();
    const engine = new AgingEngine(scope, world);
    const ids = new IdAllocator();
    const personId = ids.next("person");
    engine.registerBirth(personId, atTime(0));

    for (const cfg of DEFAULT_LIFE_STAGES) {
      const now = atTime((yearsApprox(cfg.minAgeYears + 0.5) as number));
      engine.update(personId, now);
    }

    const dev = engine.get(personId);
    expect(dev?.currentLifeStage).toBe("later_life");
    expect(dev?.dependencyState).toBe("independent");
  });

  it("records milestones idempotently", () => {
    const scope = permissiveScope();
    const world = makeWorld();
    const engine = new AgingEngine(scope, world);
    const ids = new IdAllocator();
    const personId = ids.next("person");
    engine.registerBirth(personId, atTime(0));

    engine.recordMilestone(personId, "first_words", atTime(10000));
    engine.recordMilestone(personId, "first_words", atTime(20000)); // duplicate, should be ignored

    expect(engine.get(personId)?.milestones).toHaveLength(1);
  });

  it("resolveLifeStage is data-driven and correct at boundaries", () => {
    expect(resolveLifeStage(0)).toBe("infancy");
    expect(resolveLifeStage(2)).toBe("toddlerhood");
    expect(resolveLifeStage(11.9)).toBe("childhood");
    expect(resolveLifeStage(12)).toBe("adolescence");
    expect(resolveLifeStage(18)).toBe("young_adulthood");
    expect(resolveLifeStage(45)).toBe("middle_age");
    expect(resolveLifeStage(65)).toBe("later_life");
    expect(resolveLifeStage(100)).toBe("later_life");
  });
});
