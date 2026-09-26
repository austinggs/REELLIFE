/**
 * System 37 — geography: stable LocationRefs, hierarchy validation, queries.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation, loadKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { asEntityId } from "../../src/engine/primitives/ids.ts";
import { GeographyEngine } from "../../src/engine/geography/engine.ts";
import {
  AURELIA_SLICE_PLACES,
  M2_SETTLEMENT_ID,
  registerAureliaSliceGeography,
  registerAureliaWorldGeography,
} from "../../src/content/aurelia/geography.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";

const SEED = "reellife-geography-seed";

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
}

function withGeography<T>(sim: Simulation, fn: (engine: GeographyEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("geography", () => {
    result = fn(new GeographyEngine(sim.scope, sim.world));
  });
  return result;
}

/** Runs `world.save` and waits for the store write; throws when rejected. */
async function dispatchSave(sim: Simulation, slotName: string): Promise<boolean> {
  const result = sim.dispatcher.dispatch(
    sim.dispatcher.createCommand("world.save", asEntityId<"person">("PER-000001"), { slotName }, "player"),
  );
  if (result.status !== "applied") return false;
  await sim.awaitPendingSaves();
  return true;
}

describe("geography engine (System 37)", () => {
  it("registers the canonical Aurelia slice chain with unique IDs", () => {
    const sim = newWorld();
    withGeography(sim, (engine) => {
      registerAureliaSliceGeography(engine);
      const ids = engine.all().map((place) => place.id);
      expect(ids).toEqual([
        "WORLD-AURELIA",
        "CONT-ELANDRA",
        "COUNTRY-ARDIN",
        "REGION-ARDAN-BASIN",
        "CITY-ARDEN",
      ]);
      expect(new Set(ids).size).toBe(ids.length);
      // Re-registering is a no-op, never a duplicate.
      registerAureliaSliceGeography(engine);
      expect(engine.all()).toHaveLength(AURELIA_SLICE_PLACES.length);
    });
  });

  it("rejects duplicate places, unknown parents and shallow parents", () => {
    const sim = newWorld();
    withGeography(sim, (engine) => {
      registerAureliaSliceGeography(engine);
      expect(() => engine.register({ id: "CITY-ARDEN", level: "settlement", name: "Dup" })).toThrow(
        /duplicate/,
      );
      expect(() =>
        engine.register({ id: "CITY-GHOST", level: "settlement", name: "Ghost", parentId: "CITY-NOWHERE" }),
      ).toThrow(/not registered/);
      // A settlement cannot be the parent of a country.
      expect(() =>
        engine.register({
          id: "COUNTRY-WRONG",
          level: "country",
          name: "Wrong",
          parentId: M2_SETTLEMENT_ID,
        }),
      ).toThrow(/shallower/);
    });
  });

  it("answers hierarchy queries: children, ancestors, containment, settlement", () => {
    const sim = newWorld();
    withGeography(sim, (engine) => {
      registerAureliaSliceGeography(engine);
      expect(engine.children("REGION-ARDAN-BASIN").map((p) => p.id)).toEqual([M2_SETTLEMENT_ID]);
      expect(engine.ancestors(M2_SETTLEMENT_ID).map((p) => p.id)).toEqual([
        "WORLD-AURELIA",
        "CONT-ELANDRA",
        "COUNTRY-ARDIN",
        "REGION-ARDAN-BASIN",
      ]);
      expect(engine.isWithin(M2_SETTLEMENT_ID, "COUNTRY-ARDIN")).toBe(true);
      expect(engine.isWithin(M2_SETTLEMENT_ID, "CITY-ARDEN")).toBe(true);
      expect(engine.isWithin("COUNTRY-ARDIN", M2_SETTLEMENT_ID)).toBe(false);
      expect(engine.settlementOf(M2_SETTLEMENT_ID)?.id).toBe(M2_SETTLEMENT_ID);
      expect(engine.settlementOf("WORLD-AURELIA")).toBeUndefined();
    });
  });

  it("LocationRefs survive save/load unchanged", async () => {
    const sim = newWorld();
    withGeography(sim, registerAureliaSliceGeography);

    const saved = await dispatchSave(sim, "slot-geography");
    expect(saved).toBe(true);

    const reloaded = await loadKernelSimulation({
      masterSeed: SEED,
      checkInvariants: true,
      saveStore: sim.saveStore,
      slotName: "slot-geography",
    });
    const places = (reloaded.world.systems.geography as { places: readonly { id: string }[] })
      .places;
    expect(places.map((place) => place.id)).toEqual([
      "WORLD-AURELIA",
      "CONT-ELANDRA",
      "COUNTRY-ARDIN",
      "REGION-ARDAN-BASIN",
      "CITY-ARDEN",
    ]);
  });

  it("registers full world geography (M4) and supports spatial history queries", () => {
    const sim = newWorld();
    withGeography(sim, (engine) => {
      registerAureliaWorldGeography(engine);
      // All places registered
      expect(engine.all().length).toBeGreaterThan(120);

      // Historical names query works
      const arden = engine.findByHistoricalName("Porte-Ardan");
      expect(arden?.id).toBe("CITY-ARDEN");
      expect(arden?.name).toBe("Arden");

      const veyr = engine.findByHistoricalName("Veyr-on-River");
      expect(veyr?.id).toBe("CITY-VEYR");

      // Historical names getter
      expect(engine.historicalNamesOf("CITY-ARDEN")).toContain("Old Arden");
      expect(engine.historicalNamesOf("CITY-ARDEN")).toContain("Porte-Ardan");

      // Ancestry traces from settlement up to country, continent, and world
      const selinAncestors = engine.ancestors("CITY-SELIN").map((p) => p.id);
      expect(selinAncestors).toContain("WORLD-AURELIA");
      expect(selinAncestors).toContain("CONT-ILYRA");
      expect(selinAncestors).toContain("COUNTRY-SELIN");

      const westhavenAncestors = engine.ancestors("CITY-WESTHAVEN").map((p) => p.id);
      expect(westhavenAncestors).toContain("WORLD-AURELIA");
      expect(westhavenAncestors).toContain("CONT-VEYRA");
      expect(westhavenAncestors).toContain("COUNTRY-WESTHAVEN");
    });
  });

});
