/**
 * Provisional commercial content for the Arden slice (M5 / System 33).
 *
 * The World Bible authors Arden as a working port with docks, quays, mills and
 * markets, but deliberately names no companies, banks or traders ("named
 * companies and institutions" is listed as deferred canon). So, exactly as the
 * M4 infrastructure content did, this module does two honest things:
 *
 *   1. it gives the playable slice real businesses — each an Organization Core
 *      actor (System 32) with a commercial side (System 33): docks, a quay
 *      cafe, a mill bakery, a grain cooperative and a quay trader — so
 *      employment, supply chains, markets and macro aggregates have something
 *      real to be about;
 *   2. it leaves the remaining 33 settlements' commerce unauthored rather than
 *      inventing hundreds of firms, and says so in docs/CONTENT_GAPS.md.
 *
 * Every record is flagged `provisional`, and nothing here is canon.
 */

import type { CreateOrganizationRequest, OrganizationsEngine } from "../../engine/organizations/engine.ts";
import type { BusinessesEngine, RegisterBusinessRequest } from "../../engine/businesses/engine.ts";
import type { EntityId, IdAllocator } from "../../engine/primitives/ids.ts";
import { currencyId, money } from "../../engine/primitives/money.ts";
import { entityRef } from "../../engine/primitives/entity.ts";
import type { WorldTime } from "../../engine/primitives/time.ts";
import { AURELIA_CURRENCY } from "./countries.ts";

/** The one provisional currency Money uses until a currency pack exists (M5). */
export const AURELIA_CURRENCY_ID = currencyId(AURELIA_CURRENCY.code);

const AUR = AURELIA_CURRENCY_ID;
/** Provisional: 1 AUR = 100 minor units (see countries.ts). */
const aur = (major: number): number => Math.round(major * 100);

/** One slice business: the Organization Core actor plus its commercial side. */
export interface SliceBusinessSeed {
  readonly organization: CreateOrganizationRequest & { readonly id: EntityId<"organization"> };
  readonly business: RegisterBusinessRequest & { readonly id: string };
}

export const AURELIA_SLICE_BUSINESS_COUNT = 5;

const PROVISIONAL_NOTE =
  "Provisional: the World Bible names no companies or traders (M5/S33 section 2 gap list).";

