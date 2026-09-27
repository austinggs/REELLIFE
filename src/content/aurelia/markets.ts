/**
 * Provisional market content for the Arden slice (M5 / System 35).
 *
 * The World Bible gives Arden quays, mills, a basin grain trade and port work,
 * but authors no price lists and no named exchanges (deferred canon). So this
 * module authors the *inputs* a market needs — a goods catalogue with reference
 * production costs, and three local markets with stock, supply, demand,
 * transport, tax and regulation — and lets `formPrice` compute every price.
 *
 * No price is written down here on purpose: a price that is typed in by hand
 * cannot be explained, and System 35 requires prices to come from supply,
 * demand, cost, competition, tax and regulation.
 *
 * Every record is flagged `provisional`, and nothing here is canon.
 */

import type { MarketsEngine, RegisterMarketRequest } from "../../engine/markets/engine.ts";
import type { GoodDefinition } from "../../engine/markets/types.ts";
import { currencyId, money } from "../../engine/primitives/money.ts";
import type { WorldTime } from "../../engine/primitives/time.ts";
import { AURELIA_CURRENCY } from "./countries.ts";

const AUR = currencyId(AURELIA_CURRENCY.code);
const aur = (major: number): number => Math.round(major * 100);

const PROVISIONAL_NOTE =
  "Provisional: the World Bible authors no prices, goods lists or named exchanges (M5/S35 gap list).";

export const AURELIA_SLICE_GOOD_COUNT = 7;
export const AURELIA_SLICE_MARKET_COUNT = 3;

/** The slice's tradable goods, with reference production costs. */
export function aureliaGoods(): readonly GoodDefinition[] {
  return [
    {
      id: "GOOD-BREAD-LOAF",
      name: "Mill bakery loaf",
      unit: "loaf",
      category: "staples",
      baseCost: money(AUR, aur(0.55)),
      provisional: true,
      note: PROVISIONAL_NOTE,
    },
    {
      id: "GOOD-GRAIN-SACK",
      name: "Sack of basin grain",
      unit: "sack",
      category: "raw_material",
      baseCost: money(AUR, aur(18)),
      provisional: true,
      note: PROVISIONAL_NOTE,
    },
    {
      id: "GOOD-ESPRESSO",
      name: "Espresso",
      unit: "cup",
      category: "refreshment",
      baseCost: money(AUR, aur(0.09)),
      provisional: true,
      note: PROVISIONAL_NOTE,
    },
    {
      id: "GOOD-PLATE-MEAL",
      name: "Plate meal",
      unit: "dish",
      category: "prepared_food",
      baseCost: money(AUR, aur(4.2)),
      provisional: true,
      note: PROVISIONAL_NOTE,
    },
    {
      id: "GOOD-PRODUCE-CRATE",
      name: "Produce crate",
      unit: "crate",
      category: "produce",
      baseCost: money(AUR, aur(24)),
      provisional: true,
      note: PROVISIONAL_NOTE,
    },
    {
      id: "GOOD-STEVEDORE-SHIFT",
      name: "Stevedore gang shift",
      unit: "shift",
      category: "services",
      baseCost: money(AUR, aur(120)),
      provisional: true,
      note: PROVISIONAL_NOTE,
    },
    {
      id: "GOOD-BONDED-STORAGE",
      name: "Bonded storage",
      unit: "tonne-day",
      category: "services",
      baseCost: money(AUR, aur(0.4)),
      provisional: true,
      note: PROVISIONAL_NOTE,
    },
  ];
}

/**
 * Arden's local markets. Markets stay local and fragmented (System 35): the
 * quay, the mill and the port services each form their own prices, and none of
 * them is a stand-in for a national market.
 */
