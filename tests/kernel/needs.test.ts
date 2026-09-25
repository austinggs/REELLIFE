import { describe, expect, it } from "vitest";
import { NeedsEngine } from "../../src/engine/needs/engine.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { atTime, MINUTES_PER_HOUR } from "../../src/engine/primitives/time.ts";
import { permissiveScope } from "../../src/engine/core/access.ts";
import { createWorldState } from "../../src/engine/core/worldState.ts";

function makeWorld() {
  return createWorldState({
    worldId: "test",
    worldName: "test",
    createdAtLabel: "t",
    startTime: atTime(0),
    masterSeed: "test",
    mode: "standard",
    difficulty: "standard",
    schemaVersion: 1,
    simulationVersion: 1,
    contentVersion: "1",
    rngVersion: 1,
    config: {} as never,
    idAllocator: { counters: {} },
  });
}

describe("needs & daily living (System 10)", () => {
  it("registers a person with all core needs initialized at 0.8", () => {
    const engine = new NeedsEngine(permissiveScope(), makeWorld());
    const ids = new IdAllocator();
    const personId = ids.next("person");

    const pns = engine.registerPerson(personId, atTime(0));
    expect(pns.needs.length).toBeGreaterThan(0);
    expect(pns.needs.every((n) => n.level === 0.8)).toBe(true);
    expect(pns.needs.every((n) => n.urgency === "satisfied")).toBe(true);
  });

  it("depletes hunger over time", () => {
    const engine = new NeedsEngine(permissiveScope(), makeWorld());
    const ids = new IdAllocator();
    const personId = ids.next("person");
    engine.registerPerson(personId, atTime(0));

    // Tick 10 hours
    engine.tick(personId, MINUTES_PER_HOUR * 10, atTime(MINUTES_PER_HOUR * 10));

    const hunger = engine.getNeed(personId, "hunger");
    expect(hunger!.level).toBeLessThan(0.8);
    expect(hunger!.level).toBeGreaterThan(0);
  });

  it("satisfying a need increases its level", () => {
    const engine = new NeedsEngine(permissiveScope(), makeWorld());
    const ids = new IdAllocator();
    const personId = ids.next("person");
    engine.registerPerson(personId, atTime(0));

    // Deplete hunger heavily first
    engine.tick(personId, MINUTES_PER_HOUR * 16, atTime(MINUTES_PER_HOUR * 16));
    const before = engine.getNeed(personId, "hunger")!.level;

    engine.satisfy(personId, "hunger", 0.4, atTime(MINUTES_PER_HOUR * 16));
    const after = engine.getNeed(personId, "hunger")!.level;

    expect(after).toBeGreaterThan(before);
    expect(after).toBeGreaterThanOrEqual(before + 0.39);
  });

  it("urgency becomes critical at near-zero level", () => {
    const engine = new NeedsEngine(permissiveScope(), makeWorld());
    const ids = new IdAllocator();
    const personId = ids.next("person");
    engine.registerPerson(personId, atTime(0));

    // Thirst depletes fastest — 80 hours should fully drain
    engine.tick(personId, MINUTES_PER_HOUR * 80, atTime(MINUTES_PER_HOUR * 80));
    const thirst = engine.getNeed(personId, "thirst");
    expect(thirst!.level).toBe(0);
    expect(thirst!.urgency).toBe("critical");
  });

  it("suppressed needs do not deplete", () => {
    const engine = new NeedsEngine(permissiveScope(), makeWorld());
    const ids = new IdAllocator();
    const personId = ids.next("person");
    engine.registerPerson(personId, atTime(0));

    engine.setSuppressed(personId, "hunger", true);
    engine.tick(personId, MINUTES_PER_HOUR * 20, atTime(MINUTES_PER_HOUR * 20));

    const hunger = engine.getNeed(personId, "hunger")!;
    expect(hunger.level).toBe(0.8); // unchanged
    expect(hunger.suppressed).toBe(true);
  });

  it("modifiers can accelerate recovery", () => {
    const engine = new NeedsEngine(permissiveScope(), makeWorld());
    const ids = new IdAllocator();
    const personId = ids.next("person");
    engine.registerPerson(personId, atTime(0));

    // Drip IV adds +0.3 hunger per hour
    engine.addModifier(personId, "hunger", {
      id: "iv-drip",
      sourceSystem: "health",
      deltaPerHour: 0.3,
    });

    // Net hunger rate = -0.05 + 0.30 = +0.25/h → level should increase over 1h
    const before = engine.getNeed(personId, "hunger")!.level;
    engine.tick(personId, MINUTES_PER_HOUR, atTime(MINUTES_PER_HOUR));
    const after = engine.getNeed(personId, "hunger")!.level;
    expect(after).toBeGreaterThan(before);
  });
});
