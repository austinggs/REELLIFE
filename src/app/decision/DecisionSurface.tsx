/**
 * Decision & action surface (UI/UX 07).
 *
 * The pure state machine lives in `decisionFlow.ts`; this file is only its React
 * binding. Two properties are deliberate:
 *
 *   - The surface never dispatches on a navigation key. Arrows move the
 *     selection, Escape backs out, and only a commit *button* runs a command, so
 *     a stray keystroke cannot change the world.
 *   - The offered options come from the engine's quick-action projection, so an
 *     action that does not exist in this world is not offered at all.
 *
 * Deterministic outcomes are labelled as deterministic and estimates as
 * estimates: the surface promises only what the simulation can actually promise
 * (UI/UX 07 section 4).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyDecisionKey,
  initialDecisionSurface,
  type DecisionOption,
  type DecisionSurfaceState,
} from "@/app/decision/decisionFlow.ts";
import type { SessionCommandOutcome } from "@/app/session/simulationSession.ts";
import { densityClasses, type UiDensity } from "@/app/ui/prefs.ts";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/components/card.tsx";

/** Navigation keys the surface consumes; commit keys are never intercepted. */
const NAVIGATION_KEYS = ["ArrowDown", "ArrowUp", "Home", "End", "Escape"] as const;

function isNavigationKey(key: string): boolean {
  return (NAVIGATION_KEYS as readonly string[]).includes(key);
}

export interface DecisionSurfaceProps {
  readonly options: readonly DecisionOption[];
  readonly density: UiDensity;
  /** Dispatches the chosen action; returns the authoritative outcome. */
  readonly onCommit: (option: DecisionOption) => SessionCommandOutcome;
  /** Called after a commit resolved, so the screen can re-read the world. */
  readonly onSettled?: (() => void) | undefined;
}

export function DecisionSurface({ options, density, onCommit, onSettled }: DecisionSurfaceProps) {
  const [state, setState] = useState<DecisionSurfaceState>(() => initialDecisionSurface(options));
  const optionButtons = useRef<(HTMLButtonElement | null)[]>([]);

  // A new projection may offer a different action list (a command becoming
  // available, or an action disappearing). When that happens the surface starts
  // over rather than pointing at an option that no longer exists.
  const signature = options.map((option) => option.commandType).join("|");
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    setState(initialDecisionSurface(options));
  }, [options, signature]);

  // Selection, stage and outcome are UI state; the offered options are always
  // the freshest projection, so a screen never renders a stale action list.
  const surface: DecisionSurfaceState = { ...state, options };

  const press = useCallback(
    (key: string) => {
      setState((previous) => applyDecisionKey({ ...previous, options }, key, onCommit));
    },
    [onCommit, options],
  );

  const resolvedOutcome = surface.stage === "resolved" ? surface.outcome : undefined;
  useEffect(() => {
    if (resolvedOutcome === undefined) return;
    onSettled?.();
  }, [resolvedOutcome, onSettled]);

  useEffect(() => {
    if (surface.stage !== "choosing") return;
    optionButtons.current[surface.selectedIndex]?.focus();
  }, [surface.selectedIndex, surface.stage]);

  const gap = densityClasses(density);
  const { stage, preview, outcome } = surface;

  if (options.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick actions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No actions are available in this situation yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      role="group"
      aria-label="Decision surface"
      onKeyDown={(event) => {
        if (!isNavigationKey(event.key)) return;
        event.preventDefault();
        press(event.key);
      }}
    >
      <CardHeader>
        <CardTitle className="text-lg">Quick actions</CardTitle>
      </CardHeader>
      <CardContent className={gap}>
        <ul className="flex flex-wrap gap-2" aria-label="Available actions">
          {options.map((option, index) => {
            const selected = index === surface.selectedIndex && stage !== "previewing";
            return (
              <li key={option.commandType}>
                <Button
                  ref={(element) => {
                    optionButtons.current[index] = element;
                  }}
                  variant={selected ? "default" : "outline"}
                  aria-selected={selected}
                  className="h-auto flex-col items-start gap-1 py-2 text-left"
                  onClick={() => {
                    setState((previous) =>
                      applyDecisionKey(
                        { ...previous, options, selectedIndex: index },
                        "Enter",
                        onCommit,
                      ),
                    );
                  }}
                >
                  <span>{option.label}</span>
                  <span className="flex items-center gap-1 text-[10px] font-normal uppercase opacity-80">
                    <Badge
                      variant={option.outcomeKind === "deterministic" ? "secondary" : "outline"}
                    >
                      {option.outcomeKind === "deterministic" ? "Deterministic" : "Estimate"}
                    </Badge>
                    {option.requiresDebug === true ? (
                      <Badge variant="destructive">Debug</Badge>
                    ) : null}
                  </span>
                </Button>
              </li>
            );
          })}
        </ul>

        {stage === "previewing" && preview !== undefined ? (
          <div className="rounded-md border bg-accent/20 p-4">
            <p className="text-sm font-medium">Commit to “{preview.label}”?</p>
            <p className="mt-1 text-sm text-muted-foreground">{preview.expectation}</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => press("Enter")}>
                Commit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => press("Escape")}>
                Back
              </Button>
            </div>
          </div>
        ) : null}

        {stage === "resolved" && outcome !== undefined ? (
          <div className="rounded-md border p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Badge variant={outcome.applied ? "default" : "destructive"}>
                {outcome.applied ? "Applied" : "Refused"}
              </Badge>
              <span className="text-muted-foreground">{outcome.status}</span>
            </p>
            {outcome.reasons.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {outcome.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
            {outcome.error !== undefined ? (
              <p className="mt-2 text-sm text-destructive">{outcome.error}</p>
            ) : null}
            {outcome.eventTypes.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Events: {outcome.eventTypes.join(", ")}
              </p>
            ) : null}
            <Button size="sm" variant="outline" className="mt-3" onClick={() => press("Enter")}>
              Continue
            </Button>
          </div>
        ) : null}

        {surface.log.length > 0 ? (
          <ul
            className="space-y-1 text-xs text-muted-foreground"
            aria-live="polite"
            aria-label="Decision trail"
          >
            {surface.log.slice(-4).map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
