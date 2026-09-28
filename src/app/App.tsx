import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/app/shell/AppShell.tsx";
import {
  DEFAULT_MASTER_SEED,
  SimulationSession,
  type SessionSnapshot,
} from "@/app/session/simulationSession.ts";
import { loadWorld } from "@/app/session/worldLoad.ts";
import {
  DEFAULT_UI_PREFERENCES,
  parseUiPreferences,
  serializeUiPreferences,
  systemPrefersReducedMotion,
  type UiPreferences,
} from "@/app/ui/prefs.ts";
import { UI_PREFERENCES_STORAGE_KEY } from "@/app/ui/prefs.ts";
import { textScaleClass } from "@/app/ui/accessibility.ts";
import { LocalStorageSaveStore } from "@/platform/localStorageSaveStore.ts";

/**
 * The browser's `.reel` store (System 06 platform adapter). One instance is
 * enough: it is a thin, stateless adapter over local storage, and the engine
 * itself never touches a browser API.
 */
const SAVE_STORE = new LocalStorageSaveStore();

/** Presentation-level report of the last load attempt (UI/UX 24 section 8). */
interface WorldLoadNotice {
  readonly loading: boolean;
  readonly ok: boolean;
  readonly message: string | null;
}

/**
 * M3 application root (Systems 55/56/57).
 *
 * Owns no simulation truth: it holds the `SimulationSession` (the shell's
 * only engine touchpoint), mirrors its knowledge-filtered snapshot into
 * React state after every intent, and runs the pacing loop. Screens receive
 * projections and callbacks — never the simulation.
 */
export default function App() {
  const [session, setSession] = useState<SimulationSession | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [prefs, setPrefs] = useState<UiPreferences>(() => {
    try {
      const raw = globalThis.localStorage?.getItem(UI_PREFERENCES_STORAGE_KEY) ?? null;
      return parseUiPreferences(raw);
    } catch {
      return DEFAULT_UI_PREFERENCES;
    }
  });
  const [osReducedMotion, setOsReducedMotion] = useState(() => systemPrefersReducedMotion());
  const [worldLoad, setWorldLoad] = useState<WorldLoadNotice>({
    loading: false,
    ok: true,
    message: null,
  });

  useEffect(() => {
    const query = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (query === undefined || query === null) return;
    const onChange = () => setOsReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    // The world opens from the browser's save store, so a save written here is
    // the save a reload finds. Authority is applied by the preferences effect.
    const live = SimulationSession.create({
      masterSeed: DEFAULT_MASTER_SEED,
      saveStore: SAVE_STORE,
    });
    setSession(live);
    setSnapshot(live.snapshot());
    setInitializing(false);
  }, []);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(UI_PREFERENCES_STORAGE_KEY, serializeUiPreferences(prefs));
    } catch {
      // Preferences are conveniences; a full disk must not break the world.
    }
    session?.setAuthority(prefs.authority);
    const next = session?.snapshot() ?? null;
    if (next !== null) setSnapshot(next);
  }, [prefs.authority, session]);

  // Text scale is applied to the <html> root, not to a component: every Tailwind
  // text-* token is a rem value, and rem is relative to the root font size, so
  // one class moves every screen's text with the player's setting (UI/UX 21 §1).
  useEffect(() => {
    const root = globalThis.document?.documentElement;
    if (root === undefined) return;
    root.classList.remove("reellife-text-small", "reellife-text-large", "reellife-text-x-large");
    const className = textScaleClass(prefs.textScale);
    if (className !== "") root.classList.add(className);
  }, [prefs.textScale]);

  const refresh = useCallback(() => {
    if (session === null) return;
    setSnapshot(session.snapshot());
  }, [session]);

  /**
   * Loading replaces the world rather than merging into it: the intent is
   * recorded by `world.load` first, then the platform swap happens (see
   * `worldLoad.ts`). A failed load leaves the running world exactly as it was.
   */
  const handleLoadWorld = useCallback(
    (slotName: string) => {
      if (session === null) return;
      setWorldLoad({ loading: true, ok: true, message: null });
      void loadWorld(session, {
        slotName,
        masterSeed: DEFAULT_MASTER_SEED,
        saveStore: SAVE_STORE,
        authority: prefs.authority,
      }).then((result) => {
        if (!result.ok) {
          setWorldLoad({ loading: false, ok: false, message: result.message });
          return;
        }
        setSession(result.session);
        setSnapshot(result.session.snapshot());
        setWorldLoad({ loading: false, ok: true, message: result.message });
      });
    },
    [prefs.authority, session],
  );

  const paced = useMemo(() => ({ snapshot, prefs, osReducedMotion }), [snapshot, prefs, osReducedMotion]);

  if (initializing || session === null || paced.snapshot === null) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <p className="text-muted-foreground">Opening your world…</p>
      </div>
    );
  }

  return (
    <AppShell
      session={session}
      snapshot={paced.snapshot}
      prefs={prefs}
      osReducedMotion={paced.osReducedMotion}
      onPrefsChange={setPrefs}
      onRefresh={refresh}
      onLoadSlot={handleLoadWorld}
      loadingWorld={worldLoad.loading}
      loadNotice={worldLoad.message === null ? null : { ok: worldLoad.ok, message: worldLoad.message }}
    />
  );
}

