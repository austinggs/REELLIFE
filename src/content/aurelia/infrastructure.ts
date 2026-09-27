/**
 * Canonical infrastructure operations content for Aurelia (M4 / System 38).
 *
 * This is the one deliberate provisional area of the M4 spatial work: the
 * World Bible authors corridors, settlements and the qualitative economy, but
 * no per-city utility inventory ("which city runs which water works" is not
 * canon). Rather than inventing thirty-four networks, this module does two
 * honest things:
 *
 *   1. it registers the playable slice's real operational network — Arden's
 *      urban utilities and transit with a genuine dependency order — so the
 *      world the player lives in has working, breakable infrastructure;
 *   2. it leaves every other settlement unauthored instead of fabricating
 *      parallel networks, and says so (docs/CONTENT_GAPS.md).
 *
 * Everything here is idempotent and flagged `provisional`.
 */

import type { InfrastructureEngine } from "../../engine/infrastructure/engine.ts";
import type { InfrastructureAsset } from "../../engine/infrastructure/types.ts";
import type { WorldTime } from "../../engine/primitives/time.ts";

/**
 * Arden's urban network, ordered so dependencies always precede dependents.
 * Every id is namespaced to the settlement it serves (`INFRA-ARDEN-…`), so a
 * later city cannot collide with the provisional network, and every asset is
 * flagged `provisional` (docs/CONTENT_GAPS.md).
 */
export function aureliaInfrastructureAssets(settlementId: string, at: WorldTime): readonly InfrastructureAsset[] {
  const prefix = `INFRA-${settlementId.replace("CITY-", "")}`;
  const maintained = { nextDueAt: at, deferredPeriods: 0 };
  return [
    {
      id: `${prefix}-POWER-SUBSTATION-NORTH`,
      name: "North Grid Substation",
      kind: "power",
      locationId: settlementId,
      capacityUtilisation: 0.72,
      condition: 0.86,
      dependencies: [],
      redundant: true,
      usersServed: 21000,
      maintenance: { ...maintained },
      provisional: true,
      note: "Provisional: the World Bible authors urban utilities of Arden generically, not asset by asset (M4/S38).",
    },
    {
      id: `${prefix}-POWER-SUBSTATION-EAST`,
      name: "East Grid Substation",
      kind: "power",
      locationId: settlementId,
      capacityUtilisation: 0.64,
      condition: 0.78,
      dependencies: [],
      redundant: true,
      usersServed: 16000,
      maintenance: { ...maintained },
      provisional: true,
      note: "Provisional: the World Bible authors urban utilities of Arden generically, not asset by asset (M4/S38).",
    },
    {
      id: `${prefix}-WATER-TREATMENT-WORKS`,
      name: "Ardan Basin Water Treatment Works",
      kind: "water",
      locationId: settlementId,
      capacityUtilisation: 0.81,
      condition: 0.74,
      dependencies: [`${prefix}-POWER-SUBSTATION-NORTH`, `${prefix}-POWER-SUBSTATION-EAST`],
      redundant: false,
      usersServed: 46000,
      maintenance: { ...maintained },
      provisional: true,
      note: "Provisional: see above. Powered from both substations; it still goes dark if both feeders fail.",
    },
    {
      id: `${prefix}-WATER-PUMP-SOUTH`,
      name: "South Reservoir Pumps",
      kind: "water",
      locationId: settlementId,
      capacityUtilisation: 0.88,
      condition: 0.69,
      dependencies: [`${prefix}-WATER-TREATMENT-WORKS`, `${prefix}-POWER-SUBSTATION-EAST`],
      redundant: false,
      usersServed: 18000,
      maintenance: { ...maintained },
      provisional: true,
      note: "Provisional: see above.",
    },
    {
      id: `${prefix}-SANITATION-WORKS`,
      name: "Southside Sanitation Works",
      kind: "sanitation",
      locationId: settlementId,
      capacityUtilisation: 0.61,
      condition: 0.7,
      dependencies: [`${prefix}-POWER-SUBSTATION-EAST`],
      redundant: true,
      usersServed: 29000,
      maintenance: { ...maintained },
      provisional: true,
      note: "Provisional: see above. Redundant by design: gravity sewers keep flowing on a partial power loss.",
    },
    {
      id: `${prefix}-TELECOM-EXCHANGE`,
      name: "Old Town Telecom Exchange",
      kind: "telecom",
      locationId: settlementId,
      capacityUtilisation: 0.57,
      condition: 0.82,
      dependencies: [`${prefix}-POWER-SUBSTATION-NORTH`],
      redundant: true,
      usersServed: 34000,
      maintenance: { ...maintained },
      provisional: true,
      note: "Provisional: see above. Battery backup keeps it alive through a single feeder failure.",
    },
    {
      id: `${prefix}-DISTRICT-HOSPITAL`,
      name: "Arden District Hospital (power & water)",
      kind: "hospital_support",
      locationId: settlementId,
      capacityUtilisation: 0.66,
      condition: 0.88,
      dependencies: [
        `${prefix}-POWER-SUBSTATION-NORTH`,
        `${prefix}-WATER-TREATMENT-WORKS`,
        `${prefix}-TELECOM-EXCHANGE`,
      ],
      redundant: false,
      usersServed: 46000,
      maintenance: { ...maintained },
      provisional: true,
      note: "Provisional: see above. Critical load: no redundancy by design in the M4 slice.",
    },
    {
      id: `${prefix}-RAIL-TERMINUS`,
      name: "Arden Rail Terminus",
      kind: "rail",
      locationId: settlementId,
      capacityUtilisation: 0.79,
      condition: 0.73,
      dependencies: [`${prefix}-POWER-SUBSTATION-EAST`, `${prefix}-TELECOM-EXCHANGE`],
      redundant: false,
      maintenance: { ...maintained },
      provisional: true,
      note: "Provisional: see above. Serves System 45 corridor routes that stop in Arden.",
    },
    {
      id: `${prefix}-ROAD-RING-JUNCTION`,
      name: "Ring Road North Junction",
      kind: "road",
      locationId: settlementId,
      capacityUtilisation: 1.04,
      condition: 0.58,
      dependencies: [],
      redundant: true,
      maintenance: { ...maintained },
      provisional: true,
      note: "Provisional: see above. Deliberately the slice's one overloaded asset: peak demand already exceeds design capacity.",
    },
    {
      id: `${prefix}-WASTE-DEPOT`,
      name: "East Suburbs Waste Depot",
      kind: "waste",
      locationId: settlementId,
      capacityUtilisation: 0.44,
      condition: 0.66,
      dependencies: [`${prefix}-ROAD-RING-JUNCTION`],
      redundant: false,
      usersServed: 22000,
      maintenance: { ...maintained },
      provisional: true,
      note: "Provisional: see above.",
    },
  ];
}

/** How many assets the slice network holds (pinned so drift shows up in tests). */
export const AURELIA_SLICE_ASSET_COUNT = 10;

/**
 * Registers the slice's infrastructure network. Idempotent: existing ids are
 * left alone, so this is safe on world creation, on re-seeding and in tests.
 */
export function registerAureliaInfrastructure(
  engine: InfrastructureEngine,
  settlementId: string,
  at: WorldTime,
): void {
  for (const asset of aureliaInfrastructureAssets(settlementId, at)) {
    if (!engine.asset(asset.id)) engine.defineAsset(asset);
  }
}
