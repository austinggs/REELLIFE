/**
 * Deterministic environment dynamics (System 46).
 *
 * Weather *derivation* is deterministic content, not runtime chance: given a
 * climate, latitude, month and a variation key, the same inputs always produce
 * the same conditions (the same reasoning as the canonical population
 * distribution). The engine holds the mutable state; these functions compute the
 * next value without touching the seeded RNG.
 *
 * The disaster pipeline functions (`assessExposure`, `assessVulnerability`,
 * `impactSeverity`) implement the System 46 core principle: impact emerges from
 * hazard, exposure and vulnerability together — not from a single chance. For
 * the same reason `ambientHazards` derives hazard conditions from weather and
 * the slow environmental state instead of rolling a "disaster chance" number: a
 * place has a drought because it is arid and dry, not because a die said so.
 *
 * Every numeric parameter here is provisional (the World Bible does not author
 * exact figures); see docs/CONTENT_GAPS.md.
 */

import type { WorldTime } from "../primitives/time.ts";
import { fnv1a32 } from "../rng/hash.ts";
import type {
  ClimateZone,
  HazardKind,
  PollutionState,
  WeatherCondition,
  WeatherSnapshot,
} from "./types.ts";

const BASE_TEMPERATURE_C: Readonly<Record<ClimateZone, number>> = {
  tropical: 27,
  subtropical: 22,
  temperate: 12,
  arid: 25,
  semi_arid: 19,
  alpine: 2,
  subpolar: -2,
  polar: -16,
};

const SEASONAL_AMPLITUDE_C: Readonly<Record<ClimateZone, number>> = {
  tropical: 3,
  subtropical: 8,
  temperate: 12,
  arid: 14,
  semi_arid: 15,
  alpine: 9,
  subpolar: 15,
  polar: 14,
};

const BASE_PRECIPITATION_MM: Readonly<Record<ClimateZone, number>> = {
  tropical: 220,
  subtropical: 95,
  temperate: 70,
  arid: 10,
  semi_arid: 28,
  alpine: 90,
  subpolar: 40,
  polar: 15,
};

const BASE_WIND_KPH: Readonly<Record<ClimateZone, number>> = {
  tropical: 10,
  subtropical: 14,
  temperate: 16,
  arid: 18,
  semi_arid: 18,
  alpine: 20,
  subpolar: 22,
  polar: 24,
};

/** How dry a climate is, in [0, 1]; used by the drought and wildfire rules. */
const DRYNESS: Readonly<Record<ClimateZone, number>> = {
  tropical: 0,
  subtropical: 0.35,
  temperate: 0.2,
  arid: 1,
  semi_arid: 0.75,
  alpine: 0.25,
  subpolar: 0.35,
  polar: 0.5,
};

/** Below this an implied hazard condition is not considered present. */
export const HAZARD_THRESHOLD = 0.05;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Mediterranean-like climates are wet in winter and dry in summer. */
function isWinterWet(climate: ClimateZone): boolean {
  return climate === "subtropical";
}

// ---------------------------------------------------------------- weather

export interface DerivedWeather {
  readonly condition: WeatherCondition;
  readonly temperatureCelsius: number;
  readonly precipitationMm: number;
  readonly windKph: number;
}

/**
 * Derives a deterministic weather condition for a climate at a latitude for a
 * given month (0 = January). The `variationKey` separates locations that share a
 * climate/month (e.g. two desert cities) without consuming RNG, which is what
 * keeps weather location-dependent instead of globally uniform (System 46).
 */
export function deriveWeather(
  climate: ClimateZone,
  latitude: number,
  monthIndex: number,
  variationKey: string = climate,
): DerivedWeather {
  const base = BASE_TEMPERATURE_C[climate];
  const amplitude = SEASONAL_AMPLITUDE_C[climate];
  // Northern hemisphere peaks in July (month 6), southern in January (month 0).
  const peakMonth = latitude >= 0 ? 6 : 0;
  const phase = Math.cos(((monthIndex - peakMonth) / 12) * 2 * Math.PI);

  const hash = fnv1a32(`${variationKey}:${monthIndex}`);
  const jitter = hash / 0xffff_ffff - 0.5; // -0.5 .. 0.5

  const temperatureCelsius = round1(base + amplitude * phase + jitter * 3);
  const precipitationPhase = isWinterWet(climate) ? -phase : phase;
  const precipitationMm = round1(
    Math.max(0, BASE_PRECIPITATION_MM[climate] * (1 + 0.5 * precipitationPhase) + jitter * 15),
  );
  const windKph = Math.max(0, Math.round(BASE_WIND_KPH[climate] + jitter * 12));

  return {
    condition: conditionFor(temperatureCelsius, precipitationMm, windKph, hash),
    temperatureCelsius,
    precipitationMm,
    windKph,
  };
}

