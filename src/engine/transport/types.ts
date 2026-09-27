/**
 * System 28 — Transportation & Vehicles.
 *
 * "Transportation provides real mobility capability; it is not a
 * teleportation layer" (System 28 core principle).
 *
 * The boundary with the systems around it is the important part:
 *
 *   1. **Routes are System 45's.** `TransportRoute` (mode, distance, base
 *      duration, base cost) lives in `travel/types.ts` and is not restated
 *      here. This system holds the *vehicles* that run those routes, the
 *      *services* that sell seats on them, and the condition-derived
 *      cost/risk/duration inputs a journey is finally weighed against.
 *   2. **Weather, traffic, accidents and closures are conditions, not
 *      verdicts.** A disruption is an explicit record with a cause someone
 *      raised; a breakdown is derived from condition; a cancellation is
 *      what a caller does with a disruption. Nothing here invents a road
 *      closure the world did not report.
 *   3. **Capability is not ownership.** A vehicle carries an owner, an
 *      operator and a location independently, so a hired lorry, a company
 *      car and a public bus are all representable without pretending any of
 *      them is a person.
 *
 * Money is System 25's: fares and costs here are amounts, and the caller
 * posts the ledger entry.
 */

import type { Money } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { TransportMode } from "../travel/types.ts";

/** Vehicle classes the engine models (System 28 model). */
export const VEHICLE_KINDS = [
  "bicycle",
  "motorcycle",
  "car",
  "van",
  "truck",
  "bus",
  "train",
  "ship",
  "aircraft",
  "taxi",
] as const;
export type VehicleKind = (typeof VEHICLE_KINDS)[number];

/** A vehicle's own state; a breakdown is derived, never stored. */
export type VehicleStatus = "operational" | "in_maintenance";

export interface VehicleRegistration {
  readonly at: WorldTime;
  /** Person or organization id of the registered owner. */
  readonly ownerId: string;
  readonly note?: string;
}

export interface VehicleMaintenanceEntry {
  readonly at: WorldTime;
  readonly kind: "service" | "repair";
  readonly note?: string;
}

/** One vehicle instance: the spec's "not a teleport layer" made concrete. */
export interface Vehicle {
  readonly id: string;
  readonly kind: VehicleKind;
  /** System 45's mode this vehicle runs (a bus runs `road`, a ship `maritime`). */
  readonly mode: TransportMode;
  /** Owner: a person or an organization. Capability is not ownership. */
  readonly ownerId: string;
  /** Operator organization when it differs from the owner (hired, franchised). */
  readonly operatorOrgId?: string;
  readonly locationId: string;
  /** Mechanical condition, 0..1. Drives breakdown risk and ride quality. */
  readonly condition: number;
  readonly status: VehicleStatus;
  /** Passenger or cargo capacity in units. */
  readonly capacityUnits: number;
  /** Current fuel/charge on board, and the tank/hold it started with. */
  readonly energyUnits: number;
  readonly energyCapacityUnits: number;
  /** Units of distance available per unit of energy. */
  readonly efficiencyUnitsPerEnergy: number;
  readonly registeredAt: WorldTime;
  readonly registrations: readonly VehicleRegistration[];
  readonly maintenance: readonly VehicleMaintenanceEntry[];
}

/** A public transport service selling seats on a System 45 route. */
export interface TransitService {
  readonly id: string;
  /** System 45's `TransportRoute.id`. This system never restates the route. */
  readonly routeId: string;
  readonly operatorOrgId: string;
  readonly mode: TransportMode;
  /** Stops in order; a service without stops is not a service. */
  readonly stopIds: readonly string[];
  readonly fare: Money;
  /** Seats offered per run. */
  readonly capacityUnits: number;
  /** Seats sold and not yet used on the current run. */
  readonly occupiedUnits: number;
  readonly running: boolean;
  readonly startedAt: WorldTime;
}

/** Disruption causes the spec names, plus the one a vehicle itself causes. */
export const DISRUPTION_CAUSES = [
  "breakdown",
  "road_closure",
  "accident",
  "cancellation",
  "fuel_shortage",
  "weather",
] as const;
export type DisruptionCause = (typeof DISRUPTION_CAUSES)[number];

export interface Disruption {
  readonly id: string;
  readonly cause: DisruptionCause;
  /** A vehicle id or a service id; 28 records the fact, not a road's fate. */
  readonly targetId: string;
  readonly at: WorldTime;
  /** Minutes the disruption is expected to last. */
  readonly durationMinutes: number;
  readonly note?: string;
  /** Set when the disruption stops applying. */
  readonly resolvedAt?: WorldTime;
}

export interface TransportSystemState {
  readonly vehicles: readonly Vehicle[];
  readonly services: readonly TransitService[];
  readonly disruptions: readonly Disruption[];
}

/**
 * Named factors layered over System 45's route (provisional; see
 * docs/CONTENT_GAPS.md). Every one is either derived from a vehicle's own
 * facts or supplied by the caller who owns that truth — the engine never
 * rolls a number it cannot name.
 */
export const TRANSPORT_FACTORS = {
  /** Ride time at zero condition, relative to a sound vehicle. */
  worstConditionTimeFactor: 1.8,
  /** Cost per unit of distance at zero condition, relative to a sound one. */
  worstConditionCostFactor: 1.5,
  /** Breakdown chance for a full trip by a vehicle in zero condition. */
  baseBreakdownRisk: 0.4,
  /** A full-length route consumes this share of a full tank. */
  fullRouteEnergyShare: 0.35,
  /** Condition below which a vehicle is refused (a safety floor, not taste). */
  serviceableCondition: 0.25,
  /** Energy share below which a vehicle will not start. */
  minimumEnergyShare: 0.05,
} as const;

/** Everything a caller can tell the engine about conditions it owns. */
export interface TripConditions {
  /** 1 = normal pace, higher = slower (System 38/46 caller's traffic). */
  readonly trafficFactor?: number;
  /** 0..1 severity of weather, from System 46 by the caller's hand. */
  readonly weatherSeverity?: number;
}

/** The weighed result of "can this vehicle make this trip, and what does it cost". */
export interface TripEstimate {
  readonly vehicleId: string;
  readonly mode: TransportMode;
  readonly feasible: boolean;
  /** Minutes including condition, traffic and weather, rounded. */
  readonly durationMinutes: number;
  readonly cost: Money;
  /** 0..1 chance the trip fails, from condition, energy and conditions. */
  readonly risk: number;
  readonly reasons: readonly string[];
}

