/**
 * Canonical transport network generator (Systems 38 and 45).
 *
 * Connects the 34 major settlements across the 6 canonical corridors and
 * international transit connections (maritime, rail, and flight).
 */

import {
  CANON_CORRIDORS,
  CANON_SETTLEMENTS,
  type SettlementCanon,
} from "../../content/aurelia/canon.ts";
import { approximateDistanceKm } from "../primitives/location.ts";
import type { TransportMode, TransportRoute } from "./types.ts";

const SPEED_KPH: Record<TransportMode, number> = {
  foot: 5,
  road: 80,
  rail: 160,
  maritime: 45,
  flight: 700,
};

const BASE_COST_PER_KM: Record<TransportMode, number> = {
  foot: 0,
  road: 10,     // 0.10 AUR per km
  rail: 15,     // 0.15 AUR per km
  maritime: 12, // 0.12 AUR per km
  flight: 35,   // 0.35 AUR per km
};

function createRoutePair(
  a: SettlementCanon,
  b: SettlementCanon,
  mode: TransportMode,
  corridor?: string,
): readonly [TransportRoute, TransportRoute] {
  const distance = Math.max(10, Math.round(approximateDistanceKm(a.coordinates, b.coordinates)));
  const speed = SPEED_KPH[mode];
  const durationMinutes = Math.max(15, Math.round((distance / speed) * 60));
  const costMinorUnits = Math.round(distance * BASE_COST_PER_KM[mode]);
  const isInternational = a.countryId !== b.countryId;

  const ab: TransportRoute = {
    id: `ROUTE-${a.id}-${b.id}-${mode.toUpperCase()}`,
    originSettlementId: a.id,
    destinationSettlementId: b.id,
    distanceKm: distance,
    mode,
    durationMinutes,
    costMinorUnits,
    corridor,
    isInternational,
  };

  const ba: TransportRoute = {
    id: `ROUTE-${b.id}-${a.id}-${mode.toUpperCase()}`,
    originSettlementId: b.id,
    destinationSettlementId: a.id,
    distanceKm: distance,
    mode,
    durationMinutes,
    costMinorUnits,
    corridor,
    isInternational,
  };

  return [ab, ba];
}

/** Generates all canonical transport routes connecting Aurelia's settlements. */
export function generateCanonicalRoutes(): readonly TransportRoute[] {
  const byId = new Map(CANON_SETTLEMENTS.map((s) => [s.id, s]));
  const routes: TransportRoute[] = [];

  // 1. Intra-corridor routes (rail and road along each corridor)
  for (const corridor of CANON_CORRIDORS) {
    for (let i = 0; i < corridor.settlementIds.length - 1; i++) {
      const aId = corridor.settlementIds[i];
      const bId = corridor.settlementIds[i + 1];
      if (!aId || !bId) continue;
      const a = byId.get(aId);
      const b = byId.get(bId);
      if (!a || !b) continue;

      // Primary rail link
      const [r1, r2] = createRoutePair(a, b, "rail", corridor.name);
      routes.push(r1, r2);

      // Parallel highway link
      const [h1, h2] = createRoutePair(a, b, "road", corridor.name);
      routes.push(h1, h2);
    }
  }

  // 2. Inter-corridor and international maritime connections
  const maritimeLinks: readonly [string, string][] = [
    ["CITY-ARDEN", "CITY-WESTHAVEN"],
    ["CITY-VARENPORT", "CITY-WESTHAVEN"],
    ["CITY-WESTHAVEN", "CITY-SELIN"],
    ["CITY-EASTPORT", "CITY-VARENPORT"],
    ["CITY-NAMAR", "CITY-ARDEN"],
    ["CITY-AVELON", "CITY-LYREN"],
    ["CITY-SELIN", "CITY-ILYRA-CITY"],
    ["CITY-SARAD", "CITY-ARDEN"],
  ];

  for (const [idA, idB] of maritimeLinks) {
    const a = byId.get(idA);
    const b = byId.get(idB);
    if (!a || !b) continue;
    const [m1, m2] = createRoutePair(a, b, "maritime", "Intercontinental Shipping Route");
    routes.push(m1, m2);
  }

  // 3. Continental flight routes connecting global hubs
  const flightHubs = [
    "CITY-ARDEN",
    "CITY-VEYR",
    "CITY-WESTHAVEN",
    "CITY-SARAD",
    "CITY-ORIN",
    "CITY-KHAR",
    "CITY-ILYRA-CITY",
    "CITY-SELIN",
  ];

  for (let i = 0; i < flightHubs.length; i++) {
    for (let j = i + 1; j < flightHubs.length; j++) {
      const aId = flightHubs[i];
      const bId = flightHubs[j];
      if (!aId || !bId) continue;
      const a = byId.get(aId);
      const b = byId.get(bId);
      if (!a || !b) continue;
      const [f1, f2] = createRoutePair(a, b, "flight", "Global Air Corridor");
      routes.push(f1, f2);
    }
  }

  return routes;
}