/**
 * Reads the observable condition off the derived numbers. Order matters: an
 * extreme temperature dominates (a hot storm day reads as a heatwave), then
 * precipitation, then the hash only breaks ties between calm conditions.
 */
function conditionFor(
  temperatureCelsius: number,
  precipitationMm: number,
  windKph: number,
  hash: number,
): WeatherCondition {
  if (temperatureCelsius >= 34) return "heatwave";
  if (temperatureCelsius <= -10) return "cold_snap";
  if (precipitationMm >= 60) return "storm";
  if (precipitationMm >= 12) return temperatureCelsius <= 1 ? "snow" : "rain";
  if (precipitationMm >= 3) return "overcast";
  if (windKph >= 40) return "windy";
  if (hash % 5 === 0) return "fog";
  return hash % 2 === 0 ? "clear" : "partly_cloudy";
}

export interface WeatherObservationInput {
  readonly locationId: string;
  readonly climate: ClimateZone;
  readonly latitude: number;
  readonly monthIndex: number;
  readonly at: WorldTime;
  /** Defaults to the location id, so two places in one climate still differ. */
  readonly variationKey?: string;
}

/** Builds the authoritative snapshot the environment stores for a location. */
export function weatherSnapshotFor(input: WeatherObservationInput): WeatherSnapshot {
  const derived = deriveWeather(
    input.climate,
    input.latitude,
    input.monthIndex,
    input.variationKey ?? input.locationId,
  );
  return {
    locationId: input.locationId,
    climate: input.climate,
    condition: derived.condition,
    temperatureCelsius: derived.temperatureCelsius,
    precipitationMm: derived.precipitationMm,
    windKph: derived.windKph,
    observedAt: input.at,
  };
}

// -------------------------------------------------------------- pollution

/**
 * Slow environmental pressures applied to a location. Environmental degradation
 * is cumulative (System 46): it accrues while pressure exceeds relief and is
 * never reversed by a single period of mitigation.
 */
export interface PollutionPressures {
  /** 0 none .. 1 severe emissions. */
  readonly emissions: number;
  /** 0 none .. 1 severe water extraction/contamination. */
  readonly waterDraw: number;
  /** 0 none .. 1 full mitigation (regulation, clean-up, replanting). */
  readonly mitigation: number;
}

export interface PollutionInput {
  readonly locationId: string;
  readonly current?: PollutionState;
  readonly pressures: PollutionPressures;
  readonly at: WorldTime;
}

/**
 * Applies one period of environmental pressure. Air and water quality both
 * relax towards clean water/air on their own (their decay term), and mitigation
 * speeds that relaxation while slowing — but never undoing — degradation.
 */
export function nextPollution(input: PollutionInput): PollutionState {
  const emissions = clamp01(input.pressures.emissions);
  const waterDraw = clamp01(input.pressures.waterDraw);
  const mitigation = clamp01(input.pressures.mitigation);
  const relief = 0.5 * mitigation;

  const air = input.current?.airQualityIndex ?? 0.05;
  const water = input.current?.waterStress ?? 0.05;
  const degradation = input.current?.degradation ?? 0;
  const pressure = (emissions + waterDraw) / 2;

  return {
    locationId: input.locationId,
    airQualityIndex: clamp01(round4(air + (emissions - relief - air * 0.05) * 0.25)),
    waterStress: clamp01(round4(water + (waterDraw - relief - water * 0.05) * 0.25)),
    // monotonic by construction: Math.max(0, …) means degradation cannot fall.
    degradation: clamp01(round4(degradation + Math.max(0, pressure - relief) * 0.01)),
    updatedAt: input.at,
  };
}

// -------------------------------------------------- exposure & vulnerability

/**
 * Exposure factors: how much a hazard is *present at* and *faced by* a place.
 * Higher is worse (System 46: exposure depends on location, infrastructure,
 * housing, transport, density and timing).
 */
export interface ExposureFactors {
  readonly populationDensity: number; // 0 sparse .. 1 dense
  readonly infrastructureQuality: number; // 0 poor .. 1 robust
  readonly housingQuality: number; // 0 poor .. 1 resilient
  readonly transportDependency: number; // 0 self-contained .. 1 dependent
  readonly timingFactor: number; // 0 benign .. 1 worst-case timing
}

export function assessExposure(factors: ExposureFactors): number {
  return clamp01(
    factors.populationDensity * 0.25 +
      (1 - factors.infrastructureQuality) * 0.2 +
      (1 - factors.housingQuality) * 0.2 +
      factors.transportDependency * 0.15 +
      factors.timingFactor * 0.2,
  );
}

/**
 * Vulnerability factors: how badly an exposed population is hurt. Higher is
 * worse (System 46: vulnerability depends on building quality, health,
 * dependency, resources, preparedness, infrastructure and access).
 */
