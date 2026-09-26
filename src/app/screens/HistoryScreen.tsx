import { useState } from "react";
import { densityClasses, type UiDensity } from "@/app/ui/prefs.ts";
import { visibilityLabel } from "@/app/ui/knowledge.ts";
import type { SessionSnapshot } from "@/app/session/simulationSession.ts";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/components/card.tsx";

export interface HistoryScreenProps {
  readonly snapshot: SessionSnapshot;
  readonly density: UiDensity;
}

type HistoryTab = "timeline" | "events";

/**
 * History screen (UI/UX 05).
 *
 * History is a derived presentation of the record, never a second source of
 * truth: it reads the timeline projection, which is already knowledge-filtered,
 * so the player cannot read an occurrence they were not entitled to know about.
 * Ordering is the world's own chronology, not "most interesting first".
 */
export function HistoryScreen({ snapshot, density }: HistoryScreenProps) {
  const [tab, setTab] = useState<HistoryTab>("timeline");
  // Both projections are flattened to one presentation row so the screen renders
  // a single list: the engine keeps them distinct, the eye need not.
  const rows =
    tab === "timeline"
      ? snapshot.timeline.map((item) => ({
          id: item.id,
          summary: item.summary,
          detail: item.kind,
          importance: item.importance,
          timeLabel: item.timeLabel,
          knowledge: item.knowledge,
          causalChainId: item.causalChainId,
        }))
      : snapshot.events.map((item) => ({
          id: item.eventId,
          summary: item.summary,
          detail: item.type,
          importance: item.importance,
          timeLabel: item.timeLabel,
          knowledge: item.knowledge,
          causalChainId: item.causalChainId as string | undefined,
        }));

  return (
    <div className={`${densityClasses(density)} mx-auto max-w-4xl p-4`}>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">What has happened</CardTitle>
          <div className="flex gap-2" role="tablist" aria-label="History source">
            <Button
              size="sm"
              variant={tab === "timeline" ? "default" : "outline"}
              role="tab"
              aria-selected={tab === "timeline"}
              onClick={() => setTab("timeline")}
            >
              Timeline ({snapshot.timeline.length})
            </Button>
            <Button
              size="sm"
              variant={tab === "events" ? "default" : "outline"}
              role="tab"
              aria-selected={tab === "events"}
              onClick={() => setTab("events")}
            >
              Your events ({snapshot.events.length})
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ol className="space-y-2">
              {rows.map((row) => (
                <li key={row.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{row.summary}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{visibilityLabel(row.knowledge)}</Badge>
                      {row.timeLabel}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.detail} · importance {row.importance}
                    {row.causalChainId === undefined ? "" : ` · chain ${row.causalChainId}`}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
