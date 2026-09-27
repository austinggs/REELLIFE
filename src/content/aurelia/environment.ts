/**
 * Canonical Aurelia climate content (M4 / System 46).
 *
 * The World Bible names the eight broad environmental zones Aurelia contains
 * ("tropical, subtropical, temperate, arid, semi-arid, alpine, subpolar and
 * polar", WORLD_BUILD_01 section 5) and then describes each of the 36 canonical
 * regions with a richer, authored label ("fertile_valley", "mediterranean_arid",
 * "taiga_forest", …). This module is the bridge between the two: the authored
 * descriptors are normalised onto the eight canonical zones, so the engine can
 * reason about climate without losing the Bible's own wording.
 *
 * It also exposes the weather *places* — each canonical region and settlement,
 * with its zone and latitude — which is what the environment engine needs to
 * observe location-specific weather. Latitude comes straight from the canonical
 * coordinates, so a place's seasons follow the World Bible's own layout rather
 * than a second, invented one.
 *
 * The zone mapping is a documented interpretation, not a canon number: the
 * World Bible does not assign each region to exactly one of its eight zones.
 * See docs/CONTENT_GAPS.md.
 */

import type { ClimateZone } from "../../engine/environment/types.ts";
import { CANON_REGIONS, CANON_SETTLEMENTS } from "./canon.ts";

/**
 * The 36 authored regional climate descriptors mapped onto the canonical eight
 * zones, read from each region's own description together with its canonical
 * latitude and continent (e.g. "boreal" and "continental_cold" are the subpolar
 * extremes of the northern continents; "mediterranean_arid" is a dry
 * subtropical coast).
 */
export const CLIMATE_ZONE_BY_DESCRIPTOR: Readonly<Record<string, ClimateZone>> = {
  // Elandra
  alpine: "alpine",
  temperate_river_basin: "temperate",
  maritime_temperate: "temperate",
  subtropical_coastal: "subtropical",
  semi_arid_steppe: "semi_arid",
  continental_upland: "temperate",
  // Veyra
  temperate_continental: "temperate",
  boreal: "subpolar",
  maritime: "temperate",
  fertile_valley: "temperate",
  temperate_hills: "temperate",
  coastal_oceanic: "temperate",
  // Sahraen
  mediterranean_arid: "semi_arid",
  arid_desert: "arid",
  tropical_river_basin: "tropical",
  tropical_montane: "tropical",
  tropical_savannah: "tropical",
  equatorial_rainforest: "tropical",
  // Orinth
  temperate_grassland: "temperate",
  alluvial_basin: "temperate",
  semi_arid_prairie: "semi_arid",
  montane_temperate: "temperate",
  alpine_barrier: "alpine",
  cool_maritime: "temperate",
  // Kharos
  polar_tundra: "polar",
  high_alpine: "alpine",
  continental_cold: "subpolar",
  taiga_forest: "subpolar",
  cold_steppe: "subpolar",
  temperate_basin: "temperate",
  // Ilyra
  maritime_subtropical: "subtropical",
  sheltered_marine: "subtropical",
  upland_oceanic: "temperate",
  humid_maritime: "subtropical",
  oceanic_islands: "tropical",
  cool_temperate_coast: "temperate",
};

/** Normalises an authored descriptor onto the canonical zone. */
export function classifyClimate(descriptor: string): ClimateZone {
  const zone = CLIMATE_ZONE_BY_DESCRIPTOR[descriptor];
  if (!zone) {
    throw new Error(`Unknown Aurelia climate descriptor "${descriptor}"`);
  }
  return zone;
}

/** Region id -> canonical zone, for all 36 canonical regions. */
export const AURELIA_REGION_CLIMATES: Readonly<Record<string, ClimateZone>> = Object.fromEntries(
  CANON_REGIONS.map((region) => [region.id, classifyClimate(region.climate)]),
);

/** The zone of a canonical region. */
export function climateZoneOfRegion(regionId: string): ClimateZone | undefined {
  return AURELIA_REGION_CLIMATES[regionId];
}

/**
 * The zone of a canonical place. A settlement inherits the zone of the region it
 * belongs to; a region and a continent (via its regions) answer for themselves.
 * An unknown place has no climate rather than a default one.
 */
export function climateZoneAt(locationId: string): ClimateZone | undefined {
  const region = CANON_REGIONS.find((entry) => entry.id === locationId);
  if (region) return AURELIA_REGION_CLIMATES[region.id];

  const settlement = CANON_SETTLEMENTS.find((entry) => entry.id === locationId);
  if (settlement) return AURELIA_REGION_CLIMATES[settlement.regionId];

  return undefined;
}

/** A place the environment can observe weather at. */
export interface AureliaWeatherPlace {
  readonly locationId: string;
  readonly name: string;
  readonly climate: ClimateZone;
  readonly latitude: number;
}

function regionPlace(regionId: string): AureliaWeatherPlace | undefined {
  const region = CANON_REGIONS.find((entry) => entry.id === regionId);
  if (!region) return undefined;
  return {
    locationId: region.id,
    name: region.name,
    climate: AURELIA_REGION_CLIMATES[region.id],
    latitude: region.coordinates.latitude,
  };
}

function settlementPlace(settlementId: string): AureliaWeatherPlace | undefined {
  const settlement = CANON_SETTLEMENTS.find((entry) => entry.id === settlementId);
  if (!settlement) return undefined;
  const climate = AURELIA_REGION_CLIMATES[settlement.regionId];
  if (!climate) return undefined;
  return {
    locationId: settlement.id,
    name: settlement.name,
    climate,
    latitude: settlement.coordinates.latitude,
  };
}

/**
 * Every canonical place that has a climate: the 36 geographic regions followed
 * by the 34 major settlements, in canonical order.
 */
export const AURELIA_WEATHER_PLACES: readonly AureliaWeatherPlace[] = [
  ...CANON_REGIONS.map((region) => regionPlace(region.id)).filter(
    (place): place is AureliaWeatherPlace => place !== undefined,
  ),
  ...CANON_SETTLEMENTS.map((settlement) => settlementPlace(settlement.id)).filter(
    (place): place is AureliaWeatherPlace => place !== undefined,
  ),
];

const WEATHER_PLACE_BY_ID: ReadonlyMap<string, AureliaWeatherPlace> = new Map(
  AURELIA_WEATHER_PLACES.map((place) => [place.locationId, place]),
);

/**
 * The climate and latitude of a canonical place — the two content inputs the
 * environment engine needs to observe its weather. Undefined for a place the
 * World Bible gives no climate for (continents, oceans, districts).
 */
export function aureliaWeatherPlace(locationId: string): AureliaWeatherPlace | undefined {
  return WEATHER_PLACE_BY_ID.get(locationId);
}
