/**
 * System 46 — weather / environment / disasters.
 *
 * Verifies the two things the spec is emphatic about: weather is
 * location/time dependent and deterministic (so it can be derived, not rolled),
 * and a disaster emerges from hazard, exposure and vulnerability together — the
 * engine never consults a single "disaster chance" number.
 */

import { describe, expect, it } from "vitest";
import {
  createKernelSimulation,
  loadKernelSimulation,
} from "../../src/engine/kernel/bootstrap.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import { EnvironmentEngine, ambientHazardId } from "../../src/engine/environment/engine.ts";
import {
  HAZARD_THRESHOLD,
  ambientHazards,
  assessExposure,
  assessVulnerability,
  deriveWeather,
  impactSeverity,
  nextPollution,
} from "../../src/engine/environment/dynamics.ts";
import { CLIMATE_ZONES, WEATHER_CONDITIONS, type HazardCondition } from "../../src/engine/environment/types.ts";
import {
  AURELIA_REGION_CLIMATES,
  AURELIA_WEATHER_PLACES,
  CLIMATE_ZONE_BY_DESCRIPTOR,
  aureliaWeatherPlace,
  classifyClimate,
  climateZoneAt,
  climateZoneOfRegion,
} from "../../src/content/aurelia/environment.ts";
import { CANON_REGIONS, CANON_SETTLEMENTS } from "../../src/content/aurelia/canon.ts";
import { addTime, atTime, days } from "../../src/engine/primitives/time.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";

const SEED = "reellife-environment-seed";

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
}

function withEnvironment<T>(sim: Simulation, fn: (engine: EnvironmentEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("environment", () => {
    result = fn(new EnvironmentEngine(sim.scope, sim.world));
  });
  return result;
}

type DerivedWeather = ReturnType<typeof deriveWeather>;

/** Explicit weather, so each rule can be tested against exact conditions. */
function weather(overrides: Partial<DerivedWeather> = {}): DerivedWeather {
  return {
    condition: "clear",
    temperatureCelsius: 20,
    precipitationMm: 0,
    windKph: 5,
    ...overrides,
  };
}

function intensityOf(hazards: readonly { kind: string; intensity: number }[], kind: string): number {
  return hazards.find((hazard) => hazard.kind === kind)?.intensity ?? 0;
}

describe("Aurelia climate content (System 46 × World Bible 01)", () => {
  it("normalises the 36 authored regional climates onto the 8 canonical zones", () => {
    const descriptors = CANON_REGIONS.map((region) => region.climate);
    expect(descriptors).toHaveLength(36);
    expect(Object.keys(CLIMATE_ZONE_BY_DESCRIPTOR)).toHaveLength(36);

    for (const descriptor of descriptors) {
      expect(CLIMATE_ZONES).toContain(classifyClimate(descriptor));
    }

    // Every zone the World Bible names is actually represented in canon, and no
    // region was left without one.
    expect(new Set(descriptors.map(classifyClimate)).size).toBe(CLIMATE_ZONES.length);
    expect(Object.keys(AURELIA_REGION_CLIMATES)).toHaveLength(36);

    expect(climateZoneOfRegion("REGION-GREAT-INTERIOR")).toBe("arid");
    expect(climateZoneAt("CITY-ARDEN")).toBe("temperate");
    expect(climateZoneAt("CITY-CROWNREACH")).toBe("alpine");
    expect(climateZoneAt("CITY-VARENPORT")).toBe("subtropical");
    // A continent or an ocean is not a place with a single climate.
    expect(climateZoneAt("WORLD-AURELIA")).toBeUndefined();

    expect(() => classifyClimate("volcanic_wasteland")).toThrow(/Unknown Aurelia climate descriptor/);
  });

  it("exposes every canonical region and settlement as a weather place", () => {
    expect(AURELIA_WEATHER_PLACES).toHaveLength(CANON_REGIONS.length + CANON_SETTLEMENTS.length);
    expect(new Set(AURELIA_WEATHER_PLACES.map((place) => place.locationId)).size).toBe(
      AURELIA_WEATHER_PLACES.length,
    );

    const arden = aureliaWeatherPlace("CITY-ARDEN");
    expect(arden?.climate).toBe("temperate");
    expect(arden?.latitude).toBe(34.2);
    expect(aureliaWeatherPlace("OCEAN-MERIDIAN")).toBeUndefined();

    // A settlement's zone is its region's zone, never an independent claim.
    for (const settlement of CANON_SETTLEMENTS) {
      expect(aureliaWeatherPlace(settlement.id)?.climate).toBe(
        climateZoneOfRegion(settlement.regionId),
      );
    }
  });
});

describe("weather derivation (System 46, law 8 / law 9)", () => {
  it("is deterministic for the same place, climate and month", () => {
    const first = deriveWeather("temperate", 34.2, 6, "CITY-ARDEN");
    const second = deriveWeather("temperate", 34.2, 6, "CITY-ARDEN");
    expect(second).toEqual(first);
    expect(WEATHER_CONDITIONS).toContain(first.condition);
  });

  it("differs between places that share a climate, so weather is not uniform", () => {
    const temperatePlaces = AURELIA_WEATHER_PLACES.filter((place) => place.climate === "temperate");
    expect(temperatePlaces.length).toBeGreaterThan(10);

    const temperatures = new Set(
      temperatePlaces.map(
        (place) => deriveWeather(place.climate, place.latitude, 6, place.locationId).temperatureCelsius,
      ),
    );
    expect(temperatures.size).toBeGreaterThan(4);
  });

  it("follows the canonical latitudes through the seasons", () => {
    const northJuly = deriveWeather("temperate", 48, 6, "CITY-VEYR");
    const northJanuary = deriveWeather("temperate", 48, 0, "CITY-VEYR");
    const southJuly = deriveWeather("temperate", -42, 6, "CITY-LYREN");
    const southJanuary = deriveWeather("temperate", -42, 0, "CITY-LYREN");

    expect(northJuly.temperatureCelsius).toBeGreaterThan(northJanuary.temperatureCelsius);
    expect(southJuly.temperatureCelsius).toBeLessThan(southJanuary.temperatureCelsius);

    // The arid zone is drier than the tropical zone in every month of the year.
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      expect(deriveWeather("arid", 10, monthIndex, "REGION-GREAT-INTERIOR").precipitationMm).toBeLessThan(
        deriveWeather("tropical", -6, monthIndex, "REGION-RAINFOREST-BELT").precipitationMm,
      );
    }
  });
});

