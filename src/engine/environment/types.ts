/**
 * System 46 — Weather / Environment / Disasters.
 *
 * The environment system owns *conditions*: weather, pollution/degradation,
 * hazard conditions and disaster incidents. It never owns the things a disaster
 * damages — infrastructure, transport, health, housing, businesses and
 * government each own their own state (System 46 "Does not own"). A disaster is
 * therefore a pipeline (hazard -> exposure -> vulnerability -> impact ->
 * response -> recovery) over the environment's own records, while downstream
 * damage travels out through events and consequences to the systems that own
 * the affected facts.
 *
 * Core principle (System 46): disasters emerge from hazard, exposure and
 * vulnerability — never from a single "disaster chance" number.
 */

import type { WorldTime } from "../primitives/time.ts";

/**
 * Canonical broad climate zones (World Build 01 section 5). The authored
 * per-region climate descriptors in `canon.ts` are normalised onto these eight
 * via `classifyClimate` in `src/content/aurelia/environment.ts`.
 */
export const CLIMATE_ZONES = [
  "tropical",
  "subtropical",
  "temperate",
  "arid",
  "semi_arid",
  "alpine",
  "subpolar",
  "polar",
] as const;
export type ClimateZone = (typeof CLIMATE_ZONES)[number];

/** Observable weather condition (World Build 01 sections 5 & 7). */
export const WEATHER_CONDITIONS = [
  "clear",
  "partly_cloudy",
  "overcast",
  "rain",
  "storm",
  "snow",
  "heatwave",
  "cold_snap",
  "fog",
  "windy",
  "drought",
] as const;
export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];

/** One authoritative weather observation for a location (latest wins). */
export interface WeatherSnapshot {
  readonly locationId: string;
  readonly climate: ClimateZone;
  readonly condition: WeatherCondition;
  readonly temperatureCelsius: number;
  readonly precipitationMm: number;
  readonly windKph: number;
  readonly observedAt: WorldTime;
}

/** Hazard kinds (World Build 01 section 7). */
export const HAZARD_KINDS = [
  "flood",
  "drought",
  "storm",
  "wildfire",
  "earthquake",
  "volcanic",
  "landslide",
  "extreme_heat",
  "pollution",
  "degradation",
] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

/** Slow-moving environmental state; degradation is cumulative (System 46). */
export interface PollutionState {
  readonly locationId: string;
  /** Air quality index in [0, 1]; 0 clean, 1 hazardous. */
  readonly airQualityIndex: number;
  /** Water stress in [0, 1]. */
  readonly waterStress: number;
  /** Cumulative environmental degradation in [0, 1]; never decreases on its own. */
  readonly degradation: number;
  readonly updatedAt: WorldTime;
}

/** A live hazard condition at a location (before it becomes an incident). */
export interface HazardCondition {
  readonly id: string;
  readonly locationId: string;
  readonly kind: HazardKind;
  /** Severity of the hazard condition itself, in [0, 1]. */
  readonly intensity: number;
  readonly since: WorldTime;
}

/** Disaster pipeline stages (System 46). */
export const DISASTER_STAGES = [
  "hazard",
  "exposure",
  "vulnerability",
  "impact",
  "response",
  "recovery",
] as const;
export type DisasterStage = (typeof DISASTER_STAGES)[number];

/** One step in a disaster's causal pipeline, kept in order. */
export interface DisasterStageRecord {
  readonly stage: DisasterStage;
  readonly at: WorldTime;
  readonly summary: string;
  /**
   * The magnitude recorded at this stage, in [0, 1] where meaningful: impact
   * severity at the `impact` stage, coverage/progress at `response`/`recovery`.
   * Absent when the stage has no number to record.
   */
  readonly magnitude?: number;
}

/**
 * A disaster incident: a hazard that has been assessed and is moving (or has
 * moved) through the pipeline. `stage` is always the last recorded stage, so it
 * can never disagree with `history`.
 */
export interface DisasterIncident {
  readonly id: string;
  readonly causalChainId?: string;
  /** The hazard condition this incident emerged from, when there was one. */
  readonly hazardId?: string;
  readonly locationId: string;
  readonly kind: HazardKind;
  readonly stage: DisasterStage;
  readonly startedAt: WorldTime;
  readonly history: readonly DisasterStageRecord[];
}

/**
 * The environment's persistent state.
 *
 * Weather is stored as the latest observation per location, not as a growing
 * log: weather is derived from climate, latitude and time, so an old snapshot
 * can always be recomputed (law 9, derived state remains derived). Disaster
 * occurrences that other systems must know about travel through the event
 * engine; the per-incident `history` here is the environment's own record of the
 * pipeline it ran.
 */
export interface EnvironmentSystemState {
  readonly weather: readonly WeatherSnapshot[];
  readonly pollution: readonly PollutionState[];
  readonly hazards: readonly HazardCondition[];
  readonly disasters: readonly DisasterIncident[];
}
