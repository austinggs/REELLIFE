import { useCallback, useMemo, useState } from "react";
import { EmptyState } from "@/app/ui/EmptyState.tsx";
import { knowledgeLabel, knowledgeTone } from "@/app/ui/knowledge.ts";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { MAP_MARKER_STATE_LABELS, type MapMarkerView, type MapView } from "@/engine/query/index.ts";
import {
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  buildSpatialMap,
  zoomBy,
  type MapViewport,
  type SpatialMarkerNode,
} from "@/app/world/mapProjection.ts";

/**
 * A fixed drawing surface. The SVG scales to the card with `w-full`, so the
 * layout never has to measure the DOM and the same map always lays out the same
 * way — which is what makes it testable without a browser.
 */
const VIEWPORT: MapViewport = { width: 800, height: 520 };

/** One keyboard nudge of the viewport, in canvas units. */
const PAN_STEP = 40;

export interface SpatialMapProps {
  readonly view: MapView;
  readonly onFocusPlace: (placeId: string) => void;
}

/**
 * Fill per marker, so two different kinds of "interesting" stay distinguishable.
 * None of this is load-bearing on its own: the picture is `aria-hidden` and the
 * marker list below carries every fact in words, so colour is decoration here
 * rather than the message.
 */
function markerFill(node: SpatialMarkerNode): string {
  if (node.isFocus) return "fill-primary";
  if (node.state === "restricted") return "fill-destructive";
  if (node.knowledge === "hidden" || node.knowledge === "unknown") return "fill-muted-foreground";
  if (node.state === "event-associated") return "fill-amber-500";
  if (node.state === "route-associated") return "fill-sky-500";
  return "fill-foreground";
}

/**
 * Every fact the engine holds about one marker, phrased for prose.
 *
 * Moved here from the World screen so the accessible roster under the map is the
 * *complete* one: the picture above is decorative, and nothing that used to be on
 * this screen may disappear just because it became a picture.
 */
function markerDetail(marker: MapMarkerView): string[] {
  const detail: string[] = [];
  if (marker.population !== undefined) {
    detail.push(`~${marker.population.value} people (estimate)`);
  }
  if (marker.weather !== undefined) {
    detail.push(`${marker.weather.conditionLabel}, ${marker.weather.temperatureCelsius}°C`);
  }
  for (const hazard of marker.hazards) {
    detail.push(`${hazard.kindLabel} (${Math.round(hazard.intensity * 100)}%)`);
  }
  for (const disaster of marker.disasters) {
    detail.push(`${disaster.kind} — ${disaster.stage}`);
  }
  if (marker.political !== undefined) detail.push(marker.political.countryName);
  if (marker.visibleEventCount > 0) {
    detail.push(
      `${marker.visibleEventCount} recorded ${marker.visibleEventCount === 1 ? "event" : "events"}`,
    );
  }
  if (marker.formerNames.length > 0) detail.push(`formerly ${marker.formerNames.join(", ")}`);
  if (marker.position !== undefined && marker.position.confidence === "approximate") {
    detail.push("position approximate");
  }
  return detail;
}

/**
 * The spatial lens, drawn (U4; System 56, UI/UX 09).
 *
 * Everything here paints what `mapProjection.ts` computed; the component derives
 * no geography of its own. Three deliberate choices:
 *
 *   1. **Points and routes, not borders.** Aurelia's boundaries are not recorded
 *      anywhere, so a filled political map would be invented canon. The map
 *      says so in words underneath the picture.
 *   2. **The picture is decorative.** It is `aria-hidden`, and the marker list
 *      below it is the accessible, complete version. A map that only exists as
 *      coloured dots tells a screen reader nothing.
 *   3. **Zoom is a lens, not a claim.** Zooming moves markers; it never resizes
 *      them, promotes a village to a region, or reveals a place System 56 did
 *      not return. Fog of war is decided upstream and cannot be zoomed through.
 */
