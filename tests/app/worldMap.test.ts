/**
 * World map app test (System 56, M4 DoD: "map renders only player-known markers").
 *
 * The kernel tests prove the lens itself is knowledge-limited; this file proves
 * the wiring the player actually touches — `SimulationSession.mapView`, the
 * session's only map access point — preserves that limit. The World screen can
 * only render what the session hands it, so a session that never exposes an
 * unknown place means a screen that cannot draw one.
 */

import { describe, expect, it } from "vitest";
import { SimulationSession } from "../../src/app/session/simulationSession.ts";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { asEntityId } from "../../src/engine/primitives/ids.ts";
import { GeographyEngine } from "../../src/engine/geography/engine.ts";
import { ScaleEngine } from "../../src/engine/scale/engine.ts";
import {
  M2_SETTLEMENT_ID,
  registerAureliaSliceGeography,
  registerAureliaWorldGeography,
} from "../../src/content/aurelia/geography.ts";
import { CANON_SETTLEMENTS } from "../../src/content/aurelia/canon.ts";
import {
  MAP_LODS,
  MAP_MARKER_BUDGET,
  type MapView,
} from "../../src/engine/query/index.ts";
import { buildSpatialMap } from "../../src/app/world/mapProjection.ts";

const SEED = "reellife-world-map-app";

/** The full canon geography with one resident viewer inside Arden. */
function fullWorldSession(): SimulationSession {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
  sim.guard.mutate("geography", () => {
    const geography = new GeographyEngine(sim.scope, sim.world);
    registerAureliaSliceGeography(geography);
    registerAureliaWorldGeography(geography);
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
  return new SimulationSession(sim, { masterSeed: SEED }, viewer);
}

/** A settlement the viewer has never learned about. */
function farSettlement(): { readonly id: string; readonly name: string } {
  const settlement = CANON_SETTLEMENTS.find((entry) => entry.id !== M2_SETTLEMENT_ID);
  if (!settlement) throw new Error("worldMap.test: canon has no second settlement");
  return settlement;
}

function stringsIn(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === "object") {
    return (Object.values(value) as readonly unknown[]).flatMap(stringsIn);
  }
  return [];
}

function viewsByLod(live: SimulationSession): readonly MapView[] {
  return MAP_LODS.map((lod) => live.mapView({ lod }));
}

describe("world map through the session (System 56, M4 DoD)", () => {
  it("opens on the viewer's own settlement with only known markers", () => {
    const live = fullWorldSession();
    const view = live.mapView({ lod: "city" });

    expect(view.focus).toMatchObject({ known: true, name: "Arden" });
    expect(view.markers.length).toBeGreaterThan(0);
    expect(view.markers.length).toBeLessThanOrEqual(MAP_MARKER_BUDGET);
    expect(new Set(view.markers.map((marker) => marker.id)).size).toBe(view.markers.length);
    expect(view.markers.map((marker) => marker.id)).toContain(M2_SETTLEMENT_ID);
  });

  it("renders only player-known markers at every zoom", () => {
    const live = fullWorldSession();
    const far = farSettlement();

    for (const view of viewsByLod(live)) {
      const texts = stringsIn(view);
      expect(texts, `${view.lod} draws ${far.id}`).not.toContain(far.id);
      expect(texts, `${view.lod} draws ${far.name}`).not.toContain(far.name);
      expect(view.markers.length).toBeLessThanOrEqual(MAP_MARKER_BUDGET);
      expect(new Set(view.markers.map((marker) => marker.id)).size).toBe(view.markers.length);
    }
  });

  it("answers an unknown focus with an empty window and no echo", () => {
    const live = fullWorldSession();
    const far = farSettlement();

    const view = live.mapView({ lod: "city", focusId: far.id });
    expect(view.focus.known).toBe(false);
    expect(view.markers).toHaveLength(0);
    expect(view.routes).toHaveLength(0);
    expect(stringsIn(view).filter((text) => text === far.id || text === far.name)).toEqual([]);
  });

  it("keeps the map a derived read: repeated calls agree and expose no engine state", () => {
    const live = fullWorldSession();
    const first = live.mapView({ lod: "country" });
    const second = live.mapView({ lod: "country" });

    expect(second).toEqual(first);
    expect(Object.keys(first)).not.toContain("sim");
    expect(Object.keys(first)).not.toContain("systems");
    expect(JSON.stringify(first)).not.toContain("systems");
  });
});

/**
 * U4 — the engine's own map, run through the spatial layout.
 *
 * `mapProjection.test.ts` proves the arithmetic against hand-built fixtures.
 * This proves the wiring: that the *real* knowledge-limited `MapView` draws, and
 * — the property that matters most — that turning it into a picture cannot
 * resurrect a place the projection deliberately withheld.
 */
describe("spatial map over the real world (U4)", () => {
  const VIEWPORT = { width: 800, height: 520 };
  const FLAT = { zoom: 1, offsetX: 0, offsetY: 0 };
  const ZOOMED = { zoom: 4, offsetX: 0, offsetY: 0 };

  it("draws every zoom the engine offers, accounting for all of it", () => {
    const live = fullWorldSession();
    for (const lod of MAP_LODS) {
      const view = live.mapView({ lod });
      const map = buildSpatialMap({ view, viewport: VIEWPORT, camera: FLAT });
      // Nothing is silently dropped: every marker is either drawn or explained.
      expect(map.markers.length + map.undrawnMarkers.length).toBe(view.markers.length);
      expect(map.routes.length + map.undrawnRoutes.length).toBe(view.routes.length);
      for (const node of map.markers) {
        expect(Number.isFinite(node.x)).toBe(true);
        expect(Number.isFinite(node.y)).toBe(true);
      }
    }
  });

  it("puts the viewer's own settlement on the canvas at a workable zoom", () => {
    const live = fullWorldSession();
    const view = live.mapView({ lod: "region" });
    const map = buildSpatialMap({ view, viewport: VIEWPORT, camera: FLAT });
    expect(view.markers.length).toBeGreaterThan(0);
    expect(map.markers.length).toBeGreaterThan(0);
    expect(map.bounds).toBeDefined();
  });

  it("cannot draw a place the projection withheld, at any magnification", () => {
    const live = fullWorldSession();
    const far = farSettlement();

    for (const lod of MAP_LODS) {
      const view = live.mapView({ lod });
      const permitted = new Set(view.markers.map((marker) => marker.id));
      for (const camera of [FLAT, ZOOMED]) {
        const map = buildSpatialMap({ view, viewport: VIEWPORT, camera });
        const drawn = map.markers.map((node) => node.id);
        expect(new Set(drawn).size).toBe(drawn.length);
        for (const id of drawn) expect(permitted.has(id)).toBe(true);
        // Zooming is a lens, not a key: the same set of places at every zoom.
        expect(new Set(drawn)).toEqual(new Set(permitted));
        expect(permitted.has(far.id)).toBe(false);
      }
    }
  });

  it("connects a drawn journey to two places that are both on the map", () => {
    const live = fullWorldSession();
    const map = buildSpatialMap({ view: live.mapView({ lod: "country" }), viewport: VIEWPORT, camera: FLAT });
    const placed = new Set(map.markers.map((node) => node.id));
    for (const edge of map.routes) {
      expect(placed.has(edge.fromId)).toBe(true);
      expect(placed.has(edge.toId)).toBe(true);
    }
  });
});