/** The slice's businesses, in dependency order (suppliers precede dependents). */
export function aureliaArdenBusinessSeeds(settlementId: string): readonly SliceBusinessSeed[] {
  const at = (id: string) => entityRef("settlement", id as EntityId<"settlement">);
  return [
    {
      organization: {
        id: "ORG-GRAIN-BASIN-COOP" as EntityId<"organization">,
        legalName: "Ardan Basin Grain Cooperative",
        commonName: "Basin Grain",
        type: "cooperative",
        legalStatus: "cooperative",
        locationIds: [at(settlementId)],
        policies: ["member_share_payouts", "open_membership"],
        goals: ["keep basin growers solvent"],
      },
      business: {
        id: "ORG-GRAIN-BASIN-COOP",
        organizationId: "ORG-GRAIN-BASIN-COOP" as EntityId<"organization">,
        form: "cooperative",
        sector: "agriculture_wholesale",
        locationIds: [at(settlementId)],
        offerings: [
          {
            id: "OFFER-BASIN-GRAIN-SACK",
            name: "Sack of basin grain",
            kind: "good",
            unit: "sack",
            unitCost: money(AUR, aur(18)),
            unitsPerStaffHour: 3,
          },
        ],
        capacity: { staffing: 0.88, equipment: 0.8, space: 0.7, capital: 0.62, inventory: 0.9, supply: 0.95, time: 0.9 },
        workforceTarget: 45,
        strategy: ["sell to local millers first"],
        operations: ["buy from member growers", "grade and sack", "deliver to mills"],
        provisional: true,
        note: PROVISIONAL_NOTE,
      },
    },
    {
      organization: {
        id: "ORG-ARDEN-MILL-BAKERY" as EntityId<"organization">,
        legalName: "Arden Mill Bakery",
        commonName: "the Mill Bakery",
        type: "commercial",
        legalStatus: "sole_trader",
        locationIds: [at(settlementId)],
        goals: ["keep the ovens running through winter"],
      },
      business: {
        id: "ORG-ARDEN-MILL-BAKERY",
        organizationId: "ORG-ARDEN-MILL-BAKERY" as EntityId<"organization">,
        form: "soleProprietorship",
        sector: "food_production",
        locationIds: [at(settlementId)],
        offerings: [
          {
            id: "OFFER-MILL-BAKERY-LOAF",
            name: "Mill bakery loaf",
            kind: "good",
            unit: "loaf",
            unitCost: money(AUR, aur(0.55)),
            unitsPerStaffHour: 40,
          },
        ],
        capacity: { staffing: 0.9, equipment: 0.65, space: 0.8, capital: 0.6, inventory: 0.7, supply: 0.75, time: 0.9 },
        supplierIds: ["ORG-GRAIN-BASIN-COOP" as EntityId<"organization">],
        workforceTarget: 12,
        strategy: ["buy basin grain on standing contracts"],
        operations: ["mill", "bake overnight", "sell from the shop at dawn"],
        provisional: true,
        note: PROVISIONAL_NOTE,
      },
    },
    {
      organization: {
        id: "ORG-ARDIN-DOCKS" as EntityId<"organization">,
        legalName: "Arden Docks & Stevedoring Company",
        commonName: "the Docks",
        type: "commercial",
        legalStatus: "chartered",
        locationIds: [at(settlementId)],
        policies: ["harbour_safety_rules", "shift_rotation"],
        goals: ["keep the berths clear"],
      },
      business: {
        id: "ORG-ARDIN-DOCKS",
        organizationId: "ORG-ARDIN-DOCKS" as EntityId<"organization">,
        form: "corporation",
        sector: "freight_handling",
        locationIds: [at(settlementId)],
        offerings: [
          {
            id: "OFFER-ARDIN-DOCKS-STEVEDORE-SHIFT",
            name: "Stevedore gang shift",
            kind: "service",
            unit: "shift",
            unitCost: money(AUR, aur(120)),
          },
          {
            id: "OFFER-ARDIN-DOCKS-BONDED-STORAGE",
            name: "Bonded storage",
            kind: "service",
            unit: "tonne-day",
            unitCost: money(AUR, aur(0.4)),
            unitsPerStaffHour: 12,
          },
        ],
        capacity: { staffing: 0.82, equipment: 0.9, space: 0.75, capital: 0.7, inventory: 0.85, supply: 0.8, time: 0.95 },
        customerIds: ["ORG-GRAIN-BASIN-COOP" as EntityId<"organization">],
        workforceTarget: 140,
        strategy: ["price by berth-hour", "keep two gangs on call"],
        operations: ["load and unload", "bonded storage", "harbour pilotage"],
        provisional: true,
        note: PROVISIONAL_NOTE,
      },
    },
    {
      organization: {
        id: "ORG-QUAY-CAFE" as EntityId<"organization">,
        legalName: "The Quay Cafe",
        commonName: "the Quay Cafe",
        type: "commercial",
        legalStatus: "sole_trader",
        locationIds: [at(settlementId)],
        policies: ["cash_upfront_for_strangers"],
      },
      business: {
        id: "ORG-QUAY-CAFE",
        organizationId: "ORG-QUAY-CAFE" as EntityId<"organization">,
        form: "soleProprietorship",
        sector: "food_service",
        locationIds: [at(settlementId)],
        offerings: [
          {
            id: "OFFER-QUAY-CAFE-ESPRESSO",
            name: "Espresso",
            kind: "good",
            unit: "cup",
            unitCost: money(AUR, aur(0.09)),
            unitsPerStaffHour: 24,
          },
          {
            id: "OFFER-QUAY-CAFE-PLATE-MEAL",
            name: "Plate meal",
            kind: "good",
            unit: "dish",
            unitCost: money(AUR, aur(4.2)),
            unitsPerStaffHour: 6,
          },
        ],
        capacity: { staffing: 0.6, equipment: 0.85, space: 0.8, capital: 0.55, inventory: 0.7, supply: 0.75, time: 0.9 },
        supplierIds: ["ORG-ARDEN-MILL-BAKERY" as EntityId<"organization">],
        workforceTarget: 8,
        strategy: ["open before the dock gangs start"],
        operations: ["buy bread at dawn", "serve at the counter", "close mid-afternoon"],
        provisional: true,
        note: PROVISIONAL_NOTE,
      },
    },
    {
      organization: {
        id: "ORG-FENWICK-STALL" as EntityId<"organization">,
        legalName: "Fenwick's Quay Stall",
        commonName: "Fenwick's stall",
        type: "informal",
        legalStatus: "unregistered",
        locationIds: [at(settlementId)],
      },
      business: {
        id: "ORG-FENWICK-STALL",
        organizationId: "ORG-FENWICK-STALL" as EntityId<"organization">,
        form: "informal",
        sector: "retail_trade",
        locationIds: [at(settlementId)],
        offerings: [
          {
            id: "OFFER-FENWICK-PRODUCE-CRATE",
            name: "Produce crate",
            kind: "good",
            unit: "crate",
            unitCost: money(AUR, aur(24)),
            unitsPerStaffHour: 2,
          },
        ],
        capacity: { staffing: 0.5, equipment: 0.45, space: 0.4, capital: 0.35, inventory: 0.5, supply: 0.55, time: 0.7 },
        supplierIds: ["ORG-GRAIN-BASIN-COOP" as EntityId<"organization">],
        workforceTarget: 2,
        strategy: ["sell what the coop cannot move"],
        operations: ["buy marked-down crates", "trade from the quay wall"],
        provisional: true,
        note: PROVISIONAL_NOTE,
      },
    },
  ];
}

/**
 * Registers the slice's business organizations. Idempotent: an existing record
 * is left untouched, so re-seeding a world never duplicates commerce.
 */
export function registerAureliaBusinessOrganizations(
  ids: IdAllocator,
  organizations: OrganizationsEngine,
  settlementId: string,
  now: WorldTime,
): readonly EntityId<"organization">[] {
  const created: EntityId<"organization">[] = [];
  for (const seed of aureliaArdenBusinessSeeds(settlementId)) {
    if (organizations.get(seed.organization.id) !== undefined) continue;
    organizations.create(ids, seed.organization, now);
    created.push(seed.organization.id);
  }
  return created;
}

/**
 * Registers the commercial side of each slice business (System 33 over System
 * 32). Requires the organizations to exist: a business whose organization is
 * missing would be incoherent, so `register` throws instead of guessing.
 * Idempotent, so re-seeding is a no-op.
 */
export function registerAureliaBusinesses(
  businesses: BusinessesEngine,
  settlementId: string,
  now: WorldTime,
): readonly string[] {
  const registered: string[] = [];
  for (const seed of aureliaArdenBusinessSeeds(settlementId)) {
    if (businesses.business(seed.business.id) !== undefined) continue;
    businesses.register(seed.business, now);
    registered.push(seed.business.id);
  }
  return registered;
}
