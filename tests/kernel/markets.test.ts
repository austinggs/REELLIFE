/**
 * System 35 — markets: local exchange, price formation, competition, tax and
 * regulation, and recorded transactions.
 *
 * The behaviours below are the ones the spec names for testing (shortages,
 * surpluses, monopolies, price shocks, differentiated goods, local markets,
 * regulation, imperfect information, competitor entry/exit). Price formation is
 * checked both through the engine and directly, because the claim being made is
 * that a price follows from its inputs — including the claim that its own
 * driver list accounts for it exactly.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { MarketsEngine } from "../../src/engine/markets/engine.ts";
import { formPrice } from "../../src/engine/markets/pricing.ts";
import type { GoodDefinition } from "../../src/engine/markets/types.ts";
import {
  AURELIA_SLICE_GOOD_COUNT,
  AURELIA_SLICE_MARKET_COUNT,
  aureliaArdenMarkets,
  registerAureliaGoodsAndMarkets,
} from "../../src/content/aurelia/markets.ts";
import { M2_SETTLEMENT_ID } from "../../src/content/aurelia/geography.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { currencyId, money } from "../../src/engine/primitives/money.ts";
import { atTime, days } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-markets-seed";
const AUR = currencyId("AUR");
const NOW = atTime(days(365));
const MILL = "MKT-ARDEN-MILL";
const QUAY = "MKT-ARDEN-QUAY";
const PORT = "MKT-ARDEN-PORT-SERVICES";
const BAKERY = "ORG-ARDEN-MILL-BAKERY";
const CAFE = "ORG-QUAY-CAFE";
const LOAF = "GOOD-BREAD-LOAF";
const SHIFT = "GOOD-STEVEDORE-SHIFT";

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
}

function withMarkets<T>(sim: Simulation, fn: (engine: MarketsEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("markets", () => {
    result = fn(new MarketsEngine(sim.scope, sim.world));
  });
  return result;
}

/** Price formation inputs for one good, with overrides for experiments. */
function inputs(
  overrides: Partial<Parameters<typeof formPrice>[0]> = {},
): Parameters<typeof formPrice>[0] {
  return {
    goodId: LOAF,
    landedCost: money(AUR, 55),
    transportCostPerUnit: money(AUR, 5),
    inventoryUnits: 100,
    supplyUnits: 100,
    demandUnits: 100,
    structure: "competitive",
    taxBasisPoints: 0,
    ...overrides,
  };
}

