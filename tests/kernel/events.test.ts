import { describe, expect, it } from "vitest";
import {
  EventEngine,
  type ConsequenceContext,
  type EventHandler,
} from "../../src/engine/events/engine.ts";
import { causeOf } from "../../src/engine/events/engine.ts";
import type { ConsequenceDescriptor } from "../../src/engine/events/types.ts";
import { atTime } from "../../src/engine/primitives/time.ts";
import { Prng } from "../../src/engine/rng/prng.ts";

/** Minimal harness: engine + consequence context wired to the same clock. */
function makeHarness(now = atTime(0)): {
  engine: EventEngine;
  context: ConsequenceContext;
  logged: string[];
} {
  const engine = new EventEngine();
  const logged: string[] = [];
  const context: ConsequenceContext = {
    time: now,
    rng: { stream: (path: string) => Prng.fromPath("master-seed-0001", path) },
    emit: (draft) => engine.emit(draft, now),
    log: (message) => {
      logged.push(message);
    },
  };
  return { engine, context, logged };
}

function consequence(type: string): ConsequenceDescriptor {
  return { type, owner: "events", payload: {} };
}

describe("event engine ordering and resolution (System 04)", () => {
  it("assigns identity, timestamp and a monotonic sequence", () => {
    const { engine } = makeHarness(atTime(10));
    const first = engine.emit({ type: "a", cause: causeOf("system", "test") }, atTime(10));
    const second = engine.emit({ type: "b", cause: causeOf("system", "test") }, atTime(10));
    expect(first.id).toBe("EVT-00000001");
    expect(second.id).toBe("EVT-00000002");
    expect(first.sequence).toBeLessThan(second.sequence);
    expect(first.at as number).toBe(10);
  });

  it("orders the queue by time, then priority, then sequence", () => {
    const { engine } = makeHarness();
    engine.emit({ type: "late", cause: causeOf("system", "t"), at: atTime(30) }, atTime(0));
    engine.emit({ type: "early-low", cause: causeOf("system", "t"), at: atTime(10) }, atTime(0));
    engine.emit({ type: "early-high", cause: causeOf("system", "t"), at: atTime(10), priority: 5 }, atTime(0));

    expect(engine.queueSnapshot().map((event) => event.type)).toEqual([
      "early-high",
      "early-low",
      "late",
    ]);
  });

  it("resolves only events that are due, in deterministic order", () => {
    const { engine, context } = makeHarness(atTime(10));
    engine.emit({ type: "due", cause: causeOf("system", "t"), at: atTime(5) }, atTime(0));
    engine.emit({ type: "future", cause: causeOf("system", "t"), at: atTime(50) }, atTime(0));

    const report = engine.resolveDue(atTime(10), new Map(), context);

    expect(report.resolved.map((event) => event.type)).toEqual(["due"]);
    expect(engine.queueSnapshot().map((event) => event.type)).toEqual(["future"]);
  });

  it("collects consequences from registered handlers", () => {
    const { engine, context } = makeHarness();
    const handlers = new Map<string, EventHandler>([
      [
        "rent.due",
        {
          eventType: "rent.due",
          systemId: "housing",
          handle: () => [consequence("housing.charge_rent")],
        },
      ],
    ]);
    engine.emit({ type: "rent.due", cause: causeOf("system", "schedule") }, atTime(0));
    const report = engine.resolveDue(atTime(0), handlers, context);
    expect(report.consequences).toHaveLength(1);
    expect(report.consequences[0]?.type).toBe("housing.charge_rent");
  });

  it("cancels a stale event whose precondition no longer holds", () => {
    const { engine, context } = makeHarness(atTime(1));
    const handlers = new Map<string, EventHandler>([
      [
        "shift.start",
        {
          eventType: "shift.start",
          systemId: "employment",
          precondition: () => false,
          handle: () => [consequence("employment.attend_shift")],
        },
      ],
    ]);
    engine.emit({ type: "shift.start", cause: causeOf("system", "schedule") }, atTime(0));
    const report = engine.resolveDue(atTime(1), handlers, context);
    expect(report.resolved).toHaveLength(0);
    expect(report.consequences).toHaveLength(0);
  });

  it("reports an event with no handler instead of failing", () => {
    const { engine, context, logged } = makeHarness();
    engine.emit({ type: "mystery", cause: causeOf("system", "t") }, atTime(0));
    const report = engine.resolveDue(atTime(0), new Map(), context);
    expect(report.resolved).toHaveLength(1);
    expect(logged.some((line) => line.includes("No handler registered"))).toBe(true);
  });

  it("rejects negative event timestamps", () => {
    const { engine } = makeHarness();
    expect(() =>
      engine.emit({ type: "x", cause: causeOf("system", "t"), at: atTime(-5) }, atTime(0)),
    ).toThrow(/cannot be negative/);
  });
});
