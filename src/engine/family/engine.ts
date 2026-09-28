/**
 * ReelLife System 19 — Family, Household & Genealogy engine.
 *
 * Structural kinship only: who is whose parent, who lives with whom, and when
 * each of those arrangements began and ended. Affection, trust and conflict are
 * System 18; property title is not modelled here at all (System 19's spec is
 * explicit that it does not own it), and inheritance *settlement* is System 53.
 *
 * Two decisions carry the spec:
 *
 *  1. Household membership is a record of stints, not a set. Leaving stamps
 *     `leftAt`; rejoining appends a new stint. Nothing is deleted, so household
 *     turnover is readable rather than merely impossible.
 *  2. Lineage links are explicit and never erased. Ancestors and descendants are
 *     read by walking those links — never inferred from households, because
 *     living together and being related are different facts.
 */

import type { EntityId, IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type {
  FamilyReading,
  FamilySystemState,
  HouseholdMember,
  HouseholdRecord,
  HouseholdRole,
  LineageLink,
} from "./types.ts";

/** How far lineage walks go by default; a guard against pathological graphs. */
export const LINEAGE_WALK_LIMIT = 32;

export class FamilyEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.family) {
      this.scope.assertOwner("family");
      this.world.systems.family = { households: [], lineages: [] } satisfies FamilySystemState;
    }
  }

  private get state(): FamilySystemState {
    return this.world.systems.family as FamilySystemState;
  }

  private set state(value: FamilySystemState) {
    this.world.systems.family = value;
  }

  private replaceHousehold(updated: HouseholdRecord): void {
    this.state = {
      ...this.state,
      households: this.state.households.map((h) => (h.id === updated.id ? updated : h)),
    };
  }

  // ------------------------------------------------------------- households

  createHousehold(
    ids: IdAllocator,
    name: string,
    foundingHeadId: EntityId<"person">,
    now: WorldTime,
    residenceLocationId?: string,
  ): HouseholdRecord {
    this.scope.assertOwner("family");
    const id = `hh-${ids.next("activity")}`;
    const headMember: HouseholdMember = {
      personId: foundingHeadId,
      role: "head",
      joinedAt: now,
    };

    const record: HouseholdRecord = {
      id,
      name,
      residenceLocationId,
      members: [headMember],
      createdAt: now,
    };

    this.state = {
      ...this.state,
      households: [...this.state.households, record],
    };
    return record;
  }

  /**
   * Adds a member, or updates the role of someone currently in the household.
   * Someone who already left is *re-joined*: a new stint is appended, so the
   * earlier one keeps its own dates.
   */
  addHouseholdMember(
    householdId: string,
    personId: EntityId<"person">,
    role: HouseholdRole,
    now: WorldTime,
  ): HouseholdRecord | undefined {
    this.scope.assertOwner("family");
    const hh = this.getHousehold(householdId);
    if (!hh || hh.dissolvedAt) return undefined;

    const currentStint = hh.members.find((m) => m.personId === personId && m.leftAt === undefined);
    const members: readonly HouseholdMember[] = currentStint
      ? hh.members.map((m) => (m === currentStint ? { ...m, role } : m))
      : [...hh.members, { personId, role, joinedAt: now }];

    const updated: HouseholdRecord = { ...hh, members };
    this.replaceHousehold(updated);
    return updated;
  }

  /**
   * Ends the person's current stint. The record stays, stamped with when and
   * why they left. Returns `undefined` when they were not a current member.
   */
  removeHouseholdMember(
    householdId: string,
    personId: EntityId<"person">,
    now: WorldTime,
    reason?: string,
  ): HouseholdRecord | undefined {
    this.scope.assertOwner("family");
    const hh = this.getHousehold(householdId);
    if (!hh) return undefined;
    const stint = hh.members.find((m) => m.personId === personId && m.leftAt === undefined);
    if (!stint) return undefined;

    const updated: HouseholdRecord = {
      ...hh,
      members: hh.members.map((m) =>
        m === stint ? { ...m, leftAt: now, ...(reason ? { leftReason: reason } : {}) } : m,
      ),
    };
    this.replaceHousehold(updated);
    return updated;
  }

  /** Ends every current stint and marks the household dissolved. */
  dissolveHousehold(
    householdId: string,
    now: WorldTime,
    reason?: string,
  ): HouseholdRecord | undefined {
    this.scope.assertOwner("family");
    const hh = this.getHousehold(householdId);
    if (!hh) return undefined;
    const updated: HouseholdRecord = {
      ...hh,
      dissolvedAt: hh.dissolvedAt ?? now,
      members: hh.members.map((m) =>
        m.leftAt === undefined
          ? { ...m, leftAt: now, ...(reason ? { leftReason: reason } : {}) }
          : m,
      ),
    };
    this.replaceHousehold(updated);
    return updated;
  }

  getHousehold(householdId: string): HouseholdRecord | undefined {
    return this.state.households.find((household) => household.id === householdId);
  }

  /** Members whose stint has not ended. Derived from the stint records. */
  currentMembers(householdId: string): readonly HouseholdMember[] {
    const hh = this.getHousehold(householdId);
    if (!hh) return [];
    return hh.members.filter((m) => m.leftAt === undefined);
  }

  /** Every stint in the household, ended ones included, in recorded order. */
  membershipHistory(householdId: string): readonly HouseholdMember[] {
    return this.getHousehold(householdId)?.members ?? [];
  }

  /** Stints for one person in one household, earliest first. */
  membershipStints(householdId: string, personId: EntityId<"person">): readonly HouseholdMember[] {
    return this.membershipHistory(householdId).filter((m) => m.personId === personId);
  }

  memberRole(householdId: string, personId: EntityId<"person">): HouseholdRole | undefined {
    return this.currentMembers(householdId).find((m) => m.personId === personId)?.role;
  }

  householdForPerson(personId: EntityId<"person">): HouseholdRecord | undefined {
    return this.state.households.find(
      (household) =>
        !household.dissolvedAt &&
        household.members.some((m) => m.personId === personId && m.leftAt === undefined),
    );
  }

  /** Every household the person appears in, so a move leaves a trail. */
  householdsOf(personId: EntityId<"person">): readonly HouseholdRecord[] {
    return this.state.households.filter((household) =>
      household.members.some((m) => m.personId === personId),
    );
  }

  // ---------------------------------------------------------------- lineage

  registerPersonLineage(personId: EntityId<"person">): LineageLink {
    this.scope.assertOwner("family");
    const existing = this.getLineage(personId);
    if (existing) return existing;

    const link: LineageLink = {
      personId,
      parentIds: [],
      childIds: [],
      biologicalParentIds: [],
      adoptiveParentIds: [],
    };

    this.state = {
      ...this.state,
      lineages: [...this.state.lineages, link],
    };
    return link;
  }

  getLineage(personId: EntityId<"person">): LineageLink | undefined {
    return this.state.lineages.find((l) => l.personId === personId);
  }

  parentsOf(personId: EntityId<"person">): readonly EntityId<"person">[] {
    return this.getLineage(personId)?.parentIds ?? [];
  }

  childrenOf(personId: EntityId<"person">): readonly EntityId<"person">[] {
    return this.getLineage(personId)?.childIds ?? [];
  }

  biologicalParentsOf(personId: EntityId<"person">): readonly EntityId<"person">[] {
    return this.getLineage(personId)?.biologicalParentIds ?? [];
  }

  adoptiveParentsOf(personId: EntityId<"person">): readonly EntityId<"person">[] {
    return this.getLineage(personId)?.adoptiveParentIds ?? [];
  }

  /**
   * Siblings are read through parentage, not through the household: two people
   * who share a parent are siblings even if they never lived together.
   */
  siblingsOf(personId: EntityId<"person">): readonly EntityId<"person">[] {
    const siblings: EntityId<"person">[] = [];
    for (const parentId of this.parentsOf(personId)) {
      for (const childId of this.childrenOf(parentId)) {
        if (childId === personId) continue;
        if (!siblings.includes(childId)) siblings.push(childId);
      }
    }
    return siblings;
  }

  /**
   * Ancestors, breadth-first: nearest generation first, in the order the links
   * were recorded. Deterministic by construction — no sorting on a derived fact.
   */
  ancestorsOf(
    personId: EntityId<"person">,
    maxGenerations: number = LINEAGE_WALK_LIMIT,
  ): readonly EntityId<"person">[] {
    return this.walk(personId, (id) => this.parentsOf(id), maxGenerations);
  }

  /** Descendants, breadth-first: children, then grandchildren, and so on. */
  descendantsOf(
    personId: EntityId<"person">,
    maxGenerations: number = LINEAGE_WALK_LIMIT,
  ): readonly EntityId<"person">[] {
    return this.walk(personId, (id) => this.childrenOf(id), maxGenerations);
  }

  private walk(
    origin: EntityId<"person">,
    next: (id: EntityId<"person">) => readonly EntityId<"person">[],
    maxGenerations: number,
  ): readonly EntityId<"person">[] {
    const seen = new Set<string>([String(origin)]);
    const found: EntityId<"person">[] = [];
    let frontier: readonly EntityId<"person">[] = [origin];
    for (let generation = 0; generation < maxGenerations && frontier.length > 0; generation += 1) {
      const following: EntityId<"person">[] = [];
      for (const current of frontier) {
        for (const candidate of next(current)) {
          if (seen.has(String(candidate))) continue;
          seen.add(String(candidate));
          found.push(candidate);
          following.push(candidate);
        }
      }
      frontier = following;
    }
    return found;
  }

  /**
   * Records an explicit parent-child link. Parentage is historical: a link is
   * never removed, and one that would make a person their own ancestor is
   * refused rather than stored — an inconsistent lineage graph cannot be walked.
   */
  recordParentChild(
    parentId: EntityId<"person">,
    childId: EntityId<"person">,
    kind: "biological" | "adoptive" = "biological",
  ): void {
    this.scope.assertOwner("family");
    if (parentId === childId) {
      throw new Error("FamilyEngine.recordParentChild: a person cannot be their own parent");
    }
    if (this.ancestorsOf(parentId).includes(childId)) {
      throw new Error(
        `FamilyEngine.recordParentChild: recording ${parentId} as the parent of ${childId} would create a cycle`,
      );
    }

    const parentLineage = this.registerPersonLineage(parentId);
    const childLineage = this.registerPersonLineage(childId);

    // Update child's parents
    const updatedChild: LineageLink = {
      ...childLineage,
      parentIds: Array.from(new Set([...childLineage.parentIds, parentId])),
      ...(kind === "biological"
        ? { biologicalParentIds: Array.from(new Set([...childLineage.biologicalParentIds, parentId])) }
        : { adoptiveParentIds: Array.from(new Set([...childLineage.adoptiveParentIds, parentId])) }),
    };

    // Update parent's children
    const updatedParent: LineageLink = {
      ...parentLineage,
      childIds: Array.from(new Set([...parentLineage.childIds, childId])),
    };

    this.state = {
      ...this.state,
      lineages: this.state.lineages.map((l) => {
        if (l.personId === childId) return updatedChild;
        if (l.personId === parentId) return updatedParent;
        return l;
      }),
    };
  }

  // ---------------------------------------------------------------- reading

  /**
   * Everything structural known about one person's family, assembled from the
   * records above. A read: it stores nothing and can be recomputed at will.
   */
  familyRecord(personId: EntityId<"person">): FamilyReading {
    const household = this.householdForPerson(personId);
    const history = household ? this.membershipStints(household.id, personId) : [];
    const partners: EntityId<"person">[] = [];
    if (household) {
      for (const member of this.currentMembers(household.id)) {
        if (member.personId === personId) continue;
        if (member.role === "spouse" || member.role === "partner") partners.push(member.personId);
      }
    }
    const role = household === undefined ? undefined : this.memberRole(household.id, personId);
    return {
      personId,
      ...(household === undefined ? {} : { household }),
      ...(role === undefined ? {} : { role }),
      membershipHistory: history,
      parents: this.parentsOf(personId),
      children: this.childrenOf(personId),
      siblings: this.siblingsOf(personId),
      householdPartners: partners,
    };
  }
}
