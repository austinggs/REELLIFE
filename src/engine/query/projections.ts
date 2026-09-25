/**
 * ReelLife presentation-facing queries (UI/UX 02 section 5, UI/UX 24 section 3).
 *
 * The UI does not define which system owns a fact. It requests data through
 * presentation-facing queries and renders the returned state. Every projection
 * here is:
 *   - read-only (it cannot mutate authoritative state),
 *   - knowledge filtered (hidden state is not exposed merely because the engine
 *     holds it in memory),
 *   - derived (nothing here is persisted as simulation truth).
 */

import type { EntityId } from "../primitives/ids.ts";
import type { Visibility } from "../primitives/information.ts";
import type { WorldTime } from "../primitives/time.ts";
import { SIMULATION_SPEEDS, type SimulationSpeed } from "../time/clock.ts";
import type { DayPhase } from "../time/calendar.ts";
import type { TimelineEntry } from "../history/types.ts";
import type { Simulation } from "../core/simulation.ts";

export interface ClockView {
  readonly time: WorldTime;
  readonly timeMinutes: number;
  readonly dateLabel: string;
  readonly dateTimeLabel: string;
  readonly year: number;
  readonly monthName: string;
  readonly dayOfMonth: number;
  readonly weekdayName: string;
  readonly hour: number;
  readonly minute: number;
  readonly season: string;
  readonly dayPhase: DayPhase;
  readonly speed: SimulationSpeed;
  readonly speeds: readonly SimulationSpeed[];
  readonly paused: boolean;
  readonly stepIndex: number;
}

export interface WorldSummaryView {
  readonly worldId: string;
  readonly worldName: string;
  readonly generation: number;
  readonly mode: string;
  readonly difficulty: string;
  readonly masterSeed: string;
  readonly contentVersion: string;
  readonly simulationVersion: number;
  readonly schemaVersion: number;
  readonly startDateLabel: string;
  readonly uptimeDays: number;
  readonly registeredSystems: number;
  readonly provisionalContent: readonly string[];
}

export interface EventFeedItem {
  readonly eventId: string;
  readonly type: string;
  readonly at: WorldTime;
  readonly timeLabel: string;
  readonly summary: string;
  readonly actorKind: string;
  readonly importance: number;
  readonly causalChainId: string;
  /** How the viewer relates to this occurrence. */
  readonly knowledge: Visibility;
  readonly tags: readonly string[];
}

export interface TimelineViewItem {
  readonly id: string;
  readonly at: WorldTime;
  readonly timeLabel: string;
  readonly kind: string;
  readonly summary: string;
  readonly importance: number;
  readonly knowledge: Visibility;
  readonly causalChainId?: string;
}

export interface SimulationHealthView {
  readonly steps: number;
  readonly pendingEvents: number;
  readonly commandCount: number;
  readonly timelineEntries: number;
  readonly compressedTimelineEntries: number;
  readonly unhandledConsequenceTypes: readonly string[];
  readonly invariantFailures: number;
  readonly ownershipViolations: readonly string[];
  readonly metricCounters: Readonly<Record<string, number>>;
  readonly metricGauges: Readonly<Record<string, number>>;
}

/** Which visibility labels a viewer is entitled to see. */
function visibleTo(viewer: EntityId<"person"> | null, visibility: Visibility): boolean {
  if (visibility === "public") return true;
  if (visibility === "unknown") return false;
  if (visibility === "restricted") return viewer !== null;
  return false; // private and secret require an explicit access path
}

export function getClockView(sim: Simulation): ClockView {
  const date = sim.calendar.dateFromTime(sim.clock.time);
  return {
    time: sim.clock.time,
    timeMinutes: sim.clock.time as number,
    dateLabel: sim.calendar.formatDate(sim.clock.time),
    dateTimeLabel: sim.calendar.formatDateTime(sim.clock.time),
    year: date.year,
    monthName: date.monthName,
    dayOfMonth: date.day,
    weekdayName: date.weekdayName,
    hour: date.hour,
    minute: date.minute,
    season: date.season,
    dayPhase: sim.calendar.dayPhase(sim.clock.time),
    speed: sim.clock.simulationSpeed,
    speeds: SIMULATION_SPEEDS,
    paused: sim.clock.isPaused,
    stepIndex: sim.clock.stepIndex,
  };
}

