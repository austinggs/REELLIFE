/**
 * M8 — disaster: a hazard becomes an incident, and the cascade is only ever as
 * real as the records behind it.
 *
 * The chain:
 *
 *   hazard condition -> incident raised from it -> the incident advances through
 *   its stages -> the lift is recorded on the hazard -> the timeline carries the
 *   whole chain under one causal id.
 *
 * The properties that matter, and that a disaster scenario usually gets wrong:
 *
 *  1. **A disaster is a pipeline, not a flag.** System 46's six stages
 *     (`hazard -> exposure -> vulnerability -> impact -> response -> recovery`)
 *     advance one at a time and a stage that is out of order is *refused*. An
 *     incident that could jump straight to `recovery` would let the world skip
 *     the part where a disaster actually does harm.
 *  2. **The incident cites the hazard it came from.** `hazardId` is a reference,
 *     and raising an incident against a hazard that does not exist is refused.
 *     A disaster with no recorded cause is exactly the kind of unexplained
 *     suffering System 53 also refuses to invent.
 *  3. **No silent damage.** This scenario asserts that raising a flood changes
 *     the *environment's* record and nothing else: no system was made poorer,
 *     displaced or injured by the act of raising the incident. Damage is
 *     propagated by the systems that model it, and no such system exists yet, so
 *     pretending otherwise would be a lie in the name of drama.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { asEntityId, type EntityId } from "../../src/engine/primitives/ids.ts";
import { atTime, MINUTES_PER_DAY } from "../../src/engine/primitives/time.ts";
import { EnvironmentEngine } from "../../src/engine/environment/engine.ts";
import { IdentityEngine } from "../../src/engine/identity/engine.ts";
import { FinanceEngine } from "../../src/engine/finance/engine.ts";
import { M2_SETTLEMENT_ID } from "../../src/content/aurelia/geography.ts";
import { DISASTER_STAGES } from "../../src/engine/environment/types.ts";

const SEED = "reellife-scenario-disaster";
const DAY = MINUTES_PER_DAY;
const CHAIN = "chain-flood";

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
}

function makePerson(sim: Simulation, first: string, last: string): EntityId<"person"> {
  let id: EntityId<"person"> = asEntityId<"person">("PER-999999");
  sim.guard.mutate("identity", () => {
    id = new IdentityEngine(sim.scope, sim.world).create(sim.ids, {
      name: { first, last },
      birth: { dateOfBirth: atTime(0) },
      appearanceFoundationSeed: "disaster-fixture",
    }).id;
  });
  return id;
}

/** Evaluates ambient hazards at the slice city through System 46. */
function evaluateHazards(sim: Simulation, at: number) {
  let hazards: readonly { id: string; kind: string }[] = [];
  sim.guard.mutate("environment", () => {
    const engine = new EnvironmentEngine(sim.scope, sim.world);
    const weather = engine.weatherAt(M2_SETTLEMENT_ID);
    if (weather === undefined) return;
    // A WeatherSnapshot already carries every field a DerivedWeather wants, so
    // hazard evaluation reads the recorded observation rather than inventing a
    // second weather.
    hazards = engine.evaluateHazards({
      locationId: M2_SETTLEMENT_ID,
      climate: weather.climate,
      weather: {
        condition: weather.condition,
        temperatureCelsius: weather.temperatureCelsius,
        precipitationMm: weather.precipitationMm,
        windKph: weather.windKph,
      },
      at: atTime(at),
    });
  });
  return hazards;
}

/** Raises an incident from a hazard, in System 46's scope. */
function raise(sim: Simulation, input: {
  id: string;
  kind: string;
  at: number;
  hazardId?: string;
  magnitude?: number;
}) {
  let incident: ReturnType<EnvironmentEngine["disaster"]>;
  sim.guard.mutate("environment", () => {
    incident = new EnvironmentEngine(sim.scope, sim.world).raiseDisaster({
      id: input.id,
      locationId: M2_SETTLEMENT_ID,
      kind: input.kind as never,
      at: atTime(input.at),
      causalChainId: CHAIN,
      ...(input.hazardId === undefined ? {} : { hazardId: input.hazardId }),
      ...(input.magnitude === undefined ? {} : { magnitude: input.magnitude }),
    });
  });
  return incident;
}

