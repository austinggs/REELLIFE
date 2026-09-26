import { useState } from "react";
import type { SessionSnapshot } from "@/app/session/simulationSession.ts";
import { densityClasses, type UiDensity } from "@/app/ui/prefs.ts";
import { knowledgeLabel, knowledgeTone } from "@/app/ui/knowledge.ts";
import type { EntityInspectorView } from "@/engine/query/index.ts";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/components/card.tsx";
import { Input } from "@/ui/components/input.tsx";

export interface DebugScreenProps {
  readonly snapshot: SessionSnapshot;
  readonly density: UiDensity;
  /** Diagnostic state hash (System 59); read-only and non-authoritative. */
  readonly stateHash: string;
  /** The inspector projection for the current target, if any. */
  readonly inspector: EntityInspectorView | null;
  readonly onInspect: (id: string) => void;
}

function MetricTable({
  values,
  title,
}: {
  readonly values: Readonly<Record<string, number>>;
  readonly title: string;
}) {
  const entries = Object.entries(values);
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">None recorded.</p>
      ) : (
        <dl className="grid grid-cols-1 gap-1 text-sm md:grid-cols-2">
          {entries.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-2 rounded-md border px-3 py-1">
              <dt className="font-mono text-xs text-muted-foreground">{key}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * Debug screen (UI/UX 22).
 *
 * This surface reads authoritative internals, so it exists only under granted
 * debug authority (see `navModel.visibleNavItems`). Everything here is a
 * diagnostic: the inspector, counters, invariant failures and the state hash used
 * by the determinism harness. Nothing on this screen can mutate the world.
 */
export function DebugScreen({
  snapshot,
  density,
  stateHash,
  inspector,
  onInspect,
}: DebugScreenProps) {
  const [target, setTarget] = useState("");
  const health = snapshot.health;

  return (
    <div className={`${densityClasses(density)} mx-auto max-w-4xl p-4`}>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">Simulation health</CardTitle>
          <Badge variant={health.invariantFailures === 0 ? "default" : "destructive"}>
            {health.invariantFailures === 0
              ? "No invariant failures"
              : `${health.invariantFailures} invariant failure(s)`}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Steps</dt>
              <dd className="text-lg font-semibold">{health.steps}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Pending events</dt>
              <dd className="text-lg font-semibold">{health.pendingEvents}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Commands</dt>
              <dd className="text-lg font-semibold">{health.commandCount}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">Timeline entries</dt>
              <dd className="text-lg font-semibold">
                {health.timelineEntries}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  (+{health.compressedTimelineEntries} compressed)
                </span>
              </dd>
            </div>
          </dl>
          <p className="font-mono text-xs text-muted-foreground">state hash {stateHash}</p>
          <MetricTable values={health.metricCounters} title="Counters" />
          <MetricTable values={health.metricGauges} title="Gauges" />
          {health.ownershipViolations.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-destructive">
                Ownership violations
              </h3>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {health.ownershipViolations.map((violation) => (
                  <li key={violation}>{violation}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {health.unhandledConsequenceTypes.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Unhandled consequence types
              </h3>
              <ul className="flex flex-wrap gap-2 text-sm">
                {health.unhandledConsequenceTypes.map((type) => (
                  <li key={type}>
                    <Badge variant="outline">{type}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Entity inspector</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = target.trim();
              if (trimmed.length === 0) return;
              onInspect(trimmed);
            }}
          >
            <Input
              aria-label="Entity id to inspect"
              placeholder="PER-000001"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
            <Button type="submit">Inspect</Button>
          </form>
          {inspector === null ? (
            <p className="text-sm text-muted-foreground">No entity selected.</p>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{inspector.title}</span>
                <Badge variant="outline">{inspector.kind}</Badge>
                <Badge variant={inspector.found ? "secondary" : "destructive"}>
                  {inspector.found ? "resolved" : "unresolved"}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">{inspector.id}</span>
              </p>
              <dl className="grid grid-cols-1 gap-1 md:grid-cols-2">
                {inspector.fields.map((field) => (
                  <div
                    key={field.label}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-1"
                  >
                    <dt className="flex items-center gap-2 text-muted-foreground">
                      {field.label}
                      <Badge
                        variant={knowledgeTone(field.knowledge)}
                        className="text-[10px] uppercase"
                      >
                        {knowledgeLabel(field.knowledge)}
                      </Badge>
                    </dt>
                    <dd className="font-medium">{field.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