describe("hazard, exposure and vulnerability (System 46 core principle)", () => {
  it("derives hazard conditions from the environment, not from a chance roll", () => {
    // Arid, hot and dry: a drought and a heat hazard, but no flood.
    const arid = ambientHazards({
      climate: "arid",
      weather: weather({ temperatureCelsius: 38, precipitationMm: 1 }),
    });
    const aridKinds = arid.map((hazard) => hazard.kind);
    expect(aridKinds).toContain("drought");
    expect(aridKinds).toContain("extreme_heat");
    expect(aridKinds).not.toContain("flood");

    // A tropical storm: water excess, no water deficit.
    const stormHazards = ambientHazards({
      climate: "tropical",
      weather: weather({ condition: "storm", precipitationMm: 120, windKph: 60 }),
    });
    const stormKinds = stormHazards.map((hazard) => hazard.kind);
    expect(stormKinds).toContain("flood");
    expect(stormKinds).toContain("storm");
    expect(stormKinds).not.toContain("drought");

    // A benign temperate day implies no hazard condition at all.
    expect(
      ambientHazards({
        climate: "temperate",
        weather: weather({ temperatureCelsius: 18, precipitationMm: 6 }),
      }),
    ).toEqual([]);

    // Intensity tracks the driving condition (monotonic, and never random).
    const rain = ambientHazards({ climate: "tropical", weather: weather({ precipitationMm: 60 }) });
    const downpour = ambientHazards({ climate: "tropical", weather: weather({ precipitationMm: 110 }) });
    expect(intensityOf(downpour, "flood")).toBeGreaterThan(intensityOf(rain, "flood"));

    for (const hazard of [...arid, ...stormHazards, ...downpour]) {
      expect(hazard.intensity).toBeGreaterThanOrEqual(HAZARD_THRESHOLD);
      expect(hazard.intensity).toBeLessThanOrEqual(1);
    }
  });

  it("turns severe pollution and degradation into hazard conditions of their own", () => {
    const clean = ambientHazards({
      climate: "temperate",
      weather: weather({ temperatureCelsius: 18, precipitationMm: 6 }),
      pollution: { airQualityIndex: 0.2, waterStress: 0.1, degradation: 0.2 },
    });
    expect(clean.map((hazard) => hazard.kind)).not.toContain("pollution");

    const dirty = ambientHazards({
      climate: "temperate",
      weather: weather({ temperatureCelsius: 18, precipitationMm: 6 }),
      pollution: { airQualityIndex: 0.8, waterStress: 0.1, degradation: 0.6 },
    });
    expect(dirty.map((hazard) => hazard.kind)).toEqual(["pollution", "degradation"]);
    expect(intensityOf(dirty, "pollution")).toBeCloseTo(0.6, 6);
  });

  it("computes impact from hazard, exposure and vulnerability together", () => {
    const densePoor = assessExposure({
      populationDensity: 1,
      infrastructureQuality: 0,
      housingQuality: 0,
      transportDependency: 1,
      timingFactor: 1,
    });
    const sparseRobust = assessExposure({
      populationDensity: 0,
      infrastructureQuality: 1,
      housingQuality: 1,
      transportDependency: 0,
      timingFactor: 0,
    });
    expect(densePoor).toBe(1);
    expect(sparseRobust).toBe(0);

    const fragile = assessVulnerability({
      buildingQuality: 0,
      health: 0,
      dependency: 1,
      resources: 0,
      preparedness: 0,
      infrastructure: 0,
      access: 0,
    });
    const prepared = assessVulnerability({
      buildingQuality: 1,
      health: 1,
      dependency: 0,
      resources: 1,
      preparedness: 1,
      infrastructure: 1,
      access: 1,
    });
    expect(fragile).toBe(1);
    expect(prepared).toBe(0);

    // A hazard with no intensity has no impact, and each input raises it.
    expect(impactSeverity(0, 1, 1)).toBe(0);
    const base = impactSeverity(0.5, 0.5, 0.5);
    expect(impactSeverity(0.8, 0.5, 0.5)).toBeGreaterThan(base);
    expect(impactSeverity(0.5, 0.9, 0.5)).toBeGreaterThan(base);
    expect(impactSeverity(0.5, 0.5, 0.9)).toBeGreaterThan(base);

    // The same hazard hurts a dense, fragile place more than a prepared one.
    const impoverished = impactSeverity(0.9, densePoor, fragile);
    expect(impoverished).toBeGreaterThan(impactSeverity(0.9, sparseRobust, prepared));
    expect(impoverished).toBeLessThanOrEqual(1);
  });

  it("accrues environmental degradation and never reverses it", () => {
    const at = atTime(0);
    const pressured = { emissions: 0.9, waterDraw: 0.6, mitigation: 0 };

    const first = nextPollution({ locationId: "CITY-CALDOR", pressures: pressured, at });
    expect(first.degradation).toBeGreaterThan(0);
    expect(first.airQualityIndex).toBeGreaterThan(0.05);

    const second = nextPollution({
      locationId: "CITY-CALDOR",
      current: first,
      pressures: pressured,
      at,
    });
    expect(second.degradation).toBeGreaterThan(first.degradation);
    expect(second.airQualityIndex).toBeGreaterThan(first.airQualityIndex);

    // Mitigation reduces both the harm and the accumulation — but a period of
    // full mitigation is not a time machine.
    const noRelief = nextPollution({
      locationId: "CITY-CALDOR",
      current: second,
      pressures: { ...pressured, mitigation: 0 },
      at,
    });
    const withRelief = nextPollution({
      locationId: "CITY-CALDOR",
      current: second,
      pressures: { ...pressured, mitigation: 1 },
      at,
    });
    expect(withRelief.airQualityIndex).toBeLessThan(noRelief.airQualityIndex);
    expect(withRelief.waterStress).toBeLessThan(noRelief.waterStress);
    expect(withRelief.degradation).toBeLessThan(noRelief.degradation);

    // Twenty clean periods later the air has recovered; the degradation has not.
    let record = withRelief;
    for (let period = 0; period < 20; period += 1) {
      record = nextPollution({
        locationId: "CITY-CALDOR",
        current: record,
        pressures: { emissions: 0, waterDraw: 0, mitigation: 1 },
        at,
      });
      expect(record.degradation).toBeGreaterThanOrEqual(withRelief.degradation);
    }
    expect(record.airQualityIndex).toBeLessThan(withRelief.airQualityIndex);
    expect(record.degradation).toBe(withRelief.degradation);
  });
});

