/**
 * System 07 — scale: deterministic materialization of an abstract population
 * into individuals with established lives (identity, household, legal
 * records), idempotent re-materialization, and save/load continuity.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation, loadKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { materializeSettlement } from "../../src/engine/scale/materialize.ts";
import { ScaleEngine, DEFAULT_AGE_STRUCTURE } from "../../src/engine/scale/engine.ts";
import type { AgeBand } from "../../src/engine/scale/types.ts";
import { IdentityEngine } from "../../src/engine/identity/engine.ts";
import { LegalIdentityEngine } from "../../src/engine/legalIdentity/engine.ts";
import { FamilyEngine } from "../../src/engine/family/engine.ts";
import { GeographyEngine } from "../../src/engine/geography/engine.ts";
import {
  M2_SETTLEMENT_ID,
  registerAureliaSliceGeography,
} from "../../src/content/aurelia/geography.ts";
import { asEntityId } from "../../src/engine/primitives/ids.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";

const SEED = "reellife-scale-seed";
const TOTAL = 50_000;
const TARGET = 300;

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
}

function seedGeography(sim: Simulation): void {
  sim.guard.mutate("geography", () => {
    registerAureliaSliceGeography(new GeographyEngine(sim.scope, sim.world));
  });
}

function materialize(sim: Simulation, targetCount: number) {
  return materializeSettlement(sim, {
    settlementId: M2_SETTLEMENT_ID,
    totalPopulation: TOTAL,
    targetCount,
    now: sim.clock.time,
  });
}

function residentsOf(sim: Simulation) {
  return new ScaleEngine(sim.scope, sim.world).residentsAt(M2_SETTLEMENT_ID);
}

describe("scale materialization (System 07)", () => {
  it("reveals residents from the aggregate with identity, household and legal records", () => {
    const sim = newWorld();
    seedGeography(sim);
    const personIds = materialize(sim, TARGET);

    expect(personIds).toHaveLength(TARGET);
    expect(new Set(personIds).size).toBe(TARGET);

    // The aggregate is the low-resolution truth: revealing lives does not grow it.
    const scale = new ScaleEngine(sim.scope, sim.world);
    expect(scale.aggregateFor(M2_SETTLEMENT_ID)?.totalPopulation).toBe(TOTAL);
    expect(scale.countMaterialized(M2_SETTLEMENT_ID)).toBe(TARGET);

    // Every resident is anchored in place, in a household, with an age band.
    const residents = residentsOf(sim);
    expect(residents).toHaveLength(TARGET);
    for (const resident of residents) {
      expect(resident.settlementId).toBe(M2_SETTLEMENT_ID);
      expect(resident.householdId).toBeTruthy();
      expect(DEFAULT_AGE_STRUCTURE.map((band) => band.band)).toContain(resident.ageBand);
    }

    // Age bands follow the declared structure: every band appears, and each
    // count stays near its share (loose bounds catch broken weighting only).
    const counts = new Map<AgeBand, number>();
    for (const resident of residents) {
      counts.set(resident.ageBand, (counts.get(resident.ageBand) ?? 0) + 1);
    }
    expect(counts.size).toBe(DEFAULT_AGE_STRUCTURE.length);
    for (const { band, share } of DEFAULT_AGE_STRUCTURE) {
      const observed = counts.get(band) ?? 0;
      expect(observed).toBeGreaterThan(TARGET * share * 0.5);
      expect(observed).toBeLessThan(TARGET * share * 1.6);
    }

    // Identity: full person records, canon origin, distinct appearance seeds.
    const identity = new IdentityEngine(sim.scope, sim.world);
    expect(identity.all()).toHaveLength(TARGET);
    const first = identity.get(personIds[0]);
    expect(first?.origin).toMatchObject({
      birthplaceId: M2_SETTLEMENT_ID,
      nationalityId: "COUNTRY-ARDIN",
    });
    expect(first?.appearanceFoundationSeed).toBe(`${M2_SETTLEMENT_ID}:appearance:0`);

    // Legal identity: one birth registration per resident, unique identifiers.
    const legal = new LegalIdentityEngine(sim.scope, sim.world);
    expect(legal.all()).toHaveLength(TARGET);
    const identifiers = legal.all().map((record) => record.identifier);
    expect(new Set(identifiers).size).toBe(TARGET);
    for (const personId of personIds) {
      expect(legal.ofType(personId, "birthRegistration")).toHaveLength(1);
    }

    // Family: every household sits in the settlement and has a head.
    const family = new FamilyEngine(sim.scope, sim.world);
    const household = family.householdForPerson(personIds[0]);
    expect(household?.residenceLocationId).toBe(M2_SETTLEMENT_ID);
    expect(household?.members.some((member) => member.role === "head")).toBe(true);
    expect(sim.dispatcher.unhandledConsequenceTypes.size).toBe(0);
  });

  it("same seed materializes the identical population and state hash", () => {
    const first = newWorld();
    seedGeography(first);
    const firstIds = materialize(first, TARGET);

    const second = newWorld();
    seedGeography(second);
    const secondIds = materialize(second, TARGET);

    expect(secondIds).toEqual(firstIds);
    expect(second.stateHash()).toBe(first.stateHash());
  });

  it("re-materialization restores the same lives instead of inventing new ones", () => {
    const sim = newWorld();
    seedGeography(sim);
    const original = materialize(sim, TARGET);
    const hashAfterFirst = sim.stateHash();

    // Same target: no new draws, no new people, no state change at all.
    const again = materialize(sim, TARGET);
    expect(again).toEqual(original);
    expect(sim.stateHash()).toBe(hashAfterFirst);
    expect(new IdentityEngine(sim.scope, sim.world).all()).toHaveLength(TARGET);

    // Raising the target extends the same population; earlier lives are stable.
    const extended = materialize(sim, TARGET + 100);
    expect(extended.slice(0, TARGET)).toEqual(original);
    expect(extended).toHaveLength(TARGET + 100);
    expect(new IdentityEngine(sim.scope, sim.world).all()).toHaveLength(TARGET + 100);
    expect(new LegalIdentityEngine(sim.scope, sim.world).all()).toHaveLength(TARGET + 100);
    // The aggregate still refuses to grow beyond its declared truth.
    expect(new ScaleEngine(sim.scope, sim.world).aggregateFor(M2_SETTLEMENT_ID)?.totalPopulation).toBe(
      TOTAL,
    );
  });

  it("rejects unknown settlements, undeclared aggregates and impossible targets", () => {
    const sim = newWorld();
    seedGeography(sim);
    expect(() => materializeSettlement(sim, {
      settlementId: "CITY-GHOST",
      targetCount: 10,
      now: sim.clock.time,
    })).toThrow(/not registered/);
    expect(() => materializeSettlement(sim, {
      settlementId: M2_SETTLEMENT_ID,
      targetCount: 10,
      now: sim.clock.time,
    })).toThrow(/totalPopulation required/);
    expect(() => materialize(sim, TOTAL + 1)).toThrow(/exceeds aggregate/);
  });

  it("the materialized world survives save/load across every owning system", async () => {
    const sim = newWorld();
    seedGeography(sim);
    materialize(sim, 50);

    const saved = sim.dispatcher.dispatch(
      sim.dispatcher.createCommand(
        "world.save",
        asEntityId<"person">("PER-000001"),
        { slotName: "slot-scale" },
        "player",
      ),
    );
    expect(saved.status).toBe("applied");
    await sim.awaitPendingSaves();

    const reloaded = await loadKernelSimulation({
      masterSeed: SEED,
      checkInvariants: true,
      saveStore: sim.saveStore,
      slotName: "slot-scale",
    });

    expect(new ScaleEngine(reloaded.scope, reloaded.world).countMaterialized(M2_SETTLEMENT_ID)).toBe(50);
    expect(new ScaleEngine(reloaded.scope, reloaded.world).aggregateFor(M2_SETTLEMENT_ID)?.totalPopulation).toBe(TOTAL);
    expect(new IdentityEngine(reloaded.scope, reloaded.world).all()).toHaveLength(50);
    expect(new LegalIdentityEngine(reloaded.scope, reloaded.world).all()).toHaveLength(50);
    expect(
      (reloaded.world.systems.family as { households: readonly unknown[] } | undefined)?.households
        .length,
    ).toBeGreaterThan(0);
    expect(
      (reloaded.world.systems.geography as { places: readonly unknown[] } | undefined)?.places,
    ).toHaveLength(5);
    // Lives and their identifiers come back identical, not re-derived.
    const originalIds = residentsOf(sim).map((resident) => resident.personId);
    const reloadedIds = new ScaleEngine(reloaded.scope, reloaded.world)
      .residentsAt(M2_SETTLEMENT_ID)
      .map((resident) => resident.personId);
    expect(reloadedIds).toEqual(originalIds);
  });
});
