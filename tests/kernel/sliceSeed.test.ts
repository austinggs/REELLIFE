/**
 * M3 — the playable slice: a world the UI shell can actually run on
 * (geography, materialized residents, a player with needs), idempotent to
 * re-seed, deterministic for a master seed, and intact across save/load.
 */

import { describe, expect, it } from "vitest";
import {
  createKernelSimulation,
  loadKernelSimulation,
} from "../../src/engine/kernel/bootstrap.ts";
import { SLICE_RESIDENT_COUNT, seedPlayableSlice } from "../../src/engine/kernel/sliceSeed.ts";
import { ScaleEngine } from "../../src/engine/scale/engine.ts";
import { getLifeSituation } from "../../src/engine/query/lifeViews.ts";
import { M2_SETTLEMENT_ID } from "../../src/content/aurelia/geography.ts";
import { asEntityId } from "../../src/engine/primitives/ids.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";

const SEED = "reellife-m3-slice-seed";

function newSeededWorld(): { sim: Simulation; playerId: string; residentCount: number } {
  const sim = createKernelSimulation({
    masterSeed: SEED,
    checkInvariants: true,
    seedSlice: true,
  });
  // Idempotent; this is also how the app discovers which resident is the player.
  const seeded = seedPlayableSlice(sim);
  return { sim, playerId: seeded.playerId, residentCount: seeded.residentCount };
}

describe("playable slice seed (M3)", () => {
  it("gives the UI a lived-in world: places, residents and a player with needs", () => {
    const { sim, playerId, residentCount } = newSeededWorld();

    expect(residentCount).toBe(SLICE_RESIDENT_COUNT);
    expect(new ScaleEngine(sim.scope, sim.world).countMaterialized(M2_SETTLEMENT_ID)).toBe(
      SLICE_RESIDENT_COUNT,
    );

    const life = getLifeSituation(sim, asEntityId<"person">(playerId));
    expect(life.displayName).not.toBe("Unknown person");
    expect(life.locationName).not.toBe("Unplaced");
    expect(life.householdName).toBeDefined();
    expect(life.needs.map((need) => need.kind)).toContain("hunger");
    expect(life.quickActions.map((action) => action.commandType)).toContain("person.eat");
  });

  it("is idempotent: re-seeding duplicates neither residents nor needs", () => {
    const { sim, playerId, residentCount } = newSeededWorld();
    const again = seedPlayableSlice(sim);

    expect(again.playerId).toBe(playerId);
    expect(again.residentCount).toBe(residentCount);
    const needsState = sim.world.systems.needs as {
      readonly persons: readonly { readonly personId: string }[];
    };
    expect(needsState.persons.filter((entry) => entry.personId === playerId)).toHaveLength(1);
  });

  it("is deterministic per master seed and different across seeds", () => {
    const first = newSeededWorld();
    const second = newSeededWorld();
    const firstLife = getLifeSituation(first.sim, asEntityId<"person">(first.playerId));
    const secondLife = getLifeSituation(second.sim, asEntityId<"person">(second.playerId));
    expect(secondLife.displayName).toBe(firstLife.displayName);

    const other = createKernelSimulation({
      masterSeed: "reellife-m3-other-seed",
      checkInvariants: true,
      seedSlice: true,
    });
    const otherPlayer = seedPlayableSlice(other).playerId;
    expect(getLifeSituation(other, asEntityId<"person">(otherPlayer)).displayName).not.toBe(
      firstLife.displayName,
    );
  });

  it("keeps the player's life intact across save/load", async () => {
    const { sim, playerId } = newSeededWorld();
    sim.runSteps(30);
    const before = getLifeSituation(sim, asEntityId<"person">(playerId));

    const saved = sim.dispatcher.dispatch(
      sim.dispatcher.createCommand(
        "world.save",
        asEntityId<"person">(playerId),
        { slotName: "slot-m3" },
        "player",
      ),
    );
    expect(saved.status).toBe("applied");
    await sim.awaitPendingSaves();

    const reloaded = await loadKernelSimulation({
      masterSeed: SEED,
      checkInvariants: true,
      saveStore: sim.saveStore,
      slotName: "slot-m3",
    });

    const after = getLifeSituation(reloaded, asEntityId<"person">(playerId));
    expect(after.displayName).toBe(before.displayName);
    expect(after.locationName).toBe(before.locationName);
    expect(after.householdName).toBe(before.householdName);
    expect(after.needs.map((need) => need.kind)).toEqual(before.needs.map((need) => need.kind));
    expect(after.timeLabel).toBe(before.timeLabel);
  });
});
