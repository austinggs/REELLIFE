/**
 * M2 Definition of Done — cross-system scenario: a relationship shifts.
 *
 *   neutral encounter -> repeated contact -> conflict -> repair
 *
 * Proves three things the relationship model claims about itself:
 *   1. a tie is directional — A's record of B is not B's record of A;
 *   2. interactions move specific evaluation dimensions, not a single "opinion";
 *   3. a repair is recorded as a turning point, and is attributed to the party
 *      whose view it actually changes.
 *
 * The visit is a command, so it also has to occupy real time: the activities
 * engine has to end up owning the visit, not the social layer (single owner per
 * field). The disagreement itself has no M2 command — conflict is not something
 * a player or NPC *chooses* to do yet — so the harness records it through the
 * relationship engine, and that gap is stated rather than hidden.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { asEntityId, type EntityId } from "../../src/engine/primitives/ids.ts";
import { atTime, MINUTES_PER_DAY } from "../../src/engine/primitives/time.ts";
import { SOCIAL_COMMAND_TYPES } from "../../src/engine/commands/domain/index.ts";
import { RelationshipsEngine } from "../../src/engine/relationships/engine.ts";
import type { Relationship } from "../../src/engine/primitives/relationship.ts";

const A = asEntityId<"person">("PER-000101");
const B = asEntityId<"person">("PER-000102");
const VISITS = 5;
const SEED = "reellife-scenario-relationship-shift";

function newWorld(seed: string): Simulation {
  return createKernelSimulation({ masterSeed: seed, checkInvariants: true });
}

function visit(sim: Simulation, from: EntityId<"person">, to: EntityId<"person">) {
  return sim.dispatcher.dispatch(
    sim.dispatcher.createCommand(SOCIAL_COMMAND_TYPES.visit, from, { otherPersonId: to }, "player"),
  );
}

function apologize(sim: Simulation, from: EntityId<"person">, to: EntityId<"person">) {
  return sim.dispatcher.dispatch(
    sim.dispatcher.createCommand(
      SOCIAL_COMMAND_TYPES.apologize,
      from,
      { otherPersonId: to },
      "player",
    ),
  );
}

function tie(sim: Simulation, from: EntityId<"person">, to: EntityId<"person">): Relationship {
  const relationship = new RelationshipsEngine(sim.scope, sim.world).get(from, to);
  if (!relationship) throw new Error(`No relationship ${String(from)} -> ${String(to)}`);
  return relationship;
}

interface ScenarioOutcome {
  readonly sim: Simulation;
  readonly closenessAfterFirstVisit: number;
  readonly closenessAfterAllVisits: number;
  readonly familiarityAfterFirstVisit: number;
  readonly familiarityAfterAllVisits: number;
  readonly conflictAfterDisagreement: number;
  readonly conflictAfterApology: number;
  readonly trustAfterApology: number;
  readonly visitActivities: number;
  readonly visitEvents: number;
  readonly apologyEvents: number;
  readonly bRecordTurningPoints: readonly string[];
  readonly aRecordTurningPoints: readonly string[];
  readonly unhandledConsequences: number;
}

function runRelationshipShiftScenario(seed: string): ScenarioOutcome {
  const sim = newWorld(seed);

  // 1. Neutral start: nobody knows anybody. Nothing has been written yet, so
  // there is no relationship state at all rather than an empty one.
  expect(sim.world.systems.relationships).toBeUndefined();

  // 2. Repeated contact, one visit a day.
  let closenessAfterFirstVisit = 0;
  let familiarityAfterFirstVisit = 0;
  for (let dayIndex = 0; dayIndex < VISITS; dayIndex += 1) {
    expect(visit(sim, A, B).status).toBe("applied");
    const forward = tie(sim, A, B);
    if (dayIndex === 0) {
      closenessAfterFirstVisit = forward.evaluation.closeness;
      familiarityAfterFirstVisit = forward.evaluation.familiarity;
    } else {
      // Each visit has to actually move the needle, not just be recorded.
      expect(forward.evaluation.closeness).toBeGreaterThan(0);
    }
    // Day two onward: both records already exist, so evaluations agree on the
    // shared experience and only the *event* count differs.
    expect(tie(sim, B, A).evaluation.closeness).toBe(forward.evaluation.closeness);
    sim.advanceTo(atTime((sim.clock.time as number) + MINUTES_PER_DAY));
  }

  const afterVisits = tie(sim, A, B);

  // 3. A disagreement. There is no M2 command for starting a conflict, so the
  //    harness records the occurrence through the engine that owns the record.
  sim.guard.mutate("relationships", () => {
    new RelationshipsEngine(sim.scope, sim.world).recordInteraction(
      B,
      A,
      { conflict: 0.5, trust: -0.25 },
      sim.clock.time,
      { kind: "conflict", summary: "argument about the missing rent share" },
    );
  });
  const conflictAfterDisagreement = tie(sim, B, A).evaluation.conflict;
  expect(tie(sim, B, A).turningPoints.map((point) => point.kind)).toContain("conflict");

  // 4. Repair. The apology is a command, so it goes through the pipeline. A
  //    caused the argument (the missing rent share), so A is the one who
  //    apologises; the repair lands on B's wounded view of A.
  const apologyResult = apologize(sim, A, B);
  expect(apologyResult.status).toBe("applied");

  const bRecord = tie(sim, B, A);
  const aRecord = tie(sim, A, B);
  const socialEvents = sim.history
    .all()
    .filter((entry) => (entry.eventType ?? "").startsWith("social."));

  return {
    sim,
    closenessAfterFirstVisit,
    closenessAfterAllVisits: afterVisits.evaluation.closeness,
    familiarityAfterFirstVisit,
    familiarityAfterAllVisits: afterVisits.evaluation.familiarity,
    conflictAfterDisagreement,
    conflictAfterApology: bRecord.evaluation.conflict,
    trustAfterApology: bRecord.evaluation.trust,
    visitActivities: sim.activities.all().filter((activity) => activity.kind === "socialVisit").length,
    visitEvents: socialEvents.filter((entry) => entry.eventType === "social.visited").length,
    apologyEvents: socialEvents.filter((entry) => entry.eventType === "social.apologized").length,
    bRecordTurningPoints: bRecord.turningPoints.map((point) => point.kind),
    aRecordTurningPoints: aRecord.turningPoints.map((point) => point.kind),
    unhandledConsequences: sim.dispatcher.unhandledConsequenceTypes.size,
  };
}

describe("scenario: a relationship shifts through contact, conflict and repair", () => {
  it("walks neutral -> familiar -> conflicted -> repaired, in that order", () => {
    const outcome = runRelationshipShiftScenario(SEED);

    // Contact moved specific dimensions, and kept moving them.
    expect(outcome.closenessAfterAllVisits).toBeGreaterThan(outcome.closenessAfterFirstVisit);
    expect(outcome.familiarityAfterAllVisits).toBeGreaterThan(outcome.familiarityAfterFirstVisit);

    // The disagreement was worse than the repair left it.
    expect(outcome.conflictAfterDisagreement).toBeGreaterThan(0);
    expect(outcome.conflictAfterApology).toBeLessThan(outcome.conflictAfterDisagreement);

    // Every visit occupied real time, owned by the activities engine.
    expect(outcome.visitActivities).toBe(VISITS);
    expect(outcome.visitEvents).toBe(VISITS);
    expect(outcome.apologyEvents).toBe(1);

    // The repair is attributed to the party whose view it changed: A apologised
    // to B, so B's record of A ("they apologised to me") carries the apology
    // turning point, and the apologiser's own record does not.
    expect(outcome.bRecordTurningPoints).toEqual(["met", "conflict", "apology"]);
    expect(outcome.aRecordTurningPoints).toEqual(["met"]);

    expect(outcome.unhandledConsequences).toBe(0);
  });

  it("is reproducible: same seed and same commands produce the same state hash", () => {
    const first = runRelationshipShiftScenario(SEED);
    const second = runRelationshipShiftScenario(SEED);

    expect(second.sim.stateHash()).toBe(first.sim.stateHash());
    expect(second.closenessAfterAllVisits).toBe(first.closenessAfterAllVisits);
    expect(second.conflictAfterApology).toBe(first.conflictAfterApology);
    expect(second.bRecordTurningPoints).toEqual(first.bRecordTurningPoints);
  });
});
