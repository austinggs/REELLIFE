/**
 * Transportation engine (System 28).
 *
 * Owns `systems.transport`: vehicle instances with their condition, energy,
 * capacity, owner/operator/location, registration and maintenance history;
 * public transport services with fares and seat capacity; and the
 * disruptions raised against them. Every write asserts ownership on that
 * slot; reads are scope-free.
 *
 * The engine holds no route of its own. A trip is weighed against a route
 * the caller passes in (System 45), and the engine contributes only what
 * the *vehicle* and the *service* know: whether it can go, how long it
 * takes in that condition, what it costs, and how likely it is to fail.
 * Whether anyone travels is System 17's decision and the journey itself is
 * System 45's.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { IdAllocator } from "../primitives/ids.ts";
import type { CurrencyId, Money } from "../primitives/money.ts";
import { currencyId, money } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { TransportRoute } from "../travel/types.ts";
import {
  DISRUPTION_CAUSES,
  TRANSPORT_FACTORS,
  VEHICLE_KINDS,
  type Disruption,
  type DisruptionCause,
  type TransitService,
  type TransportSystemState,
  type TripConditions,
  type TripEstimate,
  type Vehicle,
  type VehicleKind,
} from "./types.ts";

/** Provisional default currency for trip costs until System 39's pack lands. */
const AUR = currencyId("AUR");

export interface DefineVehicleRequest {
  readonly id: string;
  readonly kind: VehicleKind;
  readonly mode: Vehicle["mode"];
  readonly ownerId: string;
  readonly operatorOrgId?: string;
  readonly locationId: string;
  readonly condition?: number;
  readonly capacityUnits: number;
  readonly energyCapacityUnits: number;
  /** Full-tank range in distance units; engine use follows from it. */
  readonly rangeUnits: number;
  readonly note?: string;
}

export interface DefineServiceRequest {
  readonly id: string;
  readonly routeId: string;
  readonly operatorOrgId: string;
  readonly mode: Vehicle["mode"];
  readonly stopIds: readonly string[];
  readonly fare: Money;
  readonly capacityUnits: number;
}

