/**
 * System 45 — Travel / Immigration / Borders (and System 38 Infrastructure routes).
 *
 * Travel is physical movement across the spatial graph.
 * Immigration is legal and jurisdictional status.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";

export type TransportMode = "road" | "rail" | "maritime" | "flight" | "foot";

export interface TransportRoute {
  readonly id: string;
  readonly originSettlementId: string;
  readonly destinationSettlementId: string;
  readonly distanceKm: number;
  readonly mode: TransportMode;
  readonly durationMinutes: number;
  readonly costMinorUnits: number;
  readonly corridor?: string;
  readonly isInternational: boolean;
}

export interface ActiveJourney {
  readonly journeyId: string;
  readonly personId: EntityId<"person">;
  readonly originSettlementId: string;
  readonly destinationSettlementId: string;
  readonly routeId: string;
  readonly departedAt: WorldTime;
  readonly arrivesAt: WorldTime;
  readonly mode: TransportMode;
}

export interface TravelHistoryEntry {
  readonly personId: EntityId<"person">;
  readonly fromSettlementId: string;
  readonly toSettlementId: string;
  readonly completedAt: WorldTime;
  readonly mode: TransportMode;
}

export interface TravelSystemState {
  readonly routes: readonly TransportRoute[];
  readonly activeJourneys: readonly ActiveJourney[];
  readonly history: readonly TravelHistoryEntry[];
}