export function SpatialMap({ view, onFocusPlace }: SpatialMapProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const camera = useMemo(() => ({ zoom, offsetX: pan.x, offsetY: pan.y }), [zoom, pan]);
  const map = useMemo(() => buildSpatialMap({ view, viewport: VIEWPORT, camera }), [view, camera]);

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const nudge = useCallback((dx: number, dy: number) => {
    setPan((current) => ({ x: current.x + dx, y: current.y + dy }));
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const moves: Readonly<Record<string, [number, number]>> = {
        ArrowLeft: [PAN_STEP, 0],
        ArrowRight: [-PAN_STEP, 0],
        ArrowUp: [0, PAN_STEP],
        ArrowDown: [0, -PAN_STEP],
      };
      const move = moves[event.key];
      if (move !== undefined) {
        event.preventDefault();
        nudge(move[0], move[1]);
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom((current) => zoomBy(current, "in"));
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setZoom((current) => zoomBy(current, "out"));
      }
    },
    [nudge],
  );

  const statesPresent = [...new Set(map.markers.map((node) => node.state))];

  if (map.bounds === undefined) {
    return (
      <EmptyState
        title="Nothing to plot yet"
        body="You do not know any place that has a position on record, so there is no map to draw. System 37 records where a place is; the map can show only the places you know, and only those with a position."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Map zoom">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setZoom((current) => zoomBy(current, "in"))}
          disabled={zoom >= MAP_MAX_ZOOM}
        >
          Zoom in
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setZoom((current) => zoomBy(current, "out"))}
          disabled={zoom <= MAP_MIN_ZOOM}
        >
          Zoom out
        </Button>
        <Button size="sm" variant="ghost" onClick={reset} disabled={zoom === 1 && pan.x === 0 && pan.y === 0}>
          Reset view
        </Button>
        <span className="text-xs text-muted-foreground">
          Magnified {Math.round(zoom * 100)}% — this changes where things are drawn, never how
          important they are.
        </span>
      </div>

      <div
        role="group"
        tabIndex={0}
        aria-label="Map viewport. Arrow keys pan, plus and minus zoom. The list below carries every place in words."
        onKeyDown={onKeyDown}
        className="rounded-md border bg-muted/30 p-1 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox={`0 0 ${map.width} ${map.height}`}
          className="h-auto w-full"
        >
          {map.routes.map((edge) => (
            <line
              key={edge.id}
              x1={edge.from.x}
              y1={edge.from.y}
              x2={edge.to.x}
              y2={edge.to.y}
              strokeWidth={1.75}
              className="stroke-sky-600/70 dark:stroke-sky-400/70"
              strokeDasharray={edge.international ? "6 4" : undefined}
            />
          ))}
          {map.focusPoint === undefined ? null : (
            <circle
              cx={map.focusPoint.x}
              cy={map.focusPoint.y}
              r={22}
              fill="none"
              strokeWidth={2}
              className="stroke-primary"
            />
          )}
          {map.markers.map((node) => (
            <circle
              key={node.id}
              cx={node.x}
              cy={node.y}
              r={node.radius}
              className={markerFill(node)}
            >
              <title>
                {node.name} — {MAP_MARKER_STATE_LABELS[node.state]}
              </title>
            </circle>
          ))}
        </svg>
      </div>

      {view.markers.length === 0 ? (
        <EmptyState
          title="No known places at this zoom"
          body="System 56 shows one level of detail at a time, so a zoom that is too tight for the places you know comes back empty. Change the detail level above rather than reading this as an empty world."
        />
      ) : (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Every place on this map</h3>
          <ul className="space-y-2">
            {view.markers.map((marker) => (
              <MapMarkerRow
                key={marker.id}
                marker={marker}
                undrawnReason={map.undrawnMarkers.find((place) => place.id === marker.id)?.reason}
                isFocus={map.markers.some((node) => node.id === marker.id && node.isFocus)}
                onFocusPlace={onFocusPlace}
              />
            ))}
          </ul>
        </div>
      )}

      {map.undrawnRoutes.length > 0 ? (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Journeys not drawn</h3>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {map.undrawnRoutes.map((entry) => (
              <li key={entry.id} className="rounded-md border border-dashed p-2">
                <span className="font-medium text-foreground">{entry.label}</span> — {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {statesPresent.length === 0 ? null : (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">What the marks mean</h3>
          <ul className="flex flex-wrap gap-2 text-xs">
            {statesPresent.map((state) => (
              <li key={state}>
                <Badge variant="outline">{MAP_MARKER_STATE_LABELS[state]}</Badge>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            A dashed line is a journey that crosses a border; a solid one does not.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * One place in the accessible roster: the words behind whatever the picture
 * shows. A place with no drawable position still appears here, saying so —
 * "not drawn" is a statement about the record, not about whether it exists.
 */
function MapMarkerRow({
  marker,
  undrawnReason,
  isFocus,
  onFocusPlace,
}: {
  readonly marker: MapMarkerView;
  readonly undrawnReason: string | undefined;
  readonly isFocus: boolean;
  readonly onFocusPlace: (placeId: string) => void;
}) {
  const detail = markerDetail(marker);
  return (
    <li
      className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm${
        undrawnReason === undefined ? "" : " border-dashed"
      }`}
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{marker.name}</span>
        <Badge variant="outline" className="text-[10px] uppercase">
          {marker.level}
        </Badge>
        <Badge variant={knowledgeTone(marker.knowledge)} className="text-[10px] uppercase">
          {knowledgeLabel(marker.knowledge)}
        </Badge>
        <Badge variant="secondary" className="text-[10px] uppercase">
          {MAP_MARKER_STATE_LABELS[marker.state]}
        </Badge>
        {isFocus ? <Badge className="text-[10px] uppercase">Where you are looking</Badge> : null}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {detail.length > 0 ? (
          <span className="text-muted-foreground">{detail.join(" · ")}</span>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => onFocusPlace(marker.id)}>
          Focus
        </Button>
      </span>
      {undrawnReason === undefined ? null : (
        <span className="w-full text-xs text-muted-foreground">
          Not drawn on the map: {undrawnReason}
        </span>
      )}
    </li>
  );
}
