/**
 * Kernel calendar heartbeat (System 02 annotation, diagnostic).
 *
 * This is deliberately NOT a world event generator. It emits a calendar
 * annotation when a local day begins, so that the Main Life Screen, the timeline
 * and the observability layer have a clock-driven signal to render. It makes no
 * claim about the world, invents no destiny and changes no domain state.
 *
 * Its real purpose in the kernel milestone is to prove the loop end to end:
 * clock -> system step -> event -> history -> projection.
 */

import type { SystemDefinition } from "../core/system.ts";
import type { WorldTime } from "../primitives/time.ts";

export interface CalendarHeartbeatState {
  readonly lastDayKey: number | null;
  readonly daysStarted: number;
}

export const HEARTBEAT_DAY_EVENT = "calendar.day_started";

/** Year * 400 + day of year: an unambiguous, human-readable calendar day key. */
function dayKey(year: number, dayOfYear: number): number {
  return year * 400 + dayOfYear;
}

export function createCalendarHeartbeatSystem(): SystemDefinition<CalendarHeartbeatState> {
  return {
    id: "time",
    title: "Calendar heartbeat (diagnostic)",

    createState: () => ({ lastDayKey: null, daysStarted: 0 }),

    /**
     * A day-start annotation is recorded whenever the calendar day changes. The
     * first observation of a day also records one, so a run that begins mid-day
     * still has a day boundary in its history rather than silently missing it.
     */
    onStep: (ctx) => {
      const date = ctx.calendar.dateFromTime(ctx.time as WorldTime);
      const key = dayKey(date.year, date.dayOfYear);
      if (ctx.state.lastDayKey === key) return;

      ctx.state = { lastDayKey: key, daysStarted: ctx.state.daysStarted + 1 };

      ctx.emit({
        type: HEARTBEAT_DAY_EVENT,
        cause: { kind: "system", description: "calendar day boundary observed" },
        visibleFacts: [`${date.weekdayName}, ${date.day} ${date.monthName} ${date.year}`],
        tags: ["system", "calendar"],
        // Importance 1: a calendar annotation is not a life or world occurrence.
        metadata: { importance: 1 },
      });
    },

    serialize: (state) => state,
    deserialize: (data) => {
      const record = (data ?? {}) as Partial<CalendarHeartbeatState>;
      return {
        lastDayKey: record.lastDayKey ?? null,
        daysStarted: record.daysStarted ?? 0,
      };
    },
  };
}
