/**
 * System 53 (partial) — life continuity: death lifecycle without erasing the
 * causal graph. PersonId persists across death; identity and continuity each
 * take their own write through pronounceDeath.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import {
  LifeContinuityEngine,
  pronounceDeath,
} from "../../src/engine/continuity/engine.ts";
import { IdentityEngine } from "../../src/engine/identity/engine.ts";
import { asEntityId, type EntityId } from "../../src/engine/primitives/ids.ts";
import { atTime } from "../../src/engine/primitives/time.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";

const SEED = "reellife-continuity-seed";
const UNKNOWN = asEntityId<"person">("PER-999999");

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
}

function createPerson(sim: Simulation): EntityId<"person"> {
  let id: EntityId<"person"> = UNKNOWN;
  sim.guard.mutate("identity", () => {
    id = new IdentityEngine(sim.scope, sim.world).create(sim.ids, {
      name: { first: "Test", last: "Subject" },
      birth: { dateOfBirth: atTime(0) },
      appearanceFoundationSeed: "continuity-fixture",
    }).id;
  });
  return id;
}

/** Constructs the engine inside its ownership scope; state may not exist yet. */
function continuityOf(sim: Simulation): LifeContinuityEngine {
  let engine!: LifeContinuityEngine;
  sim.guard.mutate("continuity", () => {
    engine = new LifeContinuityEngine(sim.scope, sim.world);
  });
  return engine;
}

describe("life continuity (System 53, M2 partial)", () => {
  it("pronounceDeath records identity and continuity without erasing PersonId", () => {
    const sim = newWorld();
    const personId = createPerson(sim);

    pronounceDeath(sim, personId, sim.clock.time, "workplace accident");

    const identity = new IdentityEngine(sim.scope, sim.world).get(personId);
    expect(identity?.id).toBe(personId);
    expect(identity?.death).toMatchObject({ date: sim.clock.time, cause: "workplace accident" });

    const continuity = new LifeContinuityEngine(sim.scope, sim.world);
    expect(continuity.statusOf(personId)).toBe("deceased");
    expect(continuity.deathOf(personId)).toMatchObject({
      personId,
      declaredAt: sim.clock.time,
      cause: "workplace accident",
    });

    // Death cannot be declared twice.
    expect(() => pronounceDeath(sim, personId, sim.clock.time)).toThrow(/already dead/);
  });

  it("pronounceDeath for an unknown person leaves continuity untouched", () => {
    const sim = newWorld();
    expect(() => pronounceDeath(sim, UNKNOWN, sim.clock.time, "unknown")).toThrow(/Unknown person/);
    expect(continuityOf(sim).statusOf(UNKNOWN)).toBe("active");
  });

  it("lifecycle runs active -> deceased -> historical exactly once each", () => {
    const sim = newWorld();
    const continuity = continuityOf(sim);
    expect(continuity.statusOf(UNKNOWN)).toBe("active");
    expect(() =>
      sim.guard.mutate("continuity", () => continuity.markHistorical(UNKNOWN)),
    ).toThrow(/not deceased/);

    sim.guard.mutate("continuity", () => continuity.registerDeath(UNKNOWN, sim.clock.time, "age"));
    expect(continuity.statusOf(UNKNOWN)).toBe("deceased");
    expect(() =>
      sim.guard.mutate("continuity", () => continuity.registerDeath(UNKNOWN, sim.clock.time)),
    ).toThrow(/not active/);

    sim.guard.mutate("continuity", () => continuity.markHistorical(UNKNOWN));
    expect(continuity.statusOf(UNKNOWN)).toBe("historical");
    // The death record survives the historical transition.
    expect(continuity.deathOf(UNKNOWN)).toMatchObject({ cause: "age" });
  });
});
