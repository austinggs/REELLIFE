import { densityClasses, type UiDensity } from "@/app/ui/prefs.ts";
import { knowledgeLabel, knowledgeTone } from "@/app/ui/knowledge.ts";
import type { SessionSnapshot } from "@/app/session/simulationSession.ts";
import {
  MAP_MARKER_STATE_LABELS,
  type MapLod,
  type MapMarkerView,
  type MapView,
} from "@/engine/query/index.ts";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/components/card.tsx";

export interface WorldScreenProps {
  readonly snapshot: SessionSnapshot;
  readonly density: UiDensity;
  /** The knowledge-limited map (System 56) as the viewer may see it. */
  readonly mapView: MapView;
  readonly onSelectLod: (lod: MapLod) => void;
  /** Focus the camera on a known place, or clear it back to where the viewer is. */
  readonly onFocusPlace: (placeId: string | undefined) => void;
}

/**
 * World screen (UI/UX 09).
 *
 * The upper cards render the place chain the viewer actually occupies. The map
 * below is System 56's spatial lens over the same truth: one zoom centred on
 * one subject, showing only the places this viewer knows. Places they have
 * never learned about are absent — not greyed — because the map must not
 * expose entities merely because they exist in simulation state (UI/UX 09
 * section 5). Routes are Transportation's own answers copied out verbatim;
 * the map never invents a travel duration.
 */
export function WorldScreen({ snapshot, density, mapView, onSelectLod, onFocusPlace }: WorldScreenProps) {
  const view = snapshot.worldView;
  const world = snapshot.world;

  return (
    <div className={`${densityClasses(density)} mx-auto max-w-4xl p-4`}>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{view.worldName}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          <p className="flex justify-between gap-2">
            <span className="text-muted-foreground">Today</span>
            <span className="font-medium">{view.currentDateLabel}</span>
          </p>
          <p className="flex justify-between gap-2">
            <span className="text-muted-foreground">Started</span>
            <span className="font-medium">{view.startDateLabel}</span>
          </p>
          <p className="flex justify-between gap-2">
            <span className="text-muted-foreground">You are in</span>
            <span className="font-medium">{view.locationName}</span>
          </p>
          <p className="flex justify-between gap-2">
            <span className="text-muted-foreground">Mode</span>
            <span className="font-medium capitalize">
              {world.mode} · {world.difficulty}
            </span>
          </p>
          <p className="flex justify-between gap-2">
            <span className="text-muted-foreground">World generation</span>
            <span className="font-medium">{world.generation}</span>
          </p>
          <p className="flex justify-between gap-2">
            <span className="text-muted-foreground">Days elapsed</span>
            <span className="font-medium">{world.uptimeDays}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Where you are</CardTitle>
        </CardHeader>
        <CardContent>
          {view.places.length === 0 ? (
            <p className="text-sm text-muted-foreground">No known places yet.</p>
          ) : (
            <ul className="space-y-2">
              {view.places.map((place) => (
                <li
                  key={place.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{place.name}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {place.level}
                    </Badge>
                    <Badge
                      variant={knowledgeTone(place.knowledge)}
                      className="text-[10px] uppercase"
                    >
                      {knowledgeLabel(place.knowledge)}
                    </Badge>
                  </span>
                  <span className="text-muted-foreground">
                    {place.relation}
                    {place.population === undefined ? "" : ` · ~${place.population} people`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Map{mapView.anchorName === undefined ? "" : ` — ${mapView.anchorName}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Map detail level">
            {mapView.lods.map((option) => (
              <Button
                key={option.id}
                variant={option.id === mapView.lod ? "default" : "outline"}
                size="sm"
                onClick={() => onSelectLod(option.id)}
              >
                {option.label}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => onFocusPlace(undefined)}>
              Back to where you are
            </Button>
          </div>

          {mapView.focus.known ? (
            <p className="text-sm text-muted-foreground">
              Centred on {mapView.focus.name} · you know {mapView.knownPlaceCount}{" "}
              {mapView.knownPlaceCount === 1 ? "place" : "places"} · {mapView.nowLabel}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              That place is not one you know: moving the map never reveals a location you have
              not learned about.
            </p>
          )}

          {mapView.markers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No known places at this level.</p>
          ) : (
            <ul className="space-y-2">
              {mapView.markers.map((marker) => (
                <MapMarkerItem key={marker.id} marker={marker} onFocusPlace={onFocusPlace} />
              ))}
            </ul>
          )}

          {mapView.routes.length > 0 ? (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Travel options from where you are</h3>
              <ul className="space-y-1 text-sm">
                {mapView.routes.map((route) => (
                  <li key={route.id} className="flex flex-wrap justify-between gap-2 rounded-md border p-2">
                    <span>
                      {route.fromName} → {route.toName} · {route.modeLabel}
                      {route.corridor === undefined ? "" : ` · ${route.corridor}`}
                      {route.alternatives === 0 ? "" : ` · +${route.alternatives} alternative${route.alternatives === 1 ? "" : "s"}`}
                    </span>
                    <span className="text-muted-foreground">
                      {route.durationLabel} · {route.costLabel}
                      {route.border === undefined ? "" : ` · border ${route.border.outcome.replace(/_/g, " ")}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Layers</h3>
            <ul className="flex flex-wrap gap-2 text-xs">
              {mapView.layers.map((layer) => (
                <li key={layer.id}>
                  <Badge variant={layer.status === "shown" ? "secondary" : "outline"}>
                    {layer.label}
                    {layer.status === "shown" ? ` · ${layer.itemCount}` : " · unavailable"}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>

          {mapView.notes.map((note) => (
            <p key={note} className="text-sm text-muted-foreground">
              {note}
            </p>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">How much of this world is real</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            {view.materializedResidents} resident(s) in this settlement have been simulated in
            detail. Everyone else exists as aggregate population
            {view.aggregatePopulation === undefined
              ? ""
              : ` (~${view.aggregatePopulation} people here)`}
            .
          </p>
          {view.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
          {world.provisionalContent.length > 0 ? (
            <p>
              Provisional content in this build: {world.provisionalContent.join(", ")}. Provenance:{" "}
              {world.contentVersion}, simulation version {world.simulationVersion}, schema{" "}
              {world.schemaVersion}.
            </p>
          ) : (
            <p>
              Content version {world.contentVersion}, simulation version{" "}
              {world.simulationVersion}, schema {world.schemaVersion}.
            </p>
          )}
          <p>Registered systems: {world.registeredSystems}.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function MapMarkerItem({
  marker,
  onFocusPlace,
}: {
  readonly marker: MapMarkerView;
  readonly onFocusPlace: (placeId: string) => void;
}) {
  const detail: string[] = [];
  if (marker.population !== undefined) detail.push(`~${marker.population.value} people (estimate)`);
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

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
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
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {detail.length > 0 ? (
          <span className="text-muted-foreground">{detail.join(" · ")}</span>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => onFocusPlace(marker.id)}>
          Focus
        </Button>
      </span>
    </li>
  );
}
