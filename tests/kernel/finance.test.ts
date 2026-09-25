import { describe, expect, it } from "vitest";
import { permissiveScope, OwnershipGuard } from "../../src/engine/core/access.ts";
import { guardWorldState, type WorldState } from "../../src/engine/core/worldState.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { currencyId, money } from "../../src/engine/primitives/money.ts";
import type { WorldTime } from "../../src/engine/primitives/time.ts";
import { FinanceEngine } from "../../src/engine/finance/engine.ts";

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
      masterSeed: "fin-seed-test",
    },
    shared: {
      idAllocator: { counters: {} },
      notes: [],
    },
    config: {} as never,
    systems: {},
  };
}

describe("System 25 — Finance & Economy Architecture", () => {
  it("enforces ownership via OwnershipGuard", () => {
    const rawWorld = createMockWorldState();
    const guard = new OwnershipGuard();
    const world = guardWorldState(rawWorld, guard);

    expect(() => new FinanceEngine(guard, world)).toThrow();

    guard.mutate("finance", () => {
      const engine = new FinanceEngine(guard, world);
      expect(engine.allAccounts()).toEqual([]);
    });
  });

  it("opens accounts and performs balanced double-entry transfers", () => {
    const world = createMockWorldState();
    const scope = permissiveScope();
    const engine = new FinanceEngine(scope, world);
    const ids = new IdAllocator({ counters: {} });
    const acr = currencyId("ACR");

    const acc1 = engine.openAccount(
      ids,
      "PER-0001" as never,
      "checking",
      acr,
      100 as WorldTime,
      money(acr, 50000), // 500.00 ACR
    );

    const acc2 = engine.openAccount(
      ids,
      "ORG-STORE" as never,
      "checking",
      acr,
      100 as WorldTime,
      money(acr, 0),
    );

    const tx = engine.transfer(
      ids,
      acc1.id,
      acc2.id,
      money(acr, 1250), // 12.50 ACR
      "groceries",
      "Bought fresh produce",
      110 as WorldTime,
    );

    expect(tx.amount.minorUnits).toBe(1250);
    expect(engine.getAccount(acc1.id)?.balance.minorUnits).toBe(48750);
    expect(engine.getAccount(acc2.id)?.balance.minorUnits).toBe(1250);
    expect(engine.allLedger()).toHaveLength(1);
  });
});
