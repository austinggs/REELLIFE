/**
 * M5 DoD — a market shock is reproducible end to end.
 *
 * One story, run through four systems that must agree about it:
 * the grain cooperative fails (System 34) -> the mill bakery cannot bake
 * and stops (System 34 again, on the caller's evidence) -> the mill
 * market's bread price re-forms from its own inputs (System 35) -> the
 * city's price level moves and the conditions are listed (System 36).
 *
 * The scenario is the milestone's reproducibility claim: run twice from
 * the same seed with the same steps and the world state, the prices, the
 * gaps and the signals must be identical. No RNG is consulted anywhere —
 * the shock is an *event*, and its consequences are derived.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { MarketsEngine } from "../../src/engine/markets/engine.ts";
import { SupplyChainsEngine } from "../../src/engine/supplyChains/engine.ts";
import { MacroEngine } from "../../src/engine/macro/engine.ts";
import { asEntityId, IdAllocator } from "../../src/engine/primitives/ids.ts";
import { addTime, days } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-market-shock-seed";
const COOP = "ORG-GRAIN-BASIN-COOP";
const BAKERY = "ORG-ARDEN-MILL-BAKERY";
const MILL = "MKT-ARDEN-MILL";
const BREAD = "GOOD-BREAD-LOAF";
/**
 * The window the aggregate readings use. Three days is deliberate: it is
 * the shortest window that spans the shock and still reaches the pre-shock
 * baseline. A year-long window would compare the shocked level with itself
 * and report nothing, which is the correct answer to a different question.
 */
const JUMP_WINDOW = days(3);

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
}

/** What the scenario observed, so two runs can be compared exactly. */
interface ShockOutcome {
  readonly baselineQuote: number;
  readonly shockedQuote: number;
  readonly bakeryGapBefore: number;
  readonly bakeryGap: number;
  readonly cafeGap: number;
  readonly cafeAlternatives: number;
  readonly cascade: readonly string[];
  /** Trailing-year inflation measured the moment the shock landed. */
  readonly inflation: number | undefined;
  /** The same figure a year later: a one-off level shift, not inflation. */
  readonly inflationAfterYear: number | undefined;
  readonly signals: readonly string[];
}

/**
 * The shock, in causal order. Each system runs in its own scope — the
 * ownership guard rejects nested mutation, and rightly so: the chain is
 * delivered by sequential owners, not by one system writing another's slot.
 */
