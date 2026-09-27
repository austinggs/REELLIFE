/**
 * Markets engine (System 35).
 *
 * Owns `systems.markets`: the goods catalogue, the local markets, who competes
 * in them, what is on offer, the inputs each price is formed from, the
 * published prices and the recorded exchanges. Every write asserts ownership on
 * that slot; reads are scope-free.
 *
 * The engine deliberately stops at the exchange boundary. It forms and
 * publishes prices, tracks availability and competition, and records
 * transactions — it never moves money (System 25 posts the ledger entry and the
 * transaction stores its id) and never decides what anyone buys (System 17).
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { IdAllocator } from "../primitives/ids.ts";
import type { CurrencyId, Money } from "../primitives/money.ts";
import { zeroMoney } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";
import { availableUnits, formPrice, scarcityRatio, type PriceFormationInputs } from "./pricing.ts";
import {
  MARKET_STRUCTURES,
  type GoodDefinition,
  type MarketGoodState,
  type MarketParticipant,
  type MarketRecord,
  type MarketStructure,
  type MarketTransaction,
  type MarketsSystemState,
  type PriceQuote,
} from "./types.ts";

/** What a market is told about one of its goods when it is created. */
export interface MarketGoodSeed {
  readonly goodId: string;
  readonly inventoryUnits: number;
  readonly supplyUnits: number;
  readonly demandUnits: number;
  readonly landedCost: Money;
  readonly transportCostPerUnit?: Money;
  readonly taxBasisPoints?: number;
  readonly expectedPrice?: Money;
  readonly priceCeiling?: Money;
}

export interface RegisterMarketRequest {
  readonly id: string;
  readonly name: string;
  readonly locationId: string;
  readonly structure: MarketStructure;
  readonly currency: CurrencyId;
  readonly goods: readonly MarketGoodSeed[];
  readonly participants?: readonly {
    readonly sellerId: string;
    readonly goodIds: readonly string[];
    readonly shareOfSupply: number;
  }[];
  readonly provisional?: boolean;
  readonly note?: string;
}

export interface RecordTransactionRequest {
  readonly marketId: string;
  readonly goodId: string;
  readonly sellerId: string;
  readonly buyerId: string;
  readonly units: number;
  /** Defaults to the market's published price; the market is what sets prices. */
  readonly unitPrice?: Money;
  readonly ledgerEntryId?: string;
}

export interface MarketSnapshot {
  readonly marketId: string;
  readonly goodId: string;
  readonly quote: PriceQuote;
  readonly published: Money;
  readonly available: number;
  readonly scarcity: number;
}

