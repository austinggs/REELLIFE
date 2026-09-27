/**
 * Environment engine (System 46).
 *
 * Owns weather observations, the slow pollution/degradation state, hazard
 * conditions and disaster incidents. Writes go through the owning system's
 * scope exactly like every other state-owning engine; reads are scope-free.
 *
 * Deliberately *not* owned here (System 46 "Does not own"): infrastructure
 * maintenance, transport routing, medical treatment, government emergency policy
 * and individual decisions. Downstream damage therefore leaves this engine as
 * events and consequences; the environment only records the conditions and the
 * incident pipeline it owns.
 *
 * Registration is idempotent: a location's weather/pollution is upserted
 * (latest wins), ambient hazards are keyed by place + kind so re-evaluation
 * updates rather than duplicates, and the state slot is created once.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { WorldTime } from "../primitives/time.ts";
import {
  ambientHazards,
  nextPollution,
  weatherSnapshotFor,
  type DerivedWeather,
  type PollutionPressures,
} from "./dynamics.ts";
import {
  DISASTER_STAGES,
  type ClimateZone,
  type DisasterIncident,
  type DisasterStage,
  type DisasterStageRecord,
  type EnvironmentSystemState,
  type HazardCondition,
  type HazardKind,
  type PollutionState,
  type WeatherSnapshot,
} from "./types.ts";

const STAGE_INDEX: Readonly<Record<DisasterStage, number>> = (() => {
  const entries = DISASTER_STAGES.map((stage, index) => [stage, index] as const);
  return Object.fromEntries(entries) as Record<DisasterStage, number>;
})();

/**
 * Ambient hazard conditions carry an id derived from the place and the kind, so
 * re-evaluating the same place updates its conditions instead of piling up
 * duplicates. A hazard declared under any other id is explicit: the engine never
 * lifts it on its own.
 */
export function ambientHazardId(locationId: string, kind: HazardKind): string {
  return `HAZ-${locationId}-${kind}`;
}

/** Observation inputs: the climate and latitude are content, supplied by the caller. */
export interface ObserveWeatherInput {
  readonly locationId: string;
  readonly climate: ClimateZone;
  readonly latitude: number;
  /** 0 = January. */
  readonly monthIndex: number;
  readonly at: WorldTime;
  readonly variationKey?: string;
}

export interface ApplyPollutionInput extends PollutionPressures {
  readonly locationId: string;
  readonly at: WorldTime;
}

export interface EvaluateHazardsInput {
  readonly locationId: string;
  readonly climate: ClimateZone;
  /** The location's current weather, normally the snapshot `observeWeather` returned. */
  readonly weather: DerivedWeather;
  readonly pollution?: PollutionState;
  readonly at: WorldTime;
}

export interface RaiseDisasterInput {
  readonly id: string;
  readonly locationId: string;
  readonly kind: HazardKind;
  readonly at: WorldTime;
  /** The hazard condition this incident emerged from; it is lifted on promotion. */
  readonly hazardId?: string;
  readonly causalChainId?: string;
  readonly summary?: string;
  readonly magnitude?: number;
}

export interface AdvanceDisasterInput {
  readonly id: string;
  readonly stage: DisasterStage;
  readonly at: WorldTime;
  readonly summary: string;
  readonly magnitude?: number;
}

