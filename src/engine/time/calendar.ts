/**
 * ReelLife calendar (System 02).
 *
 * The World Bible fixes the canonical start date (1 January 2042) but does not
 * define a distinct Aurelia calendar, and the specification only requires that
 * calendar/leap behaviour be *configured* rather than hard-coded. This module
 * therefore treats the calendar as content: month names, month lengths, weekday
 * names and the leap rule all come from a CalendarConfig.
 *
 * The default configuration is a 12-month solar calendar with a Gregorian leap
 * rule. It is flagged as provisional in docs/CONTENT_GAPS.md for owner review,
 * because inventing new canon month names would be unsupported by the source.
 *
 * Leap rule semantics:
 *   "gregorian" -> divisible by 4, except centuries, unless divisible by 400
 *   "every-4"   -> divisible by 4
 *   "none"      -> never
 */

import {
  AURELIA_EPOCH_YEAR,
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  atTime,
  type WorldTime,
} from "../primitives/time.ts";

export const LEAP_RULES = ["gregorian", "every-4", "none"] as const;
export type LeapRule = (typeof LEAP_RULES)[number];

export const DAY_PHASES = ["night", "dawn", "day", "dusk"] as const;
export type DayPhase = (typeof DAY_PHASES)[number];

export interface CalendarMonth {
  readonly name: string;
  readonly days: number;
}

export interface CalendarSeason {
  readonly name: string;
  /** Month index (0-based) in which the season begins. */
  readonly startMonthIndex: number;
  readonly startDay: number;
}

export interface CalendarConfig {
  readonly id: string;
  readonly name: string;
  readonly epochYear: number;
  readonly months: readonly CalendarMonth[];
  readonly weekdays: readonly string[];
  /** Weekday index (0-based) of the epoch date. */
  readonly epochWeekdayIndex: number;
  readonly leapRule: LeapRule;
  /** Index of the month whose length increases by one day in a leap year. */
  readonly leapMonthIndex: number;
  readonly seasons: readonly CalendarSeason[];
  readonly provisional: boolean;
}

export interface CalendarDate {
  readonly year: number;
  readonly monthIndex: number;
  readonly monthName: string;
  readonly day: number;
  readonly weekdayIndex: number;
  readonly weekdayName: string;
  readonly dayOfYear: number;
  readonly hour: number;
  readonly minute: number;
  readonly minuteOfDay: number;
  readonly season: string;
  readonly isLeapYear: boolean;
}

export function isLeapYear(year: number, rule: LeapRule): boolean {
  switch (rule) {
    case "none":
      return false;
    case "every-4":
      return year % 4 === 0;
    case "gregorian":
      return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    default:
      return false;
  }
}

export function daysInYear(year: number, config: CalendarConfig): number {
  const base = config.months.reduce((total, month) => total + month.days, 0);
  return isLeapYear(year, config.leapRule) ? base + 1 : base;
}

export function daysInMonth(year: number, monthIndex: number, config: CalendarConfig): number {
  const month = config.months[monthIndex];
  if (!month) throw new RangeError(`Invalid month index: ${monthIndex}`);
  if (isLeapYear(year, config.leapRule) && monthIndex === config.leapMonthIndex) {
    return month.days + 1;
  }
  return month.days;
}

/** Minutes from the epoch to the start of the given year. */
export function minutesAtYearStart(year: number, config: CalendarConfig): number {
  let total = 0;
  if (year >= config.epochYear) {
    for (let current = config.epochYear; current < year; current += 1) {
      total += daysInYear(current, config) * MINUTES_PER_DAY;
    }
  } else {
    for (let current = year; current < config.epochYear; current += 1) {
      total -= daysInYear(current, config) * MINUTES_PER_DAY;
    }
  }
  return total;
}

export function monthOfDayOfYear(
  year: number,
  dayOfYear: number,
  config: CalendarConfig,
): { monthIndex: number; day: number } {
  let remaining = dayOfYear;
  for (let monthIndex = 0; monthIndex < config.months.length; monthIndex += 1) {
    const length = daysInMonth(year, monthIndex, config);
    if (remaining < length) return { monthIndex, day: remaining + 1 };
    remaining -= length;
  }
  throw new RangeError(`Day of year ${dayOfYear} is outside year ${year}`);
}

export class Calendar {
  readonly config: CalendarConfig;

  constructor(config: CalendarConfig) {
    if (config.months.length === 0) throw new Error("Calendar requires at least one month");
    if (config.weekdays.length === 0) throw new Error("Calendar requires at least one weekday");
    this.config = config;
  }

  daysInYear(year: number): number {
    return daysInYear(year, this.config);
  }

  daysInMonth(year: number, monthIndex: number): number {
    return daysInMonth(year, monthIndex, this.config);
  }

  isLeapYear(year: number): boolean {
    return isLeapYear(year, this.config.leapRule);
  }

