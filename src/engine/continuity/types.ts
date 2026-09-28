/**
 * Life continuity state (System 53).
 *
 * PersonId persists after death — this section records *that* a life ended, how
 * that was determined, what the world filed about it, who took over, and how the
 * estate was handed on. It never erases identity, relationships or causal
 * history (System 53's core principle: death changes world state, it does not
 * erase the causal graph).
 *
 * Two boundaries are load-bearing here, and they are why this file contains
 * *references* rather than facts:
 *
 *  - System 53 does not own medical diagnosis, so it does not store a cause it
 *    invented: a determination names the facts it rests on, each of which stays
 *    where its owner keeps it (System 11 for conditions, System 46 for
 *    disasters, System 48 for incidents).
 *  - System 53 does not own asset ownership semantics, so an estate holds
 *    `SuccessionRef`s and the owning system performs the transfer. System 26
 *    (Ownership/Contracts/Asset Rights) is deliberately not implemented for
 *    this: a second ownership record beside `AccountRecord.ownerId`,
 *    `ItemInstance.ownerId` and `Vehicle.ownerId` would be a parallel
 *    implementation of a fact that already has an owner.
 */

import type { SystemId } from "../core/ownership.ts";
import type { EntityId } from "../primitives/ids.ts";
import type { Money } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";

/** ACTIVE -> DECEASED -> HISTORICAL (System 53 lifecycle). */
export const LIFE_STATUSES = ["active", "deceased", "historical"] as const;
export type LifeStatus = (typeof LIFE_STATUSES)[number];

/**
 * Causes the spec names explicitly. `other` exists so a cause is never guessed:
 * an unknown cause stays `other` rather than being rounded to something the
 * world cannot support.
 */
export const DEATH_CAUSES = [
  "age",
  "disease",
  "injury",
  "accident",
  "violence",
  "disaster",
  "other",
] as const;
export type DeathCause = (typeof DEATH_CAUSES)[number];

export const DEATH_CERTAINTIES = ["certain", "probable", "presumed"] as const;
export type DeathCertainty = (typeof DEATH_CERTAINTIES)[number];

/** How the death came to be known; a determination of `presumed` is not a witness. */
export const DEATH_DETERMINERS = ["medical", "witness", "registration", "inference"] as const;
export type DeathDeterminer = (typeof DEATH_DETERMINERS)[number];

/**
 * A reference to a fact another system owns. Used instead of copying the fact,
 * so a determination cannot drift from the condition it was based on.
 */
export interface FactRef {
  readonly system: SystemId;
  readonly recordId: string;
  readonly field?: string;
  readonly note?: string;
}

export interface DeathDetermination {
  readonly id: string;
  readonly personId: EntityId<"person">;
  /** When the death is judged to have happened. */
  readonly occurredAt: WorldTime;
  /** When the world determined it. */
  readonly determinedAt: WorldTime;
  readonly cause: DeathCause;
  /** What actually killed them ("myocardial infarction"); free text, not an enum. */
  readonly mechanism?: string;
  readonly certainty: DeathCertainty;
  readonly determinedBy: DeathDeterminer;
  /** The facts the determination rests on. References, never copies. */
  readonly evidence: readonly FactRef[];
}

export interface DeathEntry {
  readonly personId: EntityId<"person">;
  readonly declaredAt: WorldTime;
  readonly cause?: string;
  /** Set when a determination produced this death rather than a bare declaration. */
  readonly determinationId?: string;
}

/**
 * The continuity-side record of a death: what the world filed, and which
 * administrative record (System 40) was issued alongside it.
 */
export interface ContinuityDeathRecord {
  readonly id: string;
  readonly personId: EntityId<"person">;
  readonly determinationId: string;
  readonly recordedAt: WorldTime;
  readonly cause: DeathCause;
  /** Legal record id from System 40, when one was issued. */
  readonly civilRecordId?: string;
}
/** Age-based mortality inputs. Provisional — see docs/CONTENT_GAPS.md. */
export const AGE_MORTALITY = {
  /** Below this age no age-based determination is made; other causes own that. */
  minimumAgeYears: 65,
  /** Annual hazard at the minimum age. */
  annualHazardAtMinimum: 0.02,
  /** Years after the minimum age at which the hazard doubles. */
  hazardDoublingYears: 8,
  /** Ceiling, so no age is *certain* to die within the year. */
  maximumAnnualHazard: 0.6,
} as const;

/**
 * Why control moved. The spec allows a descendant *or another eligible person*,
 * so the basis is recorded rather than assumed — a transfer to a sibling is not
 * dressed up as a succession to an heir.
 */