export class EnvironmentEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.environment) {
      this.scope.assertOwner("environment");
      this.world.systems.environment = {
        weather: [],
        pollution: [],
        hazards: [],
        disasters: [],
      } satisfies EnvironmentSystemState;
    }
  }

  private get state(): EnvironmentSystemState {
    return this.world.systems.environment as EnvironmentSystemState;
  }

  private set state(value: EnvironmentSystemState) {
    this.world.systems.environment = value;
  }

  // -------------------------------------------------------------- reads

  weather(): readonly WeatherSnapshot[] {
    return this.state.weather;
  }

  weatherAt(locationId: string): WeatherSnapshot | undefined {
    return this.state.weather.find((entry) => entry.locationId === locationId);
  }

  pollution(): readonly PollutionState[] {
    return this.state.pollution;
  }

  pollutionAt(locationId: string): PollutionState | undefined {
    return this.state.pollution.find((entry) => entry.locationId === locationId);
  }

  hazards(): readonly HazardCondition[] {
    return this.state.hazards;
  }

  hazardsAt(locationId: string): readonly HazardCondition[] {
    return this.state.hazards.filter((entry) => entry.locationId === locationId);
  }

  hazard(id: string): HazardCondition | undefined {
    return this.state.hazards.find((entry) => entry.id === id);
  }

  disasters(): readonly DisasterIncident[] {
    return this.state.disasters;
  }

  disaster(id: string): DisasterIncident | undefined {
    return this.state.disasters.find((entry) => entry.id === id);
  }

  disastersAt(locationId: string): readonly DisasterIncident[] {
    return this.state.disasters.filter((entry) => entry.locationId === locationId);
  }

  /** Disasters that have not yet reached recovery (still an ongoing situation). */
  activeDisasters(): readonly DisasterIncident[] {
    return this.state.disasters.filter((entry) => entry.stage !== "recovery");
  }

  // -------------------------------------------------------------- writes

  /** Upserts the authoritative weather for a location (latest wins). */
  setWeather(snapshot: WeatherSnapshot): WeatherSnapshot {
    this.scope.assertOwner("environment");
    if (!snapshot.locationId) {
      throw new Error("EnvironmentEngine.setWeather: locationId is required");
    }
    const rest = this.state.weather.filter((entry) => entry.locationId !== snapshot.locationId);
    this.state = { ...this.state, weather: [...rest, snapshot] };
    return snapshot;
  }

  /**
   * Derives and records the weather for a location. The derivation is a pure
   * function of climate, latitude, month and location id, so calling this twice
   * for the same month observes the same weather and does not consume any RNG.
   */
  observeWeather(input: ObserveWeatherInput): WeatherSnapshot {
    this.scope.assertOwner("environment");
    return this.setWeather(weatherSnapshotFor(input));
  }

  /** Upserts the pollution/degradation state for a location. */
  setPollution(record: PollutionState): PollutionState {
    this.scope.assertOwner("environment");
    if (!record.locationId) {
      throw new Error("EnvironmentEngine.setPollution: locationId is required");
    }
    if (
      record.airQualityIndex < 0 ||
      record.airQualityIndex > 1 ||
      record.waterStress < 0 ||
      record.waterStress > 1 ||
      record.degradation < 0 ||
      record.degradation > 1
    ) {
      throw new Error("EnvironmentEngine.setPollution: indices must be in [0, 1]");
    }
    const rest = this.state.pollution.filter((entry) => entry.locationId !== record.locationId);
    this.state = { ...this.state, pollution: [...rest, record] };
    return record;
  }

  /**
   * Applies one period of environmental pressure to a location, creating its
   * pollution record if it has none yet. Degradation only ever accrues
   * (System 46: slow-moving and cumulative).
   */
  applyPollution(input: ApplyPollutionInput): PollutionState {
    this.scope.assertOwner("environment");
    return this.setPollution(
      nextPollution({
        locationId: input.locationId,
        current: this.pollutionAt(input.locationId),
        pressures: input,
        at: input.at,
      }),
    );
  }

  /** Declares a live hazard condition at a location. */
  declareHazard(hazard: HazardCondition): HazardCondition {
    this.scope.assertOwner("environment");
    if (!hazard.id) throw new Error("EnvironmentEngine.declareHazard: id is required");
    if (this.hazard(hazard.id)) {
      throw new Error(`EnvironmentEngine.declareHazard: duplicate hazard ${hazard.id}`);
    }
    if (hazard.intensity < 0 || hazard.intensity > 1) {
      throw new Error("EnvironmentEngine.declareHazard: intensity must be in [0, 1]");
    }
    this.state = { ...this.state, hazards: [...this.state.hazards, hazard] };
    return hazard;
  }

  /** Removes a hazard condition once it has been assessed or resolved. */
  liftHazard(id: string): void {
    this.scope.assertOwner("environment");
    if (!this.hazard(id)) return;
    this.state = {
      ...this.state,
      hazards: this.state.hazards.filter((entry) => entry.id !== id),
    };
  }

  /**
   * Brings a location's ambient hazard conditions in line with its current
   * weather and pollution: conditions that no longer hold are lifted, conditions
   * that do are declared (or have their intensity refreshed). Explicitly
   * declared hazards — anything not using the ambient id scheme — are untouched.
   *
   * Returns the ambient conditions currently present, in rule order.
   */
  evaluateHazards(input: EvaluateHazardsInput): readonly HazardCondition[] {
    this.scope.assertOwner("environment");
    const implied = ambientHazards({
      climate: input.climate,
      weather: input.weather,
      ...(input.pollution ? { pollution: input.pollution } : {}),
    });

    const prefix = `HAZ-${input.locationId}-`;
    const existing = new Map(this.state.hazards.map((hazard) => [hazard.id, hazard]));

    // Every ambient condition of this place is re-derived below, so the previous
    // set is replaced wholesale. Conditions declared under any other id are not
    // the engine's to lift and are kept exactly as they are.
    const surviving = this.state.hazards.filter((hazard) => !hazard.id.startsWith(prefix));

    const current = implied.map(({ kind, intensity }): HazardCondition => {
      const id = ambientHazardId(input.locationId, kind);
      const previous = existing.get(id);
      // `since` records when the condition first appeared, not when it was last
      // refreshed, so a long drought keeps its start date.
      return previous
        ? { ...previous, intensity }
        : { id, locationId: input.locationId, kind, intensity, since: input.at };
    });

    this.state = { ...this.state, hazards: [...surviving, ...current] };
    return current;
  }

  // ------------------------------------------------- disaster pipeline

  /**
   * Promotes a hazard condition into a disaster incident. The incident starts at
   * the `hazard` stage, and any source condition it came from is lifted: the
   * hazard has become the incident (System 46 pipeline, stage 1 of 6).
   */
  raiseDisaster(input: RaiseDisasterInput): DisasterIncident {
    this.scope.assertOwner("environment");
    if (!input.id) throw new Error("EnvironmentEngine.raiseDisaster: id is required");
    if (this.disaster(input.id)) {
      throw new Error(`EnvironmentEngine.raiseDisaster: duplicate disaster ${input.id}`);
    }
    if (input.hazardId && !this.hazard(input.hazardId)) {
      throw new Error(`EnvironmentEngine.raiseDisaster: unknown hazard ${input.hazardId}`);
    }

    const record: DisasterStageRecord = {
      stage: "hazard",
      at: input.at,
      summary: input.summary ?? `${input.kind} hazard assessed at ${input.locationId}`,
      ...(input.magnitude !== undefined ? { magnitude: input.magnitude } : {}),
    };

    const incident: DisasterIncident = {
      id: input.id,
      locationId: input.locationId,
      kind: input.kind,
      stage: "hazard",
      startedAt: input.at,
      history: [record],
      ...(input.hazardId ? { hazardId: input.hazardId } : {}),
      ...(input.causalChainId ? { causalChainId: input.causalChainId } : {}),
    };

    this.state = { ...this.state, disasters: [...this.state.disasters, incident] };
    if (input.hazardId) this.liftHazard(input.hazardId);
    return incident;
  }

  /**
   * Moves a disaster exactly one stage forward: hazard -> exposure ->
   * vulnerability -> impact -> response -> recovery.
   *
   * Stages cannot be skipped or revisited. That is a deliberate constraint, not
   * a convenience: the pipeline is the environment's record of *why* an impact
   * happened, and a skipped stage would leave the causal chain (System 59)
   * claiming an effect with no recorded cause.
   */
  advanceDisaster(input: AdvanceDisasterInput): DisasterIncident {
    this.scope.assertOwner("environment");
    const incident = this.disaster(input.id);
    if (!incident) {
      throw new Error(`EnvironmentEngine.advanceDisaster: unknown disaster ${input.id}`);
    }

    const currentIndex = STAGE_INDEX[incident.stage];
    const nextStage = DISASTER_STAGES[currentIndex + 1];
    if (!nextStage) {
      throw new Error(
        `EnvironmentEngine.advanceDisaster: ${input.id} has already reached "${incident.stage}"`,
      );
    }
    if (input.stage !== nextStage) {
      throw new Error(
        `EnvironmentEngine.advanceDisaster: ${input.id} is at "${incident.stage}" and can only advance to "${nextStage}"`,
      );
    }

    const record: DisasterStageRecord = {
      stage: input.stage,
      at: input.at,
      summary: input.summary,
      ...(input.magnitude !== undefined ? { magnitude: input.magnitude } : {}),
    };

    const updated: DisasterIncident = {
      ...incident,
      stage: input.stage,
      history: [...incident.history, record],
    };

    this.state = {
      ...this.state,
      disasters: this.state.disasters.map((entry) => (entry.id === input.id ? updated : entry)),
    };
    return updated;
  }
}

