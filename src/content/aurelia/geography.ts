/**
 * Canonical geography slice for the M2 vertical slice.
 *
 * IDs are the authored World Bible IDs (WORLD_BUILD_14, "Stable Identity"):
 * WORLD-AURELIA -> CONT-ELANDRA -> COUNTRY-ARDIN -> REGION-ARDAN-BASIN ->
 * CITY-ARDEN. Arden is the Republic of Ardin's capital and major economic
 * center (WORLD_BUILD_04). Everything here is canon; the full 6/5/36/48/34
 * hierarchy arrives with M4 content loading.
 */

import type { GeographyEngine } from "../../engine/geography/engine.ts";
import type { LocationRef } from "../../engine/primitives/location.ts";

export const AURELIA_SLICE_PLACES: readonly LocationRef[] = [
  { id: "WORLD-AURELIA", level: "world", name: "Aurelia" },
  { id: "CONT-ELANDRA", level: "continent", name: "Elandra", parentId: "WORLD-AURELIA" },
  { id: "COUNTRY-ARDIN", level: "country", name: "Republic of Ardin", parentId: "CONT-ELANDRA" },
  { id: "REGION-ARDAN-BASIN", level: "region", name: "Ardan Basin", parentId: "COUNTRY-ARDIN" },
  {
    id: "CITY-ARDEN",
    level: "settlement",
    name: "Arden",
    parentId: "REGION-ARDAN-BASIN",
  },
];

/** The city the M2 slice is lived in. */
export const M2_SETTLEMENT_ID = "CITY-ARDEN";

/** Idempotent: registering an already-registered place is a no-op. */
export function registerAureliaSliceGeography(engine: GeographyEngine): void {
  for (const place of AURELIA_SLICE_PLACES) {
    if (!engine.get(place.id)) engine.register(place);
  }
}