export const SUCCESSION_BASES = [
  "descendant",
  "household",
  "beneficiary",
  "other_eligible",
  "declared",
] as const;
export type SuccessionBasis = (typeof SUCCESSION_BASES)[number];

/** Player control handoff. The world is never reset for one. */
export interface ControlTransfer {
  readonly id: string;
  readonly fromPersonId: EntityId<"person">;
  readonly toPersonId: EntityId<"person">;
  readonly at: WorldTime;
  readonly basis: SuccessionBasis;
  /** Set when the transfer follows an estate, and which one. */
  readonly estateId?: string;
  readonly reason?: string;
}

export const SUCCESSION_KINDS = [
  "money",
  "item",
  "vehicle",
  "residence",
  "lease",
  "employment",
  "policy",
] as const;
export type SuccessionKind = (typeof SUCCESSION_KINDS)[number];


/**
 * A bequest is a *reference*: `system` owns the record, `field` is the field
 * that changes when the bequest is applied. Legacy therefore propagates through
 * a concrete system and a concrete field, never through a modifier.
 */
export interface SuccessionRef {
  readonly system: SystemId;
  readonly recordId: string;
  readonly field: string;
  readonly kind: SuccessionKind;
  readonly note?: string;
}

/** Why someone is a beneficiary. Intestacy names the relationship it rests on. */
export const BENEFICIARY_BASES = [
  "will",
  "designated",
  "intestacy_descendant",
  "intestacy_household",
  "intestacy_parent",
  "intestacy_sibling",
] as const;
export type BeneficiaryBasis = (typeof BENEFICIARY_BASES)[number];

export interface Beneficiary {
  readonly personId: EntityId<"person">;
  readonly basis: BeneficiaryBasis;
  /** Residue share 0..1; money beneficiaries' shares are normalised to 1. */
  readonly share: number;
}

export const ESTATE_STATUSES = ["open", "settling", "settled", "unclaimed"] as const;
export type EstateStatus = (typeof ESTATE_STATUSES)[number];

export interface EstateItem {
  readonly id: string;
  readonly ref: SuccessionRef;
  /** Stated by the owning system when it can state one; never estimated here. */
  readonly valuation?: Money;
  /** Set when the estate did *not* hand this item on, with the reason why. */
  readonly retainedReason?: string;
}

/** A declared will: beneficiaries the testator chose instead of intestacy. */
export interface Testament {
  readonly id: string;
  readonly testatorId: EntityId<"person">;
  readonly declaredAt: WorldTime;
  readonly beneficiaries: readonly Beneficiary[];
  /** Named executor, when the testator named one. */
  readonly executorId?: EntityId<"person">;
  readonly revokedAt?: WorldTime;
}

export interface BequestApplication {
  readonly itemId: string;
  /** A bequest hands an item on; a debt settlement pays a named creditor. */
  readonly kind: "bequest" | "debt_settlement";
  /** Absent for a debt settlement, which is owed to a creditor account. */
  readonly beneficiaryId?: EntityId<"person">;
  readonly appliedAt: WorldTime;
  /** The system that performed the write — never the estate. */
  readonly appliedBy: SystemId;
  /** Set for money: the ledger entry that carries the transfer. */
  readonly ledgerEntryId?: string;
  readonly note?: string;
}

export interface EstateCase {
  readonly id: string;
  readonly deceasedId: EntityId<"person">;
  readonly openedAt: WorldTime;
  readonly status: EstateStatus;
  /** Assets, by reference to the system that owns each record. */
  readonly items: readonly EstateItem[];
  /** Obligations, also by reference: death does not erase a debt. */
  readonly obligations: readonly EstateItem[];
  readonly beneficiaries: readonly Beneficiary[];
  readonly applications: readonly BequestApplication[];
  readonly settledAt?: WorldTime;
  /** Why an estate stayed unclaimed, or was settled as it was. Never a default. */
  readonly note?: string;
}

export interface ContinuitySystemState {
  /** PersonId-keyed lifecycle; a person absent from here is `active`. */
  readonly statuses: Readonly<Record<string, LifeStatus>>;
  readonly deaths: readonly DeathEntry[];
  readonly determinations: readonly DeathDetermination[];
  readonly records: readonly ContinuityDeathRecord[];
  /** Control handoffs, oldest first; the last one names who is controlled now. */
  readonly controlTransfers: readonly ControlTransfer[];
  /** Wills. A revoked will stays on the record and simply stops applying. */
  readonly testaments: readonly Testament[];
  readonly estates: readonly EstateCase[];
}

/** The state a world starts with: nothing has happened yet. */
export function emptyContinuityState(): ContinuitySystemState {
  return {
    statuses: {},
    deaths: [],
    determinations: [],
    records: [],
    controlTransfers: [],
    testaments: [],
    estates: [],
  };
}