  /** Converts an absolute timestamp to calendar fields. */
  dateFromTime(time: WorldTime): CalendarDate {
    const totalMinutes = time as number;
    const totalDays = Math.floor(totalMinutes / MINUTES_PER_DAY);
    const minuteOfDay = totalMinutes - totalDays * MINUTES_PER_DAY;

    let year = this.config.epochYear;
    let remainingDays = totalDays;
    // Step years deterministically in both directions: historical dates must
    // stay representable once descendants continue a long playthrough.
    while (remainingDays >= this.daysInYear(year)) {
      remainingDays -= this.daysInYear(year);
      year += 1;
    }
    while (remainingDays < 0) {
      year -= 1;
      remainingDays += this.daysInYear(year);
    }

    const { monthIndex, day } = monthOfDayOfYear(year, remainingDays, this.config);
    const weekdayCount = this.config.weekdays.length;
    const weekdayIndex =
      (((totalDays + this.config.epochWeekdayIndex) % weekdayCount) + weekdayCount) % weekdayCount;

    return {
      year,
      monthIndex,
      monthName: this.config.months[monthIndex]?.name ?? `Month ${monthIndex + 1}`,
      day,
      weekdayIndex,
      weekdayName: this.config.weekdays[weekdayIndex] ?? `Day ${weekdayIndex + 1}`,
      dayOfYear: remainingDays,
      hour: Math.floor(minuteOfDay / MINUTES_PER_HOUR),
      minute: minuteOfDay % MINUTES_PER_HOUR,
      minuteOfDay,
      season: this.seasonFor(monthIndex, day),
      isLeapYear: this.isLeapYear(year),
    };
  }

  /** Inverse of dateFromTime for a calendar date plus optional time of day. */
  timeFromDate(year: number, monthIndex: number, day: number, hour = 0, minute = 0): WorldTime {
    if (monthIndex < 0 || monthIndex >= this.config.months.length) {
      throw new RangeError(`Invalid month index: ${monthIndex}`);
    }
    const maxDay = this.daysInMonth(year, monthIndex);
    if (day < 1 || day > maxDay) {
      throw new RangeError(`Invalid day ${day} for month ${monthIndex} in year ${year}`);
    }
    let total = minutesAtYearStart(year, this.config);
    for (let index = 0; index < monthIndex; index += 1) {
      total += this.daysInMonth(year, index) * MINUTES_PER_DAY;
    }
    total += (day - 1) * MINUTES_PER_DAY;
    total += hour * MINUTES_PER_HOUR + minute;
    return atTime(total);
  }

  /** Start of the calendar day containing `time`. */
  startOfDay(time: WorldTime): WorldTime {
    const date = this.dateFromTime(time);
    return this.timeFromDate(date.year, date.monthIndex, date.day);
  }

  seasonFor(monthIndex: number, day: number): string {
    const seasons = [...this.config.seasons].sort(
      (a, b) => a.startMonthIndex * 32 + a.startDay - (b.startMonthIndex * 32 + b.startDay),
    );
    let current = seasons[seasons.length - 1]?.name ?? "unknown";
    const ordinal = monthIndex * 32 + day;
    for (const season of seasons) {
      if (ordinal >= season.startMonthIndex * 32 + season.startDay) current = season.name;
    }
    return current;
  }

  /**
   * Coarse day/night phase. System 46 owns real environment modelling; this
   * approximation exists so activities and needs can reason about daylight
   * without owning environment truth.
   */
  dayPhase(time: WorldTime): DayPhase {
    const date = this.dateFromTime(time);
    const minutes = date.minuteOfDay;
    const factor = this.daylightFactor(date.dayOfYear);
    const sunrise = 6 * MINUTES_PER_HOUR - (factor - 1) * 90;
    const sunset = 18 * MINUTES_PER_HOUR + (factor - 1) * 90;
    if (minutes < sunrise - 60) return "night";
    if (minutes < sunrise + 30) return "dawn";
    if (minutes < sunset - 30) return "day";
    if (minutes < sunset + 60) return "dusk";
    return "night";
  }

  /** 1.0 at equinox, ~1.5 at mid-summer, ~0.5 at mid-winter. */
  daylightFactor(dayOfYear: number): number {
    const yearLength = daysInYear(this.config.epochYear, this.config);
    const phase = (2 * Math.PI * dayOfYear) / yearLength;
    return 1 + 0.5 * Math.sin(phase);
  }

  formatDateTime(time: WorldTime): string {
    const date = this.dateFromTime(time);
    const hh = String(date.hour).padStart(2, "0");
    const mm = String(date.minute).padStart(2, "0");
    return `${date.day} ${date.monthName} ${date.year}, ${hh}:${mm}`;
  }

  formatDate(time: WorldTime): string {
    const date = this.dateFromTime(time);
    return `${date.day} ${date.monthName} ${date.year}`;
  }
}

/**
 * Provisional calendar content (see docs/CONTENT_GAPS.md).
 *
 * The World Bible requires a coherent calendar but deliberately does not name
 * Aurelia's months. Rather than invent canon silently, this configuration uses
 * universally readable month names and is marked provisional so the owner can
 * replace it with authored canon content without touching engine code.
 */
export const DEFAULT_CALENDAR_CONFIG: CalendarConfig = {
  id: "CAL-AURELIA-DEFAULT",
  name: "Aurelian Common Calendar",
  epochYear: AURELIA_EPOCH_YEAR,
  months: [
    { name: "January", days: 31 },
    { name: "February", days: 28 },
    { name: "March", days: 31 },
    { name: "April", days: 30 },
    { name: "May", days: 31 },
    { name: "June", days: 30 },
    { name: "July", days: 31 },
    { name: "August", days: 31 },
    { name: "September", days: 30 },
    { name: "October", days: 31 },
    { name: "November", days: 30 },
    { name: "December", days: 31 },
  ],
  weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  epochWeekdayIndex: 0,
  leapRule: "gregorian",
  leapMonthIndex: 1,
  seasons: [
    { name: "winter", startMonthIndex: 11, startDay: 21 },
    { name: "spring", startMonthIndex: 2, startDay: 20 },
    { name: "summer", startMonthIndex: 5, startDay: 21 },
    { name: "autumn", startMonthIndex: 8, startDay: 22 },
  ],
  provisional: true,
};
