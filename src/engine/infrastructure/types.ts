/**
 * System 38 — Infrastructure Operations.
 *
 * "Infrastructure is an operational network with capacity and failure modes,
 * not map decoration" (System 38 core principle).
 *
 * The system owns the *operations* of public and private networks: capacity,
 * condition, dependencies, users, maintenance, operational status, outages and
 * repair. It does **not** own geographic topology (System 37), construction
 * project detail, utility pricing as a whole (System 25) or individual travel
 * decisions (System 45) — those stay with their owners, and this state only
 * ever points at them by id.
 *
 * Two design choices are worth stating because they are what keep the system
 * honest:
 *
 *   1. **Status is derived, never stored twice.** An asset has condition,
 *      utilisation, maintenance backlog and (maybe) an open outage; its
 *      capacity state and service status are computed from those facts by
 *      `capacityStateOf` / `serviceStatusOf`. A stored `status` field could
 *      disagree with the numbers, so there isn't one.
 *   2. **Failures cascade explicitly.** A dependency edge is directional
 *      (downstream depends on upstream) and an asset declared `redundant` does
 *      not cascade, so failures travel the network the way the spec describes
 *      ("Network dependencies permit upstream/downstream failures") instead of
 *      a caller scripting each impacted system.
 */

import type { WorldTime } from "../primitives/time.ts";

/** Network kinds the engine models (World Build 01, 10 and 14). */
export const INFRASTRUCTURE_KINDS = [
  "water",
  "power",
  "sanitation",
  "waste",
  "telecom",
  "data",
  "road",
  "rail",
  "port",
  "airport",
  "bridge",
  "dam",
  "district_heating",
  "hospital_support",
  "emergency_services",
] as const;
export type InfrastructureKind = (typeof INFRASTRUCTURE_KINDS)[number];

/**
 * Capacity states (System 38 model). Derived from demand against design
 * capacity, so a congested asset is *shown* as congested rather than labelled.
 */
export const CAPACITY_STATES = ["underused", "normal", "congested", "overloaded", "failed"] as const;
export type CapacityState = (typeof CAPACITY_STATES)[number];

/** Service status (System 38 "operational status"). Derived, never stored. */
export const SERVICE_STATUSES = ["operational", "degraded", "failed", "outage"] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

/** Why an outage happened (System 38 rules: the list is the spec's own). */
export const OUTAGE_CAUSES = [
  "equipment_failure",
  "disaster",
  "overload",
  "maintenance",
  "conflict",
  "sabotage",
  "supply_shortage",
  "organizational_failure",
] as const;
export type OutageCause = (typeof OUTAGE_CAUSES)[number];

/**
 * What recovery needs, in the spec's own order ("Recovery needs workers,
 * equipment, resources, access, authority, and time"). Each requirement is
 * satisfied at a time, and recovery progress cannot advance past the unmet one
 * — which is how "repair constraints" become testable rather than decorative.
 */
export const REPAIR_REQUIREMENTS = [
  "workers",
  "equipment",
  "materials",
  "access",
  "authority",
  "funding",
] as const;
export type RepairRequirement = (typeof REPAIR_REQUIREMENTS)[number];

/** Maintenance history and backlog for one asset. */
export interface MaintenanceRecord {
  readonly lastServicedAt?: WorldTime;
  readonly nextDueAt?: WorldTime;
  /** How many service windows were missed. Backlog is the spec's own term. */
  readonly deferredPeriods: number;
  readonly note?: string;
}

/** One outage on one asset, with its repair progress keeping the stages in order. */
export interface OutageRecord {
  readonly id: string;
  readonly assetId: string;
  readonly cause: OutageCause;
  readonly startedAt: WorldTime;
  readonly endedAt?: WorldTime;
  /** Requirements already met, in the order they were met. Never contains gaps. */
  readonly metRequirements: readonly RepairRequirement[];
  /** Repair progress in [0, 1]; only advances while requirements allow it. */
  readonly recoveryProgress: number;
  readonly note?: string;
}

/**
 * One operational asset: a network node with capacity, condition, dependencies,
 * users, maintenance and an optional open outage.
 */
export interface InfrastructureAsset {
  readonly id: string;
  readonly name: string;
  readonly kind: InfrastructureKind;
  /** The System 37 place this asset physically serves from. */
  readonly locationId: string;
  /** System 32/33 operator, when one exists. */
  readonly operatorOrgId?: string;
  /**
   * Demand as a share of design capacity: 1 = exactly at capacity, > 1 =
   * overloaded. Kept as a ratio so capacity can change without rewriting it.
   */
  readonly capacityUtilisation: number;
  /** Physical condition in [0, 1]; 1 = as new, 0 = failed fabric. */
  readonly condition: number;
  /** Upstream asset ids this asset depends on (may be empty). */
  readonly dependencies: readonly string[];
  /** True when an alternative upstream keeps the asset serving during a cascade. */
  readonly redundant: boolean;
  /** People served, when the asset serves people rather than freight. */
  readonly usersServed?: number;
  readonly maintenance: MaintenanceRecord;
  /** The open outage, if there is one. Service status is derived from this. */
  readonly outageId?: string;
  readonly builtAt?: WorldTime;
  readonly provisional?: boolean;
  readonly note?: string;
}

export interface InfrastructureSystemState {
  readonly assets: readonly InfrastructureAsset[];
  readonly outages: readonly OutageRecord[];
}

/** Thresholds that turn numbers into the spec's capacity vocabulary. */
export const CAPACITY_THRESHOLDS = {
  /** At or below this utilisation an asset is underused. */
  underused: 0.5,
  /** At or below this utilisation an asset is normal. */
  normal: 0.85,
  /** At or below this utilisation an asset is congested; above it, overloaded. */
  congested: 1,
} as const;

/** Condition at or below which an asset is degraded, and then failed. */
export const CONDITION_THRESHOLDS = {
  degraded: 0.5,
  failed: 0.2,
} as const;
