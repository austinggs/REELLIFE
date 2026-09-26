import { useState } from "react";
import type {
  SaveSlotView,
  SessionSnapshot,
  SimulationSpeed,
} from "@/app/session/simulationSession.ts";
import {
  authorityLabel,
  densityClasses,
  motionEnabled,
  NOTIFICATION_MODES,
  UI_DENSITIES,
  type NotificationMode,
  type UiDensity,
  type UiPreferences,
} from "@/app/ui/prefs.ts";
import type { ConsoleAuthority } from "@/engine/primitives/index.ts";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/components/card.tsx";

export interface SettingsScreenProps {
  readonly snapshot: SessionSnapshot;
  readonly prefs: UiPreferences;
  readonly density: UiDensity;
  readonly osReducedMotion: boolean;
  readonly onPrefsChange: (prefs: UiPreferences) => void;
  /** Pacing is a command, so it goes through the pipeline like any other. */
  readonly onSetSpeed: (speed: SimulationSpeed) => void;
  readonly onSetPaused: (paused: boolean) => void;
  readonly onChangeAuthority: (authority: ConsoleAuthority) => void;
  readonly slots: readonly SaveSlotView[];
  /** Set when the store could not be enumerated; shown instead of "no saves". */
  readonly slotsIssue: string | null;
  readonly saving: boolean;
  readonly onSave: (slotName: string) => void;
  readonly onRefreshSlots: () => void;
  readonly loadingWorld: boolean;
  readonly loadNotice: { readonly ok: boolean; readonly message: string } | null;
  /** Loads a slot and replaces the running world; confirmed before it happens. */
  readonly onLoadSlot: (slotName: string) => void;
}

const AUTHORITIES: readonly ConsoleAuthority[] = ["player", "debug", "system"];

/**
 * Settings screen (UI/UX 06, UI/UX 21, UI/UX 22 section 7).
 *
 * Everything here is presentation except pacing and save, which are commands and
 * therefore travel through the pipeline. Debug authority is *granted* here and
 * never assumed: granting it is what makes the console and debug anchors appear
 * at all.
 */
export function SettingsScreen({
  snapshot,
  prefs,
  density,
  osReducedMotion,
  onPrefsChange,
  onSetSpeed,
  onSetPaused,
  onChangeAuthority,
  slots,
  slotsIssue,
  saving,
  onSave,
  onRefreshSlots,
  loadingWorld,
  loadNotice,
  onLoadSlot,
}: SettingsScreenProps) {
  // Which slot is awaiting confirmation. Presentation state only (UI/UX 24).
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div className={`${densityClasses(density)} mx-auto max-w-3xl p-4`}>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Time</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {snapshot.clock.dateTimeLabel} · step {snapshot.clock.stepIndex} ·{" "}
            {snapshot.clock.paused ? "paused" : "running"}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={snapshot.clock.paused ? "default" : "outline"}
              onClick={() => onSetPaused(!snapshot.clock.paused)}
            >
              {snapshot.clock.paused ? "Resume" : "Pause"}
            </Button>
            {snapshot.clock.speeds.map((speed) => (
              <Button
                key={speed}
                size="sm"
                variant={snapshot.clock.speed === speed ? "default" : "outline"}
                onClick={() => onSetSpeed(speed)}
              >
                {speed}×
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Reading the world</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">Density</span>
            <div className="flex gap-2">
              {UI_DENSITIES.map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={prefs.density === option ? "default" : "outline"}
                  onClick={() => onPrefsChange({ ...prefs, density: option })}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">
              Reduced motion
              {osReducedMotion ? " (also set by your operating system)" : ""}
            </span>
            <Button
              size="sm"
              variant={prefs.reducedMotion ? "default" : "outline"}
              onClick={() => onPrefsChange({ ...prefs, reducedMotion: !prefs.reducedMotion })}
            >
              {motionEnabled(prefs, osReducedMotion) ? "Motion on" : "Motion reduced"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">Notifications</span>
            <div className="flex gap-2">
              {NOTIFICATION_MODES.map((mode: NotificationMode) => (
                <Button
                  key={mode}
                  size="sm"
                  variant={prefs.notificationMode === mode ? "default" : "outline"}
                  onClick={() => onPrefsChange({ ...prefs, notificationMode: mode })}
                >
                  {mode}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Console authority</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Debug tools must be granted, never assumed. Under player authority the console refuses
            every mutation outright.
          </p>
          <div className="flex flex-wrap gap-2">
            {AUTHORITIES.map((authority) => (
              <Button
                key={authority}
                size="sm"
                variant={prefs.authority === authority ? "default" : "outline"}
                onClick={() => onChangeAuthority(authority)}
              >
                {authorityLabel(authority)}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Currently: <Badge variant="outline">{authorityLabel(snapshot.authority)}</Badge>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Saves</CardTitle>
          <Button size="sm" variant="outline" onClick={onRefreshSlots}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            size="sm"
            disabled={saving}
            onClick={() => onSave(`${snapshot.world.worldName} — ${snapshot.clock.dateLabel}`)}
          >
            {saving ? "Saving…" : "Save this world"}
          </Button>
          {loadNotice === null ? null : (
            <p
              role="status"
              className={`text-sm ${loadNotice.ok ? "text-muted-foreground" : "text-destructive"}`}
            >
              {loadNotice.message}
            </p>
          )}
          {slotsIssue === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              Saved worlds could not be listed: {slotsIssue}
            </p>
          )}
          {slots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved worlds in this store yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {slots.map((slot) => (
                <li key={slot.slotName} className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{slot.slotName}</span>
                    <Badge variant={slot.integrity === "verified" ? "secondary" : "destructive"}>
                      {slot.integrity === "verified" ? "Verified" : "Unreadable"}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">
                    {slot.worldName} · {slot.worldDateLabel} · saved {slot.savedAtLabel} · format v
                    {slot.formatVersion} · content {slot.contentVersion} · generation {slot.generation} ·{" "}
                    {Math.max(1, Math.round(slot.sizeBytes / 1024))} KB
                  </p>
                  {slot.issue === undefined ? null : (
                    <p className="text-xs text-destructive">{slot.issue}</p>
                  )}
                  {confirming === slot.slotName ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={loadingWorld}
                        onClick={() => {
                          setConfirming(null);
                          onLoadSlot(slot.slotName);
                        }}
                      >
                        {loadingWorld ? "Loading…" : "Load, replacing the running world"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={slot.integrity !== "verified" || loadingWorld}
                      title={slot.issue ?? "Loads this save and replaces the running world"}
                      onClick={() => setConfirming(slot.slotName)}
                    >
                      Load
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
