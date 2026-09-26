/**
 * Application shell (Systems 55/56/57; UI/UX 01, 03, 08).
 *
 * The shell is the presentation boundary. It holds *no* simulation truth: it
 * reads the session's knowledge-filtered snapshot, renders it, and sends intents
 * back through the session. Three rules are structural rather than stylistic:
 *
 *   1. Screens receive projections and callbacks, never the session or the
 *      simulation, so no view can reach `world.systems`.
 *   2. Debug surfaces (console, debug) exist only while debug authority is
 *      granted, because their anchors are filtered by authority rather than
 *      hidden with CSS.
 *   3. Pacing advances authoritative time through the simulation's own step loop;
 *      it is not a UI animation, so reduced motion never freezes the world.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DecisionOption } from "@/app/decision/decisionFlow.ts";
import { breadcrumb, navItem, viewForShortcut, visibleNavItems, type ShellView } from "@/app/shell/navModel.ts";
import { ConsoleScreen } from "@/app/screens/ConsoleScreen.tsx";
import { DebugScreen } from "@/app/screens/DebugScreen.tsx";
import { HistoryScreen } from "@/app/screens/HistoryScreen.tsx";
import { LifeScreenView } from "@/app/screens/LifeScreen.tsx";
import { PeopleScreen } from "@/app/screens/PeopleScreen.tsx";
import { SearchScreen } from "@/app/screens/SearchScreen.tsx";
import { SettingsScreen } from "@/app/screens/SettingsScreen.tsx";
import { WorldScreen } from "@/app/screens/WorldScreen.tsx";
import type {
  SaveSlotView,
  SessionSnapshot,
  SimulationSession,
  SimulationSpeed,
} from "@/app/session/simulationSession.ts";
import { authorityLabel, motionEnabled, shouldSurfaceNotification, type UiPreferences } from "@/app/ui/prefs.ts";
import type { ConsoleAuthority } from "@/engine/primitives/index.ts";
import type { EntityInspectorView, PersonView } from "@/engine/query/index.ts";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";

/** Wall-clock cadence of one authoritative step; speed scales world time. */
const PACING_INTERVAL_MS = 1200;

export interface AppShellProps {
  readonly session: SimulationSession;
  readonly snapshot: SessionSnapshot;
  readonly prefs: UiPreferences;
  readonly osReducedMotion: boolean;
  readonly onPrefsChange: (prefs: UiPreferences) => void;
  readonly onRefresh: () => void;
  /** Loading replaces the running world; the app performs the swap. */
  readonly onLoadSlot: (slotName: string) => void;
  readonly loadingWorld: boolean;
  readonly loadNotice: { readonly ok: boolean; readonly message: string } | null;
}

