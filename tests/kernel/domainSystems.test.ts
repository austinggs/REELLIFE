import { describe, expect, it } from "vitest";
import { permissiveScope, OwnershipGuard } from "../../src/engine/core/access.ts";
import { guardWorldState, type WorldState } from "../../src/engine/core/worldState.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { currencyId, money } from "../../src/engine/primitives/money.ts";
import type { WorldTime } from "../../src/engine/primitives/time.ts";
import { EmploymentEngine } from "../../src/engine/employment/engine.ts";
import { HousingEngine } from "../../src/engine/housing/engine.ts";
import { InventoryEngine } from "../../src/engine/inventory/engine.ts";
import { FoodEngine } from "../../src/engine/food/engine.ts";

function createMockWorldState(): WorldState {
  return {
    meta: {
      worldId: "WORLD-AURELIA",
      worldName: "Aurelia",
      schemaVersion: 1,
      simulationVersion: 1,
      contentVersion: "1.0.0",
      rngVersion: 1,
      createdAtLabel: "2042-01-01",
      startTime: 0 as WorldTime,
      generation: 1,
      mode: "standard",
      difficulty: "standard",
      masterSeed: "slice-seed-test",
    },
    shared: {
      idAllocator: { counters: {} },
      notes: [],
    },
    config: {} as never,
    systems: {},
  };
}

describe("M2 Domain Systems — Employment, Housing, Inventory, Food", () => {
  it("EmploymentEngine manages hiring, active jobs, and resignation/termination", () => {
    const rawWorld = createMockWorldState();
    const guard = new OwnershipGuard();
    const world = guardWorldState(rawWorld, guard);

    expect(() => new EmploymentEngine(guard, world)).toThrow();

    guard.mutate("employment", () => {
      const engine = new EmploymentEngine(guard, world);
      const ids = new IdAllocator({ counters: {} });
      const acr = currencyId("ACR");

      const emp = engine.hire(
        ids,
        "PER-0001" as never,
        "ORG-01",
        "Junior Developer",
        "occ:software",
        money(acr, 2500),
        40,
        100 as WorldTime,
      );

      expect(emp.status).toBe("active");
      expect(engine.activeEmployments("PER-0001" as never)).toHaveLength(1);

      engine.terminate(emp.id, "resigned", 200 as WorldTime);
      expect(engine.activeEmployments("PER-0001" as never)).toHaveLength(0);
    });
  });

  it("HousingEngine manages residence and lease agreements", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new HousingEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });
    const acr = currencyId("ACR");

    const res = engine.moveIn(ids, "PER-0001" as never, "PROP-01", "tenant", 100 as WorldTime);
    expect(res.propertyId).toBe("PROP-01");
    expect(engine.currentResidence("PER-0001" as never)?.propertyId).toBe("PROP-01");

    const lease = engine.signLease(ids, "PROP-01", "PER-LANDLORD", "PER-0001" as never, money(acr, 80000), 100 as WorldTime);
    expect(lease.active).toBe(true);

    engine.moveOut("PER-0001" as never, 200 as WorldTime);
    expect(engine.currentResidence("PER-0001" as never)).toBeUndefined();
  });

  it("InventoryEngine tracks possessions, item quantities, and transfers", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new InventoryEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });

    const item = engine.addItem(ids, "def:bread", "PER-0001" as never, "PER-0001" as never, 3, 1.0, 100 as WorldTime);
    expect(item.quantity).toBe(3);
    expect(engine.itemsHeldBy("PER-0001" as never)).toHaveLength(1);

    engine.transferPossession(item.id, "PER-0002" as never);
    expect(engine.itemsHeldBy("PER-0001" as never)).toHaveLength(0);
    expect(engine.itemsHeldBy("PER-0002" as never)).toHaveLength(1);

    engine.removeItem(item.id, 1);
    expect(engine.getItem(item.id)?.quantity).toBe(2);
  });

  it("FoodEngine creates food items with calories/hydration and tracks consumption", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new FoodEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });

    const food = engine.createFood(ids, "Apple", 95, 0.85, 100 as WorldTime);
    expect(food.calories).toBe(95);
    expect(engine.getFood(food.id)).toBeDefined();

    const consumed = engine.consume(food.id);
    expect(consumed?.name).toBe("Apple");
    expect(engine.getFood(food.id)).toBeUndefined();
  });
});
