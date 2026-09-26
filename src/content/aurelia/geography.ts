/**
 * Canonical geography for Planet Aurelia (M4 / System 37).
 *
 * Owns the full authoritative world hierarchy:
 * - WORLD-AURELIA (world)
 * - 6 Continents (continent)
 * - 5 Oceans (region)
 * - 48 Sovereign Countries (country)
 * - 36 Geographic Regions (region)
 * - 34 Major Named Settlements (settlement)
 * - Districts for Arden (district)
 *
 * Preserves the M2 vertical slice places and functions for complete
 * backward-compatibility while supplying the full world dataset.
 */

import type { GeographyEngine } from "../../engine/geography/engine.ts";
import type { LocationRef } from "../../engine/primitives/location.ts";
import {
  CANON_CONTINENTS,
  CANON_COUNTRIES,
  CANON_OCEANS,
  CANON_REGIONS,
  CANON_SETTLEMENTS,
} from "./canon.ts";

/** Canonical geography slice for the M2 vertical slice (kept backward-compatible). */
export const AURELIA_SLICE_PLACES: readonly LocationRef[] = [
  { id: "WORLD-AURELIA", level: "world", name: "Aurelia", coordinates: { latitude: 0, longitude: 0 } },
  { id: "CONT-ELANDRA", level: "continent", name: "Elandra", parentId: "WORLD-AURELIA", coordinates: { latitude: 35, longitude: 5 } },
  { id: "COUNTRY-ARDIN", level: "country", name: "Republic of Ardin", parentId: "CONT-ELANDRA", coordinates: { latitude: 34.2, longitude: 6.5 } },
  { id: "REGION-ARDAN-BASIN", level: "region", name: "Ardan Basin", parentId: "COUNTRY-ARDIN", coordinates: { latitude: 34, longitude: 7 } },
  {
    id: "CITY-ARDEN",
    level: "settlement",
    name: "Arden",
    parentId: "REGION-ARDAN-BASIN",
    coordinates: { latitude: 34.2, longitude: 6.5 },
    historicalNames: ["Old Arden", "Porte-Ardan"],
  },
];

/** The city the slice is lived in. */
export const M2_SETTLEMENT_ID = "CITY-ARDEN";

/**
 * Full canonical world places list:
 * Order guarantees parents are registered strictly before children.
 */
export const AURELIA_WORLD_PLACES: readonly LocationRef[] = [
  // 1. World Root
  { id: "WORLD-AURELIA", level: "world", name: "Aurelia", coordinates: { latitude: 0, longitude: 0 } },

  // 2. Continents (6)
  ...CANON_CONTINENTS.map((c) => ({
    id: c.id,
    level: "continent" as const,
    name: c.name,
    parentId: "WORLD-AURELIA",
    coordinates: c.coordinates,
  })),

  // 3. Oceans (5) — large bodies of water under world root
  ...CANON_OCEANS.map((o) => ({
    id: o.id,
    level: "region" as const,
    name: o.name,
    parentId: "WORLD-AURELIA",
    coordinates: o.coordinates,
  })),

  // 4. Countries (48) — under continents
  ...CANON_COUNTRIES.map((c) => ({
    id: c.id,
    level: "country" as const,
    name: c.name,
    parentId: c.continentId,
    coordinates: c.coordinates,
  })),

  // 5. Geographic Regions (36) — under countries or continents
  ...CANON_REGIONS.map((r) => ({
    id: r.id,
    level: "region" as const,
    name: r.name,
    parentId: r.countryId ?? r.continentId,
    coordinates: r.coordinates,
  })),

  // 6. Major Settlements (34) — under regions or direct sovereign country
  ...CANON_SETTLEMENTS.map((s) => {
    // If settlement's country is not the owner of its geographic region, attach under country directly
    // so ancestry queries (countryAncestorOf) correctly resolve sovereign country.
    const region = CANON_REGIONS.find((r) => r.id === s.regionId);
    const parentId = (region && region.countryId === s.countryId) ? s.regionId : s.countryId;
    return {
      id: s.id,
      level: "settlement" as const,
      name: s.name,
      parentId,
      coordinates: s.coordinates,
      ...(s.historicalNames ? { historicalNames: s.historicalNames } : {}),
    };
  }),

  // 7. Arden Districts (System 37 local neighborhoods)
  { id: "DISTRICT-ARDEN-OLD-TOWN", level: "district", name: "Old Town", parentId: "CITY-ARDEN", coordinates: { latitude: 34.205, longitude: 6.495 } },
  { id: "DISTRICT-ARDEN-RIVERFRONT", level: "district", name: "Riverfront Commercial District", parentId: "CITY-ARDEN", coordinates: { latitude: 34.212, longitude: 6.510 } },
  { id: "DISTRICT-ARDEN-INNOVATION", level: "district", name: "Innovation & Tech Quarter", parentId: "CITY-ARDEN", coordinates: { latitude: 34.195, longitude: 6.525 } },
  { id: "DISTRICT-ARDEN-EAST-SUBURBS", level: "district", name: "East Suburbs", parentId: "CITY-ARDEN", coordinates: { latitude: 34.190, longitude: 6.540 } },
];

/** Idempotent: registering an already-registered place is a no-op. */
export function registerAureliaSliceGeography(engine: GeographyEngine): void {
  for (const place of AURELIA_SLICE_PLACES) {
    if (!engine.get(place.id)) engine.register(place);
  }
}

/** Registers the complete canonical Aurelia world geography hierarchy. */
export function registerAureliaWorldGeography(engine: GeographyEngine): void {
  for (const place of AURELIA_WORLD_PLACES) {
    if (!engine.get(place.id)) engine.register(place);
  }
}