describe("environment engine (System 46)", () => {
  it("records one weather observation per location and refreshes it in place", () => {
    const sim = newWorld();
    const now = sim.clock.time;
    const later = addTime(now, days(1));

    const count = withEnvironment(sim, (engine) => {
      engine.observeWeather({
        locationId: "CITY-ARDEN",
        climate: "temperate",
        latitude: 34.2,
        monthIndex: 0,
        at: now,
      });
      engine.observeWeather({
        locationId: "CITY-VEYR",
        climate: "temperate",
        latitude: 48.1,
        monthIndex: 0,
        at: now,
      });
      // Same place, same month: the snapshot is replaced, never duplicated.
      engine.observeWeather({
        locationId: "CITY-ARDEN",
        climate: "temperate",
        latitude: 34.2,
        monthIndex: 0,
        at: later,
      });
      return engine.weather().length;
    });

    expect(count).toBe(2);
    const arden = withEnvironment(sim, (engine) => engine.weatherAt("CITY-ARDEN"));
    expect(arden?.observedAt).toBe(later);
    expect(arden?.climate).toBe("temperate");
    expect(WEATHER_CONDITIONS).toContain(arden?.condition);
  });

  it("keeps ambient hazard conditions in step with the weather", () => {
    const sim = newWorld();
    const now = sim.clock.time;
    const regionId = "REGION-GREAT-INTERIOR";
    const droughtId = ambientHazardId(regionId, "drought");

    const first = withEnvironment(sim, (engine) =>
      engine.evaluateHazards({
        locationId: regionId,
        climate: "arid",
        weather: weather({ temperatureCelsius: 38, precipitationMm: 1 }),
        at: now,
      }),
    );
    expect(first.map((hazard) => hazard.kind)).toContain("drought");

    const repeated = withEnvironment(sim, (engine) => {
      engine.evaluateHazards({
        locationId: regionId,
        climate: "arid",
        weather: weather({ temperatureCelsius: 38, precipitationMm: 1 }),
        at: addTime(now, days(1)),
      });
      return { hazards: engine.hazards(), drought: engine.hazard(droughtId) };
    });
    // Idempotent, and `since` still marks the first sighting of the condition.
    expect(repeated.hazards.filter((hazard) => hazard.id === droughtId)).toHaveLength(1);
    expect(repeated.hazards).toHaveLength(first.length);
    expect(repeated.drought?.since).toBe(now);

    // The drought ends when the place is no longer dry.
    const afterRain = withEnvironment(sim, (engine) => {
      engine.evaluateHazards({
        locationId: regionId,
        climate: "arid",
        weather: weather({ condition: "rain", temperatureCelsius: 16, precipitationMm: 20 }),
        at: addTime(now, days(2)),
      });
      return engine.hazardsAt(regionId).map((hazard) => hazard.kind);
    });
    expect(afterRain).toEqual([]);
  });

  it("leaves explicitly declared hazards alone when it re-evaluates the weather", () => {
    const sim = newWorld();
    const now = sim.clock.time;
    const quake: HazardCondition = {
      id: "HAZ-QUAKE-KHARIC",
      locationId: "REGION-GREAT-INTERIOR",
      kind: "earthquake",
      intensity: 0.7,
      since: now,
    };

    const result = withEnvironment(sim, (engine) => {
      engine.declareHazard(quake);
      engine.evaluateHazards({
        locationId: "REGION-GREAT-INTERIOR",
        climate: "arid",
        weather: weather({ condition: "rain", temperatureCelsius: 16, precipitationMm: 20 }),
        at: addTime(now, days(3)),
      });
      return { quake: engine.hazard(quake.id), count: engine.hazardsAt("REGION-GREAT-INTERIOR").length };
    });

    // A declared condition is not the engine's to lift, and duplicates are refused.
    expect(result.quake?.intensity).toBe(0.7);
    expect(result.count).toBe(1);
    expect(() => withEnvironment(sim, (engine) => engine.declareHazard(quake))).toThrow(
      /duplicate hazard/,
    );
  });
});

