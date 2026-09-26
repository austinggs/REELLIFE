/**
 * ReelLife location primitive (Systems 07/37/56).
 *
 * Geography is authoritative simulation state; maps are presentation. A
 * LocationRef is a stable, serializable spatial reference that survives
 * save/load and lifecycle changes.
 *
 * The canonical hierarchy is:
 *   world -> continent -> country -> region -> settlement -> district
 *         -> neighborhood -> property -> building -> unit -> room
 *
 * Not every layer must be instantiated everywhere (System 37).
 */

import type { EntityId, EntityKind } from "./ids.ts";
import type { EntityRef } from "./entity.ts";

export const LOCATION_LEVELS = [
  "world",
  "continent",
  "country",
  "region",
  "settlement",
  "district",
  "neighborhood",
  "property",
  "building",
  "unit",
  "room",
] as const;

export type LocationLevel = (typeof LOCATION_LEVELS)[number];

export const LOCATION_LEVEL_ENTITY_KIND: Record<LocationLevel, EntityKind> = {
  world: "world",
  continent: "continent",
  country: "country",
  region: "region",
  settlement: "settlement",
  district: "location",
  neighborhood: "location",
  property: "property",
  building: "location",
  unit: "location",
  room: "location",
};

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
  readonly elevationMeters?: number;
}

/**
 * Stable spatial reference. `id` is either an authored content ID (World Bible
 * slugs such as "CITY-ARDEN") or an allocated runtime ID.
 */
export interface LocationRef {
  readonly id: EntityId<"location"> | string;
  readonly level: LocationLevel;
  readonly name: string;
  readonly parentId?: string;
  readonly coordinates?: GeoPoint;
  readonly historicalNames?: readonly string[];
}

export function locationRef(init: LocationRef): LocationRef {
  return init;
}

export function asEntityRefOfLocation(location: LocationRef): EntityRef {
  return { kind: LOCATION_LEVEL_ENTITY_KIND[location.level], id: location.id as EntityId<EntityKind> };
}

/** Approximate great-circle distance in kilometres; deterministic and side-effect free. */
export function approximateDistanceKm(a: GeoPoint, b: GeoPoint): number {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when `ancestorId` appears in the parent chain of `location`. */
export function isWithinHierarchy(
  location: LocationRef,
  ancestorId: string,
  lookup: (id: string) => LocationRef | undefined,
  maxDepth = 16,
): boolean {
  let current: LocationRef | undefined = location;
  let depth = 0;
  while (current && depth < maxDepth) {
    if (current.id === ancestorId) return true;
    current = current.parentId ? lookup(current.parentId) : undefined;
    depth += 1;
  }
  return false;
}