export function AppShell({
  session,
  snapshot,
  prefs,
  osReducedMotion,
  onPrefsChange,
  onRefresh,
  onLoadSlot,
  loadingWorld,
  loadNotice,
}: AppShellProps) {
  const [view, setView] = useState<ShellView>("life");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const [slots, setSlots] = useState<readonly SaveSlotView[]>([]);
  const [slotsIssue, setSlotsIssue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const revision = snapshot.revision;
  const authority = snapshot.authority;
  const paused = snapshot.clock.paused;

  const navItems = useMemo(() => visibleNavItems(authority), [authority]);
  const personView: PersonView | null = useMemo(
    () => (selectedPersonId === null ? null : session.personView(selectedPersonId)),
    [session, selectedPersonId, revision],
  );
  const inspector: EntityInspectorView | null = useMemo(
    () => (inspectorId === null ? null : session.inspect(inspectorId)),
    [session, inspectorId, revision],
  );

  const refreshSlots = useCallback(() => {
    void session.listSlots().then((listing) => {
      setSlots(listing.slots);
      setSlotsIssue(listing.issue ?? null);
    });
  }, [session]);

  useEffect(() => {
    refreshSlots();
  }, [refreshSlots]);

  // A loaded world is a different world. Selections and inspectors are
  // presentation state (UI/UX 24 section 2) and must not be carried across a
  // swap, where the ids they point at may not exist any more.
  useEffect(() => {
    setSelectedPersonId(null);
    setInspectorId(null);
  }, [session]);

  // Time flows on its own; the pause command is what stops it. Because this
  // advances authoritative time, reduced motion must never gate it.
  useEffect(() => {
    if (paused) return;
    const timer = globalThis.setInterval(() => {
      session.advance(1);
      onRefresh();
    }, PACING_INTERVAL_MS);
    return () => globalThis.clearInterval(timer);
  }, [session, onRefresh, paused]);

  // Every anchor is reachable without a pointer, and a shortcut for a surface the
  // current authority may not use does nothing rather than opening it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = viewForShortcut(event.key);
      if (target === undefined) return;
      if (!navItems.some((item) => item.view === target)) return;
      event.preventDefault();
      setView(target);
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [navItems]);

  // Losing authority must not strand the player on a surface they may not use.
  useEffect(() => {
    if (navItems.some((item) => item.view === view)) return;
    setView("life");
  }, [navItems, view]);

  const commit = useCallback(
    (option: DecisionOption) => {
      const outcome = session.act(option.commandType, { ...(option.params ?? {}) });
      onRefresh();
      return outcome;
    },
    [session, onRefresh],
  );

  const runConsole = useCallback(
    (line: string) => {
      const result = session.console(line);
      onRefresh();
      return result;
    },
    [session, onRefresh],
  );

  /** Pacing and saving are commands, so they settle through the same refresh. */
  const settle = useCallback(
    (action: () => void) => {
      action();
      onRefresh();
    },
    [onRefresh],
  );

  const handleSave = useCallback(
    (slotName: string) => {
      setSaving(true);
      void session
        .save(slotName)
        .then(() => refreshSlots())
        .finally(() => setSaving(false));
    },
    [session, refreshSlots],
  );

  const openPerson = useCallback((personId: string) => {
    setSelectedPersonId(personId);
    setView("people");
  }, []);

  const inspect = useCallback((id: string) => {
    setInspectorId(id);
    setView("debug");
  }, []);

  // Only notifications the player's own policy allows to interrupt are surfaced;
  // the rest accumulate in the notification feed on the Life screen.
  const surfaced = snapshot.notifications.notifications.find((notification) =>
    shouldSurfaceNotification(prefs, notification),
  );
  const trail = view === "people" && personView !== null ? [personView.displayName] : [];
  const motion = motionEnabled(prefs, osReducedMotion);
  const density = prefs.density;

  return (
    <div
      className={`min-h-screen bg-background text-foreground${
        motion ? "" : " [&_*]:transition-none"
      }`}
      data-motion={motion ? "full" : "reduced"}
    >
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-lg font-bold">ReelLife</h1>
            <p className="text-xs text-muted-foreground">
              {snapshot.world.worldName} · {snapshot.clock.dateTimeLabel} ·{" "}
              {snapshot.clock.dayPhase}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                settle(() => {
                  session.setPaused(!paused);
                })
              }
            >
              {paused ? "Resume" : "Pause"}
            </Button>
            {snapshot.clock.speeds.map((speed: SimulationSpeed) => (
              <Button
                key={speed}
                size="sm"
                variant={snapshot.clock.speed === speed ? "default" : "outline"}
                onClick={() =>
                  settle(() => {
                    session.setSpeed(speed);
                  })
                }
              >
                {speed}×
              </Button>
            ))}
            <Badge variant={authority === "player" ? "outline" : "default"}>
              {authorityLabel(authority)}
            </Badge>
          </div>
        </div>
        <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-wrap gap-2 px-4 pb-2">
          {navItems.map((item) => (
            <Button
              key={item.view}
              size="sm"
              variant={view === item.view ? "default" : "ghost"}
              aria-current={view === item.view ? "page" : undefined}
              title={`${item.description} (${item.shortcut})`}
              onClick={() => setView(item.view)}
            >
              {item.label}
            </Button>
          ))}
        </nav>
        <p className="mx-auto max-w-6xl px-4 pb-3 text-xs text-muted-foreground">
          <span className="font-medium">{breadcrumb(view, trail).join(" / ")}</span> ·{" "}
          {navItem(view).description}
        </p>
        {surfaced === undefined ? null : (
          <div role="status" className="border-t bg-accent/30 px-4 py-2 text-sm">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
              <Badge variant={surfaced.delivery === "interrupt" ? "destructive" : "secondary"}>
                {surfaced.delivery}
              </Badge>
              <span className="font-medium">{surfaced.title}</span>
              <span className="text-muted-foreground">
                {surfaced.category} · {surfaced.timeLabel}
              </span>
            </div>
          </div>
        )}
      </header>

      <main>
        {view === "life" ? (
          <LifeScreenView
            snapshot={snapshot}
            density={density}
            onCommit={commit}
            onOpenPerson={openPerson}
          />
        ) : null}
        {view === "people" ? (
          <PeopleScreen
            snapshot={snapshot}
            density={density}
            selectedPersonId={selectedPersonId}
            personView={personView}
            onSelect={setSelectedPersonId}
          />
        ) : null}
        {view === "world" ? <WorldScreen snapshot={snapshot} density={density} /> : null}
        {view === "history" ? <HistoryScreen snapshot={snapshot} density={density} /> : null}
        {view === "search" ? (
          <SearchScreen
            density={density}
            onSearch={(query) => session.search(query)}
            onOpenPerson={openPerson}
            canInspect={authority !== "player"}
            onInspect={inspect}
          />
        ) : null}
        {view === "settings" ? (
          <SettingsScreen
            snapshot={snapshot}
            prefs={prefs}
            density={density}
            osReducedMotion={osReducedMotion}
            onPrefsChange={onPrefsChange}
            onSetSpeed={(speed) =>
              settle(() => {
                session.setSpeed(speed);
              })
            }
            onSetPaused={(next) =>
              settle(() => {
                session.setPaused(next);
              })
            }
            onChangeAuthority={(next: ConsoleAuthority) => onPrefsChange({ ...prefs, authority: next })}
            slots={slots}
            slotsIssue={slotsIssue}
            saving={saving}
            onSave={handleSave}
            onRefreshSlots={refreshSlots}
            loadingWorld={loadingWorld}
            loadNotice={loadNotice}
            onLoadSlot={onLoadSlot}
          />
        ) : null}
        {view === "console" ? (
          <ConsoleScreen snapshot={snapshot} density={density} onRun={runConsole} />
        ) : null}
        {view === "debug" ? (
          <DebugScreen
            snapshot={snapshot}
            density={density}
            stateHash={session.stateHash()}
            inspector={inspector}
            onInspect={inspect}
          />
        ) : null}
      </main>
    </div>
  );
}
