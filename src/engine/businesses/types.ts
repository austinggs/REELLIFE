/**
 * System 33 — Organizations & Businesses.
 *
 * "A business coordinates people, resources, capital, production, and exchange
 * under uncertainty" (System 33 core principle). It is the *commercial
 * specialization* of Organization Core (System 32), not a second species of
 * actor: a business always has an underlying organization, and this state only
 * ever refers to that organization by id.
 *
 * Three design choices keep the system honest:
 *
 *   1. **Nothing is stored twice.** The roster is derived from System 24's
 *      employment records, revenue and cost flows are derived from System 25's
 *      ledger, price formation belongs to System 35, and ownership rights
 *      belong to System 26. This module holds only what System 33 owns:
 *      commercial form, offerings, capacity dimensions, supplier/customer
 *      references, strategy, operations and business history.
 *   2. **Capacity is a set of named dimensions, not one score.** The spec lists
 *      employees, equipment, space, capital, inventory, supply and time as
 *      separate constraints, so they stay separate and the *binding* constraint
 *      is computed rather than implied.
 *   3. **Failure causes are derived from observable facts — except the ones
 *      that are judgements about people.** `businessFailureSignals` can see
 *      insolvency, low demand, a supply shock, competition, staff loss, a
 *      disaster, regulation, financing and reputation. It deliberately refuses
 *      to infer "poor management" from numbers, because the spec routes
 *      management through "people and organizational decision processes".
 */

import type { EntityId } from "../primitives/ids.ts";
import type { EntityRef } from "../primitives/entity.ts";
import type { Money } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { OrganizationType } from "../primitives/organization.ts";

/**
 * Commercial forms the engine models (System 33 model). Each form maps to the
 * Organization Core type the underlying organization must be registered as, so
 * the two systems cannot disagree about what kind of actor this is.
 */
export const BUSINESS_FORMS = [
  "soleProprietorship",
  "partnership",
  "corporation",
  "cooperative",
  "franchise",
  "informal",
] as const;
export type BusinessForm = (typeof BUSINESS_FORMS)[number];

export const BUSINESS_FORM_ORGANIZATION_TYPE: Readonly<Record<BusinessForm, OrganizationType>> = {
  soleProprietorship: "commercial",
  partnership: "commercial",
  corporation: "commercial",
  cooperative: "cooperative",
  franchise: "commercial",
  informal: "informal",
};

/**
 * Business lifecycle (System 33): idea -> forming -> opening -> active ->
 * expanding -> restructuring -> suspended -> closed.
 */
export const BUSINESS_LIFECYCLE = [
  "idea",
  "forming",
  "opening",
  "active",
  "expanding",
  "restructuring",
  "suspended",
  "closed",
] as const;
export type BusinessLifecycle = (typeof BUSINESS_LIFECYCLE)[number];

/** A business cannot skip its own history. */
export const BUSINESS_LIFECYCLE_TRANSITIONS: Readonly<
  Record<BusinessLifecycle, readonly BusinessLifecycle[]>
> = {
  idea: ["forming", "closed"],
  forming: ["opening", "closed"],
  opening: ["active", "suspended", "closed"],
  active: ["expanding", "restructuring", "suspended", "closed"],
  expanding: ["active", "restructuring", "suspended", "closed"],
  restructuring: ["active", "suspended", "closed"],
  suspended: ["active", "restructuring", "closed"],
  closed: [],
};

/** Lifecycle states in which a business is trading. */
export const TRADING_LIFECYCLES: readonly BusinessLifecycle[] = ["opening", "active", "expanding"];

/** What a business sells (System 33 "products/services", "revenue can come from..."). */
export const OFFERING_KINDS = ["good", "service", "subscription", "license"] as const;
export type OfferingKind = (typeof OFFERING_KINDS)[number];

export interface BusinessOffering {
  /** Authored slug, e.g. "OFFER-ARDIN-DOCKS-STEVEDORE-SHIFT". */
  readonly id: string;
  readonly name: string;
  readonly kind: OfferingKind;
  /** Unit of sale: "shift", "cup", "month", "tonne". */
  readonly unit: string;
  /** What one unit costs the business to deliver (content data, not a market price). */
  readonly unitCost: Money;
  /** Units a fully-utilised business can produce per staffed hour, when modeled. */
  readonly unitsPerStaffHour?: number;
}

/**
 * Capacity is constrained by employees, equipment, space, capital, inventory,
 * supply and time (System 33 model). Each dimension is an independent 0..1
 * fact supplied by the system that owns it, so this state never fabricates it.
 */