export class MarketsEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.markets) {
      this.scope.assertOwner("markets");
      this.world.systems.markets = {
        goods: [],
        markets: [],
        transactions: [],
      } satisfies MarketsSystemState;
    }
  }

  private get state(): MarketsSystemState {
    return this.world.systems.markets as MarketsSystemState;
  }

  private set state(value: MarketsSystemState) {
    this.world.systems.markets = value;
  }

  // ---------------------------------------------------------------- reads ---

  all(): readonly MarketRecord[] {
    return this.state.markets;
  }

  market(id: string): MarketRecord | undefined {
    return this.state.markets.find((candidate) => candidate.id === id);
  }

  requireMarket(id: string, caller: string): MarketRecord {
    const found = this.market(id);
    if (found === undefined) throw new Error(`MarketsEngine.${caller}: unknown market ${id}`);
    return found;
  }

  /** Markets are local: a settlement can run several, or none. */
  marketsAt(locationId: string): readonly MarketRecord[] {
    return this.state.markets.filter((candidate) => candidate.locationId === locationId);
  }

  goods(): readonly GoodDefinition[] {
    return this.state.goods;
  }

  good(id: string): GoodDefinition | undefined {
    return this.state.goods.find((candidate) => candidate.id === id);
  }

  goodsByCategory(category: string): readonly GoodDefinition[] {
    return this.state.goods.filter((candidate) => candidate.category === category);
  }

  transactions(): readonly MarketTransaction[] {
    return this.state.transactions;
  }

  transactionsFor(marketId: string, goodId?: string): readonly MarketTransaction[] {
    return this.state.transactions.filter(
      (entry) => entry.marketId === marketId && (goodId === undefined || entry.goodId === goodId),
    );
  }

  /** One good's state in one market, or undefined when the market does not carry it. */
  goodState(marketId: string, goodId: string): MarketGoodState | undefined {
    return this.requireMarket(marketId, "goodState").goods.find((good) => good.goodId === goodId);
  }

  // --------------------------------------------------------------- writes ---

  defineGood(good: GoodDefinition): GoodDefinition {
    this.scope.assertOwner("markets");
    if (this.good(good.id) !== undefined) {
      throw new Error(`MarketsEngine.defineGood: good ${good.id} already exists`);
    }
    this.state = { ...this.state, goods: [...this.state.goods, good] };
    return good;
  }

  /**
   * Registers a local market. The opening price of every good is *formed* from
   * the inputs the content supplies, so no price in a market is ever typed in
   * by hand and none can disagree with its own drivers.
   */
  defineMarket(request: RegisterMarketRequest, now: WorldTime): MarketRecord {
    this.scope.assertOwner("markets");
    if (this.market(request.id) !== undefined) {
      throw new Error(`MarketsEngine.defineMarket: market ${request.id} already exists`);
    }
    if (!MARKET_STRUCTURES.includes(request.structure)) {
      throw new Error(`MarketsEngine.defineMarket: unknown structure ${String(request.structure)}`);
    }

    const goods: MarketGoodState[] = [];
    for (const seed of request.goods) {
      if (this.good(seed.goodId) === undefined) {
        throw new Error(
          `MarketsEngine.defineMarket: market ${request.id} carries unknown good ${seed.goodId}`,
        );
      }
      requireUnits(seed.inventoryUnits, "inventoryUnits", "defineMarket");
      requireUnits(seed.supplyUnits, "supplyUnits", "defineMarket");
      requireUnits(seed.demandUnits, "demandUnits", "defineMarket");
      if (seed.landedCost.currency !== request.currency) {
        throw new Error(
          `MarketsEngine.defineMarket: ${seed.goodId} is priced in ${seed.landedCost.currency} but market ${request.id} trades in ${request.currency}`,
        );
      }
      const state: MarketGoodState = {
        goodId: seed.goodId,
        inventoryUnits: seed.inventoryUnits,
        supplyUnits: seed.supplyUnits,
        demandUnits: seed.demandUnits,
        landedCost: seed.landedCost,
        transportCostPerUnit: seed.transportCostPerUnit ?? zeroMoney(request.currency),
        taxBasisPoints: seed.taxBasisPoints ?? 0,
        priceCeiling: seed.priceCeiling,
        expectedPrice: seed.expectedPrice,
        price: zeroMoney(request.currency),
        priceHistory: [],
      };
      const opening = formPrice(this.formationInputs(request.structure, state));
      goods.push({
        ...state,
        price: opening.price,
        priceHistory: [{ at: now, minorUnits: opening.price.minorUnits, reason: opening.reason }],
      });
    }

    const participants: MarketParticipant[] = [];
    for (const seed of request.participants ?? []) {
      requireRatio(seed.shareOfSupply, "shareOfSupply", "defineMarket");
      for (const goodId of seed.goodIds) {
        if (this.good(goodId) === undefined) {
          throw new Error(
            `MarketsEngine.defineMarket: seller ${seed.sellerId} lists unknown good ${goodId}`,
          );
        }
      }
      if (!this.knownBusiness(seed.sellerId)) {
        throw new Error(
          `MarketsEngine.defineMarket: seller ${seed.sellerId} is not a registered business (System 33)`,
        );
      }
      participants.push({
        sellerId: seed.sellerId,
        goodIds: [...seed.goodIds],
        shareOfSupply: seed.shareOfSupply,
        joinedAt: now,
      });
    }
    const declaredShare = participants.reduce((total, entry) => total + entry.shareOfSupply, 0);
    if (declaredShare > 1.000_001) {
      throw new Error(
        `MarketsEngine.defineMarket: seller shares of ${request.id} exceed 1 (${declaredShare})`,
      );
    }

    const market: MarketRecord = {
      id: request.id,
      name: request.name,
      locationId: request.locationId,
      structure: request.structure,
      currency: request.currency,
      participants,
      goods,
      provisional: request.provisional,
      note: request.note,
    };
    this.state = { ...this.state, markets: [...this.state.markets, market] };
    return market;
  }

  private knownBusiness(id: string): boolean {
    const state = this.world.systems.businesses as
      | { readonly businesses: readonly { readonly id: string }[] }
      | undefined;
    // Without System 33 there is nothing to resolve against; with it, a market
    // may not list a seller who does not exist.
    if (state === undefined) return true;
    return state.businesses.some((business) => business.id === id);
  }

  private formationInputs(structure: MarketStructure, state: MarketGoodState): PriceFormationInputs {
    return {
      goodId: state.goodId,
      landedCost: state.landedCost,
      transportCostPerUnit: state.transportCostPerUnit,
      inventoryUnits: state.inventoryUnits,
      supplyUnits: state.supplyUnits,
      demandUnits: state.demandUnits,
      structure,
      taxBasisPoints: state.taxBasisPoints,
      expectedPrice: state.expectedPrice,
      priceCeiling: state.priceCeiling,
    };
  }

  private requireGoodState(marketId: string, goodId: string, caller: string): MarketGoodState {
    const state = this.goodState(marketId, goodId);
    if (state === undefined) {
      throw new Error(`MarketsEngine.${caller}: market ${marketId} does not carry good ${goodId}`);
    }
    return state;
  }

  private replaceMarket(updated: MarketRecord): MarketRecord {
    this.state = {
      ...this.state,
      markets: this.state.markets.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      ),
    };
    return updated;
  }

  private replaceGood(marketId: string, goodId: string, updated: MarketGoodState): MarketRecord {
    const market = this.requireMarket(marketId, "replaceGood");
    if (!market.goods.some((good) => good.goodId === goodId)) {
      throw new Error(`MarketsEngine: market ${marketId} does not carry ${goodId}`);
    }
    const goods = market.goods.map((good) => (good.goodId === goodId ? updated : good));
    return this.replaceMarket({ ...market, goods });
  }

  // ------------------------------------------------ market observations ---

  /** What buyers sought this window. Whether they buy is System 17's decision. */
  observeDemand(marketId: string, goodId: string, units: number): MarketRecord {
    this.scope.assertOwner("markets");
    requireUnits(units, "units", "observeDemand");
    const state = this.requireGoodState(marketId, goodId, "observeDemand");
    return this.replaceGood(marketId, goodId, { ...state, demandUnits: units });
  }

  /** What suppliers offered this window (System 33/34 decide that). */
  recordSupply(marketId: string, goodId: string, units: number): MarketRecord {
    this.scope.assertOwner("markets");
    requireUnits(units, "units", "recordSupply");
    const state = this.requireGoodState(marketId, goodId, "recordSupply");
    return this.replaceGood(marketId, goodId, { ...state, supplyUnits: units });
  }

  /** Stock arriving on the shelf, e.g. a delivered purchase order (System 34). */
  receiveStock(marketId: string, goodId: string, units: number): MarketRecord {
    this.scope.assertOwner("markets");
    requireUnits(units, "units", "receiveStock");
    const state = this.requireGoodState(marketId, goodId, "receiveStock");
    return this.replaceGood(marketId, goodId, {
      ...state,
      inventoryUnits: state.inventoryUnits + units,
    });
  }

  /** Stock leaving the shelf for something other than a sale (spoilage, theft). */
  withdrawStock(marketId: string, goodId: string, units: number): MarketRecord {
    this.scope.assertOwner("markets");
    requireUnits(units, "units", "withdrawStock");
    const state = this.requireGoodState(marketId, goodId, "withdrawStock");
    if (state.inventoryUnits < units) {
      throw new Error(
        `MarketsEngine.withdrawStock: ${marketId} holds ${state.inventoryUnits} of ${goodId}, not ${units}`,
      );
    }
    return this.replaceGood(marketId, goodId, {
      ...state,
      inventoryUnits: state.inventoryUnits - units,
    });
  }

  setLandedCost(marketId: string, goodId: string, cost: Money): MarketRecord {
    this.scope.assertOwner("markets");
    const market = this.requireMarket(marketId, "setLandedCost");
    requireMarketCurrency(cost, market, "setLandedCost");
    const state = this.requireGoodState(marketId, goodId, "setLandedCost");
    return this.replaceGood(marketId, goodId, { ...state, landedCost: cost });
  }

  setTransportCost(marketId: string, goodId: string, cost: Money): MarketRecord {
    this.scope.assertOwner("markets");
    const market = this.requireMarket(marketId, "setTransportCost");
    requireMarketCurrency(cost, market, "setTransportCost");
    const state = this.requireGoodState(marketId, goodId, "setTransportCost");
    return this.replaceGood(marketId, goodId, { ...state, transportCostPerUnit: cost });
  }

  /** Tax is law (System 41/39); the market applies it to the price it forms. */
  setTax(marketId: string, goodId: string, basisPoints: number): MarketRecord {
    this.scope.assertOwner("markets");
    requireBasisPoints(basisPoints, "setTax");
    const state = this.requireGoodState(marketId, goodId, "setTax");
    return this.replaceGood(marketId, goodId, { ...state, taxBasisPoints: basisPoints });
  }

  /** Regulation can cap a price; passing `undefined` lifts the ceiling. */
  setPriceCeiling(marketId: string, goodId: string, ceiling?: Money): MarketRecord {
    this.scope.assertOwner("markets");
    const market = this.requireMarket(marketId, "setPriceCeiling");
    if (ceiling !== undefined) requireMarketCurrency(ceiling, market, "setPriceCeiling");
    const state = this.requireGoodState(marketId, goodId, "setPriceCeiling");
    return this.replaceGood(marketId, goodId, { ...state, priceCeiling: ceiling });
  }

  setExpectedPrice(marketId: string, goodId: string, price?: Money): MarketRecord {
    this.scope.assertOwner("markets");
    const market = this.requireMarket(marketId, "setExpectedPrice");
    if (price !== undefined) requireMarketCurrency(price, market, "setExpectedPrice");
    const state = this.requireGoodState(marketId, goodId, "setExpectedPrice");
    return this.replaceGood(marketId, goodId, { ...state, expectedPrice: price });
  }

  /** Entry and exit: competitors can appear and leave a local market. */
  addParticipant(
    marketId: string,
    sellerId: string,
    goodIds: readonly string[],
    shareOfSupply: number,
    at: WorldTime,
  ): MarketRecord {
    this.scope.assertOwner("markets");
    const market = this.requireMarket(marketId, "addParticipant");
    requireRatio(shareOfSupply, "shareOfSupply", "addParticipant");
    if (!this.knownBusiness(sellerId)) {
      throw new Error(
        `MarketsEngine.addParticipant: ${sellerId} is not a registered business (System 33)`,
      );
    }
    const active = market.participants.filter((entry) => entry.leftAt === undefined);
    if (active.some((entry) => entry.sellerId === sellerId)) {
      throw new Error(`MarketsEngine.addParticipant: ${sellerId} already trades in ${marketId}`);
    }
    const declaredShare =
      active.reduce((total, entry) => total + entry.shareOfSupply, 0) + shareOfSupply;
    if (declaredShare > 1.000_001) {
      throw new Error(
        `MarketsEngine.addParticipant: seller shares of ${marketId} would exceed 1 (${declaredShare})`,
      );
    }
    const participants: MarketParticipant[] = [
      // The previous record of a seller who left is kept: market history.
      ...market.participants,
      { sellerId, goodIds: [...goodIds], shareOfSupply, joinedAt: at },
    ];
    return this.replaceMarket({ ...market, participants });
  }

  /** A seller leaves; the entry is closed rather than deleted. */
  removeParticipant(marketId: string, sellerId: string, at: WorldTime): MarketRecord {
    this.scope.assertOwner("markets");
    const market = this.requireMarket(marketId, "removeParticipant");
    let found = false;
    const participants = market.participants.map((entry) => {
      if (entry.sellerId !== sellerId || entry.leftAt !== undefined) return entry;
      found = true;
      return { ...entry, leftAt: at };
    });
    if (!found) {
      throw new Error(`MarketsEngine.removeParticipant: ${sellerId} does not trade in ${marketId}`);
    }
    return this.replaceMarket({ ...market, participants });
  }

  /** Structure changes: a merger, a cartel breaking up, a market being regulated. */
  setStructure(marketId: string, structure: MarketStructure): MarketRecord {
    this.scope.assertOwner("markets");
    if (!MARKET_STRUCTURES.includes(structure)) {
      throw new Error(`MarketsEngine.setStructure: unknown structure ${String(structure)}`);
    }
    const market = this.requireMarket(marketId, "setStructure");
    return this.replaceMarket({ ...market, structure });
  }

  // ------------------------------------------------------------- derived ---

  /** The price this market would quote right now, with the drivers behind it. */
  quote(marketId: string, goodId: string): PriceQuote {
    const market = this.requireMarket(marketId, "quote");
    return formPrice(
      this.formationInputs(market.structure, this.requireGoodState(marketId, goodId, "quote")),
    );
  }

  /**
   * Forms the price and publishes it: the market's authoritative price, with the
   * reason kept in its history so a price change can always be explained
   * (System 59).
   */
  publishPrice(
    marketId: string,
    goodId: string,
    at: WorldTime,
  ): { readonly market: MarketRecord; readonly quote: PriceQuote } {
    this.scope.assertOwner("markets");
    const market = this.requireMarket(marketId, "publishPrice");
    const state = this.requireGoodState(marketId, goodId, "publishPrice");
    const quote = formPrice(this.formationInputs(market.structure, state));
    const updated = this.replaceGood(marketId, goodId, {
      ...state,
      price: quote.price,
      priceHistory: [
        ...state.priceHistory,
        { at, minorUnits: quote.price.minorUnits, reason: quote.reason },
      ],
    });
    return { market: updated, quote };
  }

  /** Units a buyer could obtain now: what is on the shelf plus what can arrive. */
  availability(marketId: string, goodId: string): number {
    return availableUnits(this.requireGoodState(marketId, goodId, "availability"));
  }

  /** Demand over availability. Above 1 is a shortage, below 1 a surplus. */
  scarcity(marketId: string, goodId: string): number {
    return scarcityRatio(this.requireGoodState(marketId, goodId, "scarcity"));
  }

  snapshot(marketId: string, goodId: string): MarketSnapshot {
    const quote = this.quote(marketId, goodId);
    const state = this.requireGoodState(marketId, goodId, "snapshot");
    return {
      marketId,
      goodId,
      quote,
      published: state.price,
      available: availableUnits(state),
      scarcity: scarcityRatio(state),
    };
  }

  /** Sellers currently listing a good in this market (System 35 competition). */
  competitorsFor(marketId: string, goodId: string): readonly MarketParticipant[] {
    const market = this.requireMarket(marketId, "competitorsFor");
    return market.participants.filter(
      (entry) => entry.leftAt === undefined && entry.goodIds.includes(goodId),
    );
  }

  /** Largest share among the sellers listing a good: 1 is one seller, 0 none. */
  concentrationFor(marketId: string, goodId: string): number {
    return this.competitorsFor(marketId, goodId).reduce(
      (top, entry) => (entry.shareOfSupply > top ? entry.shareOfSupply : top),
      0,
    );
  }

  /** Goods the market cannot meet demand for, worst first (ties by good id). */
  shortages(marketId: string): readonly { readonly goodId: string; readonly scarcity: number }[] {
    const market = this.requireMarket(marketId, "shortages");
    return market.goods
      .map((state) => ({ goodId: state.goodId, scarcity: scarcityRatio(state) }))
      .filter((entry) => entry.scarcity > 1)
      .sort((a, b) =>
        b.scarcity === a.scarcity ? (a.goodId < b.goodId ? -1 : 1) : b.scarcity - a.scarcity,
      );
  }

  /** Goods sitting unsold, scarcest first (ties by good id). */
  surpluses(marketId: string): readonly { readonly goodId: string; readonly scarcity: number }[] {
    const market = this.requireMarket(marketId, "surpluses");
    return market.goods
      .map((state) => ({ goodId: state.goodId, scarcity: scarcityRatio(state) }))
      .filter((entry) => entry.scarcity < 1)
      .sort((a, b) =>
        a.scarcity === b.scarcity ? (a.goodId < b.goodId ? -1 : 1) : a.scarcity - b.scarcity,
      );
  }

  /**
   * Records an exchange the market made. The money side is System 25's: the
   * transaction keeps a reference to the ledger entry that settled it rather
   * than restating the transfer.
   */
  recordTransaction(
    ids: IdAllocator,
    request: RecordTransactionRequest,
    at: WorldTime,
  ): MarketTransaction {
    this.scope.assertOwner("markets");
    const market = this.requireMarket(request.marketId, "recordTransaction");
    const state = this.requireGoodState(request.marketId, request.goodId, "recordTransaction");
    requirePositiveUnits(request.units, "units", "recordTransaction");
    const unitPrice = request.unitPrice ?? state.price;
    requireMarketCurrency(unitPrice, market, "recordTransaction");

    // In every structure except an informal one, a sale is made by a seller the
    // market knows: a market cannot invent a participant for one transaction.
    const sellerListed =
      market.structure === "informal" ||
      market.participants.some(
        (entry) =>
          entry.sellerId === request.sellerId &&
          entry.leftAt === undefined &&
          entry.goodIds.includes(request.goodId),
      );
    if (!sellerListed) {
      throw new Error(
        `MarketsEngine.recordTransaction: ${request.sellerId} is not a seller of ${request.goodId} in ${market.id}`,
      );
    }
    if (state.inventoryUnits < request.units) {
      throw new Error(
        `MarketsEngine.recordTransaction: ${market.id} holds ${state.inventoryUnits} of ${request.goodId}, not ${request.units}`,
      );
    }

    const transaction: MarketTransaction = {
      id: `mkt-tx-${ids.next("activity")}`,
      marketId: market.id,
      goodId: request.goodId,
      sellerId: request.sellerId,
      buyerId: request.buyerId,
      units: request.units,
      unitPrice,
      at,
      ledgerEntryId: request.ledgerEntryId,
    };
    this.replaceGood(market.id, request.goodId, {
      ...state,
      inventoryUnits: state.inventoryUnits - request.units,
    });
    this.state = { ...this.state, transactions: [...this.state.transactions, transaction] };
    return transaction;
  }
}

// --------------------------------------------------------------- guards ---

function requireUnits(value: number, field: string, caller: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `MarketsEngine.${caller}: ${field} must be a non-negative number, received ${String(value)}`,
    );
  }
}

function requirePositiveUnits(value: number, field: string, caller: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `MarketsEngine.${caller}: ${field} must be a positive integer, received ${String(value)}`,
    );
  }
}

function requireRatio(value: number, field: string, caller: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`MarketsEngine.${caller}: ${field} must be in [0, 1], received ${String(value)}`);
  }
}

function requireBasisPoints(value: number, caller: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error(
      `MarketsEngine.${caller}: basisPoints must be an integer in [0, 10000], received ${String(value)}`,
    );
  }
}

function requireMarketCurrency(value: Money, market: MarketRecord, caller: string): void {
  if (value.currency !== market.currency) {
    throw new Error(
      `MarketsEngine.${caller}: ${market.id} trades in ${market.currency}, not ${value.currency}`,
    );
  }
}
