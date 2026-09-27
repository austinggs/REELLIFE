/**
 * Provisional transport content for the Arden slice (M5 / System 28).
 *
 * The World Bible authors Arden as a working port with quays, mills, docks
 * and a rail terminus, but names no vehicles, operators or fares (deferred
 * canon). This module authors only what the slice's *existing* content
 * already implies: the businesses' own delivery vehicles, and a docks-run
 * worker coach on a real System 45 route out of the city — the docks are
 * authored with 140 workers on a shift rotation and a berth a walk from
 * the terminus, which is exactly the case a works coach exists for.
 *
 * Deliberately **not** authored: a municipal transit system. The slice has
 * no civic organization, and inventing one to own a bus would be a
 * fiction wearing a schema. Public transit capacity is exercised in
 * `tests/kernel/transport.test.ts` with an explicitly-stated test service
 * instead, and the gap is logged in docs/CONTENT_GAPS.md.
 *
 * Routes are never restated here: the coach references a System 45
 * `TransportRoute.id`, so the two systems cannot disagree about a line.
 * Every record is flagged `provisional`, and nothing here is canon.
 */

import type {
  DefineServiceRequest,
  DefineVehicleRequest,
  TransportEngine,
} from "../../engine/transport/engine.ts";
import { currencyId, money } from "../../engine/primitives/money.ts";
import type { WorldTime } from "../../engine/primitives/time.ts";
import { AURELIA_CURRENCY } from "./countries.ts";

const AUR = currencyId(AURELIA_CURRENCY.code);
const aur = (major: number): number => Math.round(major * 100);

const PROVISIONAL_NOTE =
  "Provisional: the World Bible names no vehicles, operators or fares (M5/S28 gap list).";

export const AURELIA_SLICE_VEHICLE_COUNT = 4;
export const AURELIA_SLICE_SERVICE_COUNT = 1;

export interface SliceVehicleSeed extends DefineVehicleRequest {
  readonly note?: string;
}

export interface SliceServiceSeed extends DefineServiceRequest {
  readonly note?: string;
}

/**
 * The slice's vehicles. Owners are real slice organizations (System 32) so
 * System 28's graph holds no dangling owners; the bakery van starts worn,
 * because a second bakery delivery van nobody maintains is not credible.
 */
export function aureliaArdenVehicles(settlementId: string): readonly SliceVehicleSeed[] {
  return [
    {
      id: "VEH-ARDEN-DOCKS-TRACTOR",
      kind: "truck",
      mode: "road",
      ownerId: "ORG-ARDIN-DOCKS",
      operatorOrgId: "ORG-ARDIN-DOCKS",
      locationId: settlementId,
      capacityUnits: 4_000,
      energyCapacityUnits: 200,
      rangeUnits: 900,
      note: PROVISIONAL_NOTE,
    },
    {
      id: "VEH-ARDEN-BAKERY-VAN",
      kind: "van",
      mode: "road",
      ownerId: "ORG-ARDEN-MILL-BAKERY",
      locationId: settlementId,
      capacityUnits: 900,
      energyCapacityUnits: 60,
      rangeUnits: 420,
      condition: 0.62,
      note: PROVISIONAL_NOTE,
    },
    {
      id: "VEH-ARDEN-DOCKS-COACH",
      kind: "bus",
      mode: "road",
      ownerId: "ORG-ARDIN-DOCKS",
      operatorOrgId: "ORG-ARDIN-DOCKS",
      locationId: settlementId,
      capacityUnits: 60,
      energyCapacityUnits: 180,
      rangeUnits: 520,
      note: PROVISIONAL_NOTE,
    },
    {
      id: "VEH-ARDEN-QUAY-TAXI",
      kind: "taxi",
      mode: "road",
      ownerId: "ORG-QUAY-CAFE",
      locationId: settlementId,
      capacityUnits: 4,
      energyCapacityUnits: 45,
      rangeUnits: 380,
      note: PROVISIONAL_NOTE,
    },
  ];
}

/**
 * One works coach, run by the docks on a road route out of Arden. The
 * caller passes the System 45 route id: if the network has no such line,
 * the service is simply not authored.
 */
export function aureliaArdenServices(routeId: string): readonly SliceServiceSeed[] {
  return [
    {
      id: "SVC-ARDEN-DOCKS-COACH",
      routeId,
      operatorOrgId: "ORG-ARDIN-DOCKS",
      mode: "road",
      stopIds: ["CITY-ARDEN", "CITY-CALDOR"],
      fare: money(AUR, aur(0.4)),
      capacityUnits: 60,
      note: PROVISIONAL_NOTE,
    },
  ];
}

/**
 * Registers the slice's transport. Idempotent: existing vehicles and
 * services are left alone, so re-seeding never duplicates a fleet. The
 * service needs a real System 45 road route out of Arden, which is why the
 * route id is a parameter rather than a guess.
 */
export function registerAureliaTransport(
  engine: TransportEngine,
  settlementId: string,
  routeId: string | undefined,
  now: WorldTime,
): { readonly vehicles: number; readonly services: number } {
  let vehicles = 0;
  for (const seed of aureliaArdenVehicles(settlementId)) {
    if (engine.vehicle(seed.id) !== undefined) continue;
    engine.defineVehicle(seed, now);
    vehicles += 1;
  }
  let services = 0;
  if (routeId !== undefined) {
    for (const seed of aureliaArdenServices(routeId)) {
      if (engine.service(seed.id) !== undefined) continue;
      engine.defineService(seed, now);
      services += 1;
    }
  }
  return { vehicles, services };
}

