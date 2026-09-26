import { useState } from "react";
import type { SessionConsoleResult, SessionSnapshot } from "@/app/session/simulationSession.ts";
import { authorityLabel, densityClasses, type UiDensity } from "@/app/ui/prefs.ts";
import { CONSOLE_READ_COMMANDS } from "@/engine/query/index.ts";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/components/card.tsx";
import { Input } from "@/ui/components/input.tsx";

export interface ConsoleScreenProps {
  readonly snapshot: SessionSnapshot;
  readonly density: UiDensity;
  /** Runs one line through the console pipeline and returns its lines. */
  readonly onRun: (line: string) => SessionConsoleResult;
}

interface TranscriptEntry {
  readonly line: string;
  readonly result: SessionConsoleResult;
}

function lineTone(kind: string): "default" | "secondary" | "destructive" | "outline" {
  switch (kind) {
    case "mutation":
      return "destructive";
    case "error":
      return "destructive";
    case "read":
      return "outline";
    default:
      return "secondary";
  }
}

/**
 * Console (System 57, UI/UX 22 section 6).
 *
 * Reads and mutations are visibly different things: a read is answered from the
 * query layer, a mutation travels through the command pipeline and is refused
 * outright under player authority. The screen shows which is which rather than
 * hiding the distinction behind one text box.
 */
export function ConsoleScreen({ snapshot, density, onRun }: ConsoleScreenProps) {
  const [line, setLine] = useState("");
  const [transcript, setTranscript] = useState<readonly TranscriptEntry[]>([]);

  return (
    <div className={`${densityClasses(density)} mx-auto max-w-3xl p-4`}>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">Console</CardTitle>
          <Badge variant={snapshot.authority === "player" ? "outline" : "default"}>
            {authorityLabel(snapshot.authority)}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Reads: {CONSOLE_READ_COMMANDS.join(", ")}. Mutations are commands and need debug
            authority; under player mode they are refused with a reason.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = line.trim();
              if (trimmed.length === 0) return;
              setTranscript((previous) => [...previous, { line: trimmed, result: onRun(trimmed) }]);
              setLine("");
            }}
          >
            <Input
              aria-label="Console input"
              placeholder="time.read  ·  world.state_hash  ·  person.eat"
              value={line}
              onChange={(event) => setLine(event.target.value)}
            />
            <Button type="submit">Run</Button>
          </form>
          {transcript.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing run yet.</p>
          ) : (
            <ul className="space-y-2">
              {transcript.map((entry, index) => (
                <li key={`${index}-${entry.line}`} className="rounded-md border p-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-mono text-xs">
                    <Badge variant={entry.result.status === "ok" ? "secondary" : "destructive"}>
                      {entry.result.status}
                    </Badge>
                    {entry.line}
                  </p>
                  {entry.result.lines.map((output, lineIndex) => (
                    <p key={lineIndex} className="mt-1 flex items-start gap-2 text-sm">
                      <Badge variant={lineTone(output.kind)} className="mt-0.5 text-[10px] uppercase">
                        {output.kind}
                      </Badge>
                      <span>{output.text}</span>
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Command audit trail</CardTitle>
        </CardHeader>
        <CardContent>
          {snapshot.commandLog.length === 0 ? (
            <p className="text-sm text-muted-foreground">No commands dispatched yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {snapshot.commandLog.map((entry) => (
                <li key={entry.id} className="rounded-md border p-3">
                  <p className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs">{entry.type}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={entry.status === "applied" ? "secondary" : "destructive"}>
                        {entry.status}
                      </Badge>
                      {entry.origin} · {entry.issuedAtLabel}
                    </span>
                  </p>
                  {entry.reasons.length > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">{entry.reasons.join("; ")}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
