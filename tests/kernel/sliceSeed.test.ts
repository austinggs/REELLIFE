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
import { aureliaCountryOfSettlement } from "../../src/content/aurelia/countries.ts";
import { AURELIA_SLICE_ASSET_COUNT } from "../../src/content/aurelia/infrastructure.ts";
import { AURELIA_SLICE_BUSINESS_COUNT } from "../../src/content/aurelia/businesses.ts";
import { CountriesEngine, DEFAULT_BORDER_ACCESS_RULE_KEY } from "../../src/engine/countries/engine.ts";
import { BusinessesEngine } from "../../src/engine/businesses/engine.ts";
import { SupplyChainsEngine } from "../../src/engine/supplyChains/engine.ts";
import {
  AURELIA_SLICE_DEPENDENCY_COUNT,
  AURELIA_SLICE_OFFER_COUNT,
} from "../../src/content/aurelia/supplyChains.ts";
import { EnvironmentEngine } from "../../src/engine/environment/engine.ts";
import { InfrastructureEngine } from "../../src/engine/infrastructure/engine.ts";
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

  it("brings up the M4 spatial systems for the seeded world (M4)", () => {
    const { sim } = newSeededWorld();

    // System 38: the slice city has a real operational network. The seed
    // registers it through the owning engine; it never becomes the owner.
    sim.guard.mutate("infrastructure", () => {
      const infrastructure = new InfrastructureEngine(sim.scope, sim.world);
      expect(infrastructure.assets()).toHaveLength(AURELIA_SLICE_ASSET_COUNT);
      expect(infrastructure.assetsAt(M2_SETTLEMENT_ID)).toHaveLength(AURELIA_SLICE_ASSET_COUNT);
    });

    // System 46: the world has weather for the slice's city from the first frame.
    sim.guard.mutate("environment", () => {
      const weather = new EnvironmentEngine(sim.scope, sim.world).weatherAt(M2_SETTLEMENT_ID);
      expect(weather?.locationId).toBe(M2_SETTLEMENT_ID);
      expect(weather?.condition).toBeDefined();
    });

    // System 39: the slice's country is a rule-and-institution environment — the
    // city sits inside a jurisdiction, inside a country that has a currency, and
    // the world rules are in force rather than described.
    const countryId = aureliaCountryOfSettlement(M2_SETTLEMENT_ID);
    expect(countryId).toBeDefined();
    if (countryId === undefined) return;
    sim.guard.mutate("countries", () => {
      const countries = new CountriesEngine(sim.scope, sim.world);
      expect(countries.country(countryId)).toBeDefined();
      expect(countries.jurisdictionsAt(M2_SETTLEMENT_ID, sim.clock.time).length).toBeGreaterThan(0);
      expect(countries.currencyOfCountry(countryId, sim.clock.time)?.code).toBe("AUR");
      expect(
        countries.resolveRule(DEFAULT_BORDER_ACCESS_RULE_KEY, [countries.worldScope()], sim.clock.time),
      ).toBeDefined();
    });

    // Re-seeding adds no duplicate network: the M4 systems are idempotent.
    seedPlayableSlice(sim);
    sim.guard.mutate("infrastructure", () => {
      expect(new InfrastructureEngine(sim.scope, sim.world).assets()).toHaveLength(
        AURELIA_SLICE_ASSET_COUNT,
      );
    });
  });

  it("brings up the M5 commercial slice for the seeded world (M5)", () => {
    const { sim } = newSeededWorld();

    // System 33 over System 32: the slice's businesses exist, each with the
    // organization behind it, and the capacity model names the constraint the
    // content actually authored.
    sim.guard.mutate("businesses", () => {
      const businesses = new BusinessesEngine(sim.scope, sim.world);
      expect(businesses.all()).toHaveLength(AURELIA_SLICE_BUSINESS_COUNT);
      expect(businesses.trading()).toHaveLength(AURELIA_SLICE_BUSINESS_COUNT);
      expect(businesses.business("ORG-QUAY-CAFE")?.organizationId).toBe("ORG-QUAY-CAFE");
      expect(businesses.organizationOf("ORG-QUAY-CAFE")?.type).toBe("commercial");
      expect(businesses.bindingConstraint("ORG-QUAY-CAFE").dimension).toBe("capital"); // lowest authored dimension (capital 0.55)
      // Suppliers are real slice businesses, so System 34's graph is not a
      // list of dangling ids.
      for (const business of businesses.all()) {
        for (const supplierId of business.supplierIds) {
          expect(businesses.business(supplierId)).toBeDefined();
        }
      }
    });

    // System 34 stands the same commerce up as a dependency network: every
    // supplier offer and standing requirement the slice trades on.
    sim.guard.mutate("supplyChains", () => {
      const chains = new SupplyChainsEngine(sim.scope, sim.world);
      expect(chains.offers()).toHaveLength(AURELIA_SLICE_OFFER_COUNT);
      expect(chains.dependencies()).toHaveLength(AURELIA_SLICE_DEPENDENCY_COUNT);
      for (const dependency of chains.dependencies()) {
        expect(chains.offer(dependency.supplierId, dependency.inputId)).toBeDefined();
      }
    });

    // Re-seeding adds no duplicate commerce either.
    seedPlayableSlice(sim);
    sim.guard.mutate("businesses", () => {
      expect(new BusinessesEngine(sim.scope, sim.world).all()).toHaveLength(
        AURELIA_SLICE_BUSINESS_COUNT,
      );
    });
    sim.guard.mutate("supplyChains", () => {
      const chains = new SupplyChainsEngine(sim.scope, sim.world);
      expect(chains.offers()).toHaveLength(AURELIA_SLICE_OFFER_COUNT);
      expect(chains.dependencies()).toHaveLength(AURELIA_SLICE_DEPENDENCY_COUNT);
    });
  });
});
