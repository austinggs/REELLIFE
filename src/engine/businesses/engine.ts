/**
 * Businesses engine (System 33).
 *
 * Owns `systems.businesses`: the commercial state of firms — form, lifecycle,
 * offerings, capacity dimensions, supplier/customer references, strategy,
 * operations and business history. Every write asserts ownership on that slot;
 * reads are scope-free.
 *
 * Nothing here reaches into another system's state. The underlying organization
 * is referenced by id, the roster is *computed* from System 24's employment
 * records, cash flow is *computed* from System 25's ledger, and the conditions
 * that decide failure are passed in by the caller — which is what makes
 * `businessFailureSignals` a derivation rather than an opinion.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { EntityId } from "../primitives/ids.ts";
import type { EntityRef } from "../primitives/entity.ts";
import type { CurrencyId } from "../primitives/money.ts";
import { addMoney, subtractMoney, zeroMoney } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { EmploymentRecord } from "../employment/types.ts";
import type { OrganizationsSystemState } from "../organizations/types.ts";
import type { LedgerEntry } from "../finance/types.ts";
import {
  BUSINESS_FORM_ORGANIZATION_TYPE,
  BUSINESS_LIFECYCLE_TRANSITIONS,
  CAPACITY_DIMENSIONS,
  FAILURE_CAUSES,
  FAILURE_THRESHOLDS,
  TERMINAL_FAILURE_CAUSES,
  TRADING_LIFECYCLES,
  type BindingConstraint,
  type BusinessCapacity,
  type BusinessCashFlow,
  type BusinessConditionInputs,
  type BusinessLifecycle,
  type BusinessOffering,
  type BusinessRecord,
  type BusinessesSystemState,
  type FailureCause,
} from "./types.ts";
import type { Organization } from "../primitives/organization.ts";

/** Fully available on every dimension; the neutral starting point. */
export function fullCapacity(): BusinessCapacity {
  return { staffing: 1, equipment: 1, space: 1, capital: 1, inventory: 1, supply: 1, time: 1 };
}

/** The smallest dimension decides what the business can actually do. */
export function usableCapacityOf(capacity: BusinessCapacity): number {
  let lowest = 1;
  for (const dimension of CAPACITY_DIMENSIONS) {
    const value = capacity[dimension];
    if (value < lowest) lowest = value;
  }
  return lowest;
}

/**
 * Which dimension is holding the business back. Ties resolve in
 * `CAPACITY_DIMENSIONS` order, so the answer is deterministic rather than
 * dependent on object key order.
 */
export function bindingConstraintOf(capacity: BusinessCapacity): BindingConstraint {
  let binding: BindingConstraint = { dimension: "staffing", value: capacity.staffing };
  for (const dimension of CAPACITY_DIMENSIONS) {
    const value = capacity[dimension];
    if (value < binding.value) binding = { dimension, value };
  }
  return binding;
}

/**
 * Failure causes visible in the facts, in `FAILURE_CAUSES` order.
 *
 * `poor_management` is deliberately never returned: the spec routes management
 * through people and organizational decision processes, so inferring it from a
 * balance would be inventing a judgement the numbers do not contain.
 */
export function businessFailureSignals(
  business: BusinessRecord,
  inputs: BusinessConditionInputs,
): readonly FailureCause[] {
  const signals = new Set<FailureCause>();
  // A business with nothing to sell cannot suffer a demand slump, and a
  // business with no premises cannot be struck by a location disaster, so
  // those facts gate the signals they make meaningful.
  const sellsSomething = business.offerings.length > 0;
  const hasLocations = business.locationIds.length > 0;
  if (inputs.cash.minorUnits < 0) signals.add("insolvency");
  if (
    sellsSomething &&
    inputs.suppliedUnits > 0 &&
    inputs.demandUnits < inputs.suppliedUnits * FAILURE_THRESHOLDS.lowDemandRatio
  ) {
    signals.add("low_demand");
  }
  if (inputs.supplyReliability < FAILURE_THRESHOLDS.supplyReliability) signals.add("supply_shock");
  if (inputs.competitorCount >= FAILURE_THRESHOLDS.competitorCount) signals.add("competition");
  if (hasLocations && inputs.activeDisasterImpacts > 0) signals.add("disaster");
  if (inputs.regulatoryRestrictions.length > 0) signals.add("regulation");
  if (inputs.staffing < FAILURE_THRESHOLDS.staffing) signals.add("staff_loss");
  if (inputs.fundingDaysRemaining < FAILURE_THRESHOLDS.fundingDaysRemaining) signals.add("financing");
  if (inputs.reputation < FAILURE_THRESHOLDS.reputation) signals.add("reputation");
  return FAILURE_CAUSES.filter((cause) => signals.has(cause));
}