export function getWorldSummaryView(sim: Simulation): WorldSummaryView {
  const meta = sim.world.meta;
  const elapsedMinutes = (sim.clock.time as number) - (meta.startTime as number);
  return {
    worldId: meta.worldId,
    worldName: meta.worldName,
    generation: meta.generation,
    mode: meta.mode,
    difficulty: meta.difficulty,
    masterSeed: meta.masterSeed,
    contentVersion: meta.contentVersion,
    simulationVersion: meta.simulationVersion,
    schemaVersion: meta.schemaVersion,
    startDateLabel: sim.calendar.formatDate(meta.startTime),
    uptimeDays: Math.floor(elapsedMinutes / (24 * 60)),
    registeredSystems: sim.registeredSystems().length,
    provisionalContent: sim.config.contentModules
      .filter((module) => module.provisional)
      .map((module) => module.id),
  };
}

/**
 * Recent occurrences as a relevance-filtered feed.
 *
 * The feed reads persisted history rather than the live event queue: history is
 * the curated, knowledge-filtered record that survives a save, and UI/UX 08
 * section 7 requires a notification to link to its underlying history entry.
 * Low-importance noise is filtered out, which is the Main Life Screen's priority
 * requirement (UI/UX 04 sections 5 and 6).
 */
export function getEventFeedView(
  sim: Simulation,
  viewer: EntityId<"person"> | null,
  options?: {
    readonly limit?: number;
    readonly minimumImportance?: number;
    readonly since?: WorldTime;
  },
): readonly EventFeedItem[] {
  const limit = options?.limit ?? 25;
  const minimumImportance = options?.minimumImportance ?? 1;
  const since = options?.since;

  const items: EventFeedItem[] = [];

  for (const entry of sim.history.recent(limit * 4)) {
    if (!visibleTo(viewer, entry.visibility)) continue;
    if (since !== undefined && (entry.at as number) < (since as number)) continue;
    if (entry.importance < minimumImportance) continue;
    items.push({
      eventId: entry.eventId ?? entry.id,
      type: entry.eventType ?? entry.kind,
      at: entry.at,
      timeLabel: sim.calendar.formatDateTime(entry.at),
      summary: entry.summary,
      actorKind: entry.causeKind ?? "system",
      importance: entry.importance,
      causalChainId: entry.causalChainId ?? "CHN-000000",
      knowledge: entry.visibility,
      tags: entry.tags,
    });
    if (items.length >= limit) break;
  }
  return items;
}

export function getTimelineView(
  sim: Simulation,
  viewer: EntityId<"person"> | null,
  options?: { readonly limit?: number; readonly minimumImportance?: number },
): readonly TimelineViewItem[] {
  const limit = options?.limit ?? 50;
  const minimumImportance = options?.minimumImportance ?? 1;
  const items: TimelineViewItem[] = [];

  for (const entry of sim.history.recent(limit * 4)) {
    if (!visibleTo(viewer, entry.visibility)) continue;
    if (entry.importance < minimumImportance) continue;
    items.push({
      id: entry.id,
      at: entry.at,
      timeLabel: sim.calendar.formatDateTime(entry.at),
      kind: entry.kind,
      summary: entry.summary,
      importance: entry.importance,
      knowledge: entry.visibility,
      ...(entry.causalChainId === undefined ? {} : { causalChainId: entry.causalChainId }),
    });
    if (items.length >= limit) break;
  }
  return items;
}

/** Raw knowledge-filtered timeline records, for drill-down surfaces. */
export function getKnowledgeFilteredTimeline(
  sim: Simulation,
  viewer: EntityId<"person"> | null,
  options?: { readonly limit?: number },
): readonly TimelineEntry[] {
  const limit = options?.limit ?? 100;
  return sim.history
    .recent(limit * 4)
    .filter((entry) => visibleTo(viewer, entry.visibility) || entry.knownBy.length > 0)
    .slice(0, limit);
}

/** Diagnostics for the Advanced/Debug UI (UI/UX 22) and the headless harness. */
export function getSimulationHealthView(sim: Simulation): SimulationHealthView {
  const snapshot = sim.metrics.snapshot();
  return {
    steps: snapshot.counters["steps"] ?? 0,
    pendingEvents: sim.events.pendingCount,
    commandCount: sim.commandLog.size,
    timelineEntries: sim.history.size(),
    compressedTimelineEntries: sim.history.compressedCount(),
    unhandledConsequenceTypes: [...sim.dispatcher.unhandledConsequenceTypes].sort(),
    invariantFailures: snapshot.counters["invariants.failures"] ?? 0,
    ownershipViolations: sim.guard.recordedViolations.map((violation) => violation.message),
    metricCounters: snapshot.counters,
    metricGauges: snapshot.gauges,
  };
}
