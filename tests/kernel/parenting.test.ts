/**
 * System 20 â€” parenting: care quality with a named binding constraint,
 * discipline described rather than judged, mistakes that can go unnoticed, and
 * autonomy measured on five separate dimensions.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { ParentingEngine } from "../../src/engine/parenting/engine.ts";
import type { CareObservation, ParentingRelationship } from "../../src/engine/parenting/types.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { addTime, days, type WorldTime } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-parenting-seed";
const CHILD = "PERSON-CHILD-NELL";
const MOTHER = "PERSON-MOTHER";
const AUNT = "PERSON-AUNT";
let T0: WorldTime;

function newWorld(): Simulation {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
  T0 = sim.clock.time;
  return sim;
}

function withParenting<T>(sim: Simulation, fn: (engine: ParentingEngine, ids: IdAllocator) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("parenting", () => {
    result = fn(new ParentingEngine(sim.scope, sim.world), new IdAllocator());
  });
  return result;
}

/** A caregiver who is present, informed, well-resourced and untroubled. */
function goodObservation(): CareObservation {
  return {
    childId: CHILD,
    caregiverId: MOTHER,
    at: T0,
    needsMet: 1,
    caregiverAvailability: 1,
    resources: 1,
    knowledge: 1,
    health: 1,
    household: 1,
    institutionSupport: 1,
    caregiverPriority: 1,
  };
}

function careFor(
  engine: ParentingEngine,
  caregiverId: string,
  kind: "parent" | "relative",
  responsibilities: readonly string[],
  at: WorldTime,
  availability = 1,
): ParentingRelationship {
  return engine.establishCare(
    {
      childId: CHILD,
      caregiverId,
      kind,
      responsibilities,
      availability,
      knowledgeOfChild: 0.8,
      resources: 0.5,
      autonomySupport: 0.5,
    },
    at,
  );
}