describe("markets (System 35)", () => {
  it("registers the catalogue and Arden's local markets, idempotently", () => {
    const sim = newWorld();
    expect(aureliaArdenMarkets(M2_SETTLEMENT_ID)).toHaveLength(AURELIA_SLICE_MARKET_COUNT);

    withMarkets(sim, (engine) => {
      expect(engine.goods()).toHaveLength(AURELIA_SLICE_GOOD_COUNT);
      expect(engine.all()).toHaveLength(AURELIA_SLICE_MARKET_COUNT);
      expect(new Set(engine.goods().map((good) => good.id)).size).toBe(AURELIA_SLICE_GOOD_COUNT);

      // Markets stay local: all three sit in the slice city.
      expect(engine.marketsAt(M2_SETTLEMENT_ID)).toHaveLength(AURELIA_SLICE_MARKET_COUNT);

      for (const market of engine.all()) {
        for (const good of market.goods) {
          expect(engine.good(good.goodId)).toBeDefined();
          // The opening price was formed, and its reason was kept.
          expect(good.price.minorUnits).toBe(engine.quote(market.id, good.goodId).price.minorUnits);
          expect(good.priceHistory).toHaveLength(1);
          expect(good.priceHistory[0]?.reason).toMatch(/Price formed from/);
        }
        // Every listed good is real, so a seller's listing cannot dangle.
        for (const participant of market.participants) {
          for (const goodId of participant.goodIds) {
            expect(engine.good(goodId)).toBeDefined();
          }
        }
      }

      // Re-seeding adds nothing.
      expect(registerAureliaGoodsAndMarkets(engine, M2_SETTLEMENT_ID, NOW)).toEqual({
        goods: 0,
        markets: 0,
      });
      expect(engine.all()).toHaveLength(AURELIA_SLICE_MARKET_COUNT);
      expect(engine.goods()).toHaveLength(AURELIA_SLICE_GOOD_COUNT);
    });
  });

  it("refuses a market whose sellers or goods are not real", () => {
    const sim = newWorld();
    withMarkets(sim, (engine) => {
      expect(() => engine.defineGood(engine.goods()[0] as GoodDefinition)).toThrow(
        /already exists/,
      );

      const base = {
        name: "Probe market",
        locationId: M2_SETTLEMENT_ID,
        structure: "competitive" as const,
        currency: AUR,
      };
      const oneGood = [
        { goodId: LOAF, inventoryUnits: 0, supplyUnits: 0, demandUnits: 0, landedCost: money(AUR, 1) },
      ];
      expect(() =>
        engine.defineMarket(
          {
            ...base,
            id: "MKT-PROBE-1",
            goods: [
              { goodId: "GOOD-NOT-REAL", inventoryUnits: 0, supplyUnits: 0, demandUnits: 0, landedCost: money(AUR, 1) },
            ],
          },
          NOW,
        ),
      ).toThrow(/unknown good/);
      expect(() =>
        engine.defineMarket(
          {
            ...base,
            id: "MKT-PROBE-2",
            goods: oneGood,
            participants: [{ sellerId: "ORG-NOT-REAL", goodIds: [LOAF], shareOfSupply: 1 }],
          },
          NOW,
        ),
      ).toThrow(/not a registered business/);
      // Shares of supply cannot exceed the whole market.
      expect(() =>
        engine.defineMarket(
          {
            ...base,
            id: "MKT-PROBE-3",
            goods: oneGood,
            participants: [
              { sellerId: BAKERY, goodIds: [LOAF], shareOfSupply: 0.8 },
              { sellerId: CAFE, goodIds: [LOAF], shareOfSupply: 0.6 },
            ],
          },
          NOW,
        ),
      ).toThrow(/exceed 1/);
      // A market id is taken once.
      expect(() =>
        engine.defineMarket(aureliaArdenMarkets(M2_SETTLEMENT_ID)[0] as never, NOW),
      ).toThrow(/already exists/);
    });
  });

  it("forms prices from its inputs, and every driver is accounted for", () => {
    // Scarcity moves the price above cost; a glut pushes it back down to cost.
    const balanced = formPrice(inputs({ inventoryUnits: 100, supplyUnits: 100, demandUnits: 200 }));
    const tight = formPrice(inputs({ inventoryUnits: 50, supplyUnits: 50, demandUnits: 200 }));
    const glut = formPrice(inputs({ inventoryUnits: 5_000, supplyUnits: 5_000, demandUnits: 10 }));
    expect(tight.price.minorUnits).toBeGreaterThan(balanced.price.minorUnits);
    expect(glut.price.minorUnits).toBeLessThan(tight.price.minorUnits);
    // Nothing sells below what the good cost to get there (55 + 5).
    expect(glut.price.minorUnits).toBe(60);
    expect(glut.reason).toMatch(/cost floor/);

    // Structure shifts the same costs: monopoly > oligopoly > competitive >
    // regulated, in that order. (Demand is above supply here, so the structure
    // factor is applied to a price that is above the cost floor.)
    const asStructure = (structure: Parameters<typeof formPrice>[0]["structure"]) =>
      formPrice(inputs({ inventoryUnits: 100, supplyUnits: 100, demandUnits: 300, structure }))
        .price.minorUnits;
    expect(asStructure("monopoly")).toBeGreaterThan(asStructure("oligopoly"));
    expect(asStructure("oligopoly")).toBeGreaterThan(asStructure("competitive"));
    expect(asStructure("competitive")).toBeGreaterThan(asStructure("regulated"));

    // Tax is applied on top of the formed price, and expectations pull toward
    // themselves without dictating. (Demand above supply keeps the formed price
    // clear of the cost floor, where a tax would otherwise be floored away.)
    const untaxed = formPrice(inputs({ demandUnits: 300 }));
    const taxed = formPrice(inputs({ demandUnits: 300, taxBasisPoints: 2_000 }));
    expect(taxed.price.minorUnits).toBeGreaterThan(untaxed.price.minorUnits);
    const pulled = formPrice(inputs({ demandUnits: 300, expectedPrice: money(AUR, 500) }));
    expect(pulled.price.minorUnits).toBeGreaterThan(untaxed.price.minorUnits);
    expect(pulled.price.minorUnits).toBeLessThan(500);

    // The drivers a market publishes account for its price exactly.
    const quote = formPrice(
      inputs({
        demandUnits: 300,
        structure: "oligopoly",
        taxBasisPoints: 500,
        expectedPrice: money(AUR, 200),
      }),
    );
    expect(quote.drivers.map((driver) => driver.driver)).toEqual([
      "landed_cost",
      "transport",
      "scarcity",
      "structure",
      "tax",
      "expectation",
    ]);
    expect(quote.drivers.reduce((total, driver) => total + driver.minorUnits, 0)).toBe(
      quote.price.minorUnits,
    );

    // A regulated ceiling caps the price and says so.
    const capped = formPrice(inputs({ demandUnits: 400, priceCeiling: money(AUR, 70) }));
    expect(capped.price.minorUnits).toBe(70);
    expect(capped.drivers.map((driver) => driver.driver)).toContain("ceiling");
    expect(capped.reason).toMatch(/regulated ceiling/);
    expect(capped.drivers.reduce((total, driver) => total + driver.minorUnits, 0)).toBe(
      capped.price.minorUnits,
    );

    // Malformed inputs are refused rather than silently coerced.
    expect(() => formPrice(inputs({ demandUnits: -1 }))).toThrow(/non-negative/);
    expect(() => formPrice(inputs({ taxBasisPoints: 20_000 }))).toThrow(/taxBasisPoints/);
    expect(() =>
      formPrice(inputs({ transportCostPerUnit: money(currencyId("XAC"), 5) })),
    ).toThrow(/mixes currencies/);
  });

  it("publishes the price it forms, and keeps the reason", () => {
    const sim = newWorld();
    withMarkets(sim, (engine) => {
      const before = engine.requireMarket(MILL, "test");
      const publishedLoaf = engine.goodState(MILL, LOAF)?.price.minorUnits;

      // Demand changes what the market would quote…
      engine.observeDemand(MILL, LOAF, 5_000);
      const quoted = engine.quote(MILL, LOAF).price.minorUnits;
      expect(quoted).toBeGreaterThan(publishedLoaf as number);
      // …but the published price only moves when the market publishes it.
      expect(engine.goodState(MILL, LOAF)?.price.minorUnits).toBe(publishedLoaf);

      const { market, quote } = engine.publishPrice(MILL, LOAF, NOW);
      const state = market.goods.find((good) => good.goodId === LOAF);
      expect(state?.price.minorUnits).toBe(quote.price.minorUnits);
      expect(state?.priceHistory).toHaveLength(2);
      expect(state?.priceHistory.at(-1)?.reason).toContain("scarcity");
      expect(state?.priceHistory.at(-1)?.at).toBe(NOW);

      // Publishing is deterministic: the same inputs give the same price.
      const repeated = engine.publishPrice(MILL, LOAF, NOW);
      expect(repeated.quote.price.minorUnits).toBe(quote.price.minorUnits);
      expect(before.id).toBe(MILL);
    });
  });

  it("tracks competition, entry and exit without forgetting who left", () => {
    const sim = newWorld();
    withMarkets(sim, (engine) => {
      expect(engine.competitorsFor(MILL, LOAF).map((entry) => entry.sellerId)).toEqual([BAKERY]);
      expect(engine.concentrationFor(MILL, LOAF)).toBeCloseTo(0.65, 6);

      const DOCKS = "ORG-ARDIN-DOCKS";
      const COOP = "ORG-GRAIN-BASIN-COOP";
      // Entry is constrained by what is left of the market's supply: the mill
      // market is already 65% bakery and 35% cooperative.
      expect(() => engine.addParticipant(MILL, DOCKS, [LOAF], 0.2, NOW)).toThrow(/exceed 1/);
      // The cooperative leaves, and the docks take up its share.
      engine.removeParticipant(MILL, COOP, NOW);
      engine.addParticipant(MILL, DOCKS, [LOAF], 0.35, NOW);
      expect(engine.competitorsFor(MILL, LOAF).map((entry) => entry.sellerId)).toEqual([
        BAKERY,
        DOCKS,
      ]);
      // Concentration is derived from the participants, not stored.
      expect(engine.concentrationFor(MILL, LOAF)).toBeCloseTo(0.65, 6);

      // A seller cannot enter twice, and only a real business can enter at all.
      expect(() => engine.addParticipant(MILL, DOCKS, [LOAF], 0.1, NOW)).toThrow(/already trades/);
      expect(() => engine.addParticipant(MILL, "ORG-NOT-REAL", [LOAF], 0.1, NOW)).toThrow(
        /not a registered business/,
      );

      // Exit closes the record rather than deleting it: market history survives.
      const afterExit = engine.removeParticipant(MILL, DOCKS, NOW);
      const left = afterExit.participants.find((entry) => entry.sellerId === DOCKS);
      expect(left?.leftAt).toBe(NOW);
      expect(engine.competitorsFor(MILL, LOAF).map((entry) => entry.sellerId)).toEqual([BAKERY]);
      expect(() => engine.removeParticipant(MILL, DOCKS, NOW)).toThrow(/does not trade/);
    });
  });

  it("records exchanges without inventing sellers, stock or money", () => {
    const sim = newWorld();
    const ids = new IdAllocator({ counters: {} });
    withMarkets(sim, (engine) => {
      const espresso = "GOOD-ESPRESSO";
      const stock = engine.goodState(QUAY, espresso)?.inventoryUnits ?? 0;
      const published = engine.goodState(QUAY, espresso)?.price.minorUnits;

      const sale = engine.recordTransaction(
        ids,
        {
          marketId: QUAY,
          goodId: espresso,
          sellerId: CAFE,
          buyerId: "PER-000001",
          units: 2,
          ledgerEntryId: "tx-000009",
        },
        NOW,
      );
      expect(sale.id).toMatch(/^mkt-tx-/);
      expect(sale.unitPrice.minorUnits).toBe(published);
      expect(sale.ledgerEntryId).toBe("tx-000009");
      // The sale moves the market's own stock, and the published price stands
      // until the market republishes it.
      expect(engine.goodState(QUAY, espresso)?.inventoryUnits).toBe(stock - 2);
      expect(engine.goodState(QUAY, espresso)?.price.minorUnits).toBe(published);
      expect(engine.transactionsFor(QUAY, espresso).map((entry) => entry.id)).toContain(sale.id);

      // A seller who does not list the good cannot sell it in a local market…
      expect(() =>
        engine.recordTransaction(
          ids,
          { marketId: QUAY, goodId: espresso, sellerId: BAKERY, buyerId: "PER-000001", units: 1 },
          NOW,
        ),
      ).toThrow(/not a seller/);
      // …nor can the market sell stock it does not hold.
      expect(() =>
        engine.recordTransaction(
          ids,
          { marketId: QUAY, goodId: espresso, sellerId: CAFE, buyerId: "PER-000001", units: stock + 100 },
          NOW,
        ),
      ).toThrow(/holds/);
      expect(() =>
        engine.recordTransaction(
          ids,
          { marketId: QUAY, goodId: espresso, sellerId: CAFE, buyerId: "PER-000001", units: 0 },
          NOW,
        ),
      ).toThrow(/positive integer/);

      // An informal market is exactly where an unlisted trader sells.
      engine.setStructure(QUAY, "informal");
      const informal = engine.recordTransaction(
        ids,
        { marketId: QUAY, goodId: espresso, sellerId: "ORG-FENWICK-STALL", buyerId: "PER-000002", units: 1 },
        NOW,
      );
      expect(informal.sellerId).toBe("ORG-FENWICK-STALL");
    });
  });

  it("applies taxes and regulated ceilings through the market", () => {
    const sim = newWorld();
    withMarkets(sim, (engine) => {
      // Port work is tariffed: the tax is part of the formed price.
      const shaped = engine.setTax(PORT, SHIFT, 2_000);
      const taxed = engine.quote(PORT, SHIFT);
      expect(taxed.drivers.find((driver) => driver.driver === "tax")?.minorUnits).toBeGreaterThan(0);
      expect(() => engine.setTax(PORT, SHIFT, 20_000)).toThrow(/basisPoints/);

      // A ceiling below the formed price caps it, and says so.
      engine.setPriceCeiling(PORT, SHIFT, money(AUR, 14_000));
      const capped = engine.quote(PORT, SHIFT);
      expect(capped.price.minorUnits).toBe(14_000);
      expect(capped.reason).toMatch(/regulated ceiling/);
      // Lifting the ceiling lets the formed price through again.
      engine.setPriceCeiling(PORT, SHIFT, undefined);
      expect(engine.quote(PORT, SHIFT).price.minorUnits).toBeGreaterThan(14_000);
      expect(shaped.id).toBe(PORT);

      // Expectations pull the price without dictating it, and never below cost.
      const formed = engine.quote(PORT, SHIFT).price.minorUnits;
      engine.setExpectedPrice(PORT, SHIFT, money(AUR, 50));
      const pulled = engine.quote(PORT, SHIFT);
      expect(pulled.price.minorUnits).toBeLessThan(formed);
      expect(pulled.price.minorUnits).toBeGreaterThanOrEqual(pulled.basePrice.minorUnits);
      expect(pulled.drivers.map((driver) => driver.driver)).toContain("expectation");
    });
  });

  it("reports shortages and surpluses deterministically", () => {
    const sim = newWorld();
    withMarkets(sim, (engine) => {
      // Short supply: 80 shifts wanted, 60 offered.
      expect(engine.scarcity(PORT, SHIFT)).toBeCloseTo(80 / 60, 6);
      expect(engine.shortages(PORT).map((entry) => entry.goodId)).toEqual([SHIFT]);
      expect(engine.surpluses(PORT).map((entry) => entry.goodId)).toEqual(["GOOD-BONDED-STORAGE"]);
      expect(engine.availability(PORT, "GOOD-BONDED-STORAGE")).toBe(5_000);

      // The mill has no shortages and two surpluses, ordered by scarcity.
      expect(engine.shortages(MILL)).toEqual([]);
      expect(engine.surpluses(MILL).map((entry) => entry.goodId)).toEqual([
        "GOOD-GRAIN-SACK",
        "GOOD-BREAD-LOAF",
      ]);
      expect(engine.surpluses(MILL)).toEqual(engine.surpluses(MILL));

      // Stock can only be withdrawn from what is on the shelf, and receiving it
      // is how a delivered purchase order arrives (System 34).
      expect(() => engine.withdrawStock(MILL, LOAF, 9_999)).toThrow(/holds/);
      engine.withdrawStock(MILL, LOAF, 900);
      expect(engine.goodState(MILL, LOAF)?.inventoryUnits).toBe(0);
      engine.receiveStock(MILL, LOAF, 250);
      expect(engine.goodState(MILL, LOAF)?.inventoryUnits).toBe(250);

      // An unknown market or good is a named error, not an empty answer.
      expect(() => engine.quote(MILL, "GOOD-NOT-REAL")).toThrow(/does not carry good/);
      expect(() => engine.goodState("MKT-NOT-REAL", LOAF)).toThrow(/unknown market/);
    });
  });

  it("keeps markets under single ownership and visible in the save format", () => {
    const sim = newWorld();

    const reader = new MarketsEngine(sim.scope, sim.world);
    expect(reader.all()).toHaveLength(AURELIA_SLICE_MARKET_COUNT);
    expect(() => reader.observeDemand(MILL, LOAF, 10)).toThrow(MissingWriterContextError);
    expect(() =>
      sim.guard.mutate("businesses", () => {
        new MarketsEngine(sim.scope, sim.world).observeDemand(MILL, LOAF, 10);
      }),
    ).toThrow(OwnershipViolationError);

    const bag = (sim.serializedWorld() as { readonly systems?: Record<string, unknown> }).systems;
    expect(bag?.["markets"]).toBeDefined();
    const state = bag?.["markets"] as {
      goods: readonly unknown[];
      markets: readonly unknown[];
      transactions: readonly unknown[];
    };
    expect(state.goods).toHaveLength(AURELIA_SLICE_GOOD_COUNT);
    expect(state.markets).toHaveLength(AURELIA_SLICE_MARKET_COUNT);
    expect(state.transactions).toHaveLength(0);
  });
});
