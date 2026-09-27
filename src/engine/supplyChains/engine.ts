/**
 * Supply chains engine (System 34).
 *
 * Owns `systems.supplyChains`: supplier offers (capacity, lead times,
 * terms), supply dependencies, purchase orders, substitution options and the
 * append-only supply-chain history. Every write asserts ownership on that
 * slot; reads are scope-free.
 *
 * The engine stops at the agreement boundary. It records *what* was agreed
 * and *when* it is due; money moves through System 25 (referenced by
 * `ledgerEntryId`), stock lands through System 35's `receiveStock`, and
 * whether anyone chooses to switch supplier is System 17's decision — this
 * system only publishes who is available and what switching would involve.
 *
 * Cascades are derived, never scripted: `cascadeFrom` walks the dependency
 * graph breadth-first in registration order, so a failure reaches exactly the
 * buyers that actually depend on the failed source, transitively.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { IdAllocator, EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import { addTime, days, MINUTES_PER_DAY } from "../primitives/time.ts";
import {
  OPEN_PURCHASE_ORDER_STATUSES,
  SUBSTITUTION_WEIGHTS,
  type PurchaseOrder,
  type SubstitutionCandidate,
  type SupplierOffer,
  type SupplyChainsSystemState,
  type SupplyDependency,
  type SupplyChainHistoryEntry,
} from "./types.ts";

export interface DefineDependencyRequest {
  readonly id: string;
  readonly buyerId: EntityId<"organization">;
  readonly inputId: string;
  readonly supplierId: EntityId<"organization">;
  readonly requiredUnits: number;
}

export interface PlaceOrderRequest {
  readonly buyerId: EntityId<"organization">;
  readonly supplierId: EntityId<"organization">;
  readonly inputId: string;
  readonly quantity: number;
  /** The System 25 ledger entry settling the order, when already paid. */
  readonly ledgerEntryId?: string;
}

