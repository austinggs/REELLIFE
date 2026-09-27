/**
 * Playable slice seed (M3 kernel composition).
 *
 * Builds the small lived-in world the UI shell runs on: the canonical Aurelia
 * geography spine, the slice's infrastructure network, a materialized
 * population inside Arden, and a player person with needs registered so the
 * Life screen has something authoritative to show. This is world *setup*, not
 * simulation rules — it runs once at creation (never after load, where state
 * is restored instead) and every write goes through the owning system's scope.
 */

import type { Simulation } from "../core/simulation.ts";
import type { EntityId } from "../primitives/ids.ts";
import {
  M2_SETTLEMENT_ID,
  registerAureliaSliceGeography,
} from "../../content/aurelia/geography.ts";
import { aureliaWeatherPlace } from "../../content/aurelia/environment.ts";
import { registerAureliaCountries } from "../../content/aurelia/countries.ts";
import { registerAureliaInfrastructure } from "../../content/aurelia/infrastructure.ts";
import { CountriesEngine } from "../countries/engine.ts";
import { EnvironmentEngine } from "../environment/engine.ts";
import { GeographyEngine } from "../geography/engine.ts";
import { InfrastructureEngine } from "../infrastructure/engine.ts";
import { materializeSettlement } from "../scale/materialize.ts";
import { NeedsEngine } from "../needs/engine.ts";
import type { ScaleSystemState } from "../scale/types.ts";

/** Provisional abstract population of the slice city (see docs/CONTENT_GAPS.md). */
export const SLICE_POPULATION = 50_000;
/** Default number of residents revealed — inside the M2 DoD's ~200–2 000 range. */
export const SLICE_RESIDENT_COUNT = 300;

export interface SliceSeedOptions {
  /** How many residents to materialize; defaults to SLICE_RESIDENT_COUNT. */
  readonly residentCount?: number;
}

export interface SliceSeedResult {
  readonly playerId: EntityId<"person">;
  readonly settlementId: string;
  readonly residentCount: number;
}

/**
 * Seeds (or re-affirms) the playable slice. Safe to call on a world that was
 * already seeded: geography registration is idempotent, materialization is a
 * no-op at its target, and the player is chosen from existing residents.
 */
export function seedPlayableSlice(
  sim: Simulation,
  options: SliceSeedOptions = {},
): SliceSeedResult {
  const residentCount = options.residentCount ?? SLICE_RESIDENT_COUNT;

  sim.guard.mutate("geography", () => {
    registerAureliaSliceGeography(new GeographyEngine(sim.scope, sim.world));
  });

  // System 39 gives the playable world its country environment: sovereignty,
  // the currency reference Money uses, citizenship/entry frameworks, the
  // national/municipal jurisdictions of the slice's country and city, and the
  // data-driven world rules. Idempotent, so re-seeding is a no-op.
  sim.guard.mutate("countries", () => {
    registerAureliaCountries(new CountriesEngine(sim.scope, sim.world));
  });

  // System 38 gives the slice city its operational network: utilities, transit
  // and hospital support with a real dependency order, so capacity, outages and
  // maintenance have something to work on. Idempotent, so re-seeding is a no-op.
  sim.guard.mutate("infrastructure", () => {
    registerAureliaInfrastructure(
      new InfrastructureEngine(sim.scope, sim.world),
      M2_SETTLEMENT_ID,
      sim.clock.time,
    );
  });

  // The slice city gets real weather from the first frame, so System 46 takes
  // part in the playable world's conditions. Idempotent: weather is upserted.
  const weatherPlace = aureliaWeatherPlace(M2_SETTLEMENT_ID);
  if (weatherPlace) {
    sim.guard.mutate("environment", () => {
      new EnvironmentEngine(sim.scope, sim.world).observeWeather({
        locationId: weatherPlace.locationId,
        climate: weatherPlace.climate,
        latitude: weatherPlace.latitude,
        monthIndex: sim.calendar.dateFromTime(sim.clock.time).monthIndex,
        at: sim.clock.time,
      });
    });
  }

  const personIds = materializeSettlement(sim, {
    settlementId: M2_SETTLEMENT_ID,
    totalPopulation: SLICE_POPULATION,
    targetCount: residentCount,
    now: sim.clock.time,
  });
  const playerId = personIds[0];
  if (playerId === undefined) {
    throw new Error("seedPlayableSlice: the slice has no residents");
  }

  // The player's needs must exist before the Life screen can show them.
  // registerPerson replaces, so guard against double-registration on re-seed.
  const needsState = sim.world.systems.needs as { persons?: readonly { personId: string }[] } | undefined;
  const alreadyRegistered = needsState?.persons?.some((entry) => entry.personId === playerId);
  if (!alreadyRegistered) {
    sim.guard.mutate("needs", () => {
      new NeedsEngine(sim.scope, sim.world).registerPerson(playerId, sim.clock.time);
    });
  }

  const scale = sim.world.systems.scale as ScaleSystemState | undefined;
  return {
    playerId,
    settlementId: M2_SETTLEMENT_ID,
    residentCount: scale?.residents.filter((r) => r.settlementId === M2_SETTLEMENT_ID).length ?? personIds.length,
  };
}
/**
 * The person the shell currently controls: the slice's first resident.
 *
 * Deliberately derived from restored state rather than persisted as a flag, so
 * a load re-derives the same person instead of trusting a stored pointer.
 * Control *transfer* (descendants, M7) will replace this selection properly.
 */
export function sliceUnderControl(sim: Simulation): EntityId<"person"> | undefined {
  const scale = sim.world.systems.scale as ScaleSystemState | undefined;
  return scale?.residents.find((resident) => resident.settlementId === M2_SETTLEMENT_ID)?.personId;
}

