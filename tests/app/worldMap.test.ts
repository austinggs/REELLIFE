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
