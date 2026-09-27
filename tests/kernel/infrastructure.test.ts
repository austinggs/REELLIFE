/**
 * System 38 — infrastructure operations: network capacity, maintenance,
 * outages, cascades and repair sequencing.
 *
 * Every behaviour below is one the spec names — capacity thresholds,
 * upstream/downstream failures, maintenance backlog, repair constraints,
 * redundancy and recovery sequencing — and every claim is checked against
 * observed engine state rather than a re-implementation of it.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import { InfrastructureEngine, repairCeiling } from "../../src/engine/infrastructure/engine.ts";
import {
  CAPACITY_THRESHOLDS,
  CONDITION_THRESHOLDS,
  REPAIR_REQUIREMENTS,
  type InfrastructureAsset,
  type RepairRequirement,
} from "../../src/engine/infrastructure/types.ts";
import {
  AURELIA_SLICE_ASSET_COUNT,
  aureliaInfrastructureAssets,
  registerAureliaInfrastructure,
} from "../../src/content/aurelia/infrastructure.ts";
import { M2_SETTLEMENT_ID } from "../../src/content/aurelia/geography.ts";
import { addTime, atTime, days } from "../../src/engine/primitives/time.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";

const SEED = "reellife-infrastructure-seed";
const NOW = addTime(atTime(0), days(10 * 365));

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
}

function withInfrastructure<T>(sim: Simulation, fn: (engine: InfrastructureEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("infrastructure", () => {
    result = fn(new InfrastructureEngine(sim.scope, sim.world));
  });
  return result;
}

function registered(engine: InfrastructureEngine): InfrastructureEngine {
  registerAureliaInfrastructure(engine, M2_SETTLEMENT_ID, NOW);
  return engine;
}

function assetOf(engine: InfrastructureEngine, id: string): InfrastructureAsset {
  const asset = engine.asset(id);
  if (asset === undefined) throw new Error(`test setup: asset ${id} is missing`);
  return asset;
}

describe("infrastructure network (System 38)", () => {
  it("registers the slice network with unique ids and an acyclic dependency order", () => {
    const sim = newWorld();
    withInfrastructure(sim, (engine) => {
      registered(engine);
      const assets = engine.assets();
      expect(assets).toHaveLength(AURELIA_SLICE_ASSET_COUNT);
      expect(new Set(assets.map((asset) => asset.id)).size).toBe(assets.length);
      // Dependencies always precede their dependents in the authored list,
      // which is what makes the cascade graph acyclic by construction.
      const position = new Map(assets.map((asset, index) => [asset.id, index]));
      for (const asset of assets) {
        for (const dependencyId of asset.dependencies) {
          expect(position.get(dependencyId)).toBeLessThan(position.get(asset.id) ?? Infinity);
          expect(engine.asset(dependencyId)).toBeDefined();
        }
      }
      // Every asset sits inside the slice city.
      for (const asset of assets) {
        expect(asset.locationId).toBe(M2_SETTLEMENT_ID);
      }
      // Re-registering is a no-op, never a duplicate.
      registered(engine);
      expect(engine.assets()).toHaveLength(AURELIA_SLICE_ASSET_COUNT);
    });
  });

  it("derives capacity states from demand, and service status from condition", () => {
    const sim = newWorld();
    withInfrastructure(sim, (engine) => {
      registered(engine);
      // The one adversarial asset in the slice content: demand already exceeds design.
      const junction = assetOf(engine, "INFRA-ARDEN-ROAD-RING-JUNCTION");
      expect(engine.capacityStateOf(junction)).toBe("overloaded");
      expect(engine.overloaded().map((asset) => asset.id)).toEqual([junction.id]);

      // Driven to the boundary values, the states read exactly the vocabulary:
      // underused ≤ 0.5, normal ≤ 0.85, congested ≤ 1, overloaded above it.
      expect(engine.capacityStateOf(engine.setDemand(junction.id, CAPACITY_THRESHOLDS.underused))).toBe("underused");
      expect(engine.capacityStateOf(engine.setDemand(junction.id, CAPACITY_THRESHOLDS.normal))).toBe("normal");
      expect(engine.capacityStateOf(engine.setDemand(junction.id, CAPACITY_THRESHOLDS.congested))).toBe("congested");
      expect(engine.capacityStateOf(engine.setDemand(junction.id, CAPACITY_THRESHOLDS.congested + 0.01))).toBe("overloaded");

      const pump = assetOf(engine, "INFRA-ARDEN-WATER-PUMP-SOUTH");
      expect(engine.serviceStatusOf(pump)).toBe("operational");
      expect(engine.serviceStatusOf(engine.setCondition(pump.id, CONDITION_THRESHOLDS.degraded))).toBe("degraded");
      expect(engine.serviceStatusOf(engine.setCondition(pump.id, CONDITION_THRESHOLDS.failed))).toBe("failed");
      // A failed fabric reports a failed capacity no matter the demand.
      expect(engine.capacityStateOf(engine.asset(pump.id) as InfrastructureAsset)).toBe("failed");
      expect(engine.overloaded().map((asset) => asset.id)).not.toContain(pump.id);
    });
  });

  it("rejects invalid definitions: duplicates, unknown/self dependencies, bad ratios", () => {
    const sim = newWorld();
    withInfrastructure(sim, (engine) => {
      registered(engine);
      const template = assetOf(engine, "INFRA-ARDEN-WASTE-DEPOT");
      expect(() => engine.defineAsset({ ...template, id: "INFRA-ARDEN-NEW", dependencies: ["INFRA-NOPE"] })).toThrow(
        /upstream asset must be defined first/,
      );
      expect(() => engine.defineAsset({ ...template, id: "INFRA-ARDEN-SELF", dependencies: ["INFRA-ARDEN-SELF"] })).toThrow(
        /depends on itself/,
      );
      expect(() => engine.defineAsset({ ...template })).toThrow(/duplicate asset id/);
      expect(() => engine.setDemand(template.id, -0.1)).toThrow(/non-negative/);
      expect(() => engine.setDemand(template.id, Number.NaN)).toThrow(/non-negative/);
      expect(() => engine.setCondition(template.id, 1.1)).toThrow(/\[0, 1\]/);
      expect(() => engine.setCondition(template.id, -0.1)).toThrow(/\[0, 1\]/);
    });
  });

  it("tracks maintenance: windows, backlog decay and due dates", () => {
    const sim = newWorld();
    withInfrastructure(sim, (engine) => {
      registered(engine);
      const pump = assetOf(engine, "INFRA-ARDEN-WATER-PUMP-SOUTH");
      expect(pump.maintenance.deferredPeriods).toBe(0);

      // One missed window: backlog grows and the fabric loses a little.
      const deferred = engine.deferMaintenance({ assetId: pump.id, at: NOW });
      expect(deferred.maintenance.deferredPeriods).toBe(1);
      expect(deferred.condition).toBeLessThan(pump.condition);
      expect(engine.maintenanceDue(addTime(NOW, days(400)))).toContainEqual(
        expect.objectContaining({ id: pump.id }),
      );

      // One completed window: condition improves and the backlog clears.
      const serviced = engine.recordMaintenance({ assetId: pump.id, at: NOW, nextDueAt: NOW });
      expect(serviced.maintenance.deferredPeriods).toBe(0);
      expect(serviced.condition).toBeGreaterThan(deferred.condition);
      expect(serviced.maintenance.lastServicedAt).toBe(NOW);
    });
  });

  it("runs the outage lifecycle: cause, requirement gates, clamped progress, close", () => {
    const sim = newWorld();
    withInfrastructure(sim, (engine) => {
      registered(engine);
      const works = assetOf(engine, "INFRA-ARDEN-WATER-TREATMENT-WORKS");

      const outage = engine.raiseOutage({ assetId: works.id, cause: "equipment_failure", at: NOW });
      expect(outage.id).toBe(`OUT-${works.id}-001`);
      expect(engine.asset(works.id)?.outageId).toBe(outage.id);
      expect(engine.serviceStatusOf(engine.asset(works.id) as InfrastructureAsset)).toBe("outage");
      expect(() => engine.raiseOutage({ assetId: works.id, cause: "overload", at: NOW })).toThrow(
        /already has an open outage/,
      );

      // Requirements are met in the spec's order — no skipping ahead.
      expect(() => engine.meetRequirement(outage.id, "materials")).toThrow(/workers must be met before materials/);
      const withWorkers = engine.meetRequirement(outage.id, "workers");
      expect(withWorkers.metRequirements).toEqual(["workers"]);

      // Progress is clamped to what is met: with only workers, repairs stall
      // at the equipment milestone (0.3) even when the caller asks for more.
      const stalled = engine.advanceRepair({ outageId: outage.id, at: NOW, progress: 0.9 });
      expect(stalled.recoveryProgress).toBeCloseTo(0.3, 6);

      // Meeting everything unclamps progress and reaching 1 closes the outage.
      let current: string = withWorkers.id;
      for (const requirement of REPAIR_REQUIREMENTS.slice(1) as readonly RepairRequirement[]) {
        current = engine.meetRequirement(current, requirement).id;
      }
      expect(repairCeiling(engine.outage(current)?.metRequirements ?? [])).toBe(1);
      const closed = engine.advanceRepair({ outageId: current, at: NOW, progress: 1 });
      expect(closed.endedAt).toBe(NOW);
      expect(closed.recoveryProgress).toBe(1);
      expect(engine.asset(works.id)?.outageId).toBeUndefined();
      expect(engine.openOutages()).toHaveLength(0);
      // The closed outage is kept as history, not deleted.
      expect(engine.outagesOf(works.id)).toHaveLength(1);
      expect(() => engine.advanceRepair({ outageId: current, at: NOW, progress: 1 })).toThrow(/already ended/);
    });
  });

  it("cascades downstream through the dependency graph, stopping at redundancy", () => {
    const sim = newWorld();
    withInfrastructure(sim, (engine) => {
      registered(engine);

      // The east substation feeds the water works, the south pump and the
      // sanitation works — but sanitation is redundant and stops the failure.
      const east = assetOf(engine, "INFRA-ARDEN-POWER-SUBSTATION-EAST");
      const cascade = engine.cascadeFrom(east.id).map((asset) => asset.id);
      expect(cascade).toContain("INFRA-ARDEN-WATER-TREATMENT-WORKS");
      expect(cascade).toContain("INFRA-ARDEN-WATER-PUMP-SOUTH");
      expect(cascade).toContain("INFRA-ARDEN-DISTRICT-HOSPITAL");
      expect(cascade).toContain("INFRA-ARDEN-RAIL-TERMINUS");
      expect(cascade).not.toContain("INFRA-ARDEN-SANITATION-WORKS");
      // Breadth-first and deterministic: the same query twice, same list.
      expect(engine.cascadeFrom(east.id).map((asset) => asset.id)).toEqual(cascade);

      // The north substation's cascade is small: the water works only, then the
      // hospital fed off the works, then the pump fed off the hospital's
      // eastern feeder. (The rail terminus never appears: its only feeder is
      // the east substation, which did not fail.)
      expect(
        engine.cascadeFrom("INFRA-ARDEN-POWER-SUBSTATION-NORTH").map((asset) => asset.id),
      ).toEqual([
        "INFRA-ARDEN-WATER-TREATMENT-WORKS",
        "INFRA-ARDEN-DISTRICT-HOSPITAL",
        "INFRA-ARDEN-WATER-PUMP-SOUTH",
      ]);

      // Propagation raises one outage per affected asset, reusing the cause.
      engine.raiseOutage({ assetId: east.id, cause: "disaster", at: NOW });
      const downstream = engine.propagateOutage({ assetId: east.id, at: NOW });
      expect(downstream.map((outage) => outage.assetId).sort()).toEqual([...cascade].sort());
      for (const record of downstream) {
        expect(record.cause).toBe("disaster");
        expect(record.note).toBe(`Cascade from ${east.id}`);
      }
      // A second propagation is a no-op: every affected asset already has one.
      expect(engine.propagateOutage({ assetId: east.id, at: NOW })).toHaveLength(0);
      // Propagation refuses to invent a cause where none exists.
      expect(() => engine.propagateOutage({ assetId: "INFRA-ARDEN-WASTE-DEPOT", at: NOW })).toThrow(
        /no open outage/,
      );
    });
  });

  it("keeps infrastructure under single ownership and visible in the save format", () => {
    const sim = newWorld();
    withInfrastructure(sim, (engine) => {
      registered(engine);
      expect(() => engine.defineAsset(assetOf(engine, "INFRA-ARDEN-WASTE-DEPOT"))).toThrow(
        /duplicate asset id/,
      );
    });
    // Reads do not need a writer; writes do, and the wrong system is refused.
    expect(() => {
      new InfrastructureEngine(sim.scope, sim.world).defineAsset(
        aureliaInfrastructureAssets(M2_SETTLEMENT_ID, NOW)[0] as InfrastructureAsset,
      );
    }).toThrow(MissingWriterContextError);
    expect(() => {
      sim.guard.mutate("geography", () => {
        new InfrastructureEngine(sim.scope, sim.world).defineAsset({
          ...(aureliaInfrastructureAssets(M2_SETTLEMENT_ID, NOW)[0] as InfrastructureAsset),
          id: "INFRA-ARDEN-PROBE",
        });
      });
    }).toThrow(OwnershipViolationError);

    // The state is carried in the native save document (System 06).
    const serialized = sim.serializedWorld();
    const bag = (serialized as { readonly systems?: Record<string, unknown> }).systems;
    expect(bag?.["infrastructure"]).toBeDefined();
    const state = bag?.["infrastructure"] as {
      assets: readonly { id: string }[];
      outages: readonly unknown[];
    };
    expect(state.assets).toHaveLength(AURELIA_SLICE_ASSET_COUNT);
    expect(state.outages).toHaveLength(0);
  });
});
