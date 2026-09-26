import { densityClasses, type UiDensity } from "@/app/ui/prefs.ts";
import { knowledgeLabel, knowledgeTone } from "@/app/ui/knowledge.ts";
import type { SessionSnapshot } from "@/app/session/simulationSession.ts";
import { Badge } from "@/ui/components/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/components/card.tsx";

export interface WorldScreenProps {
  readonly snapshot: SessionSnapshot;
  readonly density: UiDensity;
}

/**
 * World screen (UI/UX 09).
 *
 * Renders the place chain the viewer actually occupies — the settlement they are
 * in and what contains it — rather than a gazetteer they have never learned.
 * Places they cannot locate stay absent until knowledge reaches them (M4 widens
 * this into the knowledge-limited map).
 */
export function WorldScreen({ snapshot, density }: WorldScreenProps) {
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
