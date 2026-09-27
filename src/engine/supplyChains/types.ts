/**
 * System 34 — Supply Chains & B2B.
 *
 * "Supply chains are networks of dependencies, not linear scripts" (System 34
 * core principle). This module owns exactly what the spec lists: procurement
 * records (purchase orders), supplier relationships (offers with capacity and
 * lead times), supply dependencies (who needs what from whom), substitution
 * options, and supply-chain history.
 *
 * Three boundaries keep it honest:
 *
 *   1. **The network is stored once, as dependencies.** Cascades, exposure and
 *      substitution candidates are *derived* from that graph in registration
 *      order — never scripted as sequences, so a disruption can only reach who
 *      it can actually reach.
 *   2. **Money and stock do not move here.** A purchase order carries its
 *      agreed price and an optional reference to the System 25 ledger entry
 *      that settled it; receiving an order is the moment a caller adds stock
 *      (System 35's `receiveStock`) and posts the payment (System 25).
 *   3. **Every judgement input is named.** Substitution weighs price, quality,
 *      reliability, geography, switching cost and reputation through declared
 *      weights (`SUBSTITUTION_WEIGHTS`), so a switch can always be explained
 *      rather than asserted.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { Money } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";

/**
 * Purchase-order lifecycle (System 34 model). `issued -> accepted ->
 * in_transit -> received` is the healthy path; `cancelled` is a stand-down
 * before shipment; `breached` is non-delivery against the agreement.
 */
export const PURCHASE_ORDER_STATUSES = [
  "issued",
  "accepted",
  "in_transit",
  "received",
  "cancelled",
  "breached",
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

/** Statuses that still owe the buyer a delivery. */
export const OPEN_PURCHASE_ORDER_STATUSES: readonly PurchaseOrderStatus[] = [
  "issued",
  "accepted",
  "in_transit",
];

export interface PurchaseOrder {
  /** `po-<allocated>`; stable across save/load (System 03 allocator). */
  readonly id: string;
  readonly buyerId: EntityId<"organization">;
  readonly supplierId: EntityId<"organization">;
  /** The input being bought (a System 35 good id, or a capability slug). */
  readonly inputId: string;
  readonly quantity: number;
  /** Agreed at issue; System 35 may quote differently next window. */
  readonly unitPrice: Money;
  readonly placedAt: WorldTime;
  /** `placedAt` plus the supplier's lead time — the lag is visible, not hidden. */
  readonly dueAt: WorldTime;
  readonly status: PurchaseOrderStatus;
  readonly acceptedAt?: WorldTime;
  readonly shippedAt?: WorldTime;
  readonly receivedAt?: WorldTime;
  /** When the order ended (cancelled/breached/received). */
  readonly closedAt?: WorldTime;
  readonly closeReason?: string;
  /** The System 25 ledger entry that settled it, when one exists. */
  readonly ledgerEntryId?: string;
}

/**
 * What a supplier can deliver, on what terms — the pool substitution options
 * are drawn from. Assessments (`quality`, `reputation`, `distanceKm`) are
 * content-authored provisional inputs; System 22 owns reputation truth and
 * System 37 owns geography, so these are labels for ranking, not new truths.
 */
export interface SupplierOffer {
  readonly supplierId: EntityId<"organization">;
  readonly inputId: string;
  readonly unitPrice: Money;
  /** Logistics lag in whole days: an order is due this long after placement. */
  readonly leadTimeDays: number;
  /** Max units the supplier can commit per procurement cycle. */
  readonly capacityUnits: number;
  /** Provisional 0..1 assessment of goods/service quality. */
  readonly quality: number;
  /** Provisional 0..1 standing of the supplier. */
  readonly reputation: number;
  /** Rough route distance in km; closer sources lose less to disruption. */
  readonly distanceKm: number;
  /** One-off cost for a buyer to switch onto this source. */
  readonly switchingCost?: Money;
  /** When the supplier was suspended (failure, port/road disruption, …). */
  readonly suspendedAt?: WorldTime;
  readonly suspensionReason?: string;
  /** Content annotation (provisional flag / provenance). */
  readonly note?: string;
}

/** One fact about the supply chain, append-only (System 34 history). */
export interface SupplyChainHistoryEntry {
  readonly at: WorldTime;
  /** `order_placed`, `order_received`, `late_delivery`, `supplier_suspended`, `supplier_switched`, … */
  readonly kind: string;
  /** The order, dependency or supplier the fact is about. */
  readonly subjectId: string;
  readonly note: string;
}

export interface SupplyChainsSystemState {
  readonly offers: readonly SupplierOffer[];
  readonly dependencies: readonly SupplyDependency[];
  readonly purchaseOrders: readonly PurchaseOrder[];
  readonly history: readonly SupplyChainHistoryEntry[];
}

/**
 * Weights substitution candidates are ranked by (provisional; see
 * docs/CONTENT_GAPS.md). Every dimension the spec names for substitution —
 * price, quality, reliability, geography, compatibility, reputation and
 * switching cost — is either weighted here (`compatibility` folds into
 * `quality`: how well the input fits the buyer's use) or carried as
 * availability, which gates candidacy outright.
 */
export const SUBSTITUTION_WEIGHTS = {
  /** Cheaper unit price scores higher. */
  price: 0.25,
  /** Better fit and workmanship score higher. */
  quality: 0.2,
  /** On-time record, computed from this system's own order history. */
  reliability: 0.2,
  /** Paying a large switching cost scores lower. */
  switchingCost: 0.15,
  /** Closer sources score higher. */
  distance: 0.1,
  /** Better standing scores higher. */
  reputation: 0.1,
} as const;

/** One candidate source for a dependency, ranked for switching. */
export interface SubstitutionCandidate {
  readonly supplierId: EntityId<"organization">;
  readonly unitPrice: Money;
  readonly leadTimeDays: number;
  /** False when the supplier is suspended — shown, never silently dropped. */
  readonly available: boolean;
  /** On-time record derived from this supplier's completed orders (0..1). */
  readonly reliability: number;
  /** Weighted score over the declared dimensions, 0..1; unavailable scores 0. */
  readonly score: number;
}

/**
 * A buyer's standing requirement for one input, and where it currently comes
 * from. Alternatives are *not* stored here: any other offer for the same
 * inputId is a substitution candidate, so the option pool cannot drift from
 * the supplier registry.
 */
export interface SupplyDependency {
  readonly id: string;
  readonly buyerId: EntityId<"organization">;
  readonly inputId: string;
  /** Current source. Switching records history rather than erasing the past. */
  readonly supplierId: EntityId<"organization">;
  /** Units the buyer needs per procurement cycle. */
  readonly requiredUnits: number;
  readonly establishedAt: WorldTime;
  readonly switchedAt?: WorldTime;
}
