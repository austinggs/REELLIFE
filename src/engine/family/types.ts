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

export interface HouseholdMember {
  readonly personId: EntityId<"person">;
  readonly role: HouseholdRole;
  readonly joinedAt: WorldTime;
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

export interface FamilySystemState {
  readonly households: readonly HouseholdRecord[];
  readonly lineages: readonly LineageLink[];
}
