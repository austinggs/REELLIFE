/**
 * ReelLife ownership, contract and asset primitives (System 26).
 *
 * Ownership is not identical to possession. Rights over a thing can be split
 * (owned by one party, occupied by another, leased to a third, used by a
 * fourth, encumbered by a lender). All of it flows through reusable Contract
 * and Asset shapes rather than per-domain rules.
 *
 * Physical objects themselves are owned by System 29; vehicles by System 28;
 * property by System 27; money by System 25. This module owns only the rights.
 */

import type { EntityId, EntityKind } from "./ids.ts";
import type { EntityRef } from "./entity.ts";
import type { Money } from "./money.ts";
import type { WorldTime } from "./time.ts";

export const ASSET_KINDS = [
  "money",
  "property",
  "vehicle",
  "item",
  "security",
  "businessStake",
  "intangible",
  "land",
  "resourceRight",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const OWNERSHIP_RIGHT_KINDS = [
  "legalTitle",
  "beneficialOwnership",
  "possession",
  "occupancy",
  "use",
  "control",
  "management",
  "securityInterest",
  "easement",
  "claim",
] as const;
export type OwnershipRightKind = (typeof OWNERSHIP_RIGHT_KINDS)[number];

export interface OwnershipRight {
  readonly kind: OwnershipRightKind;
  readonly holder: EntityRef<EntityKind>;
  /** Share in hundredths of a percent (10 000 = 100.00%). Integer, never float. */
  readonly shareBasisPoints: number;
  readonly from: WorldTime;
  readonly until?: WorldTime;
  readonly sourceContractId?: EntityId<"contract">;
}

/**
 * An economic/legal/ownership-relevant thing. The asset record points at the
 * domain entity that owns the physical or financial truth; it never duplicates
 * that state.
 */
export interface Asset {
  readonly id: EntityId<"asset">;
  readonly kind: AssetKind;
  /** The domain entity this right-set applies to. */
  readonly subject: EntityRef<EntityKind>;
  readonly rights: readonly OwnershipRight[];
  /** Estimated market value as an estimate, not an authoritative balance. */
  readonly estimatedValue?: Money;
  readonly jurisdictionId?: EntityId<"country">;
  readonly acquiredAt: WorldTime;
  readonly notes?: string;
}

export const CONTRACT_STATES = [
  "draft",
  "proposed",
  "active",
  "fulfilled",
  "breached",
  "disputed",
  "terminated",
  "expired",
] as const;
export type ContractState = (typeof CONTRACT_STATES)[number];

export const CONTRACT_KINDS = [
  "lease",
  "employment",
  "loan",
  "sale",
  "purchase",
  "service",
  "insurance",
  "partnership",
  "license",
  "subscription",
  "marriageAgreement",
  "custody",
  "will",
] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

export interface ContractObligation {
  readonly party: EntityRef<EntityKind>;
  readonly description: string;
  /** Machine-readable obligation type, e.g. "pay_rent", "work_shifts". */
  readonly obligationType: string;
  readonly amount?: Money;
  readonly dueAt?: WorldTime;
  readonly recurrenceDays?: number;
}

export interface ContractEntitlement {
  readonly party: EntityRef<EntityKind>;
  readonly description: string;
  readonly entitlementType: string;
}

export interface Contract {
  readonly id: EntityId<"contract">;
  readonly kind: ContractKind;
  readonly state: ContractState;
  readonly parties: readonly EntityRef<EntityKind>[];
  /** Assets whose rights this contract disposes of. */
  readonly assetIds: readonly EntityId<"asset">[];
  readonly obligations: readonly ContractObligation[];
  readonly entitlements: readonly ContractEntitlement[];
  readonly signedAt: WorldTime;
  readonly effectiveFrom: WorldTime;
  readonly effectiveUntil?: WorldTime;
  readonly jurisdictionId?: EntityId<"country">;
  readonly governingTerms: readonly string[];
  readonly history: readonly {
    readonly at: WorldTime;
    readonly state: ContractState;
    readonly reason: string;
  }[];
}

export function contractIsLive(contract: Contract, at: WorldTime): boolean {
  if (contract.state !== "active") return false;
  if ((contract.effectiveFrom as number) > (at as number)) return false;
  if (contract.effectiveUntil !== undefined && (contract.effectiveUntil as number) <= (at as number)) {
    return false;
  }
  return true;
}

/** True when `holder` currently holds the requested right over the asset. */
export function holdsRight(
  asset: Asset,
  holder: EntityRef,
  kind: OwnershipRightKind,
  at: WorldTime,
): boolean {
  return asset.rights.some(
    (right) =>
      right.kind === kind &&
      right.holder.id === holder.id &&
      right.holder.kind === holder.kind &&
      (right.from as number) <= (at as number) &&
      (right.until === undefined || (right.until as number) > (at as number)),
  );
}
