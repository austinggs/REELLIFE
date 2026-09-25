import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_CATCHUP_QUANTA, WorldClock } from "../../src/engine/time/clock.ts";
import { addTime, atTime, days, hours, minutes, timeBetween } from "../../src/engine/primitives/time.ts";

describe("authoritative clock (System 02)", () => {
  it("starts paused and advances in whole quanta", () => {
    const clock = new WorldClock({ startTime: atTime(0) });
    expect(clock.isPaused).toBe(true);
    expect(clock.quantumMinutes).toBe(1);
    clock.advanceQuantum();
    expect(clock.time as number).toBe(1);
    expect(clock.stepIndex).toBe(1);
  });

  it("keeps time strictly monotonic", () => {
    const clock = new WorldClock({ startTime: atTime(1_000), paused: false });
    let previous = clock.time as number;
    for (let index = 0; index < 500; index += 1) {
      const next = clock.advanceQuantum() as number;
      expect(next).toBeGreaterThan(previous);
      previous = next;
    }
  });

  it("refuses to move authoritative time backwards", () => {
    const clock = new WorldClock({ startTime: atTime(500) });
    expect(() => clock.restoreTime(atTime(499))).toThrow(/monotonic/);
    clock.restoreTime(atTime(600));
    expect(clock.time as number).toBe(600);
  });

  it("changes cadence, not temporal truth, when speed changes", () => {
    const at1x = new WorldClock({ startTime: atTime(0) });
    const at1000x = new WorldClock({ startTime: atTime(0) });
    at1000x.setSpeed(1000);
    for (let index = 0; index < 10; index += 1) {
      at1x.advanceQuantum();
      at1000x.advanceQuantum();
    }
    expect(at1x.time).toBe(at1000x.time);
    expect(at1x.simulationSpeed).toBe(1);
    expect(at1000x.simulationSpeed).toBe(1000);
  });

  it("rejects an unsupported speed rather than approximating it", () => {
    const clock = new WorldClock({ startTime: atTime(0) });
    expect(() => clock.setSpeed(7 as never)).toThrow(/Unsupported simulation speed/);
  });

  it("freezes time while paused and resumes on request", () => {
    const clock = new WorldClock({ startTime: atTime(0), paused: false });
    clock.pause();
    expect(clock.isPaused).toBe(true);
    clock.resume();
    expect(clock.isPaused).toBe(false);
    clock.advanceQuantum();
    expect(clock.time as number).toBe(1);
  });

  it("serializes and restores the exact continuation point", () => {
    const clock = new WorldClock({ startTime: atTime(1_000), paused: false, speed: 10 });
    clock.advanceQuantum();
    clock.advanceQuantum();
    const restored = WorldClock.deserialize(clock.serialize());
    expect(restored.time).toBe(clock.time);
    expect(restored.stepIndex).toBe(clock.stepIndex);
    expect(restored.simulationSpeed).toBe(10);
    expect(restored.isPaused).toBe(false);
  });

  it("clips an oversized clock jump instead of pretending to catch up", () => {
    const clock = new WorldClock({ startTime: atTime(0) });
    const result = clock.advanceTo(atTime(DEFAULT_MAX_CATCHUP_QUANTA * 4), 100);
    expect(result.clipped).toBe(true);
    expect(result.steps).toBe(100);
    expect(clock.time as number).toBe(100);
  });

  it("treats a target in the past as a no-op rather than an error", () => {
    const clock = new WorldClock({ startTime: atTime(1_000) });
    const result = clock.advanceTo(atTime(500));
    expect(result.steps).toBe(0);
    expect(clock.time as number).toBe(1_000);
  });

  it("rejects an invalid quantum", () => {
    expect(() => new WorldClock({ startTime: atTime(0), quantumMinutes: 0 })).toThrow(/positive integer/);
    expect(() => new WorldClock({ startTime: atTime(0), quantumMinutes: 1.5 })).toThrow(/positive integer/);
  });

  it("stores durations without floating-point drift", () => {
    expect(hours(24) as number).toBe(minutes(1_440) as number);
    expect(days(1) as number).toBe(minutes(1_440) as number);
    expect(addTime(atTime(0), days(7)) as number).toBe(10_080);
    expect(timeBetween(atTime(50), atTime(20)) as number).toBe(30);
  });

  it("rejects non-finite timestamps and durations", () => {
    expect(() => atTime(Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => minutes(Number.NaN)).toThrow(/finite/);
  });
});
