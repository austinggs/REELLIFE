import { describe, expect, it } from "vitest";
import { IdentityEngine } from "../../src/engine/identity/engine.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { atTime } from "../../src/engine/primitives/time.ts";
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

describe("character identity & origin (System 08)", () => {
  it("creates a person and assigns a stable ID", () => {
    const engine = new IdentityEngine(permissiveScope(), makeWorld());
    const ids = new IdAllocator();

    const person = engine.create(ids, {
      name: { first: "John", last: "Doe" },
      birth: { dateOfBirth: atTime(1000) },
      appearanceFoundationSeed: "seed-123",
    });

    expect(person.id).toBe("PER-000001");
    expect(person.name.first).toBe("John");
    expect(engine.get(person.id)).toBeDefined();
    expect(engine.all()).toHaveLength(1);
  });

  it("assigns sequential IDs for multiple persons", () => {
    const engine = new IdentityEngine(permissiveScope(), makeWorld());
    const ids = new IdAllocator();

    const a = engine.create(ids, {
      name: { first: "Alice", last: "A" },
      birth: { dateOfBirth: atTime(0) },
      appearanceFoundationSeed: "s1",
    });
    const b = engine.create(ids, {
      name: { first: "Bob", last: "B" },
      birth: { dateOfBirth: atTime(0) },
      appearanceFoundationSeed: "s2",
    });

    expect(a.id).toBe("PER-000001");
    expect(b.id).toBe("PER-000002");
  });

  it("records death without losing the PersonId", () => {
    const engine = new IdentityEngine(permissiveScope(), makeWorld());
    const ids = new IdAllocator();

    const person = engine.create(ids, {
      name: { first: "Jane", last: "Doe" },
      birth: { dateOfBirth: atTime(1000) },
      appearanceFoundationSeed: "seed-456",
    });
    engine.recordDeath(person.id, atTime(5000), "old age");

    const deceased = engine.get(person.id)!;
    expect(deceased.id).toBe(person.id); // id unchanged
    expect(deceased.death?.cause).toBe("old age");
    expect(deceased.death?.date as number).toBe(5000);
  });

  it("changes name and records history entry", () => {
    const engine = new IdentityEngine(permissiveScope(), makeWorld());
    const ids = new IdAllocator();

    const person = engine.create(ids, {
      name: { first: "Alice", last: "Smith" },
      birth: { dateOfBirth: atTime(1000) },
      appearanceFoundationSeed: "seed-789",
    });
    engine.changeName(person.id, { first: "Alice", last: "Jones" }, atTime(2000), "marriage");

    const updated = engine.get(person.id)!;
    expect(updated.name.last).toBe("Jones");
    expect(updated.history).toHaveLength(1);
    expect(updated.history[0]!.type).toBe("nameChange");
    expect(updated.history[0]!.reason).toBe("marriage");
  });

  it("does not allow double-death", () => {
    const engine = new IdentityEngine(permissiveScope(), makeWorld());
    const ids = new IdAllocator();

    const person = engine.create(ids, {
      name: { first: "Bob", last: "B" },
      birth: { dateOfBirth: atTime(0) },
      appearanceFoundationSeed: "s",
    });
    engine.recordDeath(person.id, atTime(1000));
    expect(() => engine.recordDeath(person.id, atTime(2000))).toThrow();
  });
});
