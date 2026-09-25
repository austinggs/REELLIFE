import { describe, expect, it } from "vitest";
import { ActivitiesEngine } from "../../src/engine/activities/engine.ts";
import { Calendar, DEFAULT_CALENDAR_CONFIG } from "../../src/engine/time/calendar.ts";
import { IdAllocator, asEntityId } from "../../src/engine/primitives/ids.ts";
import { atTime, days, durationOf, hours } from "../../src/engine/primitives/time.ts";
import { OwnershipGuard } from "../../src/engine/core/access.ts";

const calendar = new Calendar(DEFAULT_CALENDAR_CONFIG);
const person = asEntityId<"person">("PER-000001");

function makeEngine(): { engine: ActivitiesEngine; ids: IdAllocator } {
  // The guard is disabled here so this suite isolates scheduler behaviour; the
  // ownership suite covers the enforcement itself.
  const guard = new OwnershipGuard();
  guard.enforce = false;
  return { engine: new ActivitiesEngine(guard), ids: new IdAllocator() };
}

describe("activities, schedules and commitments (System 05)", () => {
  it("creates planned activities with an identity and a window", () => {
    const { engine, ids } = makeEngine();
    const activity = engine.create(
      { ids, calendar },
      { actor: person, kind: "workShift", start: atTime(540), duration: hours(8), createdBy: "system" },
    );
    expect(activity.id).toBe("ACT-000001");
    expect(activity.state).toBe("planned");
    expect(activity.scheduledEnd as number).toBe(540 + 480);
    expect(engine.currentActivity(person, atTime(600))?.id).toBe(activity.id);
    expect(engine.currentActivity(person, atTime(539))).toBeUndefined();
  });

  it("detects overlapping plans instead of silently double-booking", () => {
    const { engine, ids } = makeEngine();
    engine.create(
      { ids, calendar },
      { actor: person, kind: "workShift", start: atTime(540), duration: hours(8), createdBy: "system" },
    );
    const conflicts = engine.conflictsFor({
      actor: person,
      kind: "socialVisit",
      start: atTime(600),
      duration: hours(1),
      createdBy: "player",
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.overlapMinutes).toBe(60);
  });

  it("does not report conflicts for non-overlapping plans", () => {
    const { engine, ids } = makeEngine();
    engine.create(
      { ids, calendar },
      { actor: person, kind: "workShift", start: atTime(540), duration: hours(8), createdBy: "system" },
    );
    expect(
      engine.conflictsFor({
        actor: person,
        kind: "socialVisit",
        start: atTime(1_020),
        duration: hours(1),
        createdBy: "player",
      }),
    ).toHaveLength(0);
  });

  it("treats terminal states as absorbing", () => {
    const { engine, ids } = makeEngine();
    const activity = engine.create(
      { ids, calendar },
      { actor: person, kind: "workShift", start: atTime(540), duration: hours(8), createdBy: "system" },
    );
    engine.transition(activity.id, "started", atTime(540));
    engine.transition(activity.id, "completed", atTime(1_020));
    expect(() => engine.transition(activity.id, "inProgress", atTime(1_021))).toThrow(
      /already completed/,
    );
    // Re-applying the same terminal state is a harmless no-op.
    expect(engine.transition(activity.id, "completed", atTime(1_022)).state).toBe("completed");
  });

  it("expires planned windows that elapsed without execution", () => {
    const { engine, ids } = makeEngine();
    engine.create(
      { ids, calendar },
      { actor: person, kind: "workShift", start: atTime(540), duration: hours(8), createdBy: "system" },
    );
    const expired = engine.expireDue(atTime(1_100));
    expect(expired).toHaveLength(1);
    expect(expired[0]?.state).toBe("missed");
    expect(expired[0]?.interruptionReason).toMatch(/window elapsed/);
  });

  it("interrupts an in-progress activity and records when it stopped", () => {
    const { engine, ids } = makeEngine();
    const activity = engine.create(
      { ids, calendar },
      { actor: person, kind: "workShift", start: atTime(540), duration: hours(8), createdBy: "system" },
    );
    engine.transition(activity.id, "started", atTime(540));
    const interrupted = engine.interrupt(activity.id, atTime(600), "childcare emergency");
    expect(interrupted.state).toBe("interrupted");
    expect(interrupted.actualStart as number).toBe(540);
    expect(interrupted.interruptionReason).toBe("childcare emergency");
  });

  it("reports impossible transitions rather than guessing", () => {
    const { engine } = makeEngine();
    expect(() => engine.transition("ACT-999999" as never, "started", atTime(0))).toThrow(
      /Unknown activity/,
    );
  });

  it("tracks travel inside the activity, not outside it", () => {
    const { engine, ids } = makeEngine();
    const activity = engine.create(
      { ids, calendar },
      {
        actor: person,
        kind: "travel",
        start: atTime(1_000),
        duration: durationOf(90),
        travelMinutes: durationOf(30),
        createdBy: "player",
      },
    );
    expect(activity.travelMinutes as number).toBe(30);
    expect(activity.scheduledEnd as number).toBe(1_090);
  });

  it("closes open activities when they complete", () => {
    const { engine, ids } = makeEngine();
    const activity = engine.create(
      { ids, calendar },
      { actor: person, kind: "rest", start: atTime(0), duration: days(1), createdBy: "system" },
    );
    expect(engine.openForActor(person)).toHaveLength(1);
    engine.transition(activity.id, "completed", atTime(1_440));
    expect(engine.openForActor(person)).toHaveLength(0);
    expect(engine.currentActivity(person, atTime(1_441))).toBeUndefined();
  });
});
