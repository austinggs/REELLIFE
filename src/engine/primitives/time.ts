/**
 * ReelLife temporal primitives (System 02).
 *
 * Time answers WHEN. It never answers WHY or WHAT someone chooses.
 *
 * Internally the world uses one absolute integer timestamp measured in minutes
 * since the Aurelia epoch. Calendar fields, seasons, weekdays, holidays,
 * deadlines and durations are all derived from that single value, so there is
 * exactly one authoritative clock (architectural law 7).
 *
 * Integer minutes are used rather than floating-point seconds because:
 *  - authoritative state must be exactly serializable and comparable,
 *  - minute resolution is sufficient for activities, needs and schedules,
 *  - deterministic replay requires an orderable, non-lossy scalar.
 */

import type { Branded } from "./ids.ts";

/** Minutes since 1900-01-01T00:00 in world-local canonical time. */
export type WorldTime = Branded<number, "worldTime">;

/** A length of time in minutes. Distinct from an absolute timestamp. */
export type Duration = Branded<number, "duration">;

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
export const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

/** Reference year for the internal timestamp. */
export const AURELIA_EPOCH_YEAR = 1900;

export function atTime(minutesSinceEpoch: number): WorldTime {
  if (!Number.isFinite(minutesSinceEpoch)) {
    throw new RangeError(`WorldTime must be finite, received ${String(minutesSinceEpoch)}`);
  }
  return Math.trunc(minutesSinceEpoch) as WorldTime;
}

export function durationOf(minutes: number): Duration {
  if (!Number.isFinite(minutes)) {
    throw new RangeError(`Duration must be finite, received ${String(minutes)}`);
  }
  return Math.trunc(minutes) as Duration;
}

export const minutes = durationOf;
export const hours = (count: number): Duration => durationOf(count * MINUTES_PER_HOUR);
export const days = (count: number): Duration => durationOf(count * MINUTES_PER_DAY);
export const weeks = (count: number): Duration => durationOf(count * MINUTES_PER_WEEK);
/** Approximate year in minutes; exact calendar years are computed via the calendar. */
export const yearsApprox = (count: number): Duration => durationOf(Math.round(count * 365.2425 * MINUTES_PER_DAY));

export function addTime(time: WorldTime, delta: Duration): WorldTime {
  return atTime((time as number) + (delta as number));
}

export function subtractTime(time: WorldTime, delta: Duration): WorldTime {
  return atTime((time as number) - (delta as number));
}

/** Signed difference `a - b` as a Duration. */
export function timeBetween(a: WorldTime, b: WorldTime): Duration {
  return durationOf((a as number) - (b as number));
}

export function addDuration(a: Duration, b: Duration): Duration {
  return durationOf((a as number) + (b as number));
}

export function scaleDuration(value: Duration, factor: number): Duration {
  return durationOf((value as number) * factor);
}

export function maxTime(a: WorldTime, b: WorldTime): WorldTime {
  return (a as number) >= (b as number) ? a : b;
}

export function minTime(a: WorldTime, b: WorldTime): WorldTime {
  return (a as number) <= (b as number) ? a : b;
}

export function isBefore(a: WorldTime, b: WorldTime): boolean {
  return (a as number) < (b as number);
}

export function isAfter(a: WorldTime, b: WorldTime): boolean {
  return (a as number) > (b as number);
}

export function withinTime(time: WorldTime, from: WorldTime, to: WorldTime): boolean {
  const t = time as number;
  return t >= (from as number) && t <= (to as number);
}

export function durationToMinutes(value: Duration): number {
  return value as number;
}

export function timeToMinutes(value: WorldTime): number {
  return value as number;
}

/** Formats a duration for debugging/traces, not for player-facing text. */
export function describeDuration(value: Duration): string {
  const total = Math.abs(value as number);
  const sign = (value as number) < 0 ? "-" : "";
  const d = Math.floor(total / MINUTES_PER_DAY);
  const h = Math.floor((total % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  const m = total % MINUTES_PER_HOUR;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return sign + parts.join(" ");
}
