/**
 * System 56 — map & spatial presentation: the knowledge-limited map (M4 DoD).
 *
 * The map is asserted the way the spec writes it: it "must not expose hidden
 * events or entities merely because they exist in simulation state" (UI/UX 09
 * section 5), routes "come from Transportation" and the map "never invents
 * travel duration" (UI/UX 09 section 6), levels of detail align with System 07
 * (UI/UX 09 section 7), markers carry the knowledge vocabulary of UI/UX 19
 * section 4, and renamed places stay traceable (UI/UX 19 section 6).
 *
 * Every test below builds the full canonical world (all 48 countries, all 34
 * settlements) and then shows how little of it the viewer is entitled to see —
 * which is the entire point of the exercise.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { asEntityId } from "../../src/engine/primitives/ids.ts";
import { addTime, days } from "../../src/engine/primitives/time.ts";
import { GeographyEngine } from "../../src/engine/geography/engine.ts";
import { PopulationEngine } from "../../src/engine/population/engine.ts";
import { TravelEngine } from "../../src/engine/travel/engine.ts";
import { CountriesEngine } from "../../src/engine/countries/engine.ts";
import { EnvironmentEngine } from "../../src/engine/environment/engine.ts";
import { InfrastructureEngine } from "../../src/engine/infrastructure/engine.ts";
import { registerAureliaSliceGeography } from "../../src/content/aurelia/geography.ts";
import { registerAureliaWorldGeography } from "../../src/content/aurelia/geography.ts";
import { registerAureliaPopulation } from "../../src/content/aurelia/population.ts";
import { registerAureliaCountries } from "../../src/content/aurelia/countries.ts";
import { registerAureliaInfrastructure } from "../../src/content/aurelia/infrastructure.ts";
import { aureliaWeatherPlace } from "../../src/content/aurelia/environment.ts";
import { M2_SETTLEMENT_ID } from "../../src/content/aurelia/geography.ts";
import { CANON_SETTLEMENTS } from "../../src/content/aurelia/canon.ts";
import {
  derivePlaceKnowledge,
  getMapView,
  MAP_LODS,
  MAP_MARKER_BUDGET,
  MAP_STALE_AFTER_DAYS,
} from "../../src/engine/query/mapView.ts";
import type { EntityId } from "../../src/engine/primitives/ids.ts";
import { ScaleEngine } from "../../src/engine/scale/engine.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";

const SEED = "reellife-map-seed";
type Viewer = EntityId<"person">;

/**
 * A lived-in world: the full canon geography, the population distribution,
 * the country environment, the slice infrastructure, the transport network
 * that owns its own routes, and one resident viewer inside Arden.
 */
interface MapWorld {
  readonly sim: Simulation;
  readonly viewer: Viewer;
}

function seedWorld(): MapWorld {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true });

  sim.guard.mutate("geography", () => {
    const geography = new GeographyEngine(sim.scope, sim.world);
    registerAureliaSliceGeography(geography);
    registerAureliaWorldGeography(geography);
  });
  sim.guard.mutate("population", () => {
    registerAureliaPopulation(new PopulationEngine(sim.scope, sim.world));
  });
  sim.guard.mutate("countries", () => {
    registerAureliaCountries(new CountriesEngine(sim.scope, sim.world));
  });
  sim.guard.mutate("environment", () => {
    const environment = new EnvironmentEngine(sim.scope, sim.world);
    const weatherPlace = aureliaWeatherPlace(M2_SETTLEMENT_ID);
    if (weatherPlace) {
      environment.observeWeather({
        locationId: weatherPlace.locationId,
        climate: weatherPlace.climate,
        latitude: weatherPlace.latitude,
        monthIndex: sim.calendar.dateFromTime(sim.clock.time).monthIndex,
        at: sim.clock.time,
      });
    }
  });
  // The transport network self-registers its canonical routes on construction.
  sim.guard.mutate("travel", () => {
    new TravelEngine(sim.scope, sim.world);
  });

  sim.guard.mutate("infrastructure", () => {
    registerAureliaInfrastructure(new InfrastructureEngine(sim.scope, sim.world), M2_SETTLEMENT_ID, sim.clock.time);
  });

  const viewer = asEntityId<"person">("PER-000001");
  sim.guard.mutate("scale", () => {
    const scale = new ScaleEngine(sim.scope, sim.world);
    scale.defineSettlement(M2_SETTLEMENT_ID, 50_000);
    scale.recordResident({
      personId: viewer,
      settlementId: M2_SETTLEMENT_ID,
      ageBand: "adult",
      materializedAt: sim.clock.time,
    });
  });
  return { sim, viewer };
}

