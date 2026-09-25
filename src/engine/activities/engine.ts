/**
 * ReelLife activities engine (System 05).
 *
 * Schedule   = recurring or planned pattern
 * Activity   = time-occupying instance
 * Commitment = activity with consequences for failure
 *
 * The scheduler owns planned structure and availability. It deliberately does
 * NOT decide what a person does: the decision system resolves competing
 * activities. Schedules create structure and constraints; they do not script
 * behaviour.
 *
 * Recurring schedules materialise near-term instances rather than infinite
 * future objects, so a century of daily routines never becomes a century of
 * stored rows.
 *
 * Ownership: this engine holds the authoritative `activities` state, so every
 * mutating entry point asserts that the "activities" system is the active
 * writer (`scope.assertOwner`).
 */

import type { EntityId } from "../primitives/ids.ts";
import type { Activity, ActivityState, Schedule } from "../primitives/activity.ts";
import { activityIsTerminal } from "../primitives/activity.ts";
import type { Duration, WorldTime } from "../primitives/time.ts";
import {
  MINUTES_PER_DAY,
  addTime,
  atTime,
  durationOf,
  timeBetween,
} from "../primitives/time.ts";
import type { EntityRef } from "../primitives/entity.ts";
import type { Calendar } from "../time/calendar.ts";
import type { SystemScope } from "../core/access.ts";
import type { IdAllocator } from "../primitives/ids.ts";

export interface ActivitiesState {
  readonly activities: readonly Activity[];
  readonly schedules: readonly Schedule[];
  readonly generatedThrough: WorldTime | null;
}

export interface CreateActivityRequest {
  readonly actor: EntityId<"person">;
  readonly kind: Activity["kind"];
  readonly start: WorldTime;
  readonly duration: Duration;
  readonly participants?: readonly EntityId<"person">[];
  readonly locationId?: string;
  readonly travelMinutes?: Duration;
  readonly priority?: number;
  readonly createdBy: Activity["createdBy"];
  readonly commandId?: EntityId<"command">;
  readonly templateId?: string;
  readonly notes?: string;
}

export interface ActivityConflict {
  readonly existing: Activity;
  readonly proposed: CreateActivityRequest;
  readonly overlapMinutes: number;
}

export interface ActivitiesEngineHooks {
  readonly ids: IdAllocator;
  readonly calendar: Calendar;
}

export class ActivitiesEngine {
  private readonly scope: SystemScope;
  private readonly activities = new Map<EntityId<"activity">, Activity>();
  private readonly schedules = new Map<string, Schedule>();
  private generatedThrough: WorldTime | null;

  constructor(scope: SystemScope, state?: ActivitiesState) {
    this.scope = scope;
    for (const activity of state?.activities ?? []) this.activities.set(activity.id, activity);
    for (const schedule of state?.schedules ?? []) this.schedules.set(schedule.id, schedule);
    this.generatedThrough = state?.generatedThrough ?? null;
  }

  // ---------------------------------------------------------------- reads

  get(id: EntityId<"activity">): Activity | undefined {
    return this.activities.get(id);
  }

  all(): readonly Activity[] {
    return [...this.activities.values()];
  }

  forActor(actor: EntityId<"person">): readonly Activity[] {
    return this.all().filter((activity) => activity.actor === actor);
  }

  /** Activities that are still open (not completed, cancelled, missed...). */
  openForActor(actor: EntityId<"person">): Activity[] {
    return this.forActor(actor)
      .filter((activity) => !activityIsTerminal(activity))
      .sort((a, b) => (a.scheduledStart as number) - (b.scheduledStart as number));
  }

  /** The activity currently occupying the actor's time, if any. */
  currentActivity(actor: EntityId<"person">, now: WorldTime): Activity | undefined {
    return this.openForActor(actor).find(
      (activity) =>
        (activity.scheduledStart as number) <= (now as number) &&
        (activity.scheduledEnd as number) > (now as number),
    );
  }

