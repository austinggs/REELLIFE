/**
 * Spatial projection for the world map (U4; System 56 rendering, UI/UX 09).
 *
 * Pure geometry, like `people/lineageLayout.ts`, so the map's arithmetic can be
 * asserted without a DOM — there is no jsdom in this project and adding one to
 * watch an SVG draw itself would be a poor trade.
 *
 * What this module deliberately does **not** do:
 *
 *   - **Invent geometry.** The World Bible gives every place a `GeoPoint` but no
 *     polygons, so this plots *points and the routes between them*. There is no
 *     coastline and no border to draw, and adding either would be fabricating
 *     canon (see `docs/CONTENT_GAPS.md`).
 *   - **Drop a place to make the picture tidy.** A marker with no plottable
 *     position, or a route with an endpoint that has none, is returned in
 *     `undrawnMarkers` / `undrawnRoutes` with a reason. A map that silently
 *     omits something and a map that cannot see it look different.
 *   - **Let zoom change status.** Zoom changes where a marker is drawn, never how
 *     large or how significant it is: radius is fixed in screen space, so a
 *     settlement does not become a continent by being magnified.
 *
 * The projection is a flat equirectangular plot. Longitude is scaled by
 * `cos(mean latitude)` so a settlement keeps its proportions instead of being
 * stretched east–west; that factor is returned with the layout so the choice is
 * visible rather than buried.
 */

import type { MapMarkerState, MapPositionView, MapView } from "@/engine/query/index.ts";
import { LOCATION_LEVELS, type KnowledgeState, type LocationLevel } from "@/engine/primitives/index.ts";

export const MAP_MIN_ZOOM = 1;
export const MAP_MAX_ZOOM = 8;
export const MAP_ZOOM_STEP = 1.25;

export interface MapViewport {
  readonly width: number;
  readonly height: number;
}

