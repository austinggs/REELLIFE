import { describe, expect, it } from "vitest";
import {
  Calendar,
  DEFAULT_CALENDAR_CONFIG,
  daysInMonth,
  daysInYear,
  isLeapYear,
} from "../../src/engine/time/calendar.ts";
import { addTime, atTime, days } from "../../src/engine/primitives/time.ts";

const calendar = new Calendar(DEFAULT_CALENDAR_CONFIG);

describe("calendar (System 02)", () => {
  it("round-trips a date through the calendar", () => {
    const time = calendar.timeFromDate(2042, 0, 1, 9, 30);
    const date = calendar.dateFromTime(time);
    expect(date.year).toBe(2042);
    expect(date.monthIndex).toBe(0);
    expect(date.monthName).toBe("January");
    expect(date.day).toBe(1);
    expect(date.hour).toBe(9);
    expect(date.minute).toBe(30);
  });

  it("places the canonical game start at 1 January 2042", () => {
    const start = calendar.timeFromDate(2042, 0, 1);
    expect(calendar.formatDate(start)).toBe("1 January 2042");
    expect(calendar.dateFromTime(start).weekdayName).toBe("Wednesday");
  });

  it("applies the configured leap rule including century years", () => {
    expect(isLeapYear(2042, "gregorian")).toBe(false);
    expect(isLeapYear(2044, "gregorian")).toBe(true);
    expect(isLeapYear(1900, "gregorian")).toBe(false);
    expect(isLeapYear(2000, "gregorian")).toBe(true);
    expect(daysInYear(2044, DEFAULT_CALENDAR_CONFIG)).toBe(366);
    expect(daysInMonth(2044, 1, DEFAULT_CALENDAR_CONFIG)).toBe(29);
    expect(daysInMonth(2043, 1, DEFAULT_CALENDAR_CONFIG)).toBe(28);
  });

  it("keeps consecutive days one day apart across a month boundary", () => {
    const jan31 = calendar.timeFromDate(2042, 0, 31);
    const feb1 = calendar.timeFromDate(2042, 1, 1);
    expect((feb1 as number) - (jan31 as number)).toBe(1_440);
    expect(calendar.dateFromTime(addTime(jan31, days(1))).day).toBe(1);
  });

  it("rejects impossible calendar dates", () => {
    expect(() => calendar.timeFromDate(2042, 1, 30)).toThrow(/Invalid day 30/);
    expect(() => calendar.timeFromDate(2042, 12, 1)).toThrow(/Invalid month index/);
  });

  it("derives seasons and day phases deterministically", () => {
    const midwinter = calendar.timeFromDate(2042, 0, 10, 3, 0);
    expect(calendar.dateFromTime(midwinter).season).toBe("winter");
    expect(calendar.dayPhase(midwinter)).toBe("night");

    const midsummerNoon = calendar.timeFromDate(2042, 6, 10, 12, 0);
    expect(calendar.dateFromTime(midsummerNoon).season).toBe("summer");
    expect(calendar.dayPhase(midsummerNoon)).toBe("day");
  });

  it("supports historical dates before the canonical start", () => {
    const older = calendar.timeFromDate(1905, 5, 15);
    const date = calendar.dateFromTime(older);
    expect(date.year).toBe(1905);
    expect(date.monthName).toBe("June");
    expect(date.day).toBe(15);
  });

  it("finds the start of a day for schedule anchoring", () => {
    const time = calendar.timeFromDate(2042, 3, 4, 17, 45);
    const start = calendar.startOfDay(time);
    expect(calendar.dateFromTime(start).minuteOfDay).toBe(0);
    expect(calendar.formatDate(start)).toBe("4 April 2042");
  });

  it("keeps weekday progression consistent over a full year", () => {
    let cursor = calendar.timeFromDate(2042, 0, 1);
    let previousWeekday = calendar.dateFromTime(cursor).weekdayIndex;
    for (let dayIndex = 0; dayIndex < 200; dayIndex += 1) {
      cursor = addTime(cursor, days(1));
      const weekday = calendar.dateFromTime(cursor).weekdayIndex;
      expect(weekday).toBe((previousWeekday + 1) % 7);
      previousWeekday = weekday;
    }
  });

  it("marks the shipping calendar as provisional content", () => {
    // The World Bible fixes the start date but not the month names, so the
    // calendar is flagged for owner review rather than presented as canon.
    expect(DEFAULT_CALENDAR_CONFIG.provisional).toBe(true);
  });

  it("rejects a calendar with no months or weekdays", () => {
    expect(() => new Calendar({ ...DEFAULT_CALENDAR_CONFIG, months: [] })).toThrow(/at least one month/);
    expect(() => new Calendar({ ...DEFAULT_CALENDAR_CONFIG, weekdays: [] })).toThrow(/at least one weekday/);
  });

  it("formats date and time for presentation", () => {
    expect(calendar.formatDateTime(atTime(calendar.timeFromDate(2042, 2, 3, 7, 5)))).toBe(
      "3 March 2042, 07:05",
    );
  });
});