export class SupplyChainsEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.supplyChains) {
      this.scope.assertOwner("supplyChains");
      this.world.systems.supplyChains = {
        offers: [],
        dependencies: [],
        purchaseOrders: [],
        history: [],
      } satisfies SupplyChainsSystemState;
    }
  }

  private get state(): SupplyChainsSystemState {
    return this.world.systems.supplyChains as SupplyChainsSystemState;
  }

  private set state(value: SupplyChainsSystemState) {
    this.world.systems.supplyChains = value;
  }

  // ---------------------------------------------------------------- reads ---

  offers(): readonly SupplierOffer[] {
    return this.state.offers;
  }

  /** Everything one supplier can deliver, in registration order. */
  offersOf(supplierId: string): readonly SupplierOffer[] {
    return this.state.offers.filter((offer) => offer.supplierId === supplierId);
  }

  /** One supplier's offer for one input, or undefined. */
  offer(supplierId: string, inputId: string): SupplierOffer | undefined {
    return this.state.offers.find(
      (candidate) => candidate.supplierId === supplierId && candidate.inputId === inputId,
    );
  }

  /** Every source for one input — the substitution pool. */
  offersFor(inputId: string): readonly SupplierOffer[] {
    return this.state.offers.filter((offer) => offer.inputId === inputId);
  }

  dependencies(): readonly SupplyDependency[] {
    return this.state.dependencies;
  }

  dependency(id: string): SupplyDependency | undefined {
    return this.state.dependencies.find((candidate) => candidate.id === id);
  }

  requireDependency(id: string, caller: string): SupplyDependency {
    const found = this.dependency(id);
    if (found === undefined) {
      throw new Error(`SupplyChainsEngine.${caller}: unknown dependency ${id}`);
    }
    return found;
  }

  /** What one buyer needs, and from whom, in registration order. */
  dependenciesOf(buyerId: string): readonly SupplyDependency[] {
    return this.state.dependencies.filter((dependency) => dependency.buyerId === buyerId);
  }

  /** Dependencies whose *current* supplier is this organization. */
  dependentsOf(supplierId: string): readonly SupplyDependency[] {
    return this.state.dependencies.filter((dependency) => dependency.supplierId === supplierId);
  }

  orders(): readonly PurchaseOrder[] {
    return this.state.purchaseOrders;
  }

  order(id: string): PurchaseOrder | undefined {
    return this.state.purchaseOrders.find((candidate) => candidate.id === id);
  }

  requireOrder(id: string, caller: string): PurchaseOrder {
    const found = this.order(id);
    if (found === undefined) {
      throw new Error(`SupplyChainsEngine.${caller}: unknown purchase order ${id}`);
    }
    return found;
  }

  /** Orders still owing a delivery, in registration order. */
  openOrders(): readonly PurchaseOrder[] {
    return this.state.purchaseOrders.filter((order) =>
      OPEN_PURCHASE_ORDER_STATUSES.includes(order.status),
    );
  }

  ordersOf(buyerId: string): readonly PurchaseOrder[] {
    return this.state.purchaseOrders.filter((order) => order.buyerId === buyerId);
  }

  ordersFrom(supplierId: string): readonly PurchaseOrder[] {
    return this.state.purchaseOrders.filter((order) => order.supplierId === supplierId);
  }

  history(): readonly SupplyChainHistoryEntry[] {
    return this.state.history;
  }

  // -------------------------------------------------------------- derived ---

  /**
   * Everything that would lose supply if `supplierId` failed: transitive
   * dependents, breadth-first over the dependency graph in registration
   * order. Emerges from the network; nothing here is a scripted sequence,
   * and a buyer with an alternate source still appears (whether to switch is
   * System 17's decision, reported by `substitutionCandidates`).
   */
  cascadeFrom(supplierId: string): readonly EntityId<"organization">[] {
    const affected: EntityId<"organization">[] = [];
    const seen = new Set<string>([supplierId]);
    let frontier: readonly string[] = [supplierId];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const current of frontier) {
        for (const dependency of this.dependentsOf(current)) {
          const buyer = dependency.buyerId as string;
          if (seen.has(buyer)) continue;
          seen.add(buyer);
          affected.push(dependency.buyerId);
          next.push(buyer);
        }
      }
      frontier = next;
    }
    return affected;
  }

  /**
   * How concentrated the network's exposure is on this supplier: the share
   * of all standing dependencies that name it as their current source.
   * Concentration is what makes a correlated disruption bite (System 34).
   */
  concentration(supplierId: string): number {
    const all = this.state.dependencies;
    if (all.length === 0) return 0;
    return this.dependentsOf(supplierId).length / all.length;
  }

  /**
   * On-time record of a supplier's completed orders: delivered by the due
   * date over everything resolved (received or breached). No history yet
   * reads as 1 — a supplier who has never failed has given no evidence
   * otherwise.
   */
  reliability(supplierId: string): number {
    const resolved = this.state.purchaseOrders.filter(
      (order) =>
        order.supplierId === supplierId &&
        (order.status === "received" || order.status === "breached"),
    );
    if (resolved.length === 0) return 1;
    const onTime = resolved.filter(
      (order) =>
        order.status === "received" &&
        order.receivedAt !== undefined &&
        (order.receivedAt as number) <= (order.dueAt as number),
    ).length;
    return onTime / resolved.length;
  }

  /**
   * Units of an input the buyer will be short this cycle: everything it
   * needs when the source is suspended, the over-capacity remainder when it
   * is not, and 0 when supply covers demand.
   */
  supplyGap(dependencyId: string): number {
    const dependency = this.requireDependency(dependencyId, "supplyGap");
    const offer = this.offer(dependency.supplierId, dependency.inputId);
    if (offer === undefined || offer.suspendedAt !== undefined) return dependency.requiredUnits;
    return Math.max(0, dependency.requiredUnits - offer.capacityUnits);
  }

  /** Every dependency that cannot be covered this cycle, worst gap first. */
  shortages(): readonly { readonly dependencyId: string; readonly gapUnits: number }[] {
    return this.state.dependencies
      .map((dependency) => ({
        dependencyId: dependency.id,
        gapUnits: this.supplyGap(dependency.id),
      }))
      .filter((entry) => entry.gapUnits > 0)
      .sort((a, b) =>
        b.gapUnits === a.gapUnits
          ? a.dependencyId < b.dependencyId
            ? -1
            : 1
          : b.gapUnits - a.gapUnits,
      );
  }

  /**
   * Ranked substitution options for a dependency: every *other* source for
   * the same input, scored on the declared weights. Suspended suppliers stay
   * visible with `available: false` and score 0 — an unavailable option is
   * information, not a disappearance.
   */
  substitutionCandidates(dependencyId: string): readonly SubstitutionCandidate[] {
    const dependency = this.requireDependency(dependencyId, "substitutionCandidates");
    const pool = this.offersFor(dependency.inputId);
    if (pool.length <= 1) return [];

    const reliabilities = new Map(
      pool.map((offer) => [offer.supplierId as string, this.reliability(offer.supplierId)]),
    );
    const prices = pool.map((offer) => offer.unitPrice.minorUnits);
    const distances = pool.map((offer) => offer.distanceKm);
    const switchCosts = pool.map((offer) => offer.switchingCost?.minorUnits ?? 0);
    const qualities = pool.map((offer) => offer.quality);
    const reputations = pool.map((offer) => offer.reputation);
    /** Higher-is-better normalisation over the pool; a flat pool scores 1. */
    const high = (value: number, values: readonly number[]): number => {
      const width = Math.max(...values) - Math.min(...values);
      return width === 0 ? 1 : (value - Math.min(...values)) / width;
    };
    /** Lower-is-better normalisation over the pool; a flat pool scores 1. */
    const low = (value: number, values: readonly number[]): number => {
      const width = Math.max(...values) - Math.min(...values);
      return width === 0 ? 1 : (Math.max(...values) - value) / width;
    };

    const candidates: SubstitutionCandidate[] = pool
      .filter((offer) => offer.supplierId !== dependency.supplierId)
      .map((offer) => {
        const available = offer.suspendedAt === undefined;
        const reliability = reliabilities.get(offer.supplierId as string) ?? 1;
        const score = available
          ? round4(
              SUBSTITUTION_WEIGHTS.price * low(offer.unitPrice.minorUnits, prices) +
                SUBSTITUTION_WEIGHTS.quality * high(offer.quality, qualities) +
                SUBSTITUTION_WEIGHTS.reliability * reliability +
                SUBSTITUTION_WEIGHTS.switchingCost *
                  low(offer.switchingCost?.minorUnits ?? 0, switchCosts) +
                SUBSTITUTION_WEIGHTS.distance * low(offer.distanceKm, distances) +
                SUBSTITUTION_WEIGHTS.reputation * high(offer.reputation, reputations),
            )
          : 0;
        return {
          supplierId: offer.supplierId,
          unitPrice: offer.unitPrice,
          leadTimeDays: offer.leadTimeDays,
          available,
          reliability,
          score,
        };
      });
    return candidates.sort((a, b) =>
      a.available !== b.available
        ? a.available
          ? -1
          : 1
        : b.score === a.score
          ? (a.supplierId as string) < (b.supplierId as string)
            ? -1
            : 1
          : b.score - a.score,
    );
  }

  // --------------------------------------------------------------- writes ---

  /**
   * Registers what a supplier can deliver. The offer *is* the substitution
   * pool: any two offers for the same input are alternate sources for each
   * other, so options cannot be authored here and forgotten there.
   */
  defineOffer(offer: SupplierOffer): SupplierOffer {
    this.scope.assertOwner("supplyChains");
    requireNonNegativeInteger(offer.leadTimeDays, "leadTimeDays", "defineOffer");
    requirePositiveInteger(offer.capacityUnits, "capacityUnits", "defineOffer");
    requireRatio(offer.quality, "quality", "defineOffer");
    requireRatio(offer.reputation, "reputation", "defineOffer");
    requireNonNegative(offer.distanceKm, "distanceKm", "defineOffer");
    if (offer.inputId.length === 0) {
      throw new Error("SupplyChainsEngine.defineOffer: inputId must not be empty");
    }
    if (this.offer(offer.supplierId, offer.inputId) !== undefined) {
      throw new Error(
        `SupplyChainsEngine.defineOffer: ${offer.supplierId} already offers ${offer.inputId}`,
      );
    }
    if (!this.knownBusiness(offer.supplierId)) {
      throw new Error(
        `SupplyChainsEngine.defineOffer: ${offer.supplierId} is not a registered business (System 33)`,
      );
    }
    this.state = { ...this.state, offers: [...this.state.offers, offer] };
    return offer;
  }

  /**
   * Records a standing buyer requirement. A buyer cannot depend on itself,
   * and the named supplier must actually offer the input — a dependency
   * pointing at a source that cannot supply would be a lie in the graph.
   */
  defineDependency(request: DefineDependencyRequest, at: WorldTime): SupplyDependency {
    this.scope.assertOwner("supplyChains");
    requirePositiveInteger(request.requiredUnits, "requiredUnits", "defineDependency");
    if (request.buyerId === request.supplierId) {
      throw new Error(
        `SupplyChainsEngine.defineDependency: ${request.id} would make ${request.buyerId} its own supplier`,
      );
    }
    if (this.dependency(request.id) !== undefined) {
      throw new Error(`SupplyChainsEngine.defineDependency: dependency ${request.id} already exists`);
    }
    if (!this.knownBusiness(request.buyerId) || !this.knownBusiness(request.supplierId)) {
      throw new Error(
        `SupplyChainsEngine.defineDependency: ${request.id} names a party that is not a registered business (System 33)`,
      );
    }
    if (this.offer(request.supplierId, request.inputId) === undefined) {
      throw new Error(
        `SupplyChainsEngine.defineDependency: ${request.supplierId} does not offer ${request.inputId}`,
      );
    }
    const dependency: SupplyDependency = {
      id: request.id,
      buyerId: request.buyerId,
      inputId: request.inputId,
      supplierId: request.supplierId,
      requiredUnits: request.requiredUnits,
      establishedAt: at,
    };
    this.state = { ...this.state, dependencies: [...this.state.dependencies, dependency] };
    return dependency;
  }

  /** A demand shock: the buyer's requirement changes, and it is recorded. */
  setRequiredUnits(dependencyId: string, requiredUnits: number, at: WorldTime): SupplyDependency {
    this.scope.assertOwner("supplyChains");
    requirePositiveInteger(requiredUnits, "requiredUnits", "setRequiredUnits");
    const dependency = this.requireDependency(dependencyId, "setRequiredUnits");
    const updated: SupplyDependency = { ...dependency, requiredUnits };
    this.replaceDependency(updated);
    this.record("demand_changed", dependencyId, `requirement set to ${requiredUnits} units`, at);
    return updated;
  }

  /**
   * Places an order against a live offer. The due date is the supplier's own
   * lead time, so logistics lag is part of the agreement rather than a
   * surprise: capacity caps quantity, and a suspended supplier accepts
   * nothing new.
   */
  placeOrder(ids: IdAllocator, request: PlaceOrderRequest, at: WorldTime): PurchaseOrder {
    this.scope.assertOwner("supplyChains");
    requirePositiveInteger(request.quantity, "quantity", "placeOrder");
    const offer = this.offer(request.supplierId, request.inputId);
    if (offer === undefined) {
      throw new Error(
        `SupplyChainsEngine.placeOrder: ${request.supplierId} does not offer ${request.inputId}`,
      );
    }
    if (offer.suspendedAt !== undefined) {
      throw new Error(
        `SupplyChainsEngine.placeOrder: ${request.supplierId} is suspended (${offer.suspensionReason ?? "no reason given"})`,
      );
    }
    if (request.quantity > offer.capacityUnits) {
      throw new Error(
        `SupplyChainsEngine.placeOrder: ${request.quantity} exceeds ${request.supplierId}'s capacity of ${offer.capacityUnits} for ${request.inputId}`,
      );
    }
    if (!this.knownBusiness(request.buyerId)) {
      throw new Error(
        `SupplyChainsEngine.placeOrder: ${request.buyerId} is not a registered business (System 33)`,
      );
    }
    const order: PurchaseOrder = {
      id: `po-${ids.next("activity")}`,
      buyerId: request.buyerId,
      supplierId: request.supplierId,
      inputId: request.inputId,
      quantity: request.quantity,
      unitPrice: offer.unitPrice,
      placedAt: at,
      dueAt: addTime(at, days(offer.leadTimeDays)),
      status: "issued",
      ...(request.ledgerEntryId === undefined
        ? {}
        : { ledgerEntryId: request.ledgerEntryId }),
    };
    this.state = { ...this.state, purchaseOrders: [...this.state.purchaseOrders, order] };
    this.record(
      "order_placed",
      order.id,
      `${request.quantity} ${request.inputId} from ${request.supplierId}, due day ${offer.leadTimeDays}`,
      at,
    );
    return order;
  }


  /** The supplier confirms it can fill the order. */
  acceptOrder(orderId: string, at: WorldTime): PurchaseOrder {
    this.scope.assertOwner("supplyChains");
    const order = this.requireStatus(orderId, ["issued"], "acceptOrder");
    return this.replaceOrder({ ...order, status: "accepted", acceptedAt: at });
  }

  /**
   * The order leaves the supplier. A suspension stops goods at the source —
   * which is exactly how a delayed input starts: the order stays open and
   * passes its due date until it ships, is cancelled or is breached.
   */
  shipOrder(orderId: string, at: WorldTime): PurchaseOrder {
    this.scope.assertOwner("supplyChains");
    const order = this.requireStatus(orderId, ["accepted"], "shipOrder");
    const offer = this.offer(order.supplierId, order.inputId);
    if (offer?.suspendedAt !== undefined) {
      throw new Error(
        `SupplyChainsEngine.shipOrder: ${order.supplierId} is suspended (${offer.suspensionReason ?? "no reason given"}); ${order.id} stays open`,
      );
    }
    return this.replaceOrder({ ...order, status: "in_transit", shippedAt: at });
  }

  /**
   * The buyer takes delivery. Lateness is a fact of the clock, not an
   * opinion: arriving after `dueAt` records a `late_delivery` history entry
   * with the exact lag. The caller settles the money (System 25) and adds the
   * stock (System 35 `receiveStock`) — the order stores the ledger reference.
   */
  receiveOrder(orderId: string, at: WorldTime, ledgerEntryId?: string): PurchaseOrder {
    this.scope.assertOwner("supplyChains");
    const order = this.requireStatus(orderId, ["in_transit"], "receiveOrder");
    const updated = this.replaceOrder({
      ...order,
      status: "received",
      receivedAt: at,
      closedAt: at,
      ...(ledgerEntryId === undefined ? {} : { ledgerEntryId }),
    });
    if ((at as number) > (order.dueAt as number)) {
      const lateDays = Math.floor(((at as number) - (order.dueAt as number)) / MINUTES_PER_DAY);
      this.record("late_delivery", order.id, `arrived ${lateDays} day(s) after the due date`, at);
    }
    return updated;
  }

  /** A stand-down before shipment: nothing was owed at that point. */
  cancelOrder(orderId: string, at: WorldTime, reason: string): PurchaseOrder {
    this.scope.assertOwner("supplyChains");
    const order = this.requireStatus(orderId, ["issued", "accepted"], "cancelOrder");
    this.record("order_cancelled", order.id, reason, at);
    return this.replaceOrder({
      ...order,
      status: "cancelled",
      closedAt: at,
      closeReason: reason,
    });
  }

  /** Contract breach: the supplier did not deliver against the agreement. */
  declareBreach(orderId: string, at: WorldTime, reason: string): PurchaseOrder {
    this.scope.assertOwner("supplyChains");
    const order = this.requireStatus(orderId, ["issued", "accepted", "in_transit"], "declareBreach");
    this.record("breach", order.id, reason, at);
    return this.replaceOrder({
      ...order,
      status: "breached",
      closedAt: at,
      closeReason: reason,
    });
  }

  /**
   * Everything that ran past its due date and still owes a delivery,
   * breached at `at`. Deterministic in registration order: the caller's
   * clock decides *when* this runs, the orders themselves decide *what* it
   * catches — delayed inputs become breaches without a scripted sequence.
   */
  breachExpiredOrders(at: WorldTime, reason = "not delivered by the due date"): readonly PurchaseOrder[] {
    this.scope.assertOwner("supplyChains");
    const expired = this.openOrders().filter((order) => (order.dueAt as number) < (at as number));
    return expired.map((order) => this.declareBreach(order.id, at, reason));
  }


  /**
   * A supplier stops delivering: failure, a closed port or road, a seized
   * fleet. Every offer it holds is marked at once (a supplier that cannot
   * ship cannot ship *anything*), while the suspension reason stays on the
   * record. Downstream effects are then read off the graph — `shortages`
   * and `cascadeFrom` — not applied by fiat.
   */
  suspendSupplier(supplierId: string, at: WorldTime, reason: string): readonly SupplierOffer[] {
    this.scope.assertOwner("supplyChains");
    const offers = this.offersOf(supplierId);
    if (offers.length === 0) {
      throw new Error(`SupplyChainsEngine.suspendSupplier: ${supplierId} offers nothing here`);
    }
    if (offers.every((offer) => offer.suspendedAt !== undefined)) {
      throw new Error(`SupplyChainsEngine.suspendSupplier: ${supplierId} is already suspended`);
    }
    const updated = offers.map((offer) =>
      offer.suspendedAt === undefined ? { ...offer, suspendedAt: at, suspensionReason: reason } : offer,
    );
    this.state = {
      ...this.state,
      offers: this.state.offers.map((offer) => {
        const match = updated.find(
          (candidate) => candidate.supplierId === offer.supplierId && candidate.inputId === offer.inputId,
        );
        return match ?? offer;
      }),
    };
    this.record("supplier_suspended", supplierId, reason, at);
    return updated;
  }

  /** The supplier ships again. History keeps the outage; this clears it. */
  restoreSupplier(supplierId: string, at: WorldTime): readonly SupplierOffer[] {
    this.scope.assertOwner("supplyChains");
    const offers = this.offersOf(supplierId);
    if (offers.length === 0) {
      throw new Error(`SupplyChainsEngine.restoreSupplier: ${supplierId} offers nothing here`);
    }
    if (offers.every((offer) => offer.suspendedAt === undefined)) {
      throw new Error(`SupplyChainsEngine.restoreSupplier: ${supplierId} is not suspended`);
    }
    const restored = offers.map((offer) => {
      const { suspendedAt: _suspendedAt, suspensionReason: _suspensionReason, ...rest } = offer;
      return rest;
    });
    this.state = {
      ...this.state,
      offers: this.state.offers.map((offer) => {
        if (offer.supplierId !== supplierId) return offer;
        const match = restored.find((candidate) => candidate.inputId === offer.inputId);
        return match ?? offer;
      }),
    };
    this.record("supplier_restored", supplierId, "supply resumed", at);
    return restored;
  }

  /**
   * A buyer moves onto another source. The new source must be a live offer
   * for the same input (substitution never invents a good), the switch cost
   * is read off the offer so the caller can settle it (System 25), and the
   * old supplier stays in history — a switch is a fact, not an erasure.
   */
  switchSupplier(
    dependencyId: string,
    newSupplierId: EntityId<"organization">,
    at: WorldTime,
    ledgerEntryId?: string,
  ): SupplyDependency {
    this.scope.assertOwner("supplyChains");
    const dependency = this.requireDependency(dependencyId, "switchSupplier");
    if (dependency.supplierId === newSupplierId) {
      throw new Error(
        `SupplyChainsEngine.switchSupplier: ${newSupplierId} already supplies ${dependencyId}`,
      );
    }
    const offer = this.offer(newSupplierId, dependency.inputId);
    if (offer === undefined) {
      throw new Error(
        `SupplyChainsEngine.switchSupplier: ${newSupplierId} does not offer ${dependency.inputId}`,
      );
    }
    if (offer.suspendedAt !== undefined) {
      throw new Error(
        `SupplyChainsEngine.switchSupplier: ${newSupplierId} is suspended (${offer.suspensionReason ?? "no reason given"})`,
      );
    }
    const updated: SupplyDependency = {
      ...dependency,
      supplierId: newSupplierId,
      switchedAt: at,
    };
    this.replaceDependency(updated);
    const cost = offer.switchingCost;
    this.record(
      "supplier_switched",
      dependencyId,
      `${dependency.supplierId} -> ${newSupplierId}` +
        (cost === undefined ? "" : ` (switching cost ${cost.minorUnits} ${cost.currency})`) +
        (ledgerEntryId === undefined ? "" : `, ledger ${ledgerEntryId}`),
      at,
    );
    return updated;
  }


  // -------------------------------------------------------------- private ---

  private replaceOrder(updated: PurchaseOrder): PurchaseOrder {
    this.state = {
      ...this.state,
      purchaseOrders: this.state.purchaseOrders.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      ),
    };
    return updated;
  }

  private replaceDependency(updated: SupplyDependency): SupplyDependency {
    this.state = {
      ...this.state,
      dependencies: this.state.dependencies.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      ),
    };
    return updated;
  }

  /** The order must be in one of `allowed` states for the step to happen. */
  private requireStatus(
    orderId: string,
    allowed: readonly PurchaseOrder["status"][],
    caller: string,
  ): PurchaseOrder {
    const order = this.requireOrder(orderId, caller);
    if (!allowed.includes(order.status)) {
      throw new Error(
        `SupplyChainsEngine.${caller}: ${orderId} is ${order.status}, not ${allowed.join(" or ")}`,
      );
    }
    return order;
  }

  private record(
    kind: string,
    subjectId: string,
    note: string,
    at: WorldTime,
  ): void {
    const entry: SupplyChainHistoryEntry = { at, kind, subjectId, note };
    this.state = { ...this.state, history: [...this.state.history, entry] };
  }

  /**
   * Cross-system reference check (read-only): when System 33 is present,
   * every party in a deal must be a registered business. Without it there is
   * nothing to resolve against, so the check stands down rather than invent
   * a registry.
   */
  private knownBusiness(id: string): boolean {
    const state = this.world.systems.businesses as
      | { readonly businesses: readonly { readonly id: string }[] }
      | undefined;
    if (state === undefined) return true;
    return state.businesses.some((business) => business.id === id);
  }
}

// --------------------------------------------------------------- guards ---

function requirePositiveInteger(value: number, field: string, caller: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `SupplyChainsEngine.${caller}: ${field} must be a positive integer, received ${String(value)}`,
    );
  }
}

function requireNonNegativeInteger(value: number, field: string, caller: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `SupplyChainsEngine.${caller}: ${field} must be a non-negative integer, received ${String(value)}`,
    );
  }
}

function requireNonNegative(value: number, field: string, caller: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `SupplyChainsEngine.${caller}: ${field} must be a non-negative number, received ${String(value)}`,
    );
  }
}

function requireRatio(value: number, field: string, caller: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `SupplyChainsEngine.${caller}: ${field} must be in [0, 1], received ${String(value)}`,
    );
  }
}

/** Stable score rounding: rankings must not wobble on float noise. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}