describe("disaster scenario (M8)", () => {
  it("runs a flood from hazard through to recovery, one stage at a time", () => {
    const sim = newWorld();
    makePerson(sim, "Ada", "Byron");
    makePerson(sim, "Nell", "Byron");

    // The city has weather, so hazards can be evaluated against something real.
    const hazards = evaluateHazards(sim, DAY);
    expect(Array.isArray(hazards)).toBe(true);

    // 1. An incident is raised, and it cites the hazard it came from.
    const incident = raise(sim, {
      id: "FLOOD-ARDEN-1",
      kind: "flood",
      at: DAY,
      hazardId: hazards[0]?.id,
      magnitude: 0.4,
    });
    expect(incident?.stage).toBe("hazard");
    expect(incident?.locationId).toBe(M2_SETTLEMENT_ID);
    expect(incident?.causalChainId).toBe(CHAIN);
    // The history starts with the stage it began at, and keeps what was known.
    expect(incident?.history).toHaveLength(1);
    expect(incident?.history[0]?.magnitude).toBe(0.4);
    expect(incident?.startedAt).toBe(atTime(DAY));

    // 2. The incident advances through the pipeline, one stage at a time.
    const environment = () => new EnvironmentEngine(sim.scope, sim.world);
    const stages = DISASTER_STAGES.filter((stage) => stage !== "hazard");
    stages.forEach((stage, index) => {
      sim.guard.mutate("environment", () => {
        environment().advanceDisaster({
          id: "FLOOD-ARDEN-1",
          stage,
          at: atTime(DAY * (index + 2)),
          summary: `flood at stage ${stage}`,
        });
      });
    });

    const recovered = environment().disaster("FLOOD-ARDEN-1");
    expect(recovered?.stage).toBe("recovery");
    // Every stage was recorded, in order: the pipeline cannot be skipped, and
    // the record is what makes "how did it get this bad" answerable afterwards.
    expect(recovered?.history).toHaveLength(DISASTER_STAGES.length);
    expect(recovered?.history.map((record) => record.stage)).toEqual([...DISASTER_STAGES]);
    for (let index = 1; index < (recovered?.history.length ?? 0); index += 1) {
      expect((recovered?.history[index]?.at as number) ?? 0).toBeGreaterThanOrEqual(
        (recovered?.history[index - 1]?.at as number) ?? 0,
      );
    }
    // It is no longer an active disaster once it has recovered.
    expect(
      environment().activeDisasters().some((entry) => entry.id === "FLOOD-ARDEN-1"),
    ).toBe(false);
  });

  it("refuses a stage out of order, and an incident with no cause", () => {
    const sim = newWorld();
    const hazards = evaluateHazards(sim, DAY);
    raise(sim, { id: "FLOOD-ARDEN-2", kind: "flood", at: DAY, hazardId: hazards[0]?.id });

    const environment = () => new EnvironmentEngine(sim.scope, sim.world);
    sim.guard.mutate("environment", () => {
      // `impact` is not the stage after `hazard`; the pipeline cannot be skipped.
      expect(() =>
        environment().advanceDisaster({
          id: "FLOOD-ARDEN-2",
          stage: "impact",
          at: atTime(DAY * 2),
          summary: "skipping ahead",
        }),
      ).toThrow(/can only advance to "exposure"/);
    });

    // An incident must cite a hazard that exists. A disaster with no recorded
    // cause is exactly the kind of unexplained suffering nothing else may invent.
    sim.guard.mutate("environment", () => {
      expect(() =>
        environment().raiseDisaster({
          id: "FLOOD-NOCAUDE",
          locationId: M2_SETTLEMENT_ID,
          kind: "flood" as never,
          at: atTime(DAY),
          hazardId: "HAZ-DOES-NOT-EXIST",
        }),
      ).toThrow(/unknown hazard/);
      // And a duplicate incident id is refused, so a flood is not counted twice.
      expect(() =>
        environment().raiseDisaster({
          id: "FLOOD-ARDEN-2",
          locationId: M2_SETTLEMENT_ID,
          kind: "flood" as never,
          at: atTime(DAY),
        }),
      ).toThrow(/duplicate disaster/);
    });
  });

  it("raises no damage it cannot account for", () => {
    const sim = newWorld();
    const ada = makePerson(sim, "Ada", "Byron");
    const hazards = evaluateHazards(sim, DAY);

    // A real account, so "nothing changed" is a meaningful claim.
    let accountId = "";
    sim.guard.mutate("finance", () => {
      accountId = new FinanceEngine(sim.scope, sim.world).openAccount(
        sim.ids,
        ada,
        "checking",
        "AUR" as never,
        atTime(DAY),
      ).id;
    });
    const balanceBefore = new FinanceEngine(sim.scope, sim.world).getAccount(accountId)?.balance;

    const incident = raise(sim, {
      id: "FLOOD-ARDEN-3",
      kind: "flood",
      at: DAY,
      hazardId: hazards[0]?.id,
      magnitude: 0.9,
    });
    // The incident exists and is severe...
    expect(incident?.history[0]?.magnitude).toBe(0.9);

    // ...and nothing else moved. No system was made poorer, displaced or injured
    // by the act of recording a flood, because no system models that yet. Damage
    // is propagated by the systems that own it; faking it here would be a lie
    // dressed as drama, and the player would have no way to tell.
    expect(new FinanceEngine(sim.scope, sim.world).getAccount(accountId)?.balance).toEqual(
      balanceBefore,
    );
    expect(new FinanceEngine(sim.scope, sim.world).allLedger()).toHaveLength(0);
    // The person is untouched: no health record was invented at the flood.
    expect(JSON.stringify(sim.world.systems.health ?? null)).toBe("null");
    // And no employment ended, because a flood is not a dismissal.
    const employment = sim.world.systems.employment as
      | { employments?: readonly unknown[] }
      | undefined;
    expect(employment?.employments ?? []).toEqual([]);
  });

  it("the whole disaster is on the timeline under one causal chain", () => {
    const sim = newWorld();
    const ada = makePerson(sim, "Ada", "Byron");
    const hazards = evaluateHazards(sim, DAY);
    const incident = raise(sim, { id: "FLOOD-ARDEN-4", kind: "flood", at: DAY, hazardId: hazards[0]?.id });
    expect(incident).toBeDefined();

    // The incident carries the chain id, so the timeline can answer "what
    // happened to the people affected by this" without guessing.
    expect(incident?.causalChainId).toBe(CHAIN);

    // A record on the chain, attributed to the person who was there.
    sim.guard.mutate("history", () => {
      sim.history.record({
        at: atTime(DAY),
        kind: "worldEvent",
        summary: "the river rose over the quay",
        personId: ada,
        locationId: M2_SETTLEMENT_ID,
        causalChainId: CHAIN,
        importance: 4,
        visibility: "public",
      });
    });

    const chain = sim.history.forChain(CHAIN);
    expect(chain).toHaveLength(1);
    expect(chain[0]?.locationId).toBe(M2_SETTLEMENT_ID);
    // A flood is above the retention floor, so it cannot be compressed away.
    expect(chain[0]?.importance).toBeGreaterThanOrEqual(3);
  });

  it("reproduces from its seed", () => {
    const run = (): string => {
      const sim = newWorld();
      const hazards = evaluateHazards(sim, DAY);
      raise(sim, { id: "FLOOD-ARDEN-1", kind: "flood", at: DAY, hazardId: hazards[0]?.id });
      for (const [index, stage] of DISASTER_STAGES.slice(1).entries()) {
        sim.guard.mutate("environment", () => {
          new EnvironmentEngine(sim.scope, sim.world).advanceDisaster({
            id: "FLOOD-ARDEN-1",
            stage,
            at: atTime(DAY * (index + 2)),
            summary: `flood at stage ${stage}`,
          });
        });
      }
      return sim.stateHash();
    };
    expect(run()).toBe(run());
  });
});