export interface RegisterBusinessRequest {
  /** Authored slug, or allocated when absent. */
  readonly id?: string;
  readonly organizationId: EntityId<"organization">;
  readonly form: BusinessRecord["form"];
  readonly sector: string;
  readonly lifecycle?: BusinessLifecycle;
  readonly locationIds?: readonly EntityRef[];
  readonly offerings?: readonly BusinessOffering[];
  readonly capacity?: Partial<BusinessCapacity>;
  readonly accountIds?: readonly EntityId<"account">[];
  readonly supplierIds?: readonly EntityId<"organization">[];
  readonly customerIds?: readonly EntityId<"organization">[];
  readonly workforceTarget?: number;
  readonly strategy?: readonly string[];
  readonly operations?: readonly string[];
  readonly foundedAt?: WorldTime;
  readonly provisional?: boolean;
  readonly note?: string;
}

export class BusinessesEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.businesses) {
      this.scope.assertOwner("businesses");
      this.world.systems.businesses = { businesses: [] } satisfies BusinessesSystemState;
    }
  }

  private get state(): BusinessesSystemState {
    return this.world.systems.businesses as BusinessesSystemState;
  }

  private set state(value: BusinessesSystemState) {
    this.world.systems.businesses = value;
  }

  // ---------------------------------------------------------------- reads ---

  all(): readonly BusinessRecord[] {
    return this.state.businesses;
  }

  business(id: string): BusinessRecord | undefined {
    return this.state.businesses.find((candidate) => candidate.id === id);
  }

  requireBusiness(id: string, caller: string): BusinessRecord {
    const found = this.business(id);
    if (found === undefined) {
      throw new Error(`BusinessesEngine.${caller}: unknown business ${id}`);
    }
    return found;
  }

  byOrganization(organizationId: EntityId<"organization">): readonly BusinessRecord[] {
    return this.state.businesses.filter((candidate) => candidate.organizationId === organizationId);
  }

  bySector(sector: string): readonly BusinessRecord[] {
    return this.state.businesses.filter((candidate) => candidate.sector === sector);
  }

  /** Businesses whose locations include `locationId`. */
  byLocation(locationId: string): readonly BusinessRecord[] {
    return this.state.businesses.filter((candidate) =>
      candidate.locationIds.some((location) => location.id === locationId),
    );
  }

  /** Businesses that are currently trading (System 33 lifecycle). */
  trading(): readonly BusinessRecord[] {
    return this.state.businesses.filter((candidate) =>
      TRADING_LIFECYCLES.includes(candidate.lifecycle),
    );
  }

  /** Read-only view of the Organization Core record this business belongs to. */
  organizationOf(organizationId: string): Organization | undefined {
    const state = this.world.systems.organizations as OrganizationsSystemState | undefined;
    return state?.organizations.find((candidate) => candidate.id === organizationId);
  }

  // --------------------------------------------------------------- writes ---

  /**
   * Registers the commercial side of an organization (System 33 creation paths:
   * entrepreneurship, investment, partnership, spin-off — the caller decides
   * *why*, this decides whether the record is coherent).
   */
  register(request: RegisterBusinessRequest, now: WorldTime): BusinessRecord {
    this.scope.assertOwner("businesses");
    const organization = this.organizationOf(request.organizationId);
    if (organization === undefined) {
      throw new Error(
        `BusinessesEngine.register: organization ${request.organizationId} does not exist (System 32)`,
      );
    }
    if (organization.lifecycle === "dissolved") {
      throw new Error(`BusinessesEngine.register: ${organization.id} is dissolved`);
    }
    const expectedType = BUSINESS_FORM_ORGANIZATION_TYPE[request.form];
    if (organization.type !== expectedType) {
      throw new Error(
        `BusinessesEngine.register: a ${request.form} must be an organization of type ${expectedType}, but ${organization.id} is ${organization.type}`,
      );
    }
    // A business with no authored slug takes its organization's id: one
    // commercial side per organization, and no invented ID prefix.
    const id = request.id ?? (request.organizationId as string);
    if (this.business(id) !== undefined) {
      throw new Error(`BusinessesEngine.register: business ${id} already exists`);
    }
    requireNonNegativeInteger(request.workforceTarget ?? 0, "workforceTarget", "register");
    const capacity = { ...fullCapacity(), ...request.capacity };
    for (const dimension of CAPACITY_DIMENSIONS) {
      requireRatio(capacity[dimension], `capacity.${dimension}`, "register");
    }
    const offerings = request.offerings ?? [];
    if (new Set(offerings.map((offering) => offering.id)).size !== offerings.length) {
      throw new Error(`BusinessesEngine.register: duplicate offering ids on ${id}`);
    }

    const lifecycle = request.lifecycle ?? "active";
    const foundedAt = request.foundedAt ?? now;
    const business: BusinessRecord = {
      id,
      organizationId: request.organizationId,
      form: request.form,
      lifecycle,
      sector: request.sector,
      locationIds: request.locationIds ?? [],
      offerings,
      capacity,
      accountIds: request.accountIds ?? [],
      supplierIds: request.supplierIds ?? [],
      customerIds: request.customerIds ?? [],
      workforceTarget: request.workforceTarget ?? 0,
      strategy: request.strategy ?? [],
      operations: request.operations ?? [],
      foundedAt,
      history: [{ at: foundedAt, kind: lifecycle, note: "Business registered" }],
      provisional: request.provisional,
      note: request.note,
    };
    this.state = { ...this.state, businesses: [...this.state.businesses, business] };
    return business;
  }

  /** Moves the lifecycle along an allowed edge and records it in the history. */
  setLifecycle(id: string, next: BusinessLifecycle, at: WorldTime, note: string): BusinessRecord {
    this.scope.assertOwner("businesses");
    const business = this.requireBusiness(id, "setLifecycle");
    if (business.lifecycle === next) return business;
    if (!BUSINESS_LIFECYCLE_TRANSITIONS[business.lifecycle].includes(next)) {
      throw new Error(
        `BusinessesEngine.setLifecycle: invalid transition ${business.lifecycle} -> ${next}`,
      );
    }
    return this.replace({
      ...business,
      lifecycle: next,
      ...(next === "closed" ? { closedAt: at } : {}),
      history: [...business.history, { at, kind: next, note }],
    });
  }

  /**
   * Records a failure cause and follows it where it leads: insolvency and
   * regulation close the business, everything else sends it into
   * restructuring. The cause is kept in the history either way, so the "why"
   * survives the closure.
   */
  declareFailure(id: string, cause: FailureCause, at: WorldTime, note: string): BusinessRecord {
    this.scope.assertOwner("businesses");
    const business = this.requireBusiness(id, "declareFailure");
    if (!TRADING_LIFECYCLES.includes(business.lifecycle)) {
      throw new Error(
        `BusinessesEngine.declareFailure: ${id} is ${business.lifecycle}, not a trading business`,
      );
    }
    this.replace({
      ...business,
      history: [...business.history, { at, kind: `failure:${cause}`, note }],
    });
    return this.setLifecycle(
      id,
      TERMINAL_FAILURE_CAUSES.includes(cause) ? "closed" : "restructuring",
      at,
      `Failure declared: ${cause}`,
    );
  }

  setCapacity(id: string, patch: Partial<BusinessCapacity>): BusinessRecord {
    this.scope.assertOwner("businesses");
    const business = this.requireBusiness(id, "setCapacity");
    for (const [dimension, value] of Object.entries(patch)) {
      requireRatio(value as number, `capacity.${dimension}`, "setCapacity");
    }
    return this.replace({ ...business, capacity: { ...business.capacity, ...patch } });
  }

  addOffering(id: string, offering: BusinessOffering): BusinessRecord {
    this.scope.assertOwner("businesses");
    const business = this.requireBusiness(id, "addOffering");
    if (business.offerings.some((existing) => existing.id === offering.id)) {
      throw new Error(`BusinessesEngine.addOffering: ${id} already offers ${offering.id}`);
    }
    return this.replace({ ...business, offerings: [...business.offerings, offering] });
  }

  removeOffering(id: string, offeringId: string): BusinessRecord {
    this.scope.assertOwner("businesses");
    const business = this.requireBusiness(id, "removeOffering");
    const remaining = business.offerings.filter((offering) => offering.id !== offeringId);
    if (remaining.length === business.offerings.length) {
      throw new Error(`BusinessesEngine.removeOffering: ${id} does not offer ${offeringId}`);
    }
    return this.replace({ ...business, offerings: remaining });
  }

  setWorkforceTarget(id: string, count: number): BusinessRecord {
    this.scope.assertOwner("businesses");
    const business = this.requireBusiness(id, "setWorkforceTarget");
    requireNonNegativeInteger(count, "count", "setWorkforceTarget");
    return this.replace({ ...business, workforceTarget: count });
  }

  /** Links a System 25 ledger account to the business (money stays with Finance). */
  linkAccount(id: string, accountId: EntityId<"account">): BusinessRecord {
    this.scope.assertOwner("businesses");
    const business = this.requireBusiness(id, "linkAccount");
    if (business.accountIds.includes(accountId)) return business;
    return this.replace({ ...business, accountIds: [...business.accountIds, accountId] });
  }

  linkSupplier(id: string, supplierId: EntityId<"organization">): BusinessRecord {
    this.scope.assertOwner("businesses");
    const business = this.requireBusiness(id, "linkSupplier");
    if (business.supplierIds.includes(supplierId)) return business;
    return this.replace({ ...business, supplierIds: [...business.supplierIds, supplierId] });
  }

  linkCustomer(id: string, customerId: EntityId<"organization">): BusinessRecord {
    this.scope.assertOwner("businesses");
    const business = this.requireBusiness(id, "linkCustomer");
    if (business.customerIds.includes(customerId)) return business;
    return this.replace({ ...business, customerIds: [...business.customerIds, customerId] });
  }

  /** Appends a durable history entry (ownership change, spin-off, reopening...). */
  recordHistory(id: string, kind: string, note: string, at: WorldTime): BusinessRecord {
    this.scope.assertOwner("businesses");
    const business = this.requireBusiness(id, "recordHistory");
    return this.replace({ ...business, history: [...business.history, { at, kind, note }] });
  }

  private replace(updated: BusinessRecord): BusinessRecord {
    this.state = {
      ...this.state,
      businesses: this.state.businesses.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      ),
    };
    return updated;
  }

  // ------------------------------------------------------------- derived ---

  /** The smallest capacity dimension: what the business can actually do. */
  usableCapacity(id: string): number {
    return usableCapacityOf(this.requireBusiness(id, "usableCapacity").capacity);
  }

  /** Which dimension is holding the business back (System 33 capacity model). */
  bindingConstraint(id: string): BindingConstraint {
    return bindingConstraintOf(this.requireBusiness(id, "bindingConstraint").capacity);
  }

  /** Units per staffed hour across every offering, scaled by usable capacity. */
  throughputPerStaffHour(id: string): number {
    const business = this.requireBusiness(id, "throughputPerStaffHour");
    const nominal = business.offerings.reduce(
      (total, offering) => total + (offering.unitsPerStaffHour ?? 0),
      0,
    );
    return nominal * usableCapacityOf(business.capacity);
  }

  /**
   * The actual roster, derived from System 24's employment records — the
   * business does not keep a second copy of who works there.
   */
  roster(id: string, employments: readonly EmploymentRecord[]): readonly EmploymentRecord[] {
    const business = this.requireBusiness(id, "roster");
    return employments.filter(
      (record) =>
        record.employerOrgId === (business.organizationId as string) && record.status === "active",
    );
  }

  /**
   * Revenue and costs derived from System 25's ledger for this business's own
   * accounts. Gross flows are reported; a transfer between two of the
   * business's own accounts therefore appears on both sides and cancels in
   * `net`, which is the number that matters.
   */
  cashFlow(id: string, ledger: readonly LedgerEntry[], currency: CurrencyId): BusinessCashFlow {
    const business = this.requireBusiness(id, "cashFlow");
    const accounts = new Set<string>(business.accountIds as readonly string[]);
    let revenue = zeroMoney(currency);
    let costs = zeroMoney(currency);
    for (const entry of ledger) {
      if (entry.amount.currency !== currency) continue;
      if (accounts.has(entry.toAccountId)) revenue = addMoney(revenue, entry.amount);
      if (accounts.has(entry.fromAccountId)) costs = addMoney(costs, entry.amount);
    }
    return { revenue, costs, net: subtractMoney(revenue, costs) };
  }

  /** Failure causes visible in the facts (never `poor_management`; see types). */
  failureSignals(id: string, inputs: BusinessConditionInputs): readonly FailureCause[] {
    return businessFailureSignals(this.requireBusiness(id, "failureSignals"), inputs);
  }
}

// --------------------------------------------------------------- guards ---

function requireRatio(value: number, field: string, caller: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `BusinessesEngine.${caller}: ${field} must be in [0, 1], received ${String(value)}`,
    );
  }
}

function requireNonNegativeInteger(value: number, field: string, caller: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `BusinessesEngine.${caller}: ${field} must be a non-negative integer, received ${String(value)}`,
    );
  }
}
