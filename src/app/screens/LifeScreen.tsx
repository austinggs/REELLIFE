import { useState } from "react";
import { DecisionSurface } from "@/app/decision/DecisionSurface.tsx";
import type { DecisionOption } from "@/app/decision/decisionFlow.ts";
import { EmptyState } from "@/app/ui/EmptyState.tsx";
import type {
  SessionCommandOutcome,
  SessionSnapshot,
} from "@/app/session/simulationSession.ts";
import { densityClasses, type UiDensity } from "@/app/ui/prefs.ts";
import { knowledgeLabel, knowledgeTone, visibilityLabel } from "@/app/ui/knowledge.ts";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/components/card.tsx";
import { Progress } from "@/ui/components/progress.tsx";

export interface LifeScreenViewProps {
  readonly snapshot: SessionSnapshot;
  readonly density: UiDensity;
  /** Dispatches a chosen action and returns what the simulation decided. */
  readonly onCommit: (option: DecisionOption) => SessionCommandOutcome;
  /** Shows a person the viewer can identify (people screen, preselected). */
  readonly onOpenPerson: (personId: string) => void;
}

/**
 * Main Life Screen (UI/UX 04).
 *
 * Reads exactly one projection — the viewer's situation — and renders it in the
 * order the spec calls for: who you are now, what you need, what you are doing
 * and have committed to, who is near you, what you can do about it, and what has
 * happened. Nothing is computed here; the screen renders what it is told,
 * including *how well* the viewer is supposed to know each fact.
 */
export function LifeScreenView({
  snapshot,
  density,
  onCommit,
  onOpenPerson,
}: LifeScreenViewProps) {
  const [showAllEvents, setShowAllEvents] = useState(false);
  const situation = snapshot.situation;
  const gap = densityClasses(density);

  if (situation === null) {
    return <p className="p-4 text-sm text-muted-foreground">No one to live as yet.</p>;
  }

  const events = showAllEvents ? situation.events : situation.events.slice(0, 4);

  return (
    <div className={`${gap} mx-auto max-w-4xl p-4`}>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-3">
          <div>
            <CardTitle className="font-display text-2xl font-bold">
              {situation.displayName}
              <Badge variant={knowledgeTone(situation.nameKnowledge)} className="ml-2 align-middle text-[10px] uppercase">
                {knowledgeLabel(situation.nameKnowledge)}
              </Badge>
            </CardTitle>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{situation.timeLabel}</span>
              <span aria-hidden="true">•</span>
              <Badge variant="outline">{snapshot.clock.dayPhase}</Badge>
              <Badge variant="outline">{snapshot.clock.season}</Badge>
              <span aria-hidden="true">•</span>
              <span>{situation.locationName}</span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {situation.ageYears} years old · {situation.lifeStage}
              {situation.householdName === undefined ? "" : ` · ${situation.householdName}`}
              {situation.householdRole === undefined ? "" : ` (${situation.householdRole})`}
            </p>
          </div>
          <div className="text-right">
            <span className="block text-xs uppercase tracking-wider text-muted-foreground">
              Mood
            </span>
            <Badge variant="secondary" className="mt-1 capitalize">
              {situation.moodLabel}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between rounded-md bg-muted/50 p-3 text-sm">
            <span className="text-muted-foreground">Current activity:</span>
            <span className="font-medium">
              {situation.currentActivity?.label ?? "Nothing scheduled"}
            </span>
          </div>
          {situation.mostUrgentNeed === undefined ? null : (
            <div className="flex items-center justify-between rounded-md bg-muted/50 p-3 text-sm">
              <span className="text-muted-foreground">Most urgent need:</span>
              <span className="font-medium">
                {situation.mostUrgentNeed.label} ({situation.mostUrgentNeed.urgency})
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {situation.needs.slice(0, 6).map((need) => (
          <Card key={need.kind}>
            <CardContent className="pt-6">
              <div className="mb-2 flex justify-between text-sm font-medium">
                <span className="flex items-center gap-2">
                  {need.label}
                  <Badge variant={knowledgeTone(need.knowledge)} className="text-[10px] uppercase">
                    {knowledgeLabel(need.knowledge)}
                  </Badge>
                </span>
                <span>{Math.round(need.level * 100)}%</span>
              </div>
              <Progress value={need.level * 100} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Committed to</CardTitle>
        </CardHeader>
        <CardContent>
          {situation.commitments.length === 0 ? (
            <EmptyState
              title="Nothing committed right now"
              body="A commitment is a window of time you have already promised to something — a shift, an appointment, a class. None is scheduled for you at the moment, so nothing here needs your attention."
            />
          ) : (
            <ul className="space-y-2">
              {situation.commitments.map((commitment) => (
                <li
                  key={commitment.activityId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <span className="flex items-center gap-2 font-medium">
                    {commitment.label}
                    {commitment.isNow ? <Badge variant="default">Now</Badge> : null}
                  </span>
                  <span className="text-muted-foreground">
                    {commitment.startsAtLabel} → {commitment.endsAtLabel} · {commitment.state}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">People here</CardTitle>
        </CardHeader>
        <CardContent>
          {situation.nearbyPeople.length === 0 ? (
            <p className="text-sm text-muted-foreground">You are on your own here.</p>
          ) : (
            <ul className="space-y-2">
              {situation.nearbyPeople.map((person) => (
                <li
                  key={person.personId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{person.displayName}</span>
                    <Badge variant={knowledgeTone(person.knowledge)} className="text-[10px] uppercase">
                      {knowledgeLabel(person.knowledge)}
                    </Badge>
                  </span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {person.context}
                    {person.knowledge === "unknown" ? null : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onOpenPerson(person.personId)}
                      >
                        View
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <DecisionSurface
        options={situation.quickActions.map((action) => ({
          commandType: action.commandType,
          label: action.label,
          expectation: action.expectation,
          outcomeKind: action.outcomeKind,
        }))}
        density={density}
        onCommit={onCommit}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">What has happened</CardTitle>
          {situation.events.length > 4 ? (
            <Button size="sm" variant="ghost" onClick={() => setShowAllEvents((shown) => !shown)}>
              {showAllEvents ? "Show fewer" : "Show all"}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <EmptyState
              title="Nothing notable yet"
              body="Events appear here once something the world considers notable has happened to you. Early in a life there is often nothing to report, and that is an honest answer rather than a missing record."
            />
          ) : (
            <ul className="space-y-2">
              {events.map((event) => (
                <li key={event.eventId} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{event.summary}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{visibilityLabel(event.knowledge)}</Badge>
                      {event.timeLabel}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {event.type} · importance {event.importance}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