describe("children and parenting (System 20)", () => {
  it("names the constraint that is actually binding", () => {
    const sim = newWorld();
    withParenting(sim, (engine) => {
      careFor(engine, MOTHER, "parent", ["feeding", "school"], T0);
      // Every input but one is perfect, and the one that is not is the answer.
      const reading = engine.careReading({ ...goodObservation(), resources: 0.2 });
      expect(reading.bindingConstraint).toBe("resources");
      // Resources carry 0.15 of the weight, so a fifth of them costs 0.12.
      expect(reading.quality).toBe(0.88);
      expect(reading.factors).toHaveLength(8);
      // A child who is simply ill cannot be fixed by a perfect household.
      expect(engine.careReading({ ...goodObservation(), health: 0.1 }).bindingConstraint).toBe("health");
      expect(engine.careReading(goodObservation()).bindingConstraint).toBe("none");
    });
  });

  it("counts a child with nobody caring as uncovered", () => {
    const sim = newWorld();
    withParenting(sim, (engine) => {
      expect(engine.coverage(CHILD, T0)).toMatchObject({ available: 0, caregiverCount: 0 });
    });
  });

  it("keeps tenure when a caregiver's circumstances change", () => {
    const sim = newWorld();
    withParenting(sim, (engine) => {
      const early = addTime(T0, days(30));
      const later = addTime(T0, days(365 * 2));
      const first = careFor(engine, MOTHER, "parent", ["feeding"], early, 0.4);
      const kept = engine.establishCare(
        {
          childId: CHILD,
          caregiverId: MOTHER,
          kind: "parent",
          responsibilities: ["feeding", "school"],
          availability: 0.9,
          knowledgeOfChild: 0.9,
          resources: 0.8,
          autonomySupport: 0.6,
        },
        later,
      );
      // Two years of mothering is not erased by a better-paid post.
      expect(first.since).toBe(early);
      expect(kept.since).toBe(early);
      expect(kept.responsibilities).toHaveLength(2);
      expect(engine.caregiversOf(CHILD)).toHaveLength(1);
    });
  });

  it("finds two caregivers who both believe the school run is theirs", () => {
    const sim = newWorld();
    withParenting(sim, (engine) => {
      careFor(engine, MOTHER, "parent", ["school", "feeding"], T0, 0.5);
      careFor(engine, AUNT, "relative", ["school", "feeding"], T0, 0.5);
      const coverage = engine.coverage(CHILD, T0);
      expect(coverage.caregiverCount).toBe(2);
      expect(coverage.conflictingResponsibilities).toEqual(["school", "feeding"]);
      expect(coverage.available).toBe(1);
    });
  });

  it("describes discipline rather than grading it", () => {
    const sim = newWorld();
    withParenting(sim, (engine, ids) => {
      careFor(engine, MOTHER, "parent", ["feeding"], T0);
      const record = engine.recordDiscipline(
        {
          childId: CHILD,
          caregiverId: MOTHER,
          approach: "she was made to sit out the whole tide, and told why",
          justification: "she had gone onto the quay alone",
          observedResponse: 0.3,
        },
        T0,
        ids,
      );
      // What was done, and why, in the caregiver's own words. No style label,
      // because the spec rules one out and an enum would smuggle in a judgment.
      expect(record.approach).toMatch(/sit out the whole tide/);
      expect(record.justification).toMatch(/quay alone/);
      expect(record.observedResponse).toBe(0.3);
      expect(Object.keys(record)).not.toContain("style");
      expect(() =>
        engine.recordDiscipline(
          { childId: CHILD, caregiverId: MOTHER, approach: "  ", justification: "because" },
          T0,
          ids,
        ),
      ).toThrow(/must say what was done/);
    });
  });

  it("lets a caregiver's mistake go unnoticed until somebody finds it", () => {
    const sim = newWorld();
    withParenting(sim, (engine, ids) => {
      careFor(engine, MOTHER, "parent", ["feeding"], T0);
      const mistake = engine.recordMistake(
        CHILD,
        MOTHER,
        "the fever was put down to her being difficult",
        T0,
        ids,
      );
      // A model in which caregivers are always right has no room for learning.
      expect(mistake.discoveredAt).toBeUndefined();
      expect(engine.undiscoveredMistakes()).toHaveLength(1);

      const found = engine.discoverMistake(mistake.id, addTime(T0, days(2)), 0.7);
      expect(found.discoveredAt).toBeDefined();
      expect(found.repair).toBe(0.7);
      expect(engine.undiscoveredMistakes()).toEqual([]);
      // Once found, it stays found.
      expect(engine.discoverMistake(mistake.id, addTime(T0, days(9)), 1).discoveredAt).toBe(
        addTime(T0, days(2)),
      );
    });
  });

  it("measures autonomy on five dimensions and says which are unknown", () => {
    const sim = newWorld();
    withParenting(sim, (engine) => {
      const year = addTime(T0, days(365));
      const three = addTime(T0, days(365 * 3));
      // Nothing measured yet: a child nobody has assessed is not a helpless one.
      expect(engine.independenceProfile(CHILD, T0)).toMatchObject({
        overall: undefined,
        measuredDimensions: 0,
      });

      engine.recordIndependence(CHILD, "practical", 0.3, T0);
      engine.recordIndependence(CHILD, "financial", 0.1, T0);
      const first = engine.independenceProfile(CHILD, year);
      expect(first.measuredDimensions).toBe(2);
      expect(first.overall).toBe(0.2);
      // Unmeasured is undefined, not 0: a child who can manage money while
      // nobody has checked whether they can choose their clothes.
      expect(first.byDimension.social).toBeUndefined();
      expect(first.byDimension.decision).toBeUndefined();

      engine.recordIndependence(CHILD, "practical", 0.8, three);
      const grown = engine.independenceProfile(CHILD, three);
      // The latest record per dimension wins, and development is a trajectory.
      expect(grown.byDimension.practical).toBe(0.8);
      expect(grown.overall).toBe(0.45);
      // And asking about a date before the growth sees the earlier child.
      expect(engine.independenceProfile(CHILD, T0).byDimension.practical).toBe(0.3);
    });
  });

  it("records that nobody was there, because that is the fact that matters", () => {
    const sim = newWorld();
    withParenting(sim, (engine, ids) => {
      careFor(engine, MOTHER, "parent", ["feeding"], T0);
      const event = engine.recordEvent(
        CHILD,
        "caregiver_unavailable",
        "left alone at the mill after the tide, four hours",
        T0,
        ids,
      );
      expect(event.caregiverIds).toEqual([]);
      expect(engine.eventsOf(CHILD)).toHaveLength(1);
      // An event cannot be filed against a caregiver who does not exist here.
      expect(() =>
        engine.recordEvent(CHILD, "handover", "handed to a stranger", T0, ids, ["PERSON-NOBODY"]),
      ).not.toThrow();
    });
  });

  it("keeps parenting state under single ownership and refuses a foreign writer", () => {
    const sim = newWorld();
    withParenting(sim, (engine) => {
      careFor(engine, MOTHER, "parent", ["feeding"], T0);
    });

    const reader = new ParentingEngine(sim.scope, sim.world);
    expect(reader.caregiversOf(CHILD)).toHaveLength(1);
    expect(() =>
      reader.recordIndependence(CHILD, "decision", 0.5, T0),
    ).toThrow(MissingWriterContextError);
    expect(() =>
      sim.guard.mutate("education", () => {
        new ParentingEngine(sim.scope, sim.world).recordEvent(
          CHILD,
          "coordination",
          "not ours to write",
          T0,
          new IdAllocator(),
        );
      }),
    ).toThrow(OwnershipViolationError);
  });
});