describe("disaster pipeline (System 46)", () => {
  it("promotes a hazard condition into an ordered, explainable incident", () => {
    const sim = newWorld();
    const now = sim.clock.time;
    const floodId = ambientHazardId("CITY-ARDEN", "flood");

    const incident = withEnvironment(sim, (engine) => {
      engine.declareHazard({
        id: floodId,
        locationId: "CITY-ARDEN",
        kind: "flood",
        intensity: 0.6,
        since: now,
      });
      return engine.raiseDisaster({
        id: "DIS-000001",
        locationId: "CITY-ARDEN",
        kind: "flood",
        at: now,
        hazardId: floodId,
        causalChainId: "CHAIN-ARDAN-FLOOD",
      });
    });

    expect(incident.stage).toBe("hazard");
    expect(incident.history.map((record) => record.stage)).toEqual(["hazard"]);
    expect(incident.hazardId).toBe(floodId);
    expect(incident.causalChainId).toBe("CHAIN-ARDAN-FLOOD");
    expect(withEnvironment(sim, (engine) => engine.disastersAt("CITY-ARDEN"))).toHaveLength(1);
    // The condition became the incident, so it is no longer outstanding.
    expect(withEnvironment(sim, (engine) => engine.hazard(floodId))).toBeUndefined();

    // Stages cannot be skipped...
    expect(() =>
      withEnvironment(sim, (engine) =>
        engine.advanceDisaster({ id: "DIS-000001", stage: "impact", at: now, summary: "skipped" }),
      ),
    ).toThrow(/can only advance to "exposure"/);

    // ...nor revisited.
    expect(() =>
      withEnvironment(sim, (engine) =>
        engine.advanceDisaster({ id: "DIS-000001", stage: "hazard", at: now, summary: "backwards" }),
      ),
    ).toThrow(/can only advance to "exposure"/);

    const completed = withEnvironment(sim, (engine) => {
      const stages = ["exposure", "vulnerability", "impact", "response", "recovery"] as const;
      stages.forEach((stage, index) => {
        engine.advanceDisaster({
          id: "DIS-000001",
          stage,
          at: addTime(now, days(index + 1)),
          summary: `${stage} recorded`,
          ...(stage === "impact" ? { magnitude: 0.42 } : {}),
        });
      });
      return engine.disaster("DIS-000001");
    });

    expect(completed?.stage).toBe("recovery");
    expect(completed?.history.map((record) => record.stage)).toEqual([
      "hazard",
      "exposure",
      "vulnerability",
      "impact",
      "response",
      "recovery",
    ]);
    expect(completed?.history.find((record) => record.stage === "impact")?.magnitude).toBe(0.42);
    expect(withEnvironment(sim, (engine) => engine.activeDisasters())).toHaveLength(0);

    expect(() =>
      withEnvironment(sim, (engine) =>
        engine.advanceDisaster({ id: "DIS-000001", stage: "recovery", at: now, summary: "again" }),
      ),
    ).toThrow(/already reached "recovery"/);
  });

  it("refuses to invent, duplicate or mis-attribute incidents", () => {
    const sim = newWorld();
    const now = sim.clock.time;

    expect(() =>
      withEnvironment(sim, (engine) =>
        engine.advanceDisaster({ id: "DIS-999999", stage: "exposure", at: now, summary: "ghost" }),
      ),
    ).toThrow(/unknown disaster/);

    const raised = withEnvironment(sim, (engine) =>
      engine.raiseDisaster({ id: "DIS-000002", locationId: "CITY-CALDOR", kind: "wildfire", at: now }),
    );
    expect(raised.history[0]?.summary).toMatch(/wildfire hazard assessed at CITY-CALDOR/);
    expect(withEnvironment(sim, (engine) => engine.activeDisasters())).toHaveLength(1);

    expect(() =>
      withEnvironment(sim, (engine) =>
        engine.raiseDisaster({ id: "DIS-000002", locationId: "CITY-CALDOR", kind: "wildfire", at: now }),
      ),
    ).toThrow(/duplicate disaster/);

    // An incident cannot claim a hazard condition that does not exist.
    expect(() =>
      withEnvironment(sim, (engine) =>
        engine.raiseDisaster({
          id: "DIS-000003",
          locationId: "CITY-CALDOR",
          kind: "wildfire",
          at: now,
          hazardId: "HAZ-NOWHERE-wildfire",
        }),
      ),
    ).toThrow(/unknown hazard/);
  });
});

