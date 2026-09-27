/**
 * Provisional B2B content for the Arden slice (M5 / System 34).
 *
 * The World Bible authors Arden as a working port — grain moves from the
 * basin to the mills, bread moves from the mills to the quay, and the docks
 * handle everything that arrives or leaves — but names no trading
 * relationships (deferred canon). This module writes down the *structure* of
 * that trade as System 34 sees it: who can supply what (offers with lead
 * times and capacity) and who depends on whom (standing requirements).
 *
 * No price is invented here beyond the same reference costs System 33/35
 * already use, no delivery is scripted, and every relationship that already
 * exists in `businesses.ts` (`supplierIds`, `customerIds`) is mirrored
 * rather than contradicted. Every record is provisional; nothing is canon.
 */

import type {
  DefineDependencyRequest,
  SupplyChainsEngine,
} from "../../engine/supplyChains/engine.ts";
import type { SupplierOffer } from "../../engine/supplyChains/types.ts";
import type { EntityId } from "../../engine/primitives/ids.ts";
import { currencyId, money } from "../../engine/primitives/money.ts";
import type { WorldTime } from "../../engine/primitives/time.ts";
import { AURELIA_CURRENCY } from "./countries.ts";

const AUR = currencyId(AURELIA_CURRENCY.code);
const aur = (major: number): number => Math.round(major * 100);

const PROVISIONAL_NOTE =
  "Provisional: the World Bible authors no trading relationships or delivery terms (M5/S34 gap list).";

export const AURELIA_SLICE_OFFER_COUNT = 5;
export const AURELIA_SLICE_DEPENDENCY_COUNT = 5;

const org = (id: string): EntityId<"organization"> => id as EntityId<"organization">;

/**
 * What the slice's businesses can deliver B2B. Terms mirror the reference
 * costs in `businesses.ts` / `markets.ts`; lead times reflect the authored
 * operations (the coop grades and sacks daily, the bakery bakes overnight,
 * the docks work the tide).
 */
export function aureliaArdenSupplierOffers(): readonly SupplierOffer[] {
  return [
    {
      supplierId: org("ORG-GRAIN-BASIN-COOP"),
      inputId: "GOOD-GRAIN-SACK",
      unitPrice: money(AUR, aur(18)),
      leadTimeDays: 1,
      capacityUnits: 400,
      quality: 0.8,
      reputation: 0.7,
      distanceKm: 8,
      switchingCost: money(AUR, aur(2_500)),
    },
    {
      supplierId: org("ORG-GRAIN-BASIN-COOP"),
      inputId: "GOOD-PRODUCE-CRATE",
      unitPrice: money(AUR, aur(24)),
      leadTimeDays: 1,
      capacityUnits: 60,
      quality: 0.6,
      reputation: 0.7,
      distanceKm: 8,
      switchingCost: money(AUR, aur(300)),
    },
    {
      supplierId: org("ORG-ARDEN-MILL-BAKERY"),
      inputId: "GOOD-BREAD-LOAF",
      unitPrice: money(AUR, aur(0.55)),
      leadTimeDays: 1,
      capacityUnits: 300,
      quality: 0.85,
      reputation: 0.75,
      distanceKm: 2,
      switchingCost: money(AUR, aur(500)),
    },
    {
      supplierId: org("ORG-ARDIN-DOCKS"),
      inputId: "GOOD-STEVEDORE-SHIFT",
      unitPrice: money(AUR, aur(120)),
      leadTimeDays: 0,
      capacityUnits: 60,
      quality: 0.9,
      reputation: 0.8,
      distanceKm: 1,
      switchingCost: money(AUR, aur(1_000)),
    },
    {
      supplierId: org("ORG-ARDIN-DOCKS"),
      inputId: "GOOD-BONDED-STORAGE",
      unitPrice: money(AUR, aur(0.4)),
      leadTimeDays: 0,
      capacityUnits: 800,
      quality: 0.85,
      reputation: 0.8,
      distanceKm: 1,
      switchingCost: money(AUR, aur(400)),
    },
  ].map((offer) => ({ ...offer, note: PROVISIONAL_NOTE }));
}

/**
 * Standing buyer requirements, mirroring the `supplierIds`/`customerIds`
 * already authored in `businesses.ts` — the coop ships through the docks,
 * the mill bakery buys basin grain, the cafe buys the bakery's bread and
 * Fenwick's stall takes the coop's marked-down crates. Nothing here
 * contradicts System 33; it restates that trade as a dependency graph.
 */
export function aureliaArdenSupplyDependencies(): readonly DefineDependencyRequest[] {
  return [
    {
      id: "DEP-COOP-STEVEDORE",
      buyerId: org("ORG-GRAIN-BASIN-COOP"),
      inputId: "GOOD-STEVEDORE-SHIFT",
      supplierId: org("ORG-ARDIN-DOCKS"),
      requiredUnits: 40,
    },
    {
      id: "DEP-COOP-STORAGE",
      buyerId: org("ORG-GRAIN-BASIN-COOP"),
      inputId: "GOOD-BONDED-STORAGE",
      supplierId: org("ORG-ARDIN-DOCKS"),
      requiredUnits: 300,
    },
    {
      id: "DEP-BAKERY-GRAIN",
      buyerId: org("ORG-ARDEN-MILL-BAKERY"),
      inputId: "GOOD-GRAIN-SACK",
      supplierId: org("ORG-GRAIN-BASIN-COOP"),
      requiredUnits: 150,
    },
    {
      id: "DEP-FENWICK-PRODUCE",
      buyerId: org("ORG-FENWICK-STALL"),
      inputId: "GOOD-PRODUCE-CRATE",
      supplierId: org("ORG-GRAIN-BASIN-COOP"),
      requiredUnits: 25,
    },
    {
      id: "DEP-CAFE-BREAD",
      buyerId: org("ORG-QUAY-CAFE"),
      inputId: "GOOD-BREAD-LOAF",
      supplierId: org("ORG-ARDEN-MILL-BAKERY"),
      requiredUnits: 200,
    },
  ];
}

/**
 * Registers the slice's supply network. Idempotent: existing offers and
 * dependencies are left untouched, so re-seeding never duplicates commerce
 * and never rewrites terms that may have changed in play.
 */
export function registerAureliaSupplyChains(
  engine: SupplyChainsEngine,
  now: WorldTime,
): { readonly offers: number; readonly dependencies: number } {
  let offers = 0;
  for (const offer of aureliaArdenSupplierOffers()) {
    if (engine.offer(offer.supplierId, offer.inputId) !== undefined) continue;
    engine.defineOffer(offer);
    offers += 1;
  }
  let dependencies = 0;
  for (const dependency of aureliaArdenSupplyDependencies()) {
    if (engine.dependency(dependency.id) !== undefined) continue;
    engine.defineDependency(dependency, now);
    dependencies += 1;
  }
  return { offers, dependencies };
}

