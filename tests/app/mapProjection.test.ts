/**
 * Spatial map layout (U4; System 56 rendering, UI/UX 09).
 *
 * The map is the one surface where a plausible-looking picture is easiest to
 * build out of nothing, so these tests are mostly about what the layout refuses
 * to do: it does not invent a position, it does not invent a coastline, it does
 * not promote a place by magnifying it, and it never quietly drops a marker or
 * a route to make the canvas look tidy.
 *
 * Everything here is pure arithmetic, so the fixture is a hand-built `MapView`.
 * The counterpart test that runs the real engine through the same layout lives
 * in `tests/app/worldMap.test.ts`.
 */

import { describe, expect, it } from "vitest";
import type {
  MapMarkerView,
  MapPositionConfidence,
  MapPositionView,
  MapRouteView,
  MapView,
} from "@/engine/query/index.ts";
import {
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  applyCamera,
  buildSpatialMap,
  geographicBounds,
  isPlottablePosition,
  projectToPlane,
  zoomBy,
  type MapViewport,
} from "../../src/app/world/mapProjection.ts";

const VIEWPORT: MapViewport = { width: 800, height: 600 };
const CAMERA = { zoom: 1, offsetX: 0, offsetY: 0 };

function at(latitude: number, longitude: number, confidence: MapPositionConfidence = "exact") {
  return { latitude, longitude, confidence } satisfies MapPositionView;
}

function marker(over: Partial<MapMarkerView> = {}): MapMarkerView {
  return {
    id: "PLACE-1",
    name: "Arden",
    level: "settlement",
    knowledge: "known",
    state: "known",
    formerNames: [],
    hazards: [],
    disasters: [],
    visibleEventCount: 0,
    knowledgeSources: ["residence"],
    position: at(10, 20),
    ...over,
  };
}

function route(over: Partial<MapRouteView> = {}): MapRouteView {
  return {
    id: "ROUTE-1",
    mode: "road",
    modeLabel: "Road",
    fromPlaceId: "PLACE-1",
    fromName: "Arden",
    toPlaceId: "PLACE-2",
    toName: "Veyr",
    distanceKm: 10,
    durationMinutes: 60,
    durationLabel: "1 hour",
    costMinorUnits: 100,
    costLabel: "1.00",
    isInternational: false,
    alternatives: 0,
    ...over,
  };
}

function view(over: Partial<MapView> = {}): MapView {
  return {
    worldName: "Aurelia",
    lod: "world",
    lods: [{ id: "world", label: "World" }],
    focus: { known: true, name: "Arden", level: "settlement", position: at(10, 20), containers: [] },
    markers: [marker()],
    routes: [],
    layers: [],
    knownPlaceCount: 1,
    markerBudget: 240,
    nowLabel: "1 January 2042, 00:00",
    notes: [],
    ...over,
  };
}

describe("plottable positions (U4)", () => {
  it("accepts real coordinates and the extremes of the globe", () => {
    expect(isPlottablePosition(at(0, 0))).toBe(true);
    expect(isPlottablePosition(at(90, 180))).toBe(true);
    expect(isPlottablePosition(at(-90, -180))).toBe(true);
  });

  it("refuses a missing, non-finite or off-globe coordinate", () => {
    expect(isPlottablePosition(undefined)).toBe(false);
    expect(isPlottablePosition(at(Number.NaN, 20))).toBe(false);
    expect(isPlottablePosition(at(10, Number.POSITIVE_INFINITY))).toBe(false);
    expect(isPlottablePosition(at(91, 20))).toBe(false);
    expect(isPlottablePosition(at(10, 181))).toBe(false);
  });

  it("says which of the two failures it is, rather than a generic 'unknown'", () => {
    const missing = buildSpatialMap({
      view: view({ markers: [marker({ position: undefined })] }),
      viewport: VIEWPORT,
      camera: CAMERA,
    });
    expect(missing.undrawnMarkers[0].reason).toMatch(/no position is on record/);

    const offGlobe = buildSpatialMap({
      view: view({
        markers: [marker({ position: at(200, 20) })],
        focus: { known: true, name: "Arden", level: "settlement", position: at(0, 0), containers: [] },
      }),
      viewport: VIEWPORT,
      camera: CAMERA,
    });
    expect(offGlobe.undrawnMarkers[0].reason).toMatch(/outside the world/);
  });
});