describe("environment persistence and boundaries (System 46 / law 13)", () => {
  it("survives save/load without drifting", async () => {
    const sim = newWorld();
    const now = sim.clock.time;

    withEnvironment(sim, (engine) => {
      engine.observeWeather({
        locationId: "CITY-ARDEN",
        climate: "temperate",
        latitude: 34.2,
        monthIndex: 3,
        at: now,
      });
      engine.applyPollution({
        locationId: "CITY-ARDEN",
        emissions: 0.7,
        waterDraw: 0.4,
        mitigation: 0.1,
        at: now,
      });
      engine.declareHazard({
        id: "HAZ-ARDEN-SMOG",
        locationId: "CITY-ARDEN",
        kind: "pollution",
        intensity: 0.55,
        since: now,
      });
      engine.raiseDisaster({
        id: "DIS-000042",
        locationId: "CITY-ARDEN",
        kind: "pollution",
        at: now,
        hazardId: "HAZ-ARDEN-SMOG",
      });
      engine.advanceDisaster({
        id: "DIS-000042",
        stage: "exposure",
        at: now,
        summary: "dense districts exposed",
      });
    });

    // `saveTo` snapshots the current authoritative state into the store; the
    // command-pipeline path (`world.save`) is exercised elsewhere, and the point
    // here is that environment truth survives the .reel round trip unchanged.
    const hash = sim.stateHash();
    await sim.saveTo("slot-environment", "environment unit test");

    const reloaded = await loadKernelSimulation({
      masterSeed: SEED,
      checkInvariants: true,
      saveStore: sim.saveStore,
      slotName: "slot-environment",
    });

    expect(reloaded.stateHash()).toBe(hash);
    const restored = withEnvironment(reloaded, (engine) => ({
      weather: engine.weatherAt("CITY-ARDEN"),
      pollution: engine.pollutionAt("CITY-ARDEN"),
      disaster: engine.disaster("DIS-000042"),
      hazards: engine.hazards(),
    }));
    expect(restored.weather?.observedAt).toBe(now);
    expect(restored.pollution?.degradation).toBeGreaterThan(0);
    expect(restored.disaster?.history.map((record) => record.stage)).toEqual(["hazard", "exposure"]);
    // The source condition was lifted when it became an incident and stays lifted.
    expect(restored.hazards).toEqual([]);
  });

  it("keeps environment state behind the ownership guard", () => {
    const sim = newWorld();
    const now = sim.clock.time;
    const snapshot = {
      locationId: "CITY-ARDEN",
      climate: "temperate" as const,
      condition: "clear" as const,
      temperatureCelsius: 12.4,
      precipitationMm: 0,
      windKph: 6,
      observedAt: now,
    };

    // Creating the state slot is itself a write: with no context, it fails.
    expect(() => new EnvironmentEngine(sim.scope, sim.world)).toThrow(MissingWriterContextError);

    sim.guard.mutate("environment", () =>
      new EnvironmentEngine(sim.scope, sim.world).setWeather(snapshot),
    );
    expect(() => new EnvironmentEngine(sim.scope, sim.world).setWeather(snapshot)).toThrow(
      MissingWriterContextError,
    );
    expect(() =>
      sim.guard.mutate("needs", () =>
        new EnvironmentEngine(sim.scope, sim.world).setWeather(snapshot),
      ),
    ).toThrow(OwnershipViolationError);
    expect(withEnvironment(sim, (engine) => engine.weatherAt("CITY-ARDEN")?.observedAt)).toBe(now);
  });

  it("gives the playable slice city real weather", () => {
    const sim = createKernelSimulation({
      masterSeed: SEED,
      checkInvariants: true,
      seedSlice: true,
    });
    const weather = withEnvironment(sim, (engine) => engine.weather());

    expect(weather).toHaveLength(1);
    expect(weather[0]?.locationId).toBe("CITY-ARDEN");
    expect(weather[0]?.climate).toBe("temperate");
    expect(WEATHER_CONDITIONS).toContain(weather[0]?.condition);
  });
});