export interface VulnerabilityFactors {
  readonly buildingQuality: number; // 0 weak .. 1 strong
  readonly health: number; // 0 poor .. 1 good
  readonly dependency: number; // 0 none .. 1 highly dependent share
  readonly resources: number; // 0 none .. 1 ample
  readonly preparedness: number; // 0 none .. 1 prepared
  readonly infrastructure: number; // 0 poor .. 1 good
  readonly access: number; // 0 none .. 1 full access
}

export function assessVulnerability(factors: VulnerabilityFactors): number {
  return clamp01(
    (1 - factors.buildingQuality) * 0.2 +
      (1 - factors.health) * 0.15 +
      factors.dependency * 0.15 +
      (1 - factors.resources) * 0.15 +
      (1 - factors.preparedness) * 0.15 +
      (1 - factors.infrastructure) * 0.1 +
      (1 - factors.access) * 0.1,
  );
}

/**
 * Combined impact severity. Monotonic in all three inputs; a zero-intensity
 * hazard produces zero impact, and impact rises with exposure and vulnerability.
 */
export function impactSeverity(
  hazardIntensity: number,
  exposure: number,
  vulnerability: number,
): number {
  const h = clamp01(hazardIntensity);
  const e = clamp01(exposure);
  const v = clamp01(vulnerability);
  return clamp01(h * (0.5 + 0.5 * e) * (0.4 + 0.6 * v));
}

/**
 * Ambient hazard rules (System 46 core principle).
 *
 * These are *conditions*, not incidents: a place has a drought because it is
 * arid and dry, not because a chance roll succeeded. Every rule reads the
 * weather and the slow environmental state, so hazards differ by region and
 * month without any randomness (law 8 stays intact, and law 9 keeps the derived
 * weather derived).
 *
 * Tectonic hazards (earthquake, volcanic) deliberately have no ambient rule
 * here: unlike flood or drought they are not implied by weather or pollution.
 * They are declared as conditions by whoever owns the trigger (a scenario, and
 * later the global-events system), and then run through the same pipeline.
 */

/** A hazard condition implied by the environment, before it becomes an incident. */
export interface AmbientHazard {
  readonly kind: HazardKind;
  readonly intensity: number;
}

export interface AmbientHazardInput {
  readonly climate: ClimateZone;
  readonly weather: DerivedWeather;
  /** Slow environmental state, when the place has one. */
  readonly pollution?: Pick<PollutionState, "airQualityIndex" | "waterStress" | "degradation">;
}

/** Precipitation (mm) at/above which water excess starts to matter. */
const FLOOD_ONSET_MM = 40;
/** Precipitation (mm) below which even a dry climate is in deficit. */
const DROUGHT_ONSET_MM = 6;

export function ambientHazards(input: AmbientHazardInput): readonly AmbientHazard[] {
  const { climate, weather, pollution } = input;
  const temperature = weather.temperatureCelsius;
  const precipitation = weather.precipitationMm;
  const dryness = DRYNESS[climate];
  const hazards: AmbientHazard[] = [];

  const add = (kind: HazardKind, intensity: number): void => {
    const value = clamp01(intensity);
    if (value >= HAZARD_THRESHOLD) hazards.push({ kind, intensity: round4(value) });
  };

  // Water excess: rain the ground cannot absorb; worse where water is stressed.
  const excess = Math.max(0, precipitation - FLOOD_ONSET_MM) / 80;
  add("flood", excess * (0.8 + 0.2 * (pollution?.waterStress ?? 0)));
  if (weather.condition === "storm") {
    add(
      "storm",
      Math.max(0.2, clamp01((precipitation - FLOOD_ONSET_MM) / 160) + weather.windKph / 300),
    );
  }

  // Water deficit: a dry place in a dry month.
  add("drought", dryness * clamp01((DROUGHT_ONSET_MM - precipitation) / DROUGHT_ONSET_MM));

  // Heat is a hazard on its own, and worse where the air is already bad.
  if (temperature >= 34) {
    add("extreme_heat", clamp01((temperature - 34) / 10) * (0.9 + 0.1 * (pollution?.airQualityIndex ?? 0)));
  }

  // Fire needs heat, dry fuel and wind together.
  if (temperature >= 26 && precipitation < 8) {
    add(
      "wildfire",
      clamp01((temperature - 26) / 14) *
        clamp01((8 - precipitation) / 8) *
        (0.5 + 0.5 * clamp01(weather.windKph / 60)) *
        (0.4 + 0.6 * dryness),
    );
  }

  // Slope failure: heavy rain on high ground.
  if (climate === "alpine") {
    add("landslide", clamp01((precipitation - 60) / 80));
  }

  // Slow environmental state becomes a hazard condition in its own right.
  if (pollution) {
    add("pollution", (pollution.airQualityIndex - 0.5) / 0.5);
    add("degradation", (pollution.degradation - 0.5) / 0.5);
  }

  return hazards;
}
