/**
 * Infrastructure operations engine (System 38).
 *
 * Owns `systems.infrastructure`: the asset network, its condition, capacity,
 * dependencies, maintenance and outages. Every write asserts ownership on the
 * same slot; reads are scope-free. Nothing here reaches into other systems —
 * locations, operators and users are referenced by id, and downstream effects
 * travel out as return values the caller turns into events (System 38: failures
 * "generate Events with downstream effects rather than directly scripting every
 * impacted system").
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { WorldTime } from "../primitives/time.ts";
import {
  CAPACITY_THRESHOLDS,
  CONDITION_THRESHOLDS,
  REPAIR_REQUIREMENTS,
  type CapacityState,
  type InfrastructureAsset,
  type InfrastructureKind,
  type InfrastructureSystemState,
  type OutageCause,
  type OutageRecord,
  type RepairRequirement,
  type ServiceStatus,
} from "./types.ts";

/**
 * Progress each requirement unlocks, in the spec's own order ("workers,
 * equipment, resources, access, authority, and time"). Progress may reach, but
 * never exceed, the milestone of the first unmet requirement — so a repair that
 * has workers but no materials stalls at 0.5 rather than jumping to done.
 */
export const REPAIR_MILESTONES: Readonly<Record<RepairRequirement, number>> = {
  workers: 0,
  equipment: 0.3,
  materials: 0.5,
  access: 0.65,
  authority: 0.8,
  funding: 0.95,
};

/** How far repair progress may go, given the requirements already met. */
export function repairCeiling(metRequirements: readonly RepairRequirement[]): number {
  for (const requirement of REPAIR_REQUIREMENTS) {
    if (!metRequirements.includes(requirement)) return REPAIR_MILESTONES[requirement];
  }
  return 1;
}

/** Condition lost per deferred service window (provisional; see CONTENT_GAPS). */
export const DEFERRED_MAINTENANCE_CONDITION_LOSS = 0.02;
/** Condition recovered by one completed service window (provisional). */
export const MAINTENANCE_CONDITION_GAIN = 0.1;

export interface RaiseOutageInput {
  readonly assetId: string;
  readonly cause: OutageCause;
  readonly at: WorldTime;
  readonly note?: string;
}

export interface MaintenanceInput {
  readonly assetId: string;
  readonly at: WorldTime;
  /** When the next service window is due; omitted leaves the old date alone. */
  readonly nextDueAt?: WorldTime;
}

