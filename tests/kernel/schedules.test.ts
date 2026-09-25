import { describe, expect, it } from "vitest";
import { ActivitiesEngine, matchesRecurrence } from "../../src/engine/activities/engine.ts";
import { Calendar, DEFAULT_CALENDAR_CONFIG } from "../../src/engine/time/calendar.ts";
import { IdAllocator, asEntityId } from "../../src/engine/primitives/ids.ts";
import { atTime, hours } from "../../src/engine/primitives/time.ts";
import { OwnershipGuard, permissiveScope } from "../../src/engine/core/access.ts";
import type { Schedule } from "../../src/engine/primitives/activity.ts";

const calendar = new Calendar(DEFAULT_CALENDAR_CONFIG);
const person = asEntityId<"person">("PER-000001");

function makeEngine(): { engine: ActivitiesEngine; ids: IdAllocator } {
  const guard = new OwnershipGuard();
  guard.enforce = false;
  return { engine: new ActivitiesEngine(guard), ids: new IdAllocator() };
}

function workSchedule(overrides?: Partial<Schedule>): Schedule {
  return {
    id: "SCH-work",
    owner: { kind: "person", id: person },
    kind: "workShift",
    label: "Day shift",
    startMinuteOfDay: 9 * 60,
    durationMinutes: 8 * 60,
    recurrence: { frequency: "weekly", daysOfWeek: [0, 1, 2, 3, 4] },
    requirementIds: [],
    commitment: true,
    activeFrom: atTime(0),
    ...overrides,
  };
}

describe("schedule recurrence and materialisation (System 05)", () => {
  it("matches daily, weekly, monthly and yearly recurrence", () => {
    expect(matchesRecurrence(workSchedule({ recurrence: { frequency: "daily" } }), 3, 10, 5)).toBe(
      true,
    );

    const weekly = workSchedule({ recurrence: { frequency: "weekly", daysOfWeek: [0, 4] } });
    expect(matchesRecurrence(weekly, 0, 10, 5)).toBe(true);
    expect(matchesRecurrence(weekly, 4, 10, 5)).toBe(true);
    expect(matchesRecurrence(weekly, 2, 10, 5)).toBe(false);

    const monthly = workSchedule({ recurrence: { frequency: "monthly", dayOfMonth: 1 } });
    expect(matchesRecurrence(monthly, 2, 1, 5)).toBe(true);
    expect(matchesRecurrence(monthly, 2, 2, 5)).toBe(false);

    const yearly = workSchedule({
      recurrence: { frequency: "yearly", monthIndex: 0, dayOfMonth: 1 },
    });
    expect(matchesRecurrence(yearly, 2, 1, 0)).toBe(true);
    expect(matchesRecurrence(yearly, 2, 1, 1)).toBe(false);
  });

  it("treats an empty weekly day set as every day", () => {
    expect(matchesRecurrence(workSchedule({ recurrence: { frequency: "weekly" } }), 6, 1, 0)).toBe(
      true,
    );
  });

  it("materialises schedule instances once per occurrence, not per call", () => {
    const { engine, ids } = makeEngine();
    engine.addSchedule(workSchedule());

    const from = calendar.timeFromDate(2042, 0, 5); // Monday
    const window = 7 * 24 * 60;
    const created = engine.materialiseSchedules({ ids, calendar }, from, atTime((from as number) + window));
    expect(created).toHaveLength(5);

    // A second materialisation of the same window must not duplicate instances.
    const again = engine.materialiseSchedules({ ids, calendar }, from, atTime((from as number) + window));
    expect(again).toHaveLength(0);
  });

  it("bounds schedule materialisation to a horizon", () => {
    const { engine, ids } = makeEngine();
    engine.addSchedule(workSchedule());
    const from = calendar.timeFromDate(2042, 0, 5);
    const created = engine.materialiseSchedules(
      { ids, calendar },
      from,
      atTime((from as number) + 365 * 24 * 60),
      7 * 24 * 60,
    );
    expect(created).toHaveLength(5);
    expect(engine.generatedUpTo as number).toBe((from as number) + 7 * 24 * 60);
  });

  it("skips schedules that are not yet active", () => {
    const { engine, ids } = makeEngine();
    engine.addSchedule(
      workSchedule({ activeFrom: calendar.timeFromDate(2050, 0, 1) as never }),
    );
    const from = calendar.timeFromDate(2042, 0, 5);
    const created = engine.materialiseSchedules(
      { ids, calendar },
      from,
      atTime((from as number) + 7 * 24 * 60),
    );
    expect(created).toHaveLength(0);
  });

  it("refuses duplicate schedule ids", () => {
    const { engine } = makeEngine();
    engine.addSchedule(workSchedule());
    expect(() => engine.addSchedule(workSchedule())).toThrow(/Duplicate schedule id/);
  });

  it("lists schedules per owner", () => {
    const { engine } = makeEngine();
    engine.addSchedule(workSchedule());
    engine.addSchedule(
      workSchedule({ id: "SCH-other", owner: { kind: "person", id: asEntityId<"person">("PER-000002") } }),
    );
    expect(engine.schedulesFor({ kind: "person", id: person })).toHaveLength(1);
  });

  it("restores activities and schedules from serialized state", () => {
    const first = makeEngine();
    first.engine.addSchedule(workSchedule());
    first.engine.create(
      { ids: first.ids, calendar },
      { actor: person, kind: "sleep", start: atTime(1_380), duration: hours(7), createdBy: "npc" },
    );

    const restored = ActivitiesEngine.deserialize(permissiveScope(), first.engine.serialize());
    expect(restored.all()).toHaveLength(1);
    expect(restored.all()[0]?.kind).toBe("sleep");
    expect(restored.allSchedules()).toHaveLength(1);
  });
});
