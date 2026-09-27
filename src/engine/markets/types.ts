/**
 * System 35 — Markets / Prices & Competition.
 *
 * "Markets coordinate distributed decisions under incomplete information and
 * constraints" (System 35 core principle). The system owns exchange
 * environments: what is on offer where, what it costs, who is competing, and
 * how the price was arrived at.
 *
 * Two boundaries matter and are enforced here:
 *
 *   1. **Prices are formed from stated inputs, never invented.** `formPrice`
 *      takes landed cost, inventory, supply, demand, structure, transport,
 *      tax, expectation and regulation, weights each one, and returns the
 *      result *plus its drivers* — so a price can always be explained
 *      (System 59) rather than asserted.
 *   2. **The market does not decide for people.** System 35 explicitly routes
 *      consumer choice through NPC Decision (System 17) "rather than a
 *      universal market score", so this module publishes quotes, availability
 *      and competition structure, and stops there.
 */

import type { Money } from "../primitives/money.ts";
import type { CurrencyId } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";

/** Market structures named by System 35 (model). */
export const MARKET_STRUCTURES = [
  "competitive",
  "monopoly",
  "oligopoly",
  "regulated",
  "local",
  "informal",
] as const;
export type MarketStructure = (typeof MARKET_STRUCTURES)[number];

/**
 * How each structure shifts price away from cost (provisional; see
 * docs/CONTENT_GAPS.md). Read as: a monopoly can hold a 35% premium over an
 * equally-costed competitive market.
 */
export const STRUCTURE_PRICE_FACTOR: Readonly<Record<MarketStructure, number>> = {
  competitive: 1,
  local: 1.05,
  informal: 1.1,
  oligopoly: 1.15,
  regulated: 0.95,
  monopoly: 1.35,
};

/** Price formation constants (provisional). */
export const PRICE_FORMATION = {
  /** How strongly a 1-unit scarcity gap moves the price. */
  scarcitySensitivity: 0.5,
  /** How much a stated expectation pulls the formed price toward itself. */
  expectationWeight: 0.25,
  /** Scarcity is clamped so one missing delivery cannot mint a 100x price. */
  minScarcity: 0.25,
  maxScarcity: 4,
} as const;

/** A good or service a market trades. Content authors these. */
export interface GoodDefinition {
  /** Stable slug, e.g. "GOOD-BREAD-LOAF". */
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  /** Grouping slug ("staples", "services"); used for competition queries. */
  readonly category: string;
  /** Reference production cost; a market never prices below this plus transport. */
  readonly baseCost: Money;
  readonly provisional?: boolean;
  readonly note?: string;
}

/** One seller's presence in a market (System 35 competition structure). */
export interface MarketParticipant {
  /** The business's organization id (System 32/33); the market does not own it. */
  readonly sellerId: string;
  /** Goods this seller lists *in this market* (its own offerings stay in System 33). */
  readonly goodIds: readonly string[];
  /** Share of local supply, 0..1. Concentration is derived from these. */
  readonly shareOfSupply: number;
  readonly joinedAt: WorldTime;
  readonly leftAt?: WorldTime;
}

/** One good's state inside one market. */
export interface MarketGoodState {
  readonly goodId: string;
  /** Units the market can actually sell now (System 29 owns item truth). */
  readonly inventoryUnits: number;
  /** Units suppliers offered this window. */
  readonly supplyUnits: number;
  /** Units buyers sought this window. */
  readonly demandUnits: number;
  /** Production cost plus what it took to get the good here. */
  readonly landedCost: Money;
  /** Per-unit transport cost, kept separate so the driver is visible. */
  readonly transportCostPerUnit: Money;
  /** Tax in basis points (System 41/39 set the law; the market applies it). */
  readonly taxBasisPoints: number;
  /** A ceiling imposed by regulation, when one exists. */
  readonly priceCeiling?: Money;
  /** What traders expect the price to be; pulls, never dictates. */
  readonly expectedPrice?: Money;
  /** The last price this market published, with its history. */
  readonly price: Money;
  readonly priceHistory: readonly PriceChange[];
}

export interface PriceChange {
  readonly at: WorldTime;
  readonly minorUnits: number;
  readonly reason: string;
}

/** A market is local: it lives at a place and can stay fragmented from others. */
export interface MarketRecord {
  readonly id: string;
  readonly name: string;
  readonly locationId: string;
  readonly structure: MarketStructure;
  readonly currency: CurrencyId;
  readonly participants: readonly MarketParticipant[];
  readonly goods: readonly MarketGoodState[];
  readonly provisional?: boolean;
  readonly note?: string;
}

/** One exchange, recorded by the market; the money side is System 25's. */
export interface MarketTransaction {
  readonly id: string;
  readonly marketId: string;
  readonly goodId: string;
  readonly sellerId: string;
  readonly buyerId: string;
  readonly units: number;
  readonly unitPrice: Money;
  readonly at: WorldTime;
  /** The System 25 ledger entry that settled it, when one exists. */
  readonly ledgerEntryId?: string;
}

/** Which input moved a price, and by how much. */
export type PriceDriverKind =
  | "landed_cost"
  | "transport"
  | "scarcity"
  | "structure"
  | "tax"
  | "expectation"
  | "ceiling";

export interface PriceDriver {
  readonly driver: PriceDriverKind;
  readonly detail: string;
  /** Contribution to the formed price, in minor units (may be negative). */
  readonly minorUnits: number;
}

export interface PriceQuote {
  readonly goodId: string;
  readonly price: Money;
  /** The reference price before scarcity and structure were applied. */
  readonly basePrice: Money;
  readonly scarcity: number;
  readonly reason: string;
  readonly drivers: readonly PriceDriver[];
}

export interface MarketsSystemState {
  readonly goods: readonly GoodDefinition[];
  readonly markets: readonly MarketRecord[];
  readonly transactions: readonly MarketTransaction[];
}
