import { LineageTree } from "@/app/people/LineageTree.tsx";
import { EmptyState } from "@/app/ui/EmptyState.tsx";
import { knowledgeLabel, knowledgeTone } from "@/app/ui/knowledge.ts";
import { densityClasses, type UiDensity } from "@/app/ui/prefs.ts";
import type { SessionSnapshot } from "@/app/session/simulationSession.ts";
import type {
  FamilyView,
  PeopleDirectoryView,
  PerceptionView,
  PersonView,
} from "@/engine/query/index.ts";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/components/card.tsx";

export interface PeopleScreenProps {
  readonly snapshot: SessionSnapshot;
  readonly density: UiDensity;
  readonly selectedPersonId: string | null;
  /** The viewer's picture of the selected person, computed by the session. */
  readonly personView: PersonView | null;
  /** Everyone the viewer can name (System 18/19), or a count of the rest. */
  readonly directory: PeopleDirectoryView | null;
  /** The viewer's own recorded family structure (System 19). */
  readonly family: FamilyView | null;
  /** What is believed about the selected person (System 22). */
  readonly perceptions: PerceptionView | null;
  readonly onSelect: (personId: string | null) => void;
}

/**
 * People screen (UI/UX 02).
 *
 * Four honest reads, in order: who you can name, what a person's own record
 * says, who you are related to, and what anyone actually believes about them.
 * None of it is inferred here. The directory counts the people you have not met
 * instead of listing them, the lineage shows only links System 19 recorded, and
 * perceptions arrive observer by observer because this world has no single
 * reputation score to show.
 */
export function PeopleScreen({
  snapshot,
  density,
  selectedPersonId,
  personView,
  directory,
  family,
  perceptions,
  onSelect,
}: PeopleScreenProps) {
  const situation = snapshot.situation;
  const gap = densityClasses(density);

  if (situation === null) {
    return <p className="p-4 text-sm text-muted-foreground">No one to live as yet.</p>;
  }

  const canName = (directory?.entries.length ?? 0) > 1;

  return (
    <div className={`${gap} mx-auto max-w-5xl p-4`}>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">People you can name</CardTitle>
        </CardHeader>
        <CardContent className={gap}>
          {!canName ? (
            <EmptyState
              title="Nobody is on record yet"
              body="You have not met anyone outside yourself in this world yet. System 18 writes a tie once two people actually interact, and System 19 records a household when one is formed, so this list grows out of what has happened rather than from a roster."
            />
          ) : (
            <ul className="space-y-2">
              {(directory?.entries ?? []).map((entry) => (
                <li
                  key={entry.personId}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm${
                    entry.relation === "self" ? " bg-muted/40" : ""
                  }`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{entry.displayName}</span>
                    <Badge variant={knowledgeTone(entry.knowledge)} className="text-[10px] uppercase">
                      {knowledgeLabel(entry.knowledge)}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {entry.relationLabel}
                    </Badge>
                    {entry.householdRole === undefined ? null : (
                      <Badge variant="outline" className="text-[10px]">
                        {entry.householdRole}
                      </Badge>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
                    {entry.ageLabel === undefined ? null : <span>{entry.ageLabel}</span>}
                    {entry.locationName === undefined ? null : <span>{entry.locationName}</span>}
                    <Button
                      size="sm"
                      variant={selectedPersonId === entry.personId ? "default" : "ghost"}
                      disabled={!entry.canOpen}
                      onClick={() => onSelect(entry.personId)}
                    >
                      View
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(directory?.notes ?? []).length === 0 ? null : (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {(directory?.notes ?? []).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your household</CardTitle>
        </CardHeader>
        <CardContent className={gap}>
          {family === null ? (
            <EmptyState
              title="No family record to read"
              body="System 19 has not recorded a household for you in this world, so there is nothing to show rather than something missing."
            />
          ) : (
            <>
              {family.householdName === undefined ? null : (
                <p className="text-sm">
                  <span className="font-medium">{family.householdName}</span>
                  {family.householdRole === undefined ? null : (
                    <span className="text-muted-foreground">
                      : you are recorded here as {family.householdRole}
                    </span>
                  )}
                </p>
              )}
              {family.stints.length === 0 ? (
                <EmptyState
                  title="No stints recorded"
                  body="You have not been recorded joining a household yet, so there is no stint to list."
                />
              ) : (
                <ol className="space-y-2">
                  {family.stints.map((stint, index) => (
                    <li
                      key={`${stint.joinedAtLabel}-${index}`}
                      className="rounded-md border p-3 text-sm"
                    >
                      <span className="font-medium capitalize">{stint.role}</span>
                      <span className="ml-2 text-muted-foreground">
                        joined {stint.joinedAtLabel}
                        {stint.ended
                          ? `, left ${stint.leftAtLabel ?? "on a date not recorded"}`
                          : ", still a member"}
                        {stint.leftReason === undefined ? "" : ` (${stint.leftReason})`}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
          {(family?.notes ?? []).length === 0 ? null : (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {(family?.notes ?? []).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Who you are related to</CardTitle>
        </CardHeader>
        <CardContent>
          {family === null ? (
            <EmptyState
              title="No lineage to read"
              body="System 19 holds no kinship record for you, so no diagram is drawn."
            />
          ) : (
            <LineageTree
              subjectId={family.personId}
              subjectLabel={family.displayName}
              subjectParentIds={family.parents.map((person) => person.personId)}
              ancestors={family.ancestors}
              descendants={family.descendants}
              emptyTitle="No kin on record"
              emptyBody="No parents or children have been recorded for you. System 19 writes a link when a birth actually happens in this world, and a founding household has none behind it yet."
            />
          )}
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


      {personView === null ? null : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              What people believe about {personView.displayName}
            </CardTitle>
          </CardHeader>
          <CardContent className={gap}>
            {perceptions === null || !perceptions.recorded ? (
              <EmptyState
                title="Nothing is believed about this person yet"
                body={
                  perceptions?.notes[0] ??
                  "System 22 records a belief once somebody has actually observed something. No observer has recorded a view of this person."
                }
              />
            ) : (
              <ul className="space-y-3">
                {perceptions.domains.map((domain) => (
                  <li key={domain.domain} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{domain.domainLabel}</span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {domain.collectiveValueLabel === undefined ? null : (
                          <span>held on balance: {domain.collectiveValueLabel}</span>
                        )}
                        {domain.disagreementLabel === undefined ? null : (
                          <Badge variant="outline">{domain.disagreementLabel}</Badge>
                        )}
                      </span>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {domain.readings.map((reading) => (
                        <li
                          key={reading.observerId}
                          className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
                        >
                          <span className="text-foreground">{reading.observerLabel}</span>
                          <span className="flex flex-wrap items-center gap-2">
                            <span>{reading.valueLabel ?? "no evidence recorded"}</span>
                            <Badge variant="outline">evidence {reading.evidenceCount}</Badge>
                            <Badge variant="outline">{reading.staleLabel}</Badge>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            {(perceptions?.notes ?? []).length === 0 ? null : (
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {(perceptions?.notes ?? []).map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