export const CAPACITY_DIMENSIONS = [
  "staffing",
  "equipment",
  "space",
  "capital",
  "inventory",
  "supply",
  "time",
] as const;
export type CapacityDimension = (typeof CAPACITY_DIMENSIONS)[number];

export type BusinessCapacity = Readonly<Record<CapacityDimension, number>>;

export interface BindingConstraint {
  readonly dimension: CapacityDimension;
  readonly value: number;
}

/** Failure causes named by System 33. */
export const FAILURE_CAUSES = [
  "insolvency",
  "low_demand",
  "supply_shock",
  "competition",
  "poor_management",
  "disaster",
  "regulation",
  "staff_loss",
  "financing",
  "reputation",
] as const;
export type FailureCause = (typeof FAILURE_CAUSES)[number];

/**
 * Causes that end the business outright; the rest push it into restructuring
 * (System 33's lifecycle has no "failed" state of its own — failure is a cause,
 * not a stage).
 */
export const TERMINAL_FAILURE_CAUSES: readonly FailureCause[] = ["insolvency", "regulation"];

export interface BusinessHistoryEntry {
  readonly at: WorldTime;
  /** Lifecycle state, or "failure:<cause>", "ownership_change", "spinoff"... */
  readonly kind: string;
  readonly note: string;
}

export interface BusinessRecord {
  /** Authored slug or allocated organization id; stable for the business's life. */
  readonly id: string;
  /** The Organization Core actor this business is the commercial side of. */
  readonly organizationId: EntityId<"organization">;
  readonly form: BusinessForm;
  readonly lifecycle: BusinessLifecycle;
  /** Sector slug ("food_service", "freight_handling"); occupations live in System 24. */
  readonly sector: string;
  readonly locationIds: readonly EntityRef[];
  readonly offerings: readonly BusinessOffering[];
  readonly capacity: BusinessCapacity;
  /** Accounts in System 25's ledger belonging to this business. */
  readonly accountIds: readonly EntityId<"account">[];
  readonly supplierIds: readonly EntityId<"organization">[];
  readonly customerIds: readonly EntityId<"organization">[];
  /** Intended headcount; the actual roster is derived from System 24. */
  readonly workforceTarget: number;
  readonly strategy: readonly string[];
  readonly operations: readonly string[];
  readonly foundedAt: WorldTime;
  readonly closedAt?: WorldTime;
  readonly history: readonly BusinessHistoryEntry[];
  /** True when the record is provisional pending canon decisions. */
  readonly provisional?: boolean;
  readonly note?: string;
}

export interface BusinessesSystemState {
  readonly businesses: readonly BusinessRecord[];
}

/** Revenue/cost flow view derived from the ledger (System 25), never stored. */
export interface BusinessCashFlow {
  readonly revenue: Money;
  readonly costs: Money;
  readonly net: Money;
}

/**
 * Observable conditions a business is exposed to. Every field is owned by the
 * system named beside it; the caller supplies them, so this engine can reason
 * about failure without reaching into another system's state.
 */
export interface BusinessConditionInputs {
  /** Spendable cash now (System 25). */
  readonly cash: Money;
  /** Units customers wanted this window (System 35). */
  readonly demandUnits: number;
  /** Units the business was able to supply this window. */
  readonly suppliedUnits: number;
  /** Supplier lead-time compliance, 0..1 (System 34). */
  readonly supplyReliability: number;
  /** Competing businesses offering the same sector locally (System 35). */
  readonly competitorCount: number;
  /** Staffing capacity dimension, 0..1 (System 24/33). */
  readonly staffing: number;
  /** Outstanding restrictions placed by law (System 41). */
  readonly regulatoryRestrictions: readonly string[];
  /** Open disaster impacts at the business's locations (System 46). */
  readonly activeDisasterImpacts: number;
  /** Reputation estimate, 0..1 (System 22). */
  readonly reputation: number;
  /** Days of funding left from financing arrangements (System 25/31). */
  readonly fundingDaysRemaining: number;
}

/** Provisional thresholds for the signals above; see docs/CONTENT_GAPS.md. */
export const FAILURE_THRESHOLDS = {
  /** Demand below this share of supply reads as a demand slump. */
  lowDemandRatio: 0.5,
  supplyReliability: 0.5,
  competitorCount: 4,
  staffing: 0.5,
  reputation: 0.3,
  fundingDaysRemaining: 30,
} as const;