  /**
   * Detects overlapping plans. Conflicts are reported, never silently resolved:
   * the decision system decides which plan wins (System 05/17 boundary).
   */
  conflictsFor(request: CreateActivityRequest): ActivityConflict[] {
    const proposedEnd = addTime(request.start, request.duration);
    const conflicts: ActivityConflict[] = [];
    for (const activity of this.openForActor(request.actor)) {
      if ((activity.scheduledEnd as number) <= (request.start as number)) continue;
      if ((activity.scheduledStart as number) >= (proposedEnd as number)) continue;
      const overlapStart = Math.max(activity.scheduledStart as number, request.start as number);
      const overlapEnd = Math.min(activity.scheduledEnd as number, proposedEnd as number);
      conflicts.push({
        existing: activity,
        proposed: request,
        overlapMinutes: Math.max(0, overlapEnd - overlapStart),
      });
    }
    return conflicts;
  }

  allSchedules(): readonly Schedule[] {
    return [...this.schedules.values()];
  }

  schedulesFor(owner: EntityRef): readonly Schedule[] {
    return this.allSchedules().filter(
      (schedule) => schedule.owner.kind === owner.kind && schedule.owner.id === owner.id,
    );
  }

  get generatedUpTo(): WorldTime | null {
    return this.generatedThrough;
  }

  // ------------------------------------------------------------- mutations
  // Every mutation below asserts ownership before touching state.

  /** Creates a planned activity instance. */
  create(hooks: ActivitiesEngineHooks, request: CreateActivityRequest): Activity {
    this.scope.assertOwner("activities");
    const end = addTime(request.start, request.duration);
    const activity: Activity = {
      id: hooks.ids.next("activity"),
      kind: request.kind,
      ...(request.templateId === undefined ? {} : { templateId: request.templateId }),
      actor: request.actor,
      participants: request.participants ?? [],
      state: "planned",
      scheduledStart: request.start,
      scheduledEnd: end,
      ...(request.locationId === undefined ? {} : { locationId: request.locationId }),
      requirements: [],
      travelMinutes: request.travelMinutes ?? durationOf(0),
      priority: request.priority ?? 0,
      createdBy: request.createdBy,
      ...(request.commandId === undefined ? {} : { commandId: request.commandId }),
      ...(request.notes === undefined ? {} : { notes: request.notes }),
    };
    this.activities.set(activity.id, activity);
    return activity;
  }

  /**
   * Applies a lifecycle transition. Terminal states are absorbing: an activity
   * cannot be "missed" and then "completed". That prevents ghost completions of
   * abandoned plans, which would otherwise let a commitment be satisfied after
   * its consequences had already fired.
   */
  transition(id: EntityId<"activity">, next: ActivityState, at: WorldTime, reason?: string): Activity {
    this.scope.assertOwner("activities");
    const existing = this.activities.get(id);
    if (!existing) throw new Error(`Unknown activity: ${id}`);

    const terminalNow = activityIsTerminal(existing);
    if (terminalNow) {
      if (existing.state === next) return existing;
      throw new Error(`Activity ${id} is already ${existing.state} and cannot become ${next}`);
    }

    const becomingTerminal = ["completed", "cancelled", "missed", "abandoned", "failed"].includes(
      next,
    );
    const updated: Activity = {
      ...existing,
      state: next,
      ...(next === "started" || next === "inProgress"
        ? { actualStart: existing.actualStart ?? at }
        : {}),
      ...(becomingTerminal ? { actualEnd: at } : {}),
      ...(reason === undefined ? {} : { interruptionReason: reason }),
    };
    this.activities.set(id, updated);
    return updated;
  }

  /** Marks open activities whose window elapsed without being started. */
  expireDue(now: WorldTime): Activity[] {
    this.scope.assertOwner("activities");
    const expired: Activity[] = [];
    for (const activity of this.activities.values()) {
      if (activityIsTerminal(activity)) continue;
      if (
        activity.state !== "planned" &&
        activity.state !== "scheduled" &&
        activity.state !== "ready"
      ) {
        continue;
      }
      if ((activity.scheduledEnd as number) > (now as number)) continue;

      const updated: Activity = {
        ...activity,
        state: "missed",
        actualEnd: atTime(activity.scheduledEnd as number),
        interruptionReason: "window elapsed without execution",
      };
      this.activities.set(activity.id, updated);
      expired.push(updated);
    }
    return expired;
  }

  /** Interrupts an in-progress activity, preserving when it stopped. */
  interrupt(id: EntityId<"activity">, at: WorldTime, reason: string): Activity {
    return this.transition(id, "interrupted", at, reason);
  }

