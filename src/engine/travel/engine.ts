/**
 * Travel engine (System 45).
 *
 * Owns physical transit, active journeys, and travel records.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import { generateCanonicalRoutes } from "./routes.ts";
import type { ActiveJourney, TransportMode, TransportRoute, TravelHistoryEntry, TravelSystemState } from "./types.ts";

export class TravelEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.travel) {
      this.scope.assertOwner("travel");
      this.world.systems.travel = {
        routes: generateCanonicalRoutes(),
        activeJourneys: [],
        history: [],
      } satisfies TravelSystemState;
    }
  }

  private get state(): TravelSystemState {
    return this.world.systems.travel as TravelSystemState;
  }

  private set state(value: TravelSystemState) {
    this.world.systems.travel = value;
  }

  allRoutes(): readonly TransportRoute[] {
    return this.state.routes;
  }

  routesFrom(originSettlementId: string): readonly TransportRoute[] {
    return this.state.routes.filter((r) => r.originSettlementId === originSettlementId);
  }

  findRoute(
    originSettlementId: string,
    destinationSettlementId: string,
    preferredMode?: TransportMode,
  ): TransportRoute | undefined {
    const candidates = this.state.routes.filter(
      (r) =>
        r.originSettlementId === originSettlementId &&
        r.destinationSettlementId === destinationSettlementId,
    );
    if (candidates.length === 0) return undefined;
    if (preferredMode) {
      const match = candidates.find((r) => r.mode === preferredMode);
      if (match) return match;
    }
    // Default to fastest duration
    return [...candidates].sort((a, b) => a.durationMinutes - b.durationMinutes)[0];
  }

  activeJourneyOf(personId: EntityId<"person">): ActiveJourney | undefined {
    return this.state.activeJourneys.find((j) => j.personId === personId);
  }

  startJourney(journey: ActiveJourney): void {
    this.scope.assertOwner("travel");
    if (this.activeJourneyOf(journey.personId)) {
      throw new Error(`TravelEngine.startJourney: person ${journey.personId} already on a journey`);
    }
    this.state = {
      ...this.state,
      activeJourneys: [...this.state.activeJourneys, journey],
    };
  }

  completeJourney(personId: EntityId<"person">, completedAt: WorldTime): ActiveJourney | undefined {
    this.scope.assertOwner("travel");
    const journey = this.activeJourneyOf(personId);
    if (!journey) return undefined;

    const historyEntry: TravelHistoryEntry = {
      personId,
      fromSettlementId: journey.originSettlementId,
      toSettlementId: journey.destinationSettlementId,
      completedAt,
      mode: journey.mode,
    };

    this.state = {
      ...this.state,
      activeJourneys: this.state.activeJourneys.filter((j) => j.personId !== personId),
      history: [...this.state.history, historyEntry],
    };

    return journey;
  }
}