export function aureliaArdenMarkets(settlementId: string): readonly RegisterMarketRequest[] {
  return [
    {
      id: "MKT-ARDEN-MILL",
      name: "Arden Mill market",
      locationId: settlementId,
      structure: "competitive",
      currency: AUR,
      goods: [
        {
          goodId: "GOOD-BREAD-LOAF",
          inventoryUnits: 900,
          supplyUnits: 600,
          demandUnits: 700,
          landedCost: money(AUR, aur(0.55)),
          transportCostPerUnit: money(AUR, aur(0.05)),
        },
        {
          goodId: "GOOD-GRAIN-SACK",
          inventoryUnits: 40,
          supplyUnits: 60,
          demandUnits: 40,
          landedCost: money(AUR, aur(18)),
          transportCostPerUnit: money(AUR, aur(1.2)),
        },
      ],
      participants: [
        { sellerId: "ORG-ARDEN-MILL-BAKERY", goodIds: ["GOOD-BREAD-LOAF"], shareOfSupply: 0.65 },
        { sellerId: "ORG-GRAIN-BASIN-COOP", goodIds: ["GOOD-GRAIN-SACK"], shareOfSupply: 0.35 },
      ],
      provisional: true,
      note: PROVISIONAL_NOTE,
    },
    {
      id: "MKT-ARDEN-QUAY",
      name: "Arden Quay market",
      locationId: settlementId,
      structure: "local",
      currency: AUR,
      goods: [
        {
          goodId: "GOOD-ESPRESSO",
          inventoryUnits: 400,
          supplyUnits: 300,
          demandUnits: 350,
          landedCost: money(AUR, aur(0.09)),
          transportCostPerUnit: money(AUR, aur(0.01)),
        },
        {
          goodId: "GOOD-PLATE-MEAL",
          inventoryUnits: 60,
          supplyUnits: 40,
          demandUnits: 55,
          landedCost: money(AUR, aur(4.2)),
          transportCostPerUnit: money(AUR, aur(0.15)),
        },
        {
          goodId: "GOOD-PRODUCE-CRATE",
          inventoryUnits: 25,
          supplyUnits: 20,
          demandUnits: 30,
          landedCost: money(AUR, aur(24)),
          transportCostPerUnit: money(AUR, aur(0.9)),
        },
      ],
      participants: [
        {
          sellerId: "ORG-QUAY-CAFE",
          goodIds: ["GOOD-ESPRESSO", "GOOD-PLATE-MEAL"],
          shareOfSupply: 0.7,
        },
        { sellerId: "ORG-FENWICK-STALL", goodIds: ["GOOD-PRODUCE-CRATE"], shareOfSupply: 0.3 },
      ],
      provisional: true,
      note: PROVISIONAL_NOTE,
    },
    {
      id: "MKT-ARDEN-PORT-SERVICES",
      name: "Arden port services market",
      locationId: settlementId,
      // Port work is tariffed, so the structure is regulated rather than a
      // monopoly even though one operator supplies it.
      structure: "regulated",
      currency: AUR,
      goods: [
        {
          goodId: "GOOD-STEVEDORE-SHIFT",
          inventoryUnits: 0,
          supplyUnits: 60,
          demandUnits: 80,
          landedCost: money(AUR, aur(120)),
          taxBasisPoints: 800,
          priceCeiling: money(AUR, aur(160)),
        },
        {
          goodId: "GOOD-BONDED-STORAGE",
          inventoryUnits: 700,
          supplyUnits: 4300,
          demandUnits: 3000,
          landedCost: money(AUR, aur(0.4)),
        },
      ],
      participants: [
        {
          sellerId: "ORG-ARDIN-DOCKS",
          goodIds: ["GOOD-STEVEDORE-SHIFT", "GOOD-BONDED-STORAGE"],
          shareOfSupply: 1,
        },
      ],
      provisional: true,
      note: PROVISIONAL_NOTE,
    },
  ];
}

/** Registers the goods catalogue and the slice's markets. Idempotent. */
export function registerAureliaGoodsAndMarkets(
  engine: MarketsEngine,
  settlementId: string,
  now: WorldTime,
): { readonly goods: number; readonly markets: number } {
  let goods = 0;
  for (const good of aureliaGoods()) {
    if (engine.good(good.id) !== undefined) continue;
    engine.defineGood(good);
    goods += 1;
  }
  let markets = 0;
  for (const request of aureliaArdenMarkets(settlementId)) {
    if (engine.market(request.id) !== undefined) continue;
    engine.defineMarket(request, now);
    markets += 1;
  }
  return { goods, markets };
}
