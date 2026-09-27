/**
 * System 22 — reputation: observer-relative perception, evidence weighting,
 * divergence, decay, repair, and the refusal to confuse reputation with
 * skill or truth.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { ReputationEngine } from "../../src/engine/reputation/engine.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { addTime, days, type WorldTime } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-reputation-seed";
const BAKERY = "ORG-ARDEN-MILL-BAKERY";
const DOCKS_VIEW = "community:ARDEN-QUAY";
const MILL_VIEW = "community:ARDEN-MILL";
let T0: WorldTime;

function newWorld(): Simulation {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
  T0 = sim.clock.time;
  return sim;
}

function withReputation<T>(sim: Simulation, fn: (engine: ReputationEngine, ids: IdAllocator) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("reputation", () => {
    result = fn(new ReputationEngine(sim.scope, sim.world), new IdAllocator());
  });
  return result;
}

const evidence = (over: Partial<Parameters<ReputationEngine["recordEvidence"]>[1]> = {}) => ({
  observerId: DOCKS_VIEW,
  subjectId: BAKERY,
  domain: "reliability" as const,
  note: "a delivery missed",
  sourceReliability: 0.8,
  directness: 0.8,
  corroboration: 0.4,
  recency: 1,
  valence: -0.9,
  ...over,
});

describe("reputation (System 22)", () => {
  it("is one observer's view, not a global score", () => {
    const sim = newWorld();
    withReputation(sim, (engine, ids) => {
      // The quay saw the bakery miss deliveries first-hand.
      engine.recordEvidence(
        ids,
        evidence({ note: "three missed dawn deliveries", directness: 0.9, valence: -0.8 }),
        T0,
      );
      // The mill's own floor heard an apology, second-hand.
      engine.recordEvidence(
        ids,
        evidence({
          observerId: MILL_VIEW,
          note: "the oven was repaired",
          sourceReliability: 0.6,
          directness: 0.3,
          corroboration: 0.2,
          valence: 0.4,
        }),
        T0,
      );
      const quay = engine.reading(DOCKS_VIEW, BAKERY, "reliability", T0);
      const mill = engine.reading(MILL_VIEW, BAKERY, "reliability", T0);
      // Same subject, same domain, opposite readings — and no global number.
      expect(quay.value).toBeLessThan(0);
      expect(mill.value).toBeGreaterThan(0);
      // Divergence saturates: opposite readings are as far apart as the scale goes.
      expect(engine.divergence(BAKERY, "reliability", DOCKS_VIEW, MILL_VIEW, T0)).toBe(1);
      // Thin evidence is reported as low confidence rather than hidden.
      expect(mill.confidence).toBeLessThan(quay.confidence ?? 1);
      // An unobserved domain has no reading at all.
      expect(engine.reading(DOCKS_VIEW, BAKERY, "honesty", T0).value).toBeUndefined();
      expect(engine.perceptionsOf(BAKERY, "reliability")).toHaveLength(2);
    });
  });

  it("repairs, and fades without erasing", () => {
    const sim = newWorld();
    withReputation(sim, (engine, ids) => {
      engine.recordEvidence(ids, evidence(), T0);
      const fresh = engine.decayedReading(DOCKS_VIEW, BAKERY, "reliability", T0);
      const later = engine.decayedReading(
        DOCKS_VIEW,
        BAKERY,
        "reliability",
        addTime(T0, days(365 * 2)),
      );
      // A perception fades toward neutrality, never to nothing.
      expect(fresh.value).toBeLessThan(0);
      expect(later.value).toBeGreaterThan(fresh.value ?? 0);
      // The evidence is still there: decay is not erasure.
      expect(engine.perception(DOCKS_VIEW, BAKERY, "reliability")?.evidence).toHaveLength(1);

      // A repair is evidence like any other, and moves the reading.
      engine.recordRepair(
        ids,
        {
          observerId: DOCKS_VIEW,
          subjectId: BAKERY,
          domain: "reliability",
          note: "back-pay and a written apology",
          sourceReliability: 0.8,
          directness: 0.6,
          corroboration: 0.5,
          recency: 1,
          effectiveness: 0.7,
        },
        addTime(T0, days(730)),
      );
      const repaired = engine.reading(DOCKS_VIEW, BAKERY, "reliability", addTime(T0, days(730)));
      expect(repaired.value).toBeGreaterThan(later.value ?? 0);

      // An assertion is kept distinct from something witnessed.
      engine.assertPerception(MILL_VIEW, BAKERY, "honesty", 0.9, T0, "always said so");
      const asserted = engine.perception(MILL_VIEW, BAKERY, "honesty");
      expect(asserted?.asserted).toBe(true);
      expect(asserted?.evidence).toHaveLength(0);
      expect(() =>
        engine.recordEvidence(ids, evidence({ domain: "vibes" as never }), T0),
      ).toThrow(/unknown domain/);
      // A collective reading is the mean of the observers, not a verdict.
      const collective = engine.collectiveReading(BAKERY, "reliability", T0);
      expect(collective.observerId).toBe("collective");
      expect(collective.evidenceCount).toBeGreaterThan(0);
    });
  });

  it("keeps reputation state under single ownership and in the save format", () => {
    const sim = newWorld();
    withReputation(sim, (engine, ids) => {
      engine.recordEvidence(ids, evidence(), T0);
    });
    const reader = new ReputationEngine(sim.scope, sim.world);
    expect(reader.perceptions()).toHaveLength(1);
    expect(() => reader.assertPerception(DOCKS_VIEW, BAKERY, "honesty", 0.5, T0, "x")).toThrow(
      MissingWriterContextError,
    );
    expect(() =>
      sim.guard.mutate("markets", () => {
        new ReputationEngine(sim.scope, sim.world).assertPerception(DOCKS_VIEW, BAKERY, "honesty", 0.5, T0, "x");
      }),
    ).toThrow(OwnershipViolationError);
    const bag = (sim.serializedWorld() as { readonly systems?: Record<string, unknown> }).systems;
    const state = bag?.["reputation"] as { readonly perceptions: readonly unknown[] };
    expect(state.perceptions).toHaveLength(1);
  });

  it("keeps an asserted view, and keeps it apart from what was observed", () => {
    const sim = newWorld();
    withReputation(sim, (engine, ids) => {
      const asserted = engine.assertPerception(
        DOCKS_VIEW,
        BAKERY,
        "reliability",
        0.6,
        T0,
        "the foreman says the mill never keeps its figures",
      );
      expect(asserted.asserted).toBe(true);
      expect(asserted.assertedValue).toBe(0.6);
      expect(asserted.evidence).toEqual([]);

      // The assertion is a real reading, and it claims no confidence at all:
      // nothing was observed to back it.
      const reading = engine.reading(DOCKS_VIEW, BAKERY, "reliability", T0);
      expect(reading.value).toBe(0.6);
      expect(reading.confidence).toBe(0);
      expect(reading.evidenceCount).toBe(0);

      // Evidence then outranks the assertion rather than being averaged with it.
      engine.recordEvidence(
        ids,
        {
          observerId: DOCKS_VIEW,
          subjectId: BAKERY,
          domain: "reliability",
          note: "three deliveries arrived short, witnessed by two tallymen",
          sourceReliability: 0.9,
          directness: 0.8,
          corroboration: 0.7,
          recency: 0.9,
          valence: -0.8,
        },
        T0,
      );
      const after = engine.reading(DOCKS_VIEW, BAKERY, "reliability", T0);
      expect(after.value).toBeLessThan(0);
      expect(after.confidence).toBeGreaterThan(0);
    });
  });

  it("lets a bad name be asserted as readily as a good one", () => {
    const sim = newWorld();
    withReputation(sim, (engine) => {
      // The scale is [-1, 1]; a 0..1 validator here would quietly make it
      // impossible to be talked about badly.
      engine.assertPerception(MILL_VIEW, BAKERY, "honesty", -0.8, T0, "he weighs false");
      expect(engine.perception(MILL_VIEW, BAKERY, "honesty")?.assertedValue).toBe(-0.8);
      expect(engine.reading(MILL_VIEW, BAKERY, "honesty", T0).value).toBe(-0.8);
      expect(() =>
        engine.assertPerception(MILL_VIEW, BAKERY, "honesty", -1.4, T0, "too bad even to be true"),
      ).toThrow(/must be in \[-1, 1\]/);
    });
  });

  it("fades toward neutrality, which is zero and not the middle of the scale", () => {
    const sim = newWorld();
    withReputation(sim, (engine, ids) => {
      const at = T0;
      const later = addTime(T0, days(365));
      engine.recordEvidence(
        ids,
        {
          observerId: DOCKS_VIEW,
          subjectId: BAKERY,
          domain: "reliability",
          note: "the mill was short again, and again",
          sourceReliability: 0.9,
          directness: 0.9,
          corroboration: 0.6,
          recency: 1,
          valence: -1,
        },
        at,
      );
      const fresh = engine.decayedReading(DOCKS_VIEW, BAKERY, "reliability", at);
      const faded = engine.decayedReading(DOCKS_VIEW, BAKERY, "reliability", later);
      expect(fresh.value).toBe(-1);
      // Fading a bad name toward 0.5 would slowly make the world think *better*
      // of someone it had stopped thinking badly of. Forgetting is not forgiving.
      expect(faded.value).toBeLessThan(0);
      expect(faded.value).toBeGreaterThan(-1);
      expect(faded.value).toBeCloseTo(-1 * Math.exp(-0.5), 2);
    });
  });
});