/** A viewer journey the map can learn from, written the owning system's way. */
function journey(
  sim: Simulation,
  person: Viewer,
  to: string,
  completedAt = sim.clock.time,
): void {
  sim.guard.mutate("travel", () => {
    new TravelEngine(sim.scope, sim.world).startJourney({
      journeyId: `JRN-${to}`,
      personId: person,
      originSettlementId: M2_SETTLEMENT_ID,
      destinationSettlementId: to,
      routeId: `ROUTE-${M2_SETTLEMENT_ID}-${to}-FLIGHT`,
      departedAt: completedAt,
      arrivesAt: addTime(completedAt, days(1)),
      mode: "flight",
    });
    new TravelEngine(sim.scope, sim.world).completeJourney(person, completedAt);
  });
}

/** Every id and name in the world the viewer does *not* know, for leak tests. */
function unknownPlaces(sim: Simulation, viewer: Viewer): readonly { id: string; name: string }[] {
  const known = new Set(derivePlaceKnowledge(sim, viewer).map((entry) => entry.placeId));
  const geography = new GeographyEngine(sim.scope, sim.world);
  return geography
    .all()
    .filter((place) => !known.has(String(place.id)))
    .map((place) => ({ id: String(place.id), name: place.name }));
}

/** Every string carried by a view, so the leak check compares whole values. */
function stringsIn(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === "object") {
    return (Object.values(value) as readonly unknown[]).flatMap(stringsIn);
  }
  return [];
}

/** Every LOD at every camera: no unknown id or name may appear in the view. */
function expectNoLeaks(sim: Simulation, viewer: Viewer): void {
  const unknown = unknownPlaces(sim, viewer);
  expect(unknown.length).toBeGreaterThan(0);
  const unknownIds = new Set(unknown.map((place) => place.id));
  const unknownNames = new Set(unknown.map((place) => place.name));
  for (const lod of MAP_LODS) {
    const view = getMapView(sim, viewer, { camera: { lod } });
    // Whole-value comparison, not substring: the settlement "Veyr" must not be
    // confused with the continent "Veyra", which merely contains those letters.
    for (const text of stringsIn(view)) {
      expect(text, `${lod} leaks id ${text}`).not.toSatisfy((entry: string) => unknownIds.has(entry));
      expect(text, `${lod} leaks name ${text}`).not.toSatisfy((entry: string) => unknownNames.has(entry));
    }
    expect(view.markers.length).toBeLessThanOrEqual(MAP_MARKER_BUDGET);
    expect(new Set(view.markers.map((marker) => marker.id)).size).toBe(view.markers.length);
  }
}