describe("geographic bounds (U4)", () => {
  it("has no box when nothing can be plotted", () => {
    expect(geographicBounds([])).toBeUndefined();
    expect(geographicBounds([undefined, at(200, 20)])).toBeUndefined();
  });

  it("ignores unplottable coordinates rather than distorting the box", () => {
    const bounds = geographicBounds([at(0, 0), at(20, 40), at(999, 999)]);
    expect(bounds?.minLat).toBe(0);
    expect(bounds?.maxLat).toBe(20);
    expect(bounds?.minLon).toBe(0);
    expect(bounds?.maxLon).toBe(40);
  });

  it("stretches longitude by cos(mean latitude) so shapes keep their proportions", () => {
    // Two positions 40 degrees apart in longitude, at 60 degrees north.
    expect(geographicBounds([at(60, 0), at(60, 40)])?.longitudeScale).toBeCloseTo(
      Math.cos((60 * Math.PI) / 180),
      6,
    );
    // ...and never collapses to zero for a world sitting on the equator.
    expect(geographicBounds([at(0, 0), at(0, 40)])?.longitudeScale).toBeCloseTo(1, 6);
  });
});

describe("plane projection (U4)", () => {
  const bounds = geographicBounds([at(0, 0), at(40, 40)])!;

  it("puts north at the top and the west at the left", () => {
    const north = projectToPlane(at(40, 0), bounds, VIEWPORT);
    const south = projectToPlane(at(0, 0), bounds, VIEWPORT);
    expect(north.y).toBeLessThan(south.y);
    expect(south.y).toBeCloseTo(VIEWPORT.height, 6);
    expect(north.y).toBeCloseTo(0, 6);
    expect(projectToPlane(at(0, 40), bounds, VIEWPORT).x).toBeCloseTo(VIEWPORT.width, 6);
  });

  it("centres a world that is a single point instead of dividing by zero", () => {
    const single = geographicBounds([at(12, 34)])!;
    const point = projectToPlane(at(12, 34), single, VIEWPORT);
    expect(point.x).toBeCloseTo(VIEWPORT.width / 2, 6);
    expect(point.y).toBeCloseTo(VIEWPORT.height / 2, 6);
  });

  it("centres when only the latitude collapses but the longitude does not", () => {
    const flat = geographicBounds([at(5, 0), at(5, 40)])!;
    expect(projectToPlane(at(5, 20), flat, VIEWPORT).y).toBeCloseTo(VIEWPORT.height / 2, 6);
  });
});

describe("camera (U4)", () => {
  const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

  it("leaves the canvas alone at zoom 1 with no offset", () => {
    expect(applyCamera(centre, CAMERA, VIEWPORT)).toEqual(centre);
  });

  it("doubles the spread about the centre at zoom 2", () => {
    const point = { x: centre.x + 100, y: centre.y + 50 };
    const zoomed = applyCamera(point, { zoom: 2, offsetX: 0, offsetY: 0 }, VIEWPORT);
    expect(zoomed.x - centre.x).toBeCloseTo(200, 6);
    expect(zoomed.y - centre.y).toBeCloseTo(100, 6);
  });

  it("clamps a nonsense zoom instead of producing a NaN canvas", () => {
    const point = { x: centre.x + 10, y: centre.y };
    const wild = applyCamera(point, { zoom: Number.NaN, offsetX: 0, offsetY: 0 }, VIEWPORT);
    expect(Number.isFinite(wild.x)).toBe(true);
    expect(Number.isFinite(wild.y)).toBe(true);
    expect(applyCamera(point, { zoom: 1e9, offsetX: 0, offsetY: 0 }, VIEWPORT).x).toBeCloseTo(
      applyCamera(point, { zoom: MAP_MAX_ZOOM, offsetX: 0, offsetY: 0 }, VIEWPORT).x,
      6,
    );
  });

  it("steps zoom in and out within the usable range", () => {
    expect(zoomBy(1, "in")).toBeGreaterThan(1);
    expect(zoomBy(2, "out")).toBeLessThan(2);
    expect(zoomBy(MAP_MAX_ZOOM, "in")).toBe(MAP_MAX_ZOOM);
    expect(zoomBy(MAP_MIN_ZOOM, "out")).toBe(MAP_MIN_ZOOM);
  });
});