function runMarketShock(sim: Simulation): ShockOutcome {
  const t0 = sim.clock.time;
  const ids = new IdAllocator();
  let baselineQuote = 0;
  let shockedQuote = 0;
  let bakeryGapBefore = 0;
  let bakeryGap = 0;
  let cafeGap = 0;
  let cafeAlternatives = 0;
  let cascade: readonly string[] = [];
  let inflation: number | undefined;
  let inflationAfterYear: number | undefined;
  let signals: readonly string[] = [];

  // 1. Read the market's opening level, and publish it as a price index
  //    with that level as its base: index 100 at the moment before the
  //    shock, so every later reading is a real movement of the same thing.
  sim.guard.mutate("markets", () => {
    baselineQuote = new MarketsEngine(sim.scope, sim.world).quote(MILL, BREAD).price.minorUnits;
  });
  sim.guard.mutate("macro", () => {
    new MacroEngine(sim.scope, sim.world).observePriceIndex(100, addTime(t0, days(1)));
  });

  // 2. The shock: the grain cooperative fails, so the mill has a grain
  //    gap and the cascade is read off the graph, never scripted.
  sim.guard.mutate("supplyChains", () => {
    const chain = new SupplyChainsEngine(sim.scope, sim.world);
    bakeryGapBefore = chain.supplyGap("DEP-BAKERY-GRAIN");
    chain.suspendSupplier(asEntityId(COOP), addTime(t0, days(2)), "basin grain failed");
    bakeryGap = chain.supplyGap("DEP-BAKERY-GRAIN");
    cascade = chain.cascadeFrom(COOP);
    // The bakery cannot bake what it cannot mill, so it stops supplying:
    // the cafe's only source is gone and there is nothing to substitute.
    chain.suspendSupplier(asEntityId(BAKERY), addTime(t0, days(2)), "no grain, ovens off");
    cafeGap = chain.supplyGap("DEP-CAFE-BREAD");
    cafeAlternatives = chain.substitutionCandidates("DEP-CAFE-BREAD").length;
  });

  // 3. The market: the shelf empties and supply stops, so the same good in
  //    the same market re-forms a higher price from its own inputs.
  sim.guard.mutate("markets", () => {
    const markets = new MarketsEngine(sim.scope, sim.world);
    markets.withdrawStock(MILL, BREAD, 900);
    markets.recordSupply(MILL, BREAD, 0);
    shockedQuote = markets.quote(MILL, BREAD).price.minorUnits;
  });

  // 4. The aggregate: the level moved, the shock is a listed condition,
  //    and a one-off level shift is visible as a *jump* in a window that
  //    spans it — not as inflation that never stops. The window is stated
  //    because the world has no price history older than its baseline.
  sim.guard.mutate("macro", () => {
    const macro = new MacroEngine(sim.scope, sim.world);
    macro.raiseShock(ids, { kind: "grain_failure", severity: 0.7 }, addTime(t0, days(2)));
    const shockedIndex = Math.round((shockedQuote / baselineQuote) * 100);
    // The new level is observed, and the window that spans the shock now
    // shows the jump: the baseline three days back was 100.
    macro.observePriceIndex(shockedIndex, addTime(t0, days(3)));
    inflation = macro.inflation(JUMP_WINDOW);
    // A year on the level is unchanged, so the same measurement over the
    // same window finds no change at all — the shock raised prices once,
    // and a one-off level shift is not a standing inflation.
    macro.observePriceIndex(shockedIndex, addTime(t0, days(368)));
    inflationAfterYear = macro.inflation(JUMP_WINDOW);
    signals = macro.downturnSignals().map((entry) => entry.signal);
  });

  return {
    baselineQuote,
    shockedQuote,
    bakeryGapBefore,
    bakeryGap,
    cafeGap,
    cafeAlternatives,
    cascade,
    inflation,
    inflationAfterYear,
    signals,
  };
}

describe("market shock (M5 DoD)", () => {
  it("carries one failure through supply, price and aggregate in order", () => {
    const sim = newWorld();
    const outcome = runMarketShock(sim);

    // Supply first: the coop covered the mill's grain before, and its
    // failure is now a gap — read off the graph, never scripted.
    expect(outcome.bakeryGapBefore).toBe(0);
    expect(outcome.bakeryGap).toBe(150);
    expect(outcome.cascade).toEqual([BAKERY, "ORG-FENWICK-STALL", "ORG-QUAY-CAFE"]);

    // Then the second-order effect: with the bakery stopped, the cafe's
    // only source is gone and there is nothing to substitute to.
    expect(outcome.cafeGap).toBe(200);
    expect(outcome.cafeAlternatives).toBe(0);

    // Then the price: the same good, the same market, a higher quote,
    // and the drivers say why.
    expect(outcome.shockedQuote).toBeGreaterThan(outcome.baselineQuote);
    sim.guard.mutate("markets", () => {
      const quote = new MarketsEngine(sim.scope, sim.world).quote(MILL, BREAD);
      const scarcity = quote.drivers.find((driver) => driver.driver === "scarcity");
      expect(scarcity?.minorUnits).toBeGreaterThan(0);
    });

    // And finally the aggregate: the level jump shows up in the trailing
    // figure, the shock is still a listed condition — and a year later
    // the same level is no longer inflation, because a one-off supply
    // shock raises prices once rather than continuously.
    expect(outcome.inflation).toBeGreaterThan(0);
    expect(outcome.inflationAfterYear).toBeCloseTo(0, 10);
    expect(outcome.signals).toContain("shock_active:grain_failure");
  });

  it("reproduces the same shock, prices and world from the same seed", () => {
    const first = runMarketShock(newWorld());
    const second = runMarketShock(newWorld());
    expect(second).toEqual(first);
    // Whole-world reproducibility, not only the numbers asserted above.
    const worldA = newWorld();
    const worldB = newWorld();
    runMarketShock(worldA);
    runMarketShock(worldB);
    expect(worldB.stateHash()).toBe(worldA.stateHash());
  });
});