export class TransportEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.transport) {
      this.scope.assertOwner("transport");
      this.world.systems.transport = {
        vehicles: [],
        services: [],
        disruptions: [],
      } satisfies TransportSystemState;
    }
  }

  private get state(): TransportSystemState {
    return this.world.systems.transport as TransportSystemState;
  }

  private set state(value: TransportSystemState) {
    this.world.systems.transport = value;
  }

  // ---------------------------------------------------------------- reads ---

  vehicles(): readonly Vehicle[] {
    return this.state.vehicles;
  }

  vehicle(id: string): Vehicle | undefined {
    return this.state.vehicles.find((candidate) => candidate.id === id);
  }

  requireVehicle(id: string, caller: string): Vehicle {
    const found = this.vehicle(id);
    if (found === undefined) {
      throw new Error(`TransportEngine.${caller}: unknown vehicle ${id}`);
    }
    return found;
  }

  /** Vehicles standing at a place, registration order. */
  vehiclesAt(locationId: string): readonly Vehicle[] {
    return this.state.vehicles.filter((vehicle) => vehicle.locationId === locationId);
  }

  vehiclesOfKind(kind: VehicleKind): readonly Vehicle[] {
    return this.state.vehicles.filter((vehicle) => vehicle.kind === kind);
  }

  /** Vehicles an owner holds, whatever kind they are. */
  vehiclesOwnedBy(ownerId: string): readonly Vehicle[] {
    return this.state.vehicles.filter((vehicle) => vehicle.ownerId === ownerId);
  }

  services(): readonly TransitService[] {
    return this.state.services;
  }

  service(id: string): TransitService | undefined {
    return this.state.services.find((candidate) => candidate.id === id);
  }

  requireService(id: string, caller: string): TransitService {
    const found = this.service(id);
    if (found === undefined) {
      throw new Error(`TransportEngine.${caller}: unknown service ${id}`);
    }
    return found;
  }

  servicesOn(routeId: string): readonly TransitService[] {
    return this.state.services.filter((candidate) => candidate.routeId === routeId);
  }

  disruptions(): readonly Disruption[] {
    return this.state.disruptions;
  }

  /** Disruptions that have not been resolved, in the order raised. */
  activeDisruptions(): readonly Disruption[] {
    return this.state.disruptions.filter((entry) => entry.resolvedAt === undefined);
  }

  /** Unresolved disruptions against one vehicle or service. */
  disruptionsOf(targetId: string): readonly Disruption[] {
    return this.activeDisruptions().filter((entry) => entry.targetId === targetId);
  }

  // -------------------------------------------------------------- derived ---

  /**
   * Whether a vehicle can be dispatched at all, with the reasons stated.
   * A vehicle below the serviceable-condition floor or without usable fuel
   * is not "risky" — it is not going, and saying otherwise would let a
   * caller treat a wreck as mobility.
   */
  dispatchable(id: string): { readonly dispatchable: boolean; readonly reasons: readonly string[] } {
    const vehicle = this.requireVehicle(id, "dispatchable");
    const reasons: string[] = [];
    if (vehicle.status === "in_maintenance") reasons.push("in maintenance");
    if (vehicle.condition < TRANSPORT_FACTORS.serviceableCondition) {
      reasons.push(`condition ${round2(vehicle.condition)} below the serviceable floor`);
    }
    if (this.energyShare(vehicle) < TRANSPORT_FACTORS.minimumEnergyShare) {
      reasons.push("not enough fuel or charge to start");
    }
    for (const disruption of this.disruptionsOf(id)) {
      reasons.push(`${disruption.cause} in force`);
    }
    return { dispatchable: reasons.length === 0, reasons };
  }

  /** Fraction of the tank/hold currently usable, 0..1. */
  energyShare(vehicle: Vehicle): number {
    if (vehicle.energyCapacityUnits <= 0) return 0;
    return vehicle.energyUnits / vehicle.energyCapacityUnits;
  }

  /**
   * How likely a trip is to fail, 0..1. Linear in how unsound and how
   * under-fuelled the vehicle is, and raised by the conditions the caller
   * reports. Deliberately derived from named facts — no hidden roll.
   */
  breakdownRisk(vehicle: Vehicle, conditions: TripConditions = {}): number {
    const unsound = 1 - vehicle.condition;
    const dry = 1 - this.energyShare(vehicle);
    const traffic = Math.max(0, (conditions.trafficFactor ?? 1) - 1);
    const weather = clamp01(conditions.weatherSeverity ?? 0);
    const risk =
      TRANSPORT_FACTORS.baseBreakdownRisk * unsound +
      0.2 * dry +
      0.1 * traffic +
      0.25 * weather;
    return round4(clamp01(risk));
  }

  /**
   * Weighs a trip: can this vehicle make it, how long, at what cost, and
   * with what risk. The route is System 45's baseline; this only layers
   * the vehicle's condition and the caller's conditions over it, and names
   * every reason behind the answer.
   */
  estimateTrip(
    route: TransportRoute,
    vehicle: Vehicle,
    conditions: TripConditions = {},
    currency: CurrencyId = AUR,
  ): TripEstimate {
    const reasons: string[] = [];
    const vehicleReasons = this.dispatchable(vehicle.id).reasons;
    reasons.push(...vehicleReasons);

    // Fuel: a full route costs a stated share of a full tank, so a long
    // route is exactly as fuel-hungry as it is long.
    const energyNeeded = vehicle.energyCapacityUnits * TRANSPORT_FACTORS.fullRouteEnergyShare;
    if (vehicle.energyUnits < energyNeeded) {
      reasons.push(
        `needs ${round2(energyNeeded)} energy for the route, has ${round2(vehicle.energyUnits)}`,
      );
    }

    const traffic = Math.max(0, (conditions.trafficFactor ?? 1) - 1);
    const weather = clamp01(conditions.weatherSeverity ?? 0);
    const conditionTime = 1 + (1 - vehicle.condition) * (TRANSPORT_FACTORS.worstConditionTimeFactor - 1);
    const duration = Math.round(route.durationMinutes * conditionTime * (1 + traffic) * (1 + weather));
    const conditionCost = 1 + (1 - vehicle.condition) * (TRANSPORT_FACTORS.worstConditionCostFactor - 1);
    const distanceCost = Math.round(route.costMinorUnits * conditionCost);
    // Per-unit operating cost, provisional: what a kilometre of fuel and
    // wear costs a sound vehicle, times how many units this one carries.
    const perUnitOperating = Math.max(1, Math.round(route.distanceKm * 0.02 * conditionCost));
    const cost = money(currency, distanceCost + perUnitOperating * vehicle.capacityUnits);

    return {
      vehicleId: vehicle.id,
      mode: vehicle.mode,
      feasible: reasons.length === 0,
      durationMinutes: duration,
      cost,
      risk: this.breakdownRisk(vehicle, conditions),
      reasons,
    };
  }

  /** Seats still available on a service's current run. */
  seatsAvailable(serviceId: string): number {
    const service = this.requireService(serviceId, "seatsAvailable");
    return Math.max(0, service.capacityUnits - service.occupiedUnits);
  }

  // --------------------------------------------------------------- writes ---

  /** Registers a vehicle, at full condition and a full tank by default. */
  defineVehicle(request: DefineVehicleRequest, at: WorldTime): Vehicle {
    this.scope.assertOwner("transport");
    if (!VEHICLE_KINDS.includes(request.kind)) {
      throw new Error(`TransportEngine.defineVehicle: unknown kind ${String(request.kind)}`);
    }
    if (this.vehicle(request.id) !== undefined) {
      throw new Error(`TransportEngine.defineVehicle: vehicle ${request.id} already exists`);
    }
    requireRatio(request.condition ?? 1, "condition", "defineVehicle");
    requireNonNegativeInteger(request.capacityUnits, "capacityUnits", "defineVehicle");
    requirePositiveInteger(request.energyCapacityUnits, "energyCapacityUnits", "defineVehicle");
    requirePositiveNumber(request.rangeUnits, "rangeUnits", "defineVehicle");
    const capacity = request.energyCapacityUnits;
    const vehicle: Vehicle = {
      id: request.id,
      kind: request.kind,
      mode: request.mode,
      ownerId: request.ownerId,
      ...(request.operatorOrgId === undefined ? {} : { operatorOrgId: request.operatorOrgId }),
      locationId: request.locationId,
      condition: request.condition ?? 1,
      status: "operational",
      capacityUnits: request.capacityUnits,
      energyUnits: capacity,
      energyCapacityUnits: capacity,
      efficiencyUnitsPerEnergy: request.rangeUnits / capacity,
      registeredAt: at,
      registrations: [{ at, ownerId: request.ownerId }],
      maintenance: [],
    };
    this.state = { ...this.state, vehicles: [...this.state.vehicles, vehicle] };
    return vehicle;
  }

  /**
   * Ownership changes are registrations, not overwrites: the previous
   * owner stays in the history, so a sold lorry can still be traced.
   */
  transferOwnership(id: string, ownerId: string, at: WorldTime, note?: string): Vehicle {
    this.scope.assertOwner("transport");
    const vehicle = this.requireVehicle(id, "transferOwnership");
    if (vehicle.ownerId === ownerId) {
      throw new Error(`TransportEngine.transferOwnership: ${id} already belongs to ${ownerId}`);
    }
    return this.replaceVehicle({
      ...vehicle,
      ownerId,
      registrations: [...vehicle.registrations, { at, ownerId, ...(note === undefined ? {} : { note }) }],
    });
  }

  /** Reassigns the operator without touching ownership (hire, franchise). */
  setOperator(id: string, operatorOrgId: string | undefined): Vehicle {
    this.scope.assertOwner("transport");
    const vehicle = this.requireVehicle(id, "setOperator");
    return this.replaceVehicle({
      ...vehicle,
      ...(operatorOrgId === undefined ? { operatorOrgId: undefined } : { operatorOrgId }),
    });
  }

  /** Where a vehicle stands. Travelling is System 45; this is bookkeeping. */
  moveVehicle(id: string, locationId: string): Vehicle {
    this.scope.assertOwner("transport");
    const vehicle = this.requireVehicle(id, "moveVehicle");
    return this.replaceVehicle({ ...vehicle, locationId });
  }

  /** Fuel or charge added; capped at the tank/hold it started with. */
  refuel(id: string, units: number): Vehicle {
    this.scope.assertOwner("transport");
    requirePositiveNumber(units, "units", "refuel");
    const vehicle = this.requireVehicle(id, "refuel");
    return this.replaceVehicle({
      ...vehicle,
      energyUnits: Math.min(vehicle.energyCapacityUnits, vehicle.energyUnits + units),
    });
  }

  /** Fuel or charge burnt on a trip, never below empty. */
  consumeEnergy(id: string, units: number): Vehicle {
    this.scope.assertOwner("transport");
    requireNonNegativeInteger(units, "units", "consumeEnergy");
    const vehicle = this.requireVehicle(id, "consumeEnergy");
    return this.replaceVehicle({
      ...vehicle,
      energyUnits: Math.max(0, vehicle.energyUnits - units),
    });
  }

  /**
   * Condition moves because something happened to the vehicle — wear,
   * damage, an accident. A vehicle that has crossed the serviceable floor
   * simply stops being dispatchable, which is *derived* from the number:
   * no stored `broken` flag can disagree with it.
   */
  setCondition(id: string, condition: number): Vehicle {
    this.scope.assertOwner("transport");
    requireRatio(condition, "condition", "setCondition");
    return this.replaceVehicle({ ...this.requireVehicle(id, "setCondition"), condition });
  }

  /**
   * Maintenance is a state and a record: the vehicle is in the workshop
   * (so it cannot be dispatched) until the work is finished, and the
   * history keeps when the work started.
   */
  beginMaintenance(id: string, at: WorldTime, kind: "service" | "repair" = "service"): Vehicle {
    this.scope.assertOwner("transport");
    const vehicle = this.requireVehicle(id, "beginMaintenance");
    if (vehicle.status === "in_maintenance") {
      throw new Error(`TransportEngine.beginMaintenance: ${id} is already in maintenance`);
    }
    return this.replaceVehicle({
      ...vehicle,
      status: "in_maintenance",
      maintenance: [...vehicle.maintenance, { at, kind }],
    });
  }

  /** Work finished: the vehicle returns to service with condition restored. */
  completeMaintenance(id: string, restoredCondition = 1): Vehicle {
    this.scope.assertOwner("transport");
    requireRatio(restoredCondition, "restoredCondition", "completeMaintenance");
    const vehicle = this.requireVehicle(id, "completeMaintenance");
    if (vehicle.status !== "in_maintenance") {
      throw new Error(`TransportEngine.completeMaintenance: ${id} is not in maintenance`);
    }
    return this.replaceVehicle({ ...vehicle, status: "operational", condition: restoredCondition });
  }

  /**
   * A public service on a System 45 route. The route itself is referenced,
   * never restated: if System 45 re-times or reroutes the line, 28 follows.
   */
  defineService(request: DefineServiceRequest, at: WorldTime): TransitService {
    this.scope.assertOwner("transport");
    if (this.service(request.id) !== undefined) {
      throw new Error(`TransportEngine.defineService: service ${request.id} already exists`);
    }
    if (request.stopIds.length < 2) {
      throw new Error(
        `TransportEngine.defineService: ${request.id} needs at least two stops, has ${request.stopIds.length}`,
      );
    }
    requirePositiveInteger(request.capacityUnits, "capacityUnits", "defineService");
    const service: TransitService = {
      id: request.id,
      routeId: request.routeId,
      operatorOrgId: request.operatorOrgId,
      mode: request.mode,
      stopIds: [...request.stopIds],
      fare: request.fare,
      capacityUnits: request.capacityUnits,
      occupiedUnits: 0,
      running: true,
      startedAt: at,
    };
    this.state = { ...this.state, services: [...this.state.services, service] };
    return service;
  }

  /**
   * Sells a seat. Capacity is the spec's "public transit capacity": a full
   * bus refuses rather than overbooking, because the alternative is a
   * teleport layer with a ticket.
   */
  boardService(serviceId: string, units: number): TransitService {
    this.scope.assertOwner("transport");
    requirePositiveInteger(units, "units", "boardService");
    const service = this.requireService(serviceId, "boardService");
    if (!service.running) {
      throw new Error(`TransportEngine.boardService: ${serviceId} is not running`);
    }
    if (this.disruptionsOf(serviceId).length > 0) {
      throw new Error(`TransportEngine.boardService: ${serviceId} has a disruption in force`);
    }
    if (this.seatsAvailable(serviceId) < units) {
      throw new Error(
        `TransportEngine.boardService: ${serviceId} has ${this.seatsAvailable(serviceId)} seats left, not ${units}`,
      );
    }
    return this.replaceService({ ...service, occupiedUnits: service.occupiedUnits + units });
  }

  /** Seats given up on arrival; the run's occupancy falls. */
  alightService(serviceId: string, units: number): TransitService {
    this.scope.assertOwner("transport");
    requireNonNegativeInteger(units, "units", "alightService");
    const service = this.requireService(serviceId, "alightService");
    if (service.occupiedUnits < units) {
      throw new Error(
        `TransportEngine.alightService: ${serviceId} holds ${service.occupiedUnits} passengers, not ${units}`,
      );
    }
    return this.replaceService({ ...service, occupiedUnits: service.occupiedUnits - units });
  }

  /** Starts or stops a service (a strike, a timetable end, a cancellation). */
  setServiceRunning(serviceId: string, running: boolean): TransitService {
    this.scope.assertOwner("transport");
    return this.replaceService({ ...this.requireService(serviceId, "setServiceRunning"), running });
  }

  /** Changes the fare; the money is posted by the caller (System 25). */
  setFare(serviceId: string, fare: Money): TransitService {
    this.scope.assertOwner("transport");
    return this.replaceService({ ...this.requireService(serviceId, "setFare"), fare });
  }

  /**
   * Raises a disruption against a vehicle or a service. The cause is one
   * the spec names, and the target must exist — a disruption against
   * nothing would be a road the world never had.
   */
  raiseDisruption(
    ids: IdAllocator,
    request: {
      readonly cause: DisruptionCause;
      readonly targetId: string;
      readonly durationMinutes: number;
      readonly note?: string;
    },
    at: WorldTime,
  ): Disruption {
    this.scope.assertOwner("transport");
    if (!DISRUPTION_CAUSES.includes(request.cause)) {
      throw new Error(`TransportEngine.raiseDisruption: unknown cause ${String(request.cause)}`);
    }
    requireNonNegativeInteger(request.durationMinutes, "durationMinutes", "raiseDisruption");
    if (this.vehicle(request.targetId) === undefined && this.service(request.targetId) === undefined) {
      throw new Error(
        `TransportEngine.raiseDisruption: ${request.targetId} is neither a vehicle nor a service`,
      );
    }
    const disruption: Disruption = {
      id: `dis-${ids.next("activity")}`,
      cause: request.cause,
      targetId: request.targetId,
      at,
      durationMinutes: request.durationMinutes,
      ...(request.note === undefined ? {} : { note: request.note }),
    };
    this.state = { ...this.state, disruptions: [...this.state.disruptions, disruption] };
    return disruption;
  }

  /** Resolves a disruption. The record keeps the cause and the window. */
  resolveDisruption(id: string, at: WorldTime): Disruption {
    this.scope.assertOwner("transport");
    const found = this.state.disruptions.find((entry) => entry.id === id);
    if (found === undefined) {
      throw new Error(`TransportEngine.resolveDisruption: unknown disruption ${id}`);
    }
    if (found.resolvedAt !== undefined) {
      throw new Error(`TransportEngine.resolveDisruption: ${id} was already resolved`);
    }
    const resolved: Disruption = { ...found, resolvedAt: at };
    this.state = {
      ...this.state,
      disruptions: this.state.disruptions.map((entry) => (entry.id === id ? resolved : entry)),
    };
    return resolved;
  }

  private replaceVehicle(updated: Vehicle): Vehicle {
    this.state = {
      ...this.state,
      vehicles: this.state.vehicles.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      ),
    };
    return updated;
  }

  private replaceService(updated: TransitService): TransitService {
    this.state = {
      ...this.state,
      services: this.state.services.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      ),
    };
    return updated;
  }
}

// --------------------------------------------------------------- helpers ---

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

// --------------------------------------------------------------- guards ---

function requireRatio(value: number, field: string, caller: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `TransportEngine.${caller}: ${field} must be in [0, 1], received ${String(value)}`,
    );
  }
}

function requireNonNegativeInteger(value: number, field: string, caller: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `TransportEngine.${caller}: ${field} must be a non-negative integer, received ${String(value)}`,
    );
  }
}

function requirePositiveInteger(value: number, field: string, caller: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `TransportEngine.${caller}: ${field} must be a positive integer, received ${String(value)}`,
    );
  }
}

function requirePositiveNumber(value: number, field: string, caller: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `TransportEngine.${caller}: ${field} must be a positive number, received ${String(value)}`,
    );
  }
}
