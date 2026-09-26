import { knowledgeLabel, knowledgeTone } from "@/app/ui/knowledge.ts";
import { densityClasses, type UiDensity } from "@/app/ui/prefs.ts";
import type { SessionSnapshot } from "@/app/session/simulationSession.ts";
import type { PersonView } from "@/engine/query/index.ts";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/components/card.tsx";

export interface PeopleScreenProps {
  readonly snapshot: SessionSnapshot;
  readonly density: UiDensity;
  readonly selectedPersonId: string | null;
  /** The viewer's picture of the selected person, computed by the session. */
  readonly personView: PersonView | null;
  readonly onSelect: (personId: string | null) => void;
}

/**
 * People screen (UI/UX 02).
 *
 * The list is not a directory of the world: it is everyone the viewer can
 * actually identify — themselves, the people they live with, and the people they
 * know. Someone the viewer has never met is shown as a stranger with no name,
 * because naming them would be inventing knowledge the viewer does not have.
 */
export function PeopleScreen({
  snapshot,
  density,
  selectedPersonId,
  personView,
  onSelect,
}: PeopleScreenProps) {
  const situation = snapshot.situation;
  const gap = densityClasses(density);

  if (situation === null) {
    return <p className="p-4 text-sm text-muted-foreground">No one to live as yet.</p>;
  }

  return (
    <div className={`${gap} mx-auto max-w-5xl p-4`}>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">People you can name</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 p-3 text-sm">
              <span className="flex items-center gap-2">
                <span className="font-medium">{situation.displayName}</span>
                <Badge
                  variant={knowledgeTone(situation.nameKnowledge)}
                  className="text-[10px] uppercase"
                >
                  {knowledgeLabel(situation.nameKnowledge)}
                </Badge>
              </span>
              <span className="flex items-center gap-2 text-muted-foreground">
                yourself
                <Button
                  size="sm"
                  variant={selectedPersonId === situation.viewerId ? "default" : "ghost"}
                  onClick={() => onSelect(situation.viewerId)}
                >
                  View
                </Button>
              </span>
            </li>
            {situation.nearbyPeople.map((person) => (
              <li
                key={person.personId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">{person.displayName}</span>
                  <Badge
                    variant={knowledgeTone(person.knowledge)}
                    className="text-[10px] uppercase"
                  >
                    {knowledgeLabel(person.knowledge)}
                  </Badge>
                </span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  {person.context}
                  <Button
                    size="sm"
                    variant={selectedPersonId === person.personId ? "default" : "ghost"}
                    disabled={person.knowledge === "unknown"}
                    onClick={() => onSelect(person.personId)}
                  >
                    {person.knowledge === "unknown" ? "Unnamed" : "View"}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {personView === null ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Select someone to see what you know about them.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
              {personView.displayName}
              <Badge
                variant={knowledgeTone(personView.nameKnowledge)}
                className="text-[10px] uppercase"
              >
                {knowledgeLabel(personView.nameKnowledge)}
              </Badge>
              <Badge variant="outline" className="text-[10px] uppercase">
                {personView.relation}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className={gap}>
            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                What you can observe
              </h3>
              <dl className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {personView.summaryFields.map((field) => (
                  <div key={field.label} className="rounded-md border p-3 text-sm">
                    <dt className="flex items-center justify-between gap-2 text-muted-foreground">
                      {field.label}
                      <Badge
                        variant={knowledgeTone(field.knowledge)}
                        className="text-[10px] uppercase"
                      >
                        {knowledgeLabel(field.knowledge)}
                      </Badge>
                    </dt>
                    <dd className="mt-1 font-medium">{field.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Not observable
              </h3>
              <dl className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {personView.privateFields.map((field) => (
                  <div key={field.label} className="rounded-md border border-dashed p-3 text-sm">
                    <dt className="flex items-center justify-between gap-2 text-muted-foreground">
                      {field.label}
                      <Badge
                        variant={knowledgeTone(field.knowledge)}
                        className="text-[10px] uppercase"
                      >
                        {knowledgeLabel(field.knowledge)}
                      </Badge>
                    </dt>
                    <dd className="mt-1 font-medium">{field.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            {personView.notes.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {personView.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