describe("knowledge-limited map (System 56, M4 DoD)", () => {
  it("shows the viewer's own chain at city level, and nothing beyond what they know", () => {
    const { sim, viewer } = seedWorld();
    const view = getMapView(sim, viewer, { camera: { lod: "city" } });

    expect(view.lod).toBe("city");
    expect(view.lods.map((option) => option.id)).toEqual([...MAP_LODS]);
    expect(view.focus).toMatchObject({ known: true, name: "Arden", level: "settlement" });
    expect(view.worldName.length).toBeGreaterThan(0);

    // The viewer lives in Arden: they know it, its district children in the
    // full canon, and the chain that contains it.
    const knowledge = derivePlaceKnowledge(sim, viewer);
    expect(knowledge.some((entry) => entry.placeId === M2_SETTLEMENT_ID)).toBe(true);
    expect(knowledge.some((entry) => entry.placeId === "REGION-ARDAN-BASIN")).toBe(true);
    expect(knowledge.some((entry) => entry.placeId === "COUNTRY-ARDIN")).toBe(true);

    const ids = view.markers.map((marker) => marker.id);
    expect(ids).toContain(M2_SETTLEMENT_ID);
    expect(view.markers.find((marker) => marker.id === M2_SETTLEMENT_ID)?.state).toBe("selected");
    // Only the LOD window's levels appear, in deterministic level-then-name order.
    for (const marker of view.markers) {
      expect(["district", "neighborhood", "settlement"]).toContain(marker.level);
    }

    // Nothing beyond that: the whole world is registered, almost none of it known.
    expectNoLeaks(sim, viewer);
    expect(view.knownPlaceCount).toBeLessThan(20);
  });

  it("widens each zoom by exactly one anchor rung, knowledge permitting", () => {
    const { sim, viewer } = seedWorld();

    const city = getMapView(sim, viewer, { camera: { lod: "city" } });
    expect(city.anchorName).toBeUndefined();
    expect(city.focus.containers.at(-1)?.name).toBe("Arden");

    const region = getMapView(sim, viewer, { camera: { lod: "region" } });
    expect(region.anchorName).toBe("Ardan Basin");
    expect(region.markers.map((marker) => marker.id)).toContain(M2_SETTLEMENT_ID);
    // The anchor (the camera's subject) is always shown alongside its window.
    for (const marker of region.markers) {
      expect(["region", "settlement"]).toContain(marker.level);
    }

    const country = getMapView(sim, viewer, { camera: { lod: "country" } });
    expect(country.anchorName).toBe("Republic of Ardin");
    expect(country.markers.map((marker) => marker.id)).toEqual(
      expect.arrayContaining(["REGION-ARDAN-BASIN", M2_SETTLEMENT_ID]),
    );
    for (const marker of country.markers) {
      expect(["country", "region", "settlement"]).toContain(marker.level);
    }

    const world = getMapView(sim, viewer, { camera: { lod: "world" } });
    expect(world.anchorName).toBe("Aurelia");
    const worldIds = world.markers.map((marker) => marker.id);
    expect(worldIds).toContain("CONT-ELANDRA");
    expect(worldIds).not.toContain("CONT-VEYRA");
    for (const marker of world.markers) {
      expect(["world", "continent", "region"]).toContain(marker.level);
    }
    expectNoLeaks(sim, viewer);
  });

  it("reveals nothing — not even an echo — for a camera focus the viewer never learned", () => {
    const { sim, viewer } = seedWorld();
    const elsewhere = CANON_SETTLEMENTS.find((settlement) => settlement.id !== M2_SETTLEMENT_ID);
    expect(elsewhere).toBeDefined();
    if (!elsewhere) return;

    const view = getMapView(sim, viewer, { camera: { lod: "city", focusId: elsewhere.id } });
    expect(view.focus.known).toBe(false);
    expect(view.markers).toHaveLength(0);
    expect(view.routes).toHaveLength(0);
    const echoed = stringsIn(view).filter((text) => text === elsewhere.id || text === elsewhere.name);
    expect(echoed).toEqual([]);
    expectNoLeaks(sim, viewer);
  });

  it("grows the viewer's map through travel, and marks dated knowledge stale", () => {
    const { sim, viewer } = seedWorld();
    const destination = "CITY-WESTHAVEN";

    // Before the journey there is no route and no marker for the far city.
    expect(getMapView(sim, viewer, { camera: { lod: "region", focusId: M2_SETTLEMENT_ID } }).routes).toHaveLength(0);
    expect(
      derivePlaceKnowledge(sim, viewer).some((entry) => entry.placeId === destination),
    ).toBe(false);

    journey(sim, viewer, destination);
    const knowledge = derivePlaceKnowledge(sim, viewer);
    const visited = knowledge.find((entry) => entry.placeId === destination);
    expect(visited?.state).toBe("known");
    expect(visited?.sources).toContain("travel");

    // The visited city is now known — and so is everything containing it, one
    // rung up the chain: its region, country and continent join the world zoom.
    const westhavenCanon = CANON_SETTLEMENTS.find((settlement) => settlement.id === destination);
    expect(westhavenCanon).toBeDefined();
    const world = getMapView(sim, viewer, { camera: { lod: "world" } });
    expect(world.markers.map((marker) => marker.id)).toContain(westhavenCanon?.continentId);

    // The route from home is Transportation's own fastest pairing, copied out
    // verbatim — checked field by field against the owning engine's answer.
    const routes = getMapView(sim, viewer, { camera: { lod: "region" } }).routes;
    expect(routes.length).toBeGreaterThan(0);
    let owned: ReturnType<TravelEngine["findRoute"]>;
    sim.guard.mutate("travel", () => {
      owned = new TravelEngine(sim.scope, sim.world).findRoute(M2_SETTLEMENT_ID, destination);
    });
    const shown = routes.find((route) => route.toPlaceId === destination);
    expect(shown).toBeDefined();
    expect(shown?.durationMinutes).toBe(owned?.durationMinutes);
    expect(shown?.distanceKm).toBe(owned?.distanceKm);
    expect(shown?.costMinorUnits).toBe(owned?.costMinorUnits);
    expect(shown?.mode).toBe(owned?.mode);
    expect(shown?.border?.outcome).toBe("conditional");

    // Memory fades: a journey that completed more than MAP_STALE_AFTER_DAYS
    // ago is still knowledge, but it is presented as possibly out of date.
    // The camera moves to the visited city (it is known through travel, so the
    // focus is entitled) because a region zoom only draws its own anchor's
    // subtree — Westhaven lives under another region, not Ardan Basin.
    const { sim: oldSim, viewer: oldViewer } = seedWorld();
    journey(oldSim, oldViewer, destination, addTime(oldSim.clock.time, days(-(MAP_STALE_AFTER_DAYS + 30))));
    const stale = getMapView(oldSim, oldViewer, { camera: { lod: "region", focusId: destination } });
    const marker = stale.markers.find((entry) => entry.id === destination);
    expect(marker).toBeDefined();
    expect(marker?.state).toBe("stale");
    expect(marker?.knowledge).toBe("known");
    expect(stale.notes.some((note) => note.includes(String(MAP_STALE_AFTER_DAYS)))).toBe(true);
    expectNoLeaks(oldSim, oldViewer);
  });

  it("carries political, population, weather and infrastructure detail where it is owned", () => {
    const { sim, viewer } = seedWorld();
    const view = getMapView(sim, viewer, { camera: { lod: "country" } });

    const country = view.markers.find((marker) => marker.id === "COUNTRY-ARDIN");
    expect(country).toBeDefined();
    expect(country?.political?.governmentType).toBe("Federal Republic");
    expect(country?.political?.currencyCode).toBe("AUR");
    expect(country?.political?.currencyName).toBe("Aurelian mark");
    expect(country?.population?.value).toBeGreaterThan(0);
    expect(country?.population?.knowledge).toBe("estimate");

    const home = getMapView(sim, viewer, { camera: { lod: "city" } });
    const arden = home.markers.find((marker) => marker.id === M2_SETTLEMENT_ID);
    expect(arden).toBeDefined();
    expect(arden?.weather?.conditionLabel.length).toBeGreaterThan(0);
    // Population is System 47's aggregate truth, not the slice's scale
    // register — the map copies the owning engine's answer verbatim.
    let ownedPopulation: number | undefined;
    sim.guard.mutate("population", () => {
      ownedPopulation = new PopulationEngine(sim.scope, sim.world).aggregateFor(M2_SETTLEMENT_ID)?.totalPopulation;
    });
    expect(ownedPopulation).toBeGreaterThan(0);
    expect(arden?.population?.value).toBe(ownedPopulation);

    // The infrastructure layer reads System 38's truth from where the viewer is.
    const infrastructure = home.layers.find((layer) => layer.id === "infrastructure");
    expect(infrastructure?.status).toBe("shown");
    expect(infrastructure?.itemCount).toBe(10);

    // A world without System 39 says the political layer is unavailable —
    // the map never fakes a government or a currency. The removal goes through
    // the owning context like any other authoritative write.
    const { sim: bareSim, viewer: bareViewer } = seedWorld();
    bareSim.guard.mutate("countries", () => {
      delete (bareSim.world.systems as Record<string, unknown>)["countries"];
    });
    const bare = getMapView(bareSim, bareViewer, { camera: { lod: "country" } });
    expect(bare.layers.find((layer) => layer.id === "political")?.status).toBe("unavailable");
    expect(bare.routes).toHaveLength(0);
    expectNoLeaks(bareSim, bareViewer);
  });

  it("carries a known place's former names as spatial history, and never a stranger's", () => {
    const { sim, viewer } = seedWorld();
    const view = getMapView(sim, viewer, { camera: { lod: "city" } });

    // A former name is truth owned by System 37's renaming record, so the lens
    // copies it (UI/UX 19 §6: a renamed place stays traceable) instead of
    // deriving it from the current name.
    let owned: readonly string[] = [];
    sim.guard.mutate("geography", () => {
      owned = new GeographyEngine(sim.scope, sim.world).historicalNamesOf(M2_SETTLEMENT_ID);
    });
    expect(owned).toContain("Old Arden");
    const arden = view.markers.find((marker) => marker.id === M2_SETTLEMENT_ID);
    expect(arden?.formerNames).toEqual(owned);

    // Every marker reports the owning system's list for its own place, and a
    // place that was never renamed reports an empty list rather than no field.
    for (const marker of view.markers) {
      let truth: readonly string[] = [];
      sim.guard.mutate("geography", () => {
        truth = new GeographyEngine(sim.scope, sim.world).historicalNamesOf(marker.id);
      });
      expect(marker.formerNames).toEqual(truth);
    }

    // A former name is knowledge too. Veyr was once Veyr-on-River; the viewer
    // has never been there, so neither its current nor its former name may
    // appear anywhere — not even as a hint that the place exists.
    const veyr = CANON_SETTLEMENTS.find((settlement) => settlement.id === "CITY-VEYR");
    expect(veyr?.historicalNames).toContain("Veyr-on-River");
    for (const lod of MAP_LODS) {
      const texts = stringsIn(getMapView(sim, viewer, { camera: { lod } }));
      expect(texts, `${lod} leaks Veyr`).not.toContain("Veyr");
      expect(texts, `${lod} leaks Veyr-on-River`).not.toContain("Veyr-on-River");
    }
    expectNoLeaks(sim, viewer);
  });
});
