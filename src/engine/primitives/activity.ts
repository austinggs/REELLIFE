/**
 * ReelLife activity, schedule and commitment primitives (System 05).
 *
 * Schedule  = recurring or planned pattern.
 * Activity  = a specific time-occupying instance.
 * Commitment = an activity with consequences for failure.
 *
 * Boundary rule (System 02/05/17):
 *   Time     = WHEN
 *   Schedule = WHAT IS EXPECTED
 *   Decision = WHAT ACTUALLY HAPPENS
 *
 * Planned behaviour is not guaranteed behaviour, so an activity carries its own
 * lifecycle and can be missed, interrupted or abandoned.
 */

import type { EntityId, EntityKind } from "./ids.ts";
import type { EntityRef } from "./entity.ts";
import type { Duration, WorldTime } from "./time.ts";

export const ACTIVITY_STATES = [
  "planned",
  "scheduled",
  "ready",
  "started",
  "inProgress",
  "completed",
  "cancelled",
  "missed",
  "interrupted",
  "abandoned",
  "waiting",
  "delayed",
  "rescheduled",
  "failed",
] as const;
export type ActivityState = (typeof ACTIVITY_STATES)[number];

/** Terminal states an activity cannot leave. */
export const TERMINAL_ACTIVITY_STATES: readonly ActivityState[] = [
  "completed",
  "cancelled",
  "missed",
  "abandoned",
  "failed",
];

export const ACTIVITY_KINDS = [
  "sleep",
  "rest",
  "eat",
  "drink",
  "hygiene",
  "workShift",
  "commute",
  "travel",
  "study",
  "school",
  "appointment",
  "socialVisit",
  "leisure",
  "recreation",
  "exercise",
  "household",
  "childcare",
  "errand",
  "shopping",
  "waiting",
  "custom",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface ActivityRequirement {
  readonly kind: "location" | "person" | "item" | "money" | "authority" | "preparation" | "vehicle";
  readonly ref?: EntityRef<EntityKind>;
  readonly description: string;
}

export interface Activity {
  readonly id: EntityId<"activity">;
  readonly kind: ActivityKind;
  readonly templateId?: string;
  readonly actor: EntityId<"person">;
  readonly participants: readonly EntityId<"person">[];
  readonly state: ActivityState;
  readonly scheduledStart: WorldTime;
  readonly scheduledEnd: WorldTime;
  readonly actualStart?: WorldTime;
  readonly actualEnd?: WorldTime;
  readonly locationId?: string;
  readonly requirements: readonly ActivityRequirement[];
  readonly commitmentId?: EntityId<"activity">;
  /** Travel is explicit inside activities rather than implicit. */
  readonly travelMinutes: Duration;
  readonly priority: number;
  readonly createdBy: "player" | "npc" | "system" | "console" | "institution";
  readonly commandId?: EntityId<"command">;
  readonly interruptionReason?: string;
  readonly notes?: string;
}

export function activityIsTerminal(activity: Activity): boolean {
  return TERMINAL_ACTIVITY_STATES.includes(activity.state);
}

export function activityOverlaps(a: Activity, b: Activity): boolean {
  if (a.actor !== b.actor) return false;
  if (activityIsTerminal(a) || activityIsTerminal(b)) return false;
  return (a.scheduledStart as number) < (b.scheduledEnd as number) && (b.scheduledStart as number) < (a.scheduledEnd as number);
}

export const RECURRENCE_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/**
 * Recurring patterns generate near-term instances rather than infinite future
 * objects (System 05).
 */
export interface ScheduleRecurrence {
  readonly frequency: RecurrenceFrequency;
  /** Days of week (0-6) for weekly recurrence; empty means every day/period. */
  readonly daysOfWeek?: readonly number[];
  /** Day of month (1-31) for monthly/yearly recurrence. */
  readonly dayOfMonth?: number;
  readonly monthIndex?: number;
  readonly intervalCount?: number;
}

export interface Schedule {
  readonly id: string;
  readonly owner: EntityRef<EntityKind>;
  readonly kind: ActivityKind;
  readonly label: string;
  /** Minutes after local midnight. */
  readonly startMinuteOfDay: number;
  readonly durationMinutes: number;
  readonly recurrence: ScheduleRecurrence;
  readonly locationId?: string;
  readonly requirementIds: readonly string[];
  readonly commitment: boolean;
  readonly activeFrom: WorldTime;
  readonly activeUntil?: WorldTime;
}

export interface Commitment {
  readonly id: EntityId<"activity">;
  readonly actor: EntityId<"person">;
  readonly description: string;
  readonly counterparty?: EntityRef<EntityKind>;
  readonly severity: number;
  readonly consequenceOnFailure: string;
  readonly scheduleId?: string;
}
