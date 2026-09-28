import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";

/**
 * ReelLife System 19 — Family, Household & Genealogy.
 *
 * Models family structure, household membership, lineage, caregiving structure,
 * and shared living arrangements.
 */

export type HouseholdRole =
  | "head"
  | "spouse"
  | "partner"
  | "adult"
  | "child"
  | "dependent"
  | "caregiver"
  | "roommate"
  | "boarder"
  | "foster";

/**
 * One membership *stint*. System 19 requires membership history to record
 * entry/exit rather than treating the household as timeless, so a stint is
 * never deleted: leaving stamps `leftAt`, and rejoining appends another stint.
 * Current membership is therefore derived (`leftAt === undefined`), never
 * stored a second time.
 */
export interface HouseholdMember {
  readonly personId: EntityId<"person">;
  readonly role: HouseholdRole;
  readonly joinedAt: WorldTime;
  /** Absent while the member is in the household. */
  readonly leftAt?: WorldTime;
  /** Why the stint ended ("moved out", "death", ...); free text, not an enum. */
  readonly leftReason?: string;
}

export interface HouseholdRecord {
  readonly id: string;
  readonly name: string;
  readonly residenceLocationId?: string;
  readonly members: readonly HouseholdMember[];
  readonly createdAt: WorldTime;
  readonly dissolvedAt?: WorldTime;
}

export interface LineageLink {
  readonly personId: EntityId<"person">;
  readonly parentIds: readonly EntityId<"person">[];
  readonly childIds: readonly EntityId<"person">[];
  readonly biologicalParentIds: readonly EntityId<"person">[];
  readonly adoptiveParentIds: readonly EntityId<"person">[];
}

/**
 * Read model of a person's structural family: the household they are in (and
 * the stints behind it), their lineage links and their household partners.
 *
 * Deliberately contains no affection, trust or conflict — quality is System 18,
 * and this reading must never be mistaken for it.
 */
export interface FamilyReading {
  readonly personId: EntityId<"person">;
  readonly household?: HouseholdRecord;
  readonly role?: HouseholdRole;
  /** Entry/exit stints in the current household, earliest first. */
  readonly membershipHistory: readonly HouseholdMember[];
  readonly parents: readonly EntityId<"person">[];
  readonly children: readonly EntityId<"person">[];
  readonly siblings: readonly EntityId<"person">[];
  /** Household members recorded as `spouse` or `partner` (structure, not feeling). */
  readonly householdPartners: readonly EntityId<"person">[];
}

export interface FamilySystemState {
  readonly households: readonly HouseholdRecord[];
  readonly lineages: readonly LineageLink[];
}
