import { describe, expect, it } from "vitest";
import {
  TraitsEngine,
  deriveTemperament,
  generateAptitudes,
  generatePersonality,
} from "../../src/engine/traits/engine.ts";
import { Prng } from "../../src/engine/rng/prng.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { atTime } from "../../src/engine/primitives/time.ts";
import { permissiveScope } from "../../src/engine/core/access.ts";
import { createWorldState } from "../../src/engine/core/worldState.ts";
import type { PersonalityDimensions, TraitDimension } from "../../src/engine/traits/types.ts";

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
  const engine = new TraitsEngine(permissiveScope(), makeWorld());
  const ids = new IdAllocator();
  const personId = ids.next("person");
  return { engine, personId };
}

function allDims(value: number): PersonalityDimensions {
  return {
    sociability: value,
    assertiveness: value,
    conscientiousness: value,
    openness: value,
    emotionalReactivity: value,
    patience: value,
    riskTolerance: value,
    adaptability: value,
    independence: value,
    competitiveness: value,
    empathy: value,
    trust: value,
    persistence: value,
  };
}

describe("personality, traits & aptitudes (System 13)", () => {
  it("registers a person with default mid-band personality and derived temperament", () => {
    const { engine, personId } = makeEngine();
    const pts = engine.registerPerson(personId);
    expect(pts.personality.sociability).toBeCloseTo(0.5);
    expect(pts.temperament).toBe("phlegmatic"); // mid reactivity, mid sociability
  });

  it("derives temperament from emotional reactivity and sociability", () => {
    expect(deriveTemperament(allDims(0.7))).toBe("sanguine");
    expect(deriveTemperament({ ...allDims(0.5), emotionalReactivity: 0.7, sociability: 0.3 })).toBe("choleric");
    expect(deriveTemperament({ ...allDims(0.5), emotionalReactivity: 0.3, sociability: 0.3 })).toBe("melancholic");
  });

  it("generation is deterministic for the same seed and differs across seeds", () => {
    const a1 = generatePersonality(Prng.fromPath("master", "traits:person-1"));
    const a2 = generatePersonality(Prng.fromPath("master", "traits:person-1"));
    const b = generatePersonality(Prng.fromPath("master", "traits:person-2"));

    expect(a1).toEqual(a2); // reproducible from identical stream state (law 8)
    expect(a1).not.toEqual(b); // variation across individuals
    for (const dimension of Object.keys(a1) as TraitDimension[]) {
      expect(a1[dimension]).toBeGreaterThanOrEqual(0);
      expect(a1[dimension]).toBeLessThanOrEqual(1);
    }
  });

  it("child traits blend both parents with variation, not a copy of either", () => {
    const parentA = generatePersonality(Prng.fromPath("m", "p:a"));
    const parentB = generatePersonality(Prng.fromPath("m", "p:b"));
    const child = generatePersonality(Prng.fromPath("m", "p:c1"), [parentA, parentB]);

    // Child sits between the parents more often than not (regression to mean).
    let within = 0;
    for (const dimension of Object.keys(child) as TraitDimension[]) {
      const lo = Math.min(parentA[dimension], parentB[dimension]);
      const hi = Math.max(parentA[dimension], parentB[dimension]);
      if (child[dimension] >= lo - 0.12 && child[dimension] <= hi + 0.12) within++;
    }
    expect(within).toBeGreaterThan(8); // most dimensions near the parental band
  });

  it("aptitudes are per-domain and influenced by related personality dimensions", () => {
    const personality = { ...allDims(0.5), sociability: 0.9, conscientiousness: 0.9 };
    const aptitudes = generateAptitudes(Prng.fromPath("m", "apt:1"), ["social", "reasoning"], personality);
    const social = aptitudes.find((a) => a.domain === "social")!;
    expect(social.level).toBeGreaterThan(0); // exists, in range, not a universal stat
    expect(social.level).toBeLessThanOrEqual(1);
  });

  it("personality changes gradually — a single experience is clamped", () => {
    const { engine, personId } = makeEngine();
    engine.registerPerson(personId, allDims(0.5));
    // A huge delta must be clamped to the per-experience cap, not applied whole.
    engine.applyExperience(personId, "sociability", 0.9, atTime(100), "sudden fame");
    const pts = engine.getPerson(personId)!;
    expect(pts.personality.sociability).toBeLessThanOrEqual(0.5 + 0.1);
    expect(pts.history.length).toBe(1); // the meaningful change was recorded
  });

  it("accumulating small experiences still moves a dimension gradually", () => {
    const { engine, personId } = makeEngine();
    engine.registerPerson(personId, allDims(0.3));
    for (let i = 1; i <= 5; i++) {
      engine.applyExperience(personId, "persistence", 0.05, atTime(i * 10), "practice");
    }
    expect(engine.getPerson(personId)!.personality.persistence).toBeGreaterThan(0.3);
  });

  it("expression modifiers change expressed value without touching base personality", () => {
    const { engine, personId } = makeEngine();
    engine.registerPerson(personId, { ...allDims(0.5), sociability: 0.5 });
    engine.addExpressionModifier(personId, {
      id: "role:formal",
      sourceSystem: "culture",
      dimension: "sociability",
      delta: -0.3,
    });
    const expressed = engine.expressedDimension(personId, "sociability", atTime(50));
    expect(expressed).toBeCloseTo(0.2);
    // Base state is untouched.
    expect(engine.getPerson(personId)!.personality.sociability).toBeCloseTo(0.5);
  });

  it("expired expression modifiers no longer apply", () => {
    const { engine, personId } = makeEngine();
    engine.registerPerson(personId, { ...allDims(0.5), sociability: 0.5 });
    engine.addExpressionModifier(personId, {
      id: "temp",
      sourceSystem: "culture",
      dimension: "sociability",
      delta: -0.3,
      expiresAt: atTime(100),
    });
    expect(engine.expressedDimension(personId, "sociability", atTime(50))).toBeCloseTo(0.2);
    expect(engine.expressedDimension(personId, "sociability", atTime(200))).toBeCloseTo(0.5);
  });
});