export class InfrastructureEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.infrastructure) {
      this.scope.assertOwner("infrastructure");
      this.world.systems.infrastructure = {
        assets: [],
        outages: [],
      } satisfies InfrastructureSystemState;
    }
  }

  private get state(): InfrastructureSystemState {
    return this.world.systems.infrastructure as InfrastructureSystemState;
  }

  private set state(value: InfrastructureSystemState) {
    this.world.systems.infrastructure = value;
  }

  // ---------------------------------------------------------------- reads ---

  assets(): readonly InfrastructureAsset[] {
    return this.state.assets;
  }

  asset(id: string): InfrastructureAsset | undefined {
    return this.state.assets.find((candidate) => candidate.id === id);
  }

  assetsAt(locationId: string): readonly InfrastructureAsset[] {
    return this.state.assets.filter((asset) => asset.locationId === locationId);
  }

  assetsOfKind(kind: InfrastructureKind): readonly InfrastructureAsset[] {
    return this.state.assets.filter((asset) => asset.kind === kind);
  }

  /** Direct upstream assets this asset depends on. */
  dependenciesOf(id: string): readonly InfrastructureAsset[] {
    const asset = this.asset(id);
    if (asset === undefined) return [];
    return asset.dependencies
      .map((dependencyId) => this.asset(dependencyId))
      .filter((candidate): candidate is InfrastructureAsset => candidate !== undefined);
  }

  /** Direct downstream assets that depend on this asset. Registration order. */
  dependentsOf(id: string): readonly InfrastructureAsset[] {
    return this.state.assets.filter((asset) => asset.dependencies.includes(id));
  }

  /**
   * Everything that would lose service if `id` failed: transitivity matters,
   * redundancy stops it. A `redundant` asset keeps serving through its other
   * upstream, so the failure does not travel past it (System 38 "redundancy").
   * Deterministic: breadth-first in registration order.
   */
  cascadeFrom(id: string): readonly InfrastructureAsset[] {
    const affected: InfrastructureAsset[] = [];
    const seen = new Set<string>([id]);
    let frontier = this.dependentsOf(id).filter((asset) => !asset.redundant);
    while (frontier.length > 0) {
      const next: InfrastructureAsset[] = [];
      for (const asset of frontier) {
        if (seen.has(asset.id)) continue;
        seen.add(asset.id);
        affected.push(asset);
        next.push(...this.dependentsOf(asset.id).filter((dependent) => !dependent.redundant));
      }
      frontier = next;
    }
    return affected;
  }

  openOutages(): readonly OutageRecord[] {
    return this.state.outages.filter((outage) => outage.endedAt === undefined);
  }

  outagesOf(assetId: string): readonly OutageRecord[] {
    return this.state.outages.filter((outage) => outage.assetId === assetId);
  }

  outage(id: string): OutageRecord | undefined {
    return this.state.outages.find((candidate) => candidate.id === id);
  }

  /** Assets at or above their design capacity (System 38 "congested/overloaded"). */
  overloaded(): readonly InfrastructureAsset[] {
    return this.state.assets.filter((asset) => this.capacityStateOf(asset) === "overloaded");
  }

  /** Assets whose maintenance is due at `at`. */
  maintenanceDue(at: WorldTime): readonly InfrastructureAsset[] {
    return this.state.assets.filter(
      (asset) => asset.maintenance.nextDueAt !== undefined && asset.maintenance.nextDueAt <= at,
    );
  }

  /** Service status, derived from condition and any open outage. Never stored. */
  serviceStatusOf(asset: InfrastructureAsset): ServiceStatus {
    if (this.openOutageOf(asset) !== undefined) return "outage";
    if (asset.condition <= CONDITION_THRESHOLDS.failed) return "failed";
    if (asset.condition <= CONDITION_THRESHOLDS.degraded) return "degraded";
    return "operational";
  }

  /** Capacity state, derived from demand and service status. Never stored. */
  capacityStateOf(asset: InfrastructureAsset): CapacityState {
    const status = this.serviceStatusOf(asset);
    if (status === "outage" || status === "failed") return "failed";
    if (asset.capacityUtilisation > CAPACITY_THRESHOLDS.congested) return "overloaded";
    if (asset.capacityUtilisation > CAPACITY_THRESHOLDS.normal) return "congested";
    if (asset.capacityUtilisation <= CAPACITY_THRESHOLDS.underused) return "underused";
    return "normal";
  }

  openOutageOf(asset: InfrastructureAsset): OutageRecord | undefined {
    return asset.outageId === undefined ? undefined : this.outage(asset.outageId);
  }

  // --------------------------------------------------------------- writes ---

  private requireAsset(id: string, caller: string): InfrastructureAsset {
    const asset = this.asset(id);
    if (asset === undefined) {
      throw new Error(`InfrastructureEngine.${caller}: asset ${id} is not defined`);
    }
    return asset;
  }

  private replaceAsset(next: InfrastructureAsset): InfrastructureAsset {
    this.state = {
      ...this.state,
      assets: this.state.assets.map((asset) => (asset.id === next.id ? next : asset)),
    };
    return next;
  }

  private replaceOutage(next: OutageRecord): OutageRecord {
    this.state = {
      ...this.state,
      outages: this.state.outages.map((outage) => (outage.id === next.id ? next : outage)),
    };
    return next;
  }

  /**
   * Defines an asset.
   *
   * Validation is what makes the network usable: ids are unique, ratios are in
   * range, and a dependency must *already exist*. Requiring dependencies to
   * precede their dependents is what makes the dependency graph acyclic by
   * construction (the same rule geography uses for parents), which in turn is
   * what lets cascades terminate.
   */
  defineAsset(asset: InfrastructureAsset): InfrastructureAsset {
    this.scope.assertOwner("infrastructure");
    if (!asset.id || asset.id.length === 0) {
      throw new Error("InfrastructureEngine.defineAsset: asset id is required");
    }
    if (this.asset(asset.id)) {
      throw new Error(`InfrastructureEngine.defineAsset: duplicate asset id ${asset.id}`);
    }
    if (!asset.locationId || asset.locationId.length === 0) {
      throw new Error(`InfrastructureEngine.defineAsset: ${asset.id} needs a locationId`);
    }
    requireNonNegative(asset.capacityUtilisation, "capacityUtilisation", "defineAsset");
    requireRatio(asset.condition, "condition", "defineAsset");
    if (!Number.isInteger(asset.maintenance.deferredPeriods) || asset.maintenance.deferredPeriods < 0) {
      throw new Error(
        `InfrastructureEngine.defineAsset: ${asset.id} deferredPeriods must be a non-negative integer`,
      );
    }
    for (const dependencyId of asset.dependencies) {
      if (dependencyId === asset.id) {
        throw new Error(`InfrastructureEngine.defineAsset: ${asset.id} depends on itself`);
      }
      if (this.asset(dependencyId) === undefined) {
        throw new Error(
          `InfrastructureEngine.defineAsset: dependency ${dependencyId} of ${asset.id} is not defined; an upstream asset must be defined first`,
        );
      }
    }
    this.state = { ...this.state, assets: [...this.state.assets, asset] };
    return asset;
  }

  /** Records a demand change. Capacity states are derived from this number. */
  setDemand(assetId: string, utilisation: number): InfrastructureAsset {
    this.scope.assertOwner("infrastructure");
    const asset = this.requireAsset(assetId, "setDemand");
    requireNonNegative(utilisation, "utilisation", "setDemand");
    return this.replaceAsset({ ...asset, capacityUtilisation: utilisation });
  }

  /** Records damage or repair of the fabric itself (0 = failed, 1 = as new). */
  setCondition(assetId: string, condition: number): InfrastructureAsset {
    this.scope.assertOwner("infrastructure");
    const asset = this.requireAsset(assetId, "setCondition");
    requireRatio(condition, "condition", "setCondition");
    return this.replaceAsset({ ...asset, condition });
  }

  /** Completes a service window: condition improves and the backlog clears. */
  recordMaintenance(input: MaintenanceInput): InfrastructureAsset {
    this.scope.assertOwner("infrastructure");
    const asset = this.requireAsset(input.assetId, "recordMaintenance");
    const nextDueAt = input.nextDueAt ?? asset.maintenance.nextDueAt;
    return this.replaceAsset({
      ...asset,
      condition: Math.min(1, asset.condition + MAINTENANCE_CONDITION_GAIN),
      maintenance: {
        lastServicedAt: input.at,
        ...(nextDueAt === undefined ? {} : { nextDueAt }),
        deferredPeriods: 0,
      },
    });
  }

  /**
   * Misses a service window. Deferral is a choice with a cost: the backlog
   * grows and the fabric loses a little condition (provisional figures, see
   * docs/CONTENT_GAPS.md).
   */
  deferMaintenance(input: MaintenanceInput): InfrastructureAsset {
    this.scope.assertOwner("infrastructure");
    const asset = this.requireAsset(input.assetId, "deferMaintenance");
    const nextDueAt = input.nextDueAt ?? asset.maintenance.nextDueAt;
    return this.replaceAsset({
      ...asset,
      condition: Math.max(0, asset.condition - DEFERRED_MAINTENANCE_CONDITION_LOSS),
      maintenance: {
        ...(asset.maintenance.lastServicedAt === undefined
          ? {}
          : { lastServicedAt: asset.maintenance.lastServicedAt }),
        ...(nextDueAt === undefined ? {} : { nextDueAt }),
        deferredPeriods: asset.maintenance.deferredPeriods + 1,
        ...(asset.maintenance.note === undefined ? {} : { note: asset.maintenance.note }),
      },
    });
  }

  /**
   * Raises an outage on an asset. The cause is required and comes from the
   * spec's own list — "equipment failure, disaster, overload, maintenance,
   * conflict, sabotage, supply shortage, or organizational failure" — so an
   * outage always has an explanation rather than a generic failure flag.
   */
  raiseOutage(input: RaiseOutageInput): OutageRecord {
    this.scope.assertOwner("infrastructure");
    const asset = this.requireAsset(input.assetId, "raiseOutage");
    if (this.openOutageOf(asset) !== undefined) {
      throw new Error(`InfrastructureEngine.raiseOutage: ${asset.id} already has an open outage`);
    }
    if (!REPAIR_REQUIREMENTS.length) {
      throw new Error("InfrastructureEngine.raiseOutage: repair requirements are not configured");
    }
    const sequence = this.state.outages.filter((outage) => outage.assetId === asset.id).length + 1;
    const outage: OutageRecord = {
      id: `OUT-${asset.id}-${String(sequence).padStart(3, "0")}`,
      assetId: asset.id,
      cause: input.cause,
      startedAt: input.at,
      metRequirements: [],
      recoveryProgress: 0,
      ...(input.note === undefined ? {} : { note: input.note }),
    };
    this.state = { ...this.state, outages: [...this.state.outages, outage] };
    this.replaceAsset({ ...asset, outageId: outage.id });
    return outage;
  }

  /**
   * Satisfies one repair requirement. Requirements are met in the spec's order
   * (workers, equipment, materials, access, authority, funding), so a repair
   * cannot claim materials before a crew exists.
   */
  meetRequirement(outageId: string, requirement: RepairRequirement): OutageRecord {
    this.scope.assertOwner("infrastructure");
    const outage = this.outage(outageId);
    if (outage === undefined) {
      throw new Error(`InfrastructureEngine.meetRequirement: unknown outage ${outageId}`);
    }
    if (outage.endedAt !== undefined) {
      throw new Error(`InfrastructureEngine.meetRequirement: outage ${outageId} has already ended`);
    }
    if (outage.metRequirements.includes(requirement)) {
      throw new Error(
        `InfrastructureEngine.meetRequirement: ${requirement} is already met for outage ${outageId}`,
      );
    }
    const index = REPAIR_REQUIREMENTS.indexOf(requirement);
    for (let earlier = 0; earlier < index; earlier += 1) {
      const prior = REPAIR_REQUIREMENTS[earlier];
      if (!outage.metRequirements.includes(prior)) {
        throw new Error(
          `InfrastructureEngine.meetRequirement: ${prior} must be met before ${requirement}`,
        );
      }
    }
    const merged = [...outage.metRequirements, requirement];
    return this.replaceOutage({
      ...outage,
      metRequirements: REPAIR_REQUIREMENTS.filter((candidate) => merged.includes(candidate)),
    });
  }

  /**
   * Moves repair progress. It is clamped to what the met requirements allow, so
   * recovery sequencing cannot be skipped; reaching 1 closes the outage and
   * clears the asset's outage reference in the same write.
   */
  advanceRepair(input: { readonly outageId: string; readonly at: WorldTime; readonly progress: number }): OutageRecord {
    this.scope.assertOwner("infrastructure");
    const outage = this.outage(input.outageId);
    if (outage === undefined) {
      throw new Error(`InfrastructureEngine.advanceRepair: unknown outage ${input.outageId}`);
    }
    if (outage.endedAt !== undefined) {
      throw new Error(`InfrastructureEngine.advanceRepair: outage ${input.outageId} has already ended`);
    }
    requireRatio(input.progress, "progress", "advanceRepair");
    const progress = Math.min(input.progress, repairCeiling(outage.metRequirements));
    const completed = progress >= 1;
    const updated = this.replaceOutage({
      ...outage,
      recoveryProgress: progress,
      ...(completed ? { endedAt: input.at } : {}),
    });
    if (completed) {
      const asset = this.requireAsset(outage.assetId, "advanceRepair");
      this.replaceAsset({ ...asset, outageId: undefined });
    }
    return updated;
  }

  /**
   * Propagates an existing outage down the network. Only cascades from a real
   * outage, and only to assets without redundancy — a caller cannot invent a
   * failure chain (System 38 "Network dependencies permit upstream/downstream
   * failures").
   */
  propagateOutage(input: {
    readonly assetId: string;
    readonly at: WorldTime;
    readonly cause?: OutageCause;
  }): readonly OutageRecord[] {
    this.scope.assertOwner("infrastructure");
    const source = this.requireAsset(input.assetId, "propagateOutage");
    const cause = input.cause ?? this.openOutageOf(source)?.cause;
    if (cause === undefined) {
      throw new Error(
        `InfrastructureEngine.propagateOutage: ${source.id} has no open outage, so there is no cause to propagate`,
      );
    }
    const created: OutageRecord[] = [];
    for (const affected of this.cascadeFrom(input.assetId)) {
      if (this.openOutageOf(affected) !== undefined) continue;
      created.push(
        this.raiseOutage({
          assetId: affected.id,
          cause,
          at: input.at,
          note: `Cascade from ${source.id}`,
        }),
      );
    }
    return created;
  }
}

// --------------------------------------------------------------- guards ---

function requireRatio(value: number, field: string, caller: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `InfrastructureEngine.${caller}: ${field} must be in [0, 1], received ${String(value)}`,
    );
  }
}

function requireNonNegative(value: number, field: string, caller: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `InfrastructureEngine.${caller}: ${field} must be a non-negative number, received ${String(value)}`,
    );
  }
}