export interface SpatialCamera {
  readonly zoom: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface GeoBounds {
  readonly minLat: number;
  readonly maxLat: number;
  readonly minLon: number;
  readonly maxLon: number;
  /** The factor longitudes were stretched by, so the choice is inspectable. */
  readonly longitudeScale: number;
}

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface SpatialMarkerNode {
  readonly id: string;
  readonly name: string;
  readonly level: LocationLevel;
  readonly x: number;
  readonly y: number;
  /** Fixed in screen space: zoom changes position, never status. */
  readonly radius: number;
  readonly state: MapMarkerState;
  readonly knowledge: KnowledgeState;
  readonly isFocus: boolean;
}

export interface SpatialRouteEdge {
  readonly id: string;
  readonly fromId: string;
  readonly toId: string;
  readonly from: Point2D;
  readonly to: Point2D;
  readonly modeLabel: string;
  readonly international: boolean;
}

export interface UndrawnPlace {
  readonly id: string;
  readonly name: string;
  /** Why it is on the list but not on the map. */
  readonly reason: string;
}

export interface UndrawnRoute {
  readonly id: string;
  readonly label: string;
  readonly reason: string;
}

export interface SpatialMap {
  readonly width: number;
  readonly height: number;
  readonly markers: readonly SpatialMarkerNode[];
  readonly routes: readonly SpatialRouteEdge[];
  readonly undrawnMarkers: readonly UndrawnPlace[];
  readonly undrawnRoutes: readonly UndrawnRoute[];
  /** The camera's own subject, when it has a position. */
  readonly focusPoint?: Point2D;
  readonly bounds?: GeoBounds;
  readonly notes: readonly string[];
}

/**
 * Radius per place level, in screen pixels; wider places read as wider. Levels
 * absent from this table (the sub-place ones — property, room, unit) fall back
 * to the smallest mark, which is honest: the engine records them, but a map is
 * not where a single room is legible.
 */
const LEVEL_RADII: Readonly<Partial<Record<LocationLevel, number>>> = {
  world: 16,
  continent: 12,
  country: 10,
  region: 8,
  settlement: 7,
  district: 5,
  neighborhood: 4,
};

const UNKNOWN_POSITION = "no position is on record for this place";
const IMPLAUSIBLE_POSITION = "the recorded position is outside the world";

/**
 * Whether a position can honestly be plotted.
 *
 * NaN, infinities and coordinates off the globe are rejected rather than
 * clamped: a bad coordinate is a gap in the record, and silently pinning it to
 * the edge of the map would place the place somewhere false.
 */
export function isPlottablePosition(position: MapPositionView | undefined): boolean {
  if (position === undefined) return false;
  const { latitude, longitude } = position;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (Math.abs(latitude) > 90) return false;
  return Math.abs(longitude) <= 180;
}

export function reasonNotPlottable(position: MapPositionView | undefined): string {
  if (position === undefined) return UNKNOWN_POSITION;
  return isPlottablePosition(position) ? "" : IMPLAUSIBLE_POSITION;
}

/** The box of plotable positions, or `undefined` when there are none. */
export function geographicBounds(
  positions: readonly (MapPositionView | undefined)[],
): GeoBounds | undefined {
  const usable = positions.filter(
    (position): position is MapPositionView => isPlottablePosition(position),
  );
  if (usable.length === 0) return undefined;

  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let latSum = 0;
  for (const position of usable) {
    minLat = Math.min(minLat, position.latitude);
    maxLat = Math.max(maxLat, position.latitude);
    minLon = Math.min(minLon, position.longitude);
    maxLon = Math.max(maxLon, position.longitude);
    latSum += position.latitude;
  }
  const meanLat = latSum / usable.length;
  // Clamp away from zero so a world straddling the equator still plots.
  const longitudeScale = Math.max(0.05, Math.cos((meanLat * Math.PI) / 180));

  return { minLat, maxLat, minLon, maxLon, longitudeScale };
}

export interface SpatialMapInput {
  readonly view: MapView;
  readonly viewport: MapViewport;
  readonly camera: SpatialCamera;
}

/** Levels inside `LOCATION_LEVELS` are known; anything else still gets a radius. */
function radiusFor(level: LocationLevel): number {
  return LEVEL_RADII[level] ?? (LOCATION_LEVELS.includes(level) ? 5 : 6);
}

/** Projects one position onto the canvas, north up. */
export function projectToPlane(
  position: MapPositionView,
  bounds: GeoBounds,
  viewport: MapViewport,
): Point2D {
  const lonSpan = (bounds.maxLon - bounds.minLon) * bounds.longitudeScale;
  const latSpan = bounds.maxLat - bounds.minLat;
  const x =
    lonSpan <= 0
      ? viewport.width / 2
      : ((position.longitude - bounds.minLon) * bounds.longitudeScale * viewport.width) / lonSpan;
  const y =
    latSpan <= 0
      ? viewport.height / 2
      : viewport.height - ((position.latitude - bounds.minLat) / latSpan) * viewport.height;
  return { x, y };
}

/** Applies zoom about the canvas centre, then the pan offset. */
export function applyCamera(
  point: Point2D,
  camera: SpatialCamera,
  viewport: MapViewport,
): Point2D {
  // A NaN or infinite camera would otherwise poison every coordinate on the
  // canvas and leave the map blank with no explanation, which is the one outcome
  // worse than a wrong-looking map.
  const zoom = Number.isFinite(camera.zoom)
    ? Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, camera.zoom))
    : MAP_MIN_ZOOM;
  const offsetX = Number.isFinite(camera.offsetX) ? camera.offsetX : 0;
  const offsetY = Number.isFinite(camera.offsetY) ? camera.offsetY : 0;
  return {
    x: (point.x - viewport.width / 2) * zoom + viewport.width / 2 + offsetX,
    y: (point.y - viewport.height / 2) * zoom + viewport.height / 2 + offsetY,
  };
}

/** The next zoom step in a direction, clamped to the usable range. */
export function zoomBy(zoom: number, direction: "in" | "out"): number {
  const factor = direction === "in" ? MAP_ZOOM_STEP : 1 / MAP_ZOOM_STEP;
  return Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, zoom * factor));
}

