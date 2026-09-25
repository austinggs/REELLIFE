import { describe, expect, it } from "vitest";
import { createKernelSimulation, bootstrapLoadedSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { Simulation } from "../../src/engine/core/simulation.ts";
import { TIME_COMMAND_TYPES } from "../../src/engine/commands/builtin/timeCommands.ts";
import { addTime, atTime, days } from "../../src/engine/primitives/time.ts";
import { getSimulationHealthView } from "../../src/engine/query/projections.ts";
import type { EntityId } from "../../src/engine/primitives/ids.ts";

const SEED = "reellife-kernel-determinism-seed";
const SYSTEM_ACTOR = "PER-000000" as EntityId<"person">;

function newWorld(seed = SEED): Simulation {
  return createKernelSimulation({ masterSeed: seed, checkInvariants: true });
}

function runDays(sim: Simulation, dayCount: number): void {
  sim.advanceTo(addTime(sim.clock.time, days(dayCount)));
}

describe("deterministic continuation (System 03 / System 06)", () => {
  it("reproduces an identical world from the same seed and command sequence", () => {
    const first = newWorld();
    const second = newWorld();
    runDays(first, 5);
    runDays(second, 5);

    expect(second.stateHash()).toBe(first.stateHash());
    expect(second.canonicalStateText()).toBe(first.canonicalStateText());
    expect(second.clock.time).toBe(first.clock.time);
  });

  it("produces a different world identity and divergent streams for a different seed", () => {
    const first = newWorld("reellife-kernel-seed-aaaa");
    const second = newWorld("reellife-kernel-seed-bbbb");
    runDays(first, 1);
    runDays(second, 1);
    expect(first.stateHash()).not.toBe(second.stateHash());
    expect(first.rng.stream("world").nextUint32()).not.toBe(second.rng.stream("world").nextUint32());
  });

  it("advances exactly one quantum per step and lands on the requested time", () => {
    const sim = newWorld();
    const start = sim.clock.time as number;
    const result = sim.advanceTo(atTime(start + 1_440));
    expect(result.steps).toBe(1_440);
    expect(result.clipped).toBe(false);
    expect(sim.clock.time as number).toBe(start + 1_440);
    expect(sim.clock.stepIndex).toBe(1_440);
  });

  it("reports a clipped catch-up instead of pretending to have caught up", () => {
    const sim = createKernelSimulation({
      masterSeed: SEED,
      checkInvariants: false,
      config: { maxCatchupQuanta: 100 },
    });
    const start = sim.clock.time as number;
    const result = sim.advanceTo(atTime(start + 10_000));
    expect(result.clipped).toBe(true);
    expect(result.steps).toBe(100);
    expect(sim.clock.time as number).toBe(start + 100);
  });

  it("keeps the world advancing independently of observation", () => {
    const observed = newWorld();
    const untouched = newWorld();
    for (let index = 0; index < 10; index += 1) {
      observed.step();
      void getSimulationHealthView(observed);
    }
    untouched.advanceTo(atTime((untouched.clock.time as number) + 10));
    expect(observed.stateHash()).toBe(untouched.stateHash());
  });

  it("routes pacing through a command rather than a direct mutation", () => {
    const sim = newWorld();
    const result = sim.dispatcher.dispatch(
      sim.dispatcher.createCommand(TIME_COMMAND_TYPES.setSpeed, SYSTEM_ACTOR, { speed: 100 }, "player"),
    );
    expect(result.status).toBe("applied");
    expect(sim.clock.simulationSpeed).toBe(100);
    expect(sim.commandLog.size).toBe(1);

    const rejected = sim.dispatcher.dispatch(
      sim.dispatcher.createCommand(TIME_COMMAND_TYPES.setSpeed, SYSTEM_ACTOR, { speed: 7 }, "player"),
    );
    expect(rejected.status).toBe("rejected");
    expect(rejected.issues[0]?.code).toBe("unsupported_speed");
    expect(sim.clock.simulationSpeed).toBe(100);
  });

  it("changes no world state when a command is rejected", () => {
    const sim = newWorld();
    const result = sim.dispatcher.dispatch(
      sim.dispatcher.createCommand("no.such_command", SYSTEM_ACTOR, {}, "player"),
    );
    expect(result.status).toBe("rejected");
    expect(sim.events.pendingCount).toBe(0);
    expect(sim.history.size()).toBe(0);
    expect(sim.commandLog.all()[0]?.status).toBe("rejected");
  });
});

describe("save/load equivalence (System 06)", () => {
  it("continues identically after a reload", async () => {
    const uninterrupted = newWorld();
    runDays(uninterrupted, 2);

    const file = uninterrupted.toSave("continue-check");
    const reloaded = bootstrapLoadedSimulation(Simulation.fromSaveFile(file, { masterSeed: SEED }));

    runDays(uninterrupted, 1);
    runDays(reloaded, 1);

    expect(reloaded.stateHash()).toBe(uninterrupted.stateHash());
    expect(reloaded.clock.time).toBe(uninterrupted.clock.time);
    expect(reloaded.clock.stepIndex).toBe(uninterrupted.clock.stepIndex);
  });

  it("preserves RNG continuation across a reload", () => {
    const sim = newWorld();
    runDays(sim, 1);
    sim.rng.stream("world").nextUint32();
    const file = sim.toSave("rng-check");

    const expectedNext = sim.rng.stream("world").nextUint32();
    const reloaded = bootstrapLoadedSimulation(Simulation.fromSaveFile(file, { masterSeed: SEED }));
    expect(reloaded.rng.stream("world").nextUint32()).toBe(expectedNext);
  });

  it("stores and restores the command log so replay has its source", async () => {
    const sim = newWorld();
    sim.dispatcher.dispatch(
      sim.dispatcher.createCommand(TIME_COMMAND_TYPES.setSpeed, SYSTEM_ACTOR, { speed: 10 }, "player"),
    );
    runDays(sim, 1);
    const info = await sim.saveTo("slot-a", "test run");
    expect(sim.toSave("slot-a").header.commandCount).toBe(1);
    expect(info.worldDateLabel).toBe("2 January 2042");

    const reloaded = bootstrapLoadedSimulation(
      Simulation.fromSaveFile(sim.toSave("slot-a"), { masterSeed: SEED }),
    );
    expect(reloaded.commandLog.size).toBe(1);
    expect(reloaded.commandLog.all()[0]?.type).toBe(TIME_COMMAND_TYPES.setSpeed);
    expect(reloaded.commandLog.all()[0]?.params.speed).toBe(10);
  });

  it("keeps the canonical start date and generation after a reload", () => {
    const sim = newWorld();
    runDays(sim, 3);
    const reloaded = bootstrapLoadedSimulation(
      Simulation.fromSaveFile(sim.toSave("meta"), { masterSeed: SEED }),
    );
    expect(reloaded.world.meta.startTime).toBe(sim.world.meta.startTime);
    expect(reloaded.world.meta.generation).toBe(1);
    expect(reloaded.world.meta.masterSeed).toBe(SEED);
  });

  it("writes through a store and reloads through the same store", async () => {
    const sim = newWorld();
    runDays(sim, 1);
    await sim.saveTo("slot-store");

    const reloaded = await Simulation.load({
      masterSeed: SEED,
      saveStore: sim.saveStore,
      slotName: "slot-store",
    });
    expect(bootstrapLoadedSimulation(reloaded).stateHash()).toBe(sim.stateHash());
  });
});