describe("spatial map (U4)", () => {
  it("accounts for every marker the projection gave it", () => {
    const map = buildSpatialMap({
      view: view({
        markers: [marker(), marker({ id: "PLACE-2", name: "Veyr", position: at(30, 30) })],
      }),
      viewport: VIEWPORT,
      camera: CAMERA,
    });
    expect(map.markers.length + map.undrawnMarkers.length).toBe(2);
    expect(map.undrawnMarkers).toHaveLength(0);
  });

  it("reports a place with no position instead of hiding it", () => {
    const map = buildSpatialMap({
      view: view({
        markers: [marker(), marker({ id: "PLACE-2", name: "Unplaced", position: undefined })],
      }),
      viewport: VIEWPORT,
      camera: CAMERA,
    });
    expect(map.markers.map((node) => node.id)).toEqual(["PLACE-1"]);
    expect(map.undrawnMarkers).toEqual([
      { id: "PLACE-2", name: "Unplaced", reason: "no position is on record for this place" },
    ]);
    expect(map.notes.join(" ")).toMatch(/on the list but not on the map/);
  });

  it("reports a journey it cannot draw rather than drawing it to nowhere", () => {
    const map = buildSpatialMap({
      view: view({
        markers: [marker()],
        routes: [route({ toPlaceId: "PLACE-9", toName: "Nowhere recorded" })],
      }),
      viewport: VIEWPORT,
      camera: CAMERA,
    });
    expect(map.routes).toHaveLength(0);
    expect(map.undrawnRoutes[0].label).toBe("Arden → Nowhere recorded");
    expect(map.undrawnRoutes[0].reason.length).toBeGreaterThan(0);
  });

  it("draws a journey when both of its ends are on the map", () => {
    const map = buildSpatialMap({
      view: view({
        markers: [marker(), marker({ id: "PLACE-2", name: "Veyr", position: at(30, 30) })],
        routes: [route({ isInternational: true })],
      }),
      viewport: VIEWPORT,
      camera: CAMERA,
    });
    expect(map.routes).toHaveLength(1);
    expect(map.routes[0].international).toBe(true);
    expect(map.routes[0].to.x).not.toBe(map.routes[0].from.x);
    expect(map.undrawnRoutes).toHaveLength(0);
  });

  it("never lets zoom change how big or important a place is", () => {
    // Two places, so there is a real spread to magnify. (A lone place is drawn
    // dead centre by definition, and zooming about the centre rightly leaves it
    // there — that is not a bug in the camera.)
    const wide = view({
      markers: [marker(), marker({ id: "PLACE-2", name: "Veyr", position: at(40, 40) })],
    });
    const base = buildSpatialMap({ view: wide, viewport: VIEWPORT, camera: CAMERA });
    const zoomed = buildSpatialMap({
      view: wide,
      viewport: VIEWPORT,
      camera: { zoom: 2, offsetX: 0, offsetY: 0 },
    });

    const spread = (map: typeof base) =>
      Math.abs(map.markers[0].x - map.markers[1].x) + Math.abs(map.markers[0].y - map.markers[1].y);
    expect(spread(zoomed)).toBeGreaterThan(spread(base));

    // Radius and state are the same objects of attention at any magnification.
    expect(zoomed.markers[0].radius).toBe(base.markers[0].radius);
    expect(zoomed.markers[1].radius).toBe(base.markers[1].radius);
    expect(zoomed.markers[0].state).toBe(base.markers[0].state);
  });

  it("identifies the camera's own subject from the anchor chain", () => {
    const map = buildSpatialMap({
      view: view({
        focus: {
          known: true,
          name: "Arden",
          level: "settlement",
          position: at(10, 20),
          containers: [
            { id: "PLACE-0", name: "Aurelia", level: "world" },
            { id: "PLACE-1", name: "Arden", level: "settlement" },
          ],
        },
      }),
      viewport: VIEWPORT,
      camera: CAMERA,
    });
    expect(map.markers[0].isFocus).toBe(true);
    expect(map.focusPoint).toBeDefined();
  });

  it("does not guess an identity for the focus when the camera has no anchor", () => {
    const map = buildSpatialMap({
      view: view({ focus: { known: false, name: "Somewhere", level: "unknown", containers: [] } }),
      viewport: VIEWPORT,
      camera: CAMERA,
    });
    expect(map.markers[0].isFocus).toBe(false);
    expect(map.focusPoint).toBeUndefined();
  });

  it("always states that this is a point plot, not a map of borders", () => {
    const map = buildSpatialMap({ view: view(), viewport: VIEWPORT, camera: CAMERA });
    expect(map.notes.join(" ")).toMatch(/coastlines and borders are not recorded/);
  });

  it("returns an empty map with reasons when no known place has a position", () => {
    const map = buildSpatialMap({
      view: view({
        markers: [marker({ position: undefined })],
        focus: { known: true, name: "Arden", level: "settlement", containers: [] },
      }),
      viewport: VIEWPORT,
      camera: CAMERA,
    });
    expect(map.markers).toHaveLength(0);
    expect(map.bounds).toBeUndefined();
    expect(map.undrawnMarkers).toHaveLength(1);
    expect(map.notes.join(" ")).toMatch(/nothing to plot/);
  });
});
