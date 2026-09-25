import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVENT_LIMITS,
  EventEngine,
  EventStormError,
  type ConsequenceContext,
} from "../../src/engine/events/engine.ts";
import { causeOf } from "../../src/engine/events/engine.ts";
import type { EventDraft } from "../../src/engine/events/types.ts";
import { atTime } from "../../src/engine/primitives/time.ts";
import { Prng } from "../../src/engine/rng/prng.ts";

function makeHarness(now = atTime(0)): {
  engine: EventEngine;
  context: ConsequenceContext;
  emit: (draft: EventDraft) => ReturnType<EventEngine["emit"]>;
} {
  const engine = new EventEngine();
  const emit = (draft: EventDraft) => engine.emit(draft, now);
  const context: ConsequenceContext = {
    time: now,
    rng: { stream: (path: string) => Prng.fromPath("master-seed-0001", path) },
    emit,
    log: () => undefined,
  };
  return { engine, context, emit };
}

describe("event consequences, delays and guards (System 04)", () => {
  it("turns delayed effects into future scheduled events", () => {
    const { engine, emit } = makeHarness();
    const source = engine.emit(
      {
        type: "injury",
        cause: causeOf("environment", "accident"),
        delayedEffects: [
          { delayMinutes: 120, eventType: "medical.bill_due", description: "hospital invoice" },
        ],
      },
      atTime(100),
    );

    const scheduled = engine.scheduleDelayedEffects(source, emit);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.at as number).toBe(220);
    expect(scheduled[0]?.parentEventId).toBe(source.id);
    expect(scheduled[0]?.causalChainId).toBe(source.causalChainId);
    expect(scheduled[0]?.tags).toContain("delayed");
  });

  it("keeps delayed effects causally linked to their parent chain", () => {
    const { engine, emit } = makeHarness();
    const source = engine.emit({ type: "a", cause: causeOf("system", "t") }, atTime(0));
    const child = engine.scheduleOne(
      source,
      { delayMinutes: 10, eventType: "b", description: "child" },
      emit,
    );
    expect(engine.chainOf(source.causalChainId)).toContain(child.id);
    expect(engine.chainRootOf(source.causalChainId)).toBe(source.id);
  });

  it("suppresses duplicate consequences with a dedupe key", () => {
    const { engine } = makeHarness();
    const draft: EventDraft = {
      type: "rent.charge",
      cause: causeOf("system", "schedule"),
      dedupeKey: "rent:PER-000001:2042-01",
    };
    const first = engine.emit(draft, atTime(0));
    const second = engine.emit(draft, atTime(60));
    expect(second.id).toBe(first.id);
    expect(engine.pendingCount).toBe(1);
  });

  it("guards against an event storm in a runaway chain", () => {
    const engine = new EventEngine(undefined, { ...DEFAULT_EVENT_LIMITS, maxChainDepth: 3 });
    const emit = (draft: EventDraft) => engine.emit(draft, atTime(0));
    const root = engine.emit({ type: "loop", cause: causeOf("system", "t") }, atTime(0));
    let parent = root;
    for (let index = 0; index < 4; index += 1) {
      parent = emit({
        type: "loop",
        cause: causeOf("chain", "recursion"),
        parentEventId: parent.id,
      });
    }
    const context: ConsequenceContext = {
      time: atTime(0),
      rng: { stream: (path: string) => Prng.fromPath("master-seed-0001", path) },
      emit,
      log: () => undefined,
    };
    expect(() => engine.resolveDue(atTime(0), new Map(), context)).toThrow(EventStormError);
  });

  it("rejects an oversized delayed-effect declaration", () => {
    const engine = new EventEngine(undefined, {
      ...DEFAULT_EVENT_LIMITS,
      maxDelayedEffectsPerEvent: 1,
    });
    expect(() =>
      engine.emit(
        {
          type: "x",
          cause: causeOf("system", "t"),
          delayedEffects: [
            { delayMinutes: 1, eventType: "a", description: "a" },
            { delayMinutes: 2, eventType: "b", description: "b" },
          ],
        },
        atTime(0),
      ),
    ).toThrow(EventStormError);
  });

  it("leaves the remainder queued when the per-resolution limit is reached", () => {
    const engine = new EventEngine(undefined, {
      ...DEFAULT_EVENT_LIMITS,
      maxEventsPerResolution: 2,
    });
    for (let index = 0; index < 5; index += 1) {
      engine.emit({ type: `e${index}`, cause: causeOf("system", "t") }, atTime(1));
    }
    const context: ConsequenceContext = {
      time: atTime(1),
      rng: { stream: (path: string) => Prng.fromPath("master-seed-0001", path) },
      emit: (draft) => engine.emit(draft, atTime(1)),
      log: () => undefined,
    };
    const report = engine.resolveDue(atTime(1), new Map(), context);
    expect(report.resolved).toHaveLength(2);
    expect(report.limitReached).toBe(true);
    expect(engine.pendingCount).toBe(3);
  });

  it("preserves queue and sequence across save/load", () => {
    const { engine } = makeHarness();
    engine.emit({ type: "a", cause: causeOf("system", "t"), at: atTime(60) }, atTime(0));
    engine.emit({ type: "b", cause: causeOf("system", "t"), at: atTime(30) }, atTime(0));

    const restored = EventEngine.deserialize(engine.serialize());
    expect(restored.queueSnapshot().map((event) => event.type)).toEqual(["b", "a"]);

    const next = restored.emit({ type: "c", cause: causeOf("system", "t") }, atTime(0));
    expect(next.id).toBe("EVT-00000003");
  });

  it("keeps a bounded recent window for live feeds", () => {
    const { engine } = makeHarness();
    for (let index = 0; index < 5; index += 1) {
      engine.emit({ type: `e${index}`, cause: causeOf("system", "t") }, atTime(0));
    }
    expect(engine.recentEvents(2).map((event) => event.type)).toEqual(["e4", "e3"]);
  });

  it("gives each root event its own causal chain", () => {
    const { engine } = makeHarness();
    const a = engine.emit({ type: "a", cause: causeOf("system", "t") }, atTime(0));
    const b = engine.emit({ type: "b", cause: causeOf("system", "t") }, atTime(0));
    expect(a.causalChainId).not.toBe(b.causalChainId);
    expect(engine.knownChainIds()).toHaveLength(2);
  });
});