  addSchedule(schedule: Schedule): void {
    this.scope.assertOwner("activities");
    if (this.schedules.has(schedule.id)) {
      throw new Error(`Duplicate schedule id: ${schedule.id}`);
    }
    this.schedules.set(schedule.id, schedule);
  }

  /**
   * Materialises schedule instances for the window [from, to), bounded by an
   * explicit horizon so a recurring pattern can never generate unbounded state.
   */
  materialiseSchedules(
    hooks: ActivitiesEngineHooks,
    from: WorldTime,
    to: WorldTime,
    horizonMinutes = 14 * MINUTES_PER_DAY,
  ): Activity[] {
    this.scope.assertOwner("activities");
    const created: Activity[] = [];
    const boundedTo = Math.min(to as number, (from as number) + horizonMinutes);

    for (const schedule of this.allSchedules()) {
      if ((schedule.activeFrom as number) > boundedTo) continue;
      if (schedule.activeUntil !== undefined && (schedule.activeUntil as number) < (from as number)) {
        continue;
      }
      const firstDayCandidate = Math.max(from as number, schedule.activeFrom as number);
      let cursorDay = hooks.calendar.startOfDay(atTime(firstDayCandidate));

      // The 400-day guard bounds the loop even if a caller passes a huge span.
      for (let guard = 0; guard < 400; guard += 1) {
        const date = hooks.calendar.dateFromTime(cursorDay);
        if (matchesRecurrence(schedule, date.weekdayIndex, date.day, date.monthIndex)) {
          const start = atTime((cursorDay as number) + schedule.startMinuteOfDay);
          const end = addTime(start, durationOf(schedule.durationMinutes));
          const withinWindow = (end as number) > (from as number) && (start as number) < boundedTo;
          if (withinWindow && !this.hasInstanceFor(schedule.id, start)) {
            created.push(
              this.create(hooks, {
                actor: schedule.owner.id as EntityId<"person">,
                kind: schedule.kind,
                start,
                duration: durationOf(schedule.durationMinutes),
                ...(schedule.locationId === undefined ? {} : { locationId: schedule.locationId }),
                createdBy: "system",
                templateId: schedule.id,
              }),
            );
          }
        }
        cursorDay = atTime((cursorDay as number) + MINUTES_PER_DAY);
        if ((cursorDay as number) >= boundedTo) break;
      }
    }

    const previous = this.generatedThrough === null ? 0 : (this.generatedThrough as number);
    this.generatedThrough = atTime(Math.max(boundedTo, previous));
    return created;
  }

  private hasInstanceFor(scheduleId: string, start: WorldTime): boolean {
    for (const activity of this.activities.values()) {
      if (activity.templateId !== scheduleId) continue;
      if ((activity.scheduledStart as number) === (start as number)) return true;
    }
    return false;
  }

  serialize(): ActivitiesState {
    return {
      activities: [...this.activities.values()],
      schedules: [...this.schedules.values()],
      generatedThrough: this.generatedThrough,
    };
  }

  static deserialize(scope: SystemScope, state: ActivitiesState): ActivitiesEngine {
    return new ActivitiesEngine(scope, state);
  }
}

/** Recurrence matching is pure so it can be tested without a scheduler. */
export function matchesRecurrence(
  schedule: Schedule,
  weekdayIndex: number,
  dayOfMonth: number,
  monthIndex: number,
): boolean {
  const { recurrence } = schedule;
  switch (recurrence.frequency) {
    case "daily":
      return true;
    case "weekly":
      return recurrence.daysOfWeek === undefined || recurrence.daysOfWeek.length === 0
        ? true
        : recurrence.daysOfWeek.includes(weekdayIndex);
    case "monthly":
      return recurrence.dayOfMonth === undefined || recurrence.dayOfMonth === dayOfMonth;
    case "yearly":
      return (
        (recurrence.monthIndex === undefined || recurrence.monthIndex === monthIndex) &&
        (recurrence.dayOfMonth === undefined || recurrence.dayOfMonth === dayOfMonth)
      );
    default:
      return false;
  }
}

/** Elapsed duration between two timestamps, clamped at zero. */
export function elapsedBetween(start: WorldTime, end: WorldTime): Duration {
  return durationOf(Math.max(0, timeBetween(end, start) as number));
}


