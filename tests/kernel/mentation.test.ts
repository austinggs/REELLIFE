import { describe, expect, it } from "vitest";
import {
  MentalEngine,
  moodLabelFromValence,
  resolveGriefStage,
} from "../../src/engine/mentation/engine.ts";
import type { CopingMechanism, Emotion } from "../../src/engine/mentation/types.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { atTime, MINUTES_PER_DAY, MINUTES_PER_HOUR } from "../../src/engine/primitives/time.ts";
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

function makeEngine() {
  const engine = new MentalEngine(permissiveScope(), makeWorld());
  const ids = new IdAllocator();
  const personId = ids.next("person");
  engine.registerPerson(personId, atTime(0));
  return { engine, personId };
}

function makeEmotion(overrides?: Partial<Emotion>): Emotion {
  return {
    id: "emo-001",
    kind: "joy",
    intensity: 0.8,
    startedAt: atTime(0),
    durationMinutes: 6 * MINUTES_PER_HOUR,
    residue: 0.1,
    associations: [],
    concealed: false,
    expressedIntensity: 0.8,
    ...overrides,
  };
}

function makeCoping(overrides?: Partial<CopingMechanism>): CopingMechanism {
  return {
    id: "cope-001",
    kind: "effective",
    stressRelief: 0.4,
    resilienceCost: 0,
    useCount: 0,
    ...overrides,
  };
}