const UNDRAWN_PLACE_NOTE =
  "These places are on the list but not on the map, because no usable position is on record for them.";
const POINT_AND_ROUTE_NOTE =
  "This is a point-and-route plot. Aurelia's coastlines and borders are not recorded anywhere, so they are not drawn here.";

/**
 * Lays out one zoom of the map for one viewer.
 *
 * The result always accounts for every marker and every route the projection
 * gave it: anything that cannot be drawn comes back in `undrawnMarkers` /
 * `undrawnRoutes` with a reason, so a caller can say so in words instead of
 * letting a gap look like an absence of places.
 */
export function buildSpatialMap(input: SpatialMapInput): SpatialMap {
  const { view, viewport, camera } = input;
  // The anchor chain's last entry is the zoom's anchor, so it identifies the
  // camera's own subject when that subject is also a marker in the window.
  const focusPlaceId = view.focus.known
    ? view.focus.containers[view.focus.containers.length - 1]?.id
    : undefined;

  const bounds = geographicBounds([
    ...view.markers.map((marker) => marker.position),
    view.focus.position,
  ]);

  if (bounds === undefined) {
    return {
      width: viewport.width,
      height: viewport.height,
      markers: [],
      routes: [],
      undrawnMarkers: view.markers.map((marker) => ({
        id: marker.id,
        name: marker.name,
        reason: reasonNotPlottable(marker.position),
      })),
      undrawnRoutes: view.routes.map((route) => ({
        id: route.id,
        label: `${route.fromName} → ${route.toName}`,
        reason: "one end of this journey has no position to draw a line to",
      })),
      notes: [...view.notes, "No place you know has a position on record, so there is nothing to plot."],
    };
  }

  const at = (position: MapPositionView): Point2D =>
    applyCamera(projectToPlane(position, bounds, viewport), camera, viewport);

  const markers: SpatialMarkerNode[] = [];
  const undrawnMarkers: UndrawnPlace[] = [];
  const pointById = new Map<string, Point2D>();

  for (const marker of view.markers) {
    if (marker.position === undefined || !isPlottablePosition(marker.position)) {
      undrawnMarkers.push({
        id: marker.id,
        name: marker.name,
        reason: reasonNotPlottable(marker.position),
      });
      continue;
    }
    const point = at(marker.position);
    pointById.set(marker.id, point);
    markers.push({
      id: marker.id,
      name: marker.name,
      level: marker.level,
      x: point.x,
      y: point.y,
      radius: radiusFor(marker.level),
      state: marker.state,
      knowledge: marker.knowledge,
      isFocus: marker.id === focusPlaceId,
    });
  }

  const routes: SpatialRouteEdge[] = [];
  const undrawnRoutes: UndrawnRoute[] = [];
  for (const route of view.routes) {
    const from = pointById.get(route.fromPlaceId);
    const to = pointById.get(route.toPlaceId);
    if (from === undefined || to === undefined) {
      undrawnRoutes.push({
        id: route.id,
        label: `${route.fromName} → ${route.toName}`,
        reason: "one end of this journey is not drawn on this map",
      });
      continue;
    }
    routes.push({
      id: route.id,
      fromId: route.fromPlaceId,
      toId: route.toPlaceId,
      from,
      to,
      modeLabel: route.modeLabel,
      international: route.isInternational,
    });
  }

  const notes = [...view.notes, POINT_AND_ROUTE_NOTE];
  if (undrawnMarkers.length > 0) notes.push(UNDRAWN_PLACE_NOTE);

  const focusPoint =
    view.focus.position !== undefined && isPlottablePosition(view.focus.position)
      ? at(view.focus.position)
      : undefined;

  return {
    width: viewport.width,
    height: viewport.height,
    markers,
    routes,
    undrawnMarkers,
    undrawnRoutes,
    ...(focusPoint === undefined ? {} : { focusPoint }),
    bounds,
    notes,
  };
}