describe("mental & emotional state (System 12)", () => {
  it("registers a person with a neutral baseline", () => {
    const { engine, personId } = makeEngine();
    const ms = engine.getPerson(personId)!;
    expect(ms.mood.label).toBe("neutral");
    expect(ms.stress.level).toBe(0);
    expect(ms.emotions).toHaveLength(0);
  });

  it("holds contradictory emotions at the same time", () => {
    const { engine, personId } = makeEngine();
    engine.addEmotion(personId, makeEmotion({ id: "e1", kind: "joy", intensity: 0.7 }), atTime(0));
    engine.addEmotion(personId, makeEmotion({ id: "e2", kind: "grief", intensity: 0.7 }), atTime(0));
    const ms = engine.getPerson(personId)!;
    expect(ms.emotions.map((e) => e.kind).sort()).toEqual(["grief", "joy"]);
  });

  it("a positive emotion lifts mood, a negative one lowers it", () => {
    const { engine, personId } = makeEngine();
    engine.addEmotion(personId, makeEmotion({ kind: "joy", intensity: 0.9 }), atTime(0));
    expect(engine.getPerson(personId)!.mood.label).toBe("uplifted");

    const other = makeEngine();
    other.engine.addEmotion(
      other.personId,
      makeEmotion({ kind: "sadness", intensity: 1.0 }),
      atTime(0),
    );
    expect(other.engine.getPerson(other.personId)!.mood.label).toBe("despondent");
  });

  it("separates internal intensity from outward expression (concealment)", () => {
    const { engine, personId } = makeEngine();
    engine.addEmotion(personId, makeEmotion({ kind: "anger", intensity: 0.9 }), atTime(0));
    engine.setConcealment(personId, "emo-001", true);
    const emo = engine.getPerson(personId)!.emotions[0]!;
    expect(emo.concealed).toBe(true);
    expect(emo.expressedIntensity).toBe(0);
    // The internal feeling is unchanged by concealment.
    expect(emo.intensity).toBeCloseTo(0.9);
  });

  it("accumulates stress under repeated stressors and recovers over time", () => {
    const { engine, personId } = makeEngine();
    engine.applyStress(personId, 0.4, atTime(0));
    engine.applyStress(personId, 0.4, atTime(10));
    const stressed = engine.getPerson(personId)!;
    expect(stressed.stress.level).toBeGreaterThan(0.5);
    expect(stressed.stress.accumulated).toBeGreaterThan(0);

    // Several hours of unpressured recovery should reduce acute stress.
    engine.tick(personId, MINUTES_PER_HOUR * 8, atTime(MINUTES_PER_HOUR * 8));
    expect(engine.getPerson(personId)!.stress.level).toBeLessThan(stressed.stress.level);
  });

  it("resilience blunts the impact of the same stressor", () => {
    const low = new MentalEngine(permissiveScope(), makeWorld());
    const ids = new IdAllocator();
    const p = ids.next("person");
    low.registerPerson(p, atTime(0), 0.1);
    low.applyStress(p, 0.6, atTime(0));

    const high = new MentalEngine(permissiveScope(), makeWorld());
    const p2 = ids.next("person");
    high.registerPerson(p2, atTime(0), 0.9);
    high.applyStress(p2, 0.6, atTime(0));

    expect(low.getPerson(p)!.stress.level).toBeGreaterThan(high.getPerson(p2)!.stress.level);
  });

  it("coping reduces stress, and avoidant coping erodes resilience", () => {
    const { engine, personId } = makeEngine();
    engine.applyStress(personId, 0.8, atTime(0));
    engine.addCoping(personId, makeCoping({ id: "drink", kind: "avoidant", stressRelief: 0.5, resilienceCost: 0.2 }));

    const before = engine.getPerson(personId)!;
    engine.useCoping(personId, "drink", atTime(5));
    const after = engine.getPerson(personId)!;

    expect(after.stress.level).toBeLessThan(before.stress.level);
    expect(after.stress.resilience).toBeLessThan(before.stress.resilience);
    expect(after.coping[0]!.useCount).toBe(1);
  });

  it("models grief as a staged process that advances with time", () => {
    const { engine, personId } = makeEngine();
    const ids = new IdAllocator();
    const deceased = ids.next("person");
    engine.startGrief(personId, "grief-1", deceased, atTime(0));
    expect(engine.getPerson(personId)!.grief[0]!.stage).toBe("shock");

    engine.tick(personId, 10 * MINUTES_PER_DAY, atTime(10 * MINUTES_PER_DAY));
    expect(engine.getPerson(personId)!.grief[0]!.stage).toBe("yearning");

    engine.tick(personId, 400 * MINUTES_PER_DAY, atTime(410 * MINUTES_PER_DAY));
    expect(engine.getPerson(personId)!.grief[0]!.stage).toBe("integration");
  });

  it("persists meaningful history without storing every fluctuation", () => {
    const { engine, personId } = makeEngine();
    // Many small ticks with no transitions should not spam the history.
    for (let i = 1; i <= 5; i++) {
      engine.tick(personId, 1, atTime(i));
    }
    const quiet = engine.getPerson(personId)!.history.length;

    // A mood-changing event must be recorded.
    engine.addEmotion(personId, makeEmotion({ kind: "joy", intensity: 0.95 }), atTime(100));
    const afterJoy = engine.getPerson(personId)!.history.length;

    expect(afterJoy).toBeGreaterThan(quiet);
    expect(engine.getPerson(personId)!.history.some((h) => h.note.startsWith("mood ->"))).toBe(true);
  });

  it("emotion intensity decays toward residue and eventually clears", () => {
    const { engine, personId } = makeEngine();
    engine.addEmotion(
      personId,
      makeEmotion({ kind: "joy", intensity: 0.9, durationMinutes: MINUTES_PER_HOUR, residue: 0.1 }),
      atTime(0),
    );
    engine.tick(personId, MINUTES_PER_HOUR, atTime(MINUTES_PER_HOUR));
    const decayed = engine.getPerson(personId)!.emotions[0]!;
    expect(decayed.intensity).toBeLessThan(0.9);

    // Far beyond its lifetime the emotion is removed entirely.
    engine.tick(personId, 40 * MINUTES_PER_HOUR, atTime(41 * MINUTES_PER_HOUR));
    expect(engine.getPerson(personId)!.emotions).toHaveLength(0);
  });

  it("mood label and grief stage resolvers are correct at boundaries", () => {
    expect(moodLabelFromValence(-1)).toBe("despondent");
    expect(moodLabelFromValence(-0.3)).toBe("down");
    expect(moodLabelFromValence(0)).toBe("neutral");
    expect(moodLabelFromValence(0.3)).toBe("content");
    expect(moodLabelFromValence(0.9)).toBe("uplifted");

    expect(resolveGriefStage(0)).toBe("shock");
    expect(resolveGriefStage(3)).toBe("yearning");
    expect(resolveGriefStage(21)).toBe("disorganization");
    expect(resolveGriefStage(90)).toBe("reorganization");
    expect(resolveGriefStage(365)).toBe("integration");
  });
});
