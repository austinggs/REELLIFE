import type { EntityId, IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type {
  FamilySystemState,
  HouseholdMember,
  HouseholdRecord,
  HouseholdRole,
  LineageLink,
} from "./types.ts";

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

  // --- Household Methods ---

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

  addHouseholdMember(
    householdId: string,
    personId: EntityId<"person">,
    role: HouseholdRole,
    now: WorldTime,
  ): HouseholdRecord | undefined {
    this.scope.assertOwner("family");
    const hh = this.state.households.find((h) => h.id === householdId);
    if (!hh || hh.dissolvedAt) return undefined;

    const filtered = hh.members.filter((m) => m.personId !== personId);
    const updatedMember: HouseholdMember = { personId, role, joinedAt: now };
    const updated: HouseholdRecord = {
      ...hh,
      members: [...filtered, updatedMember],
    };

    this.state = {
      ...this.state,
      households: this.state.households.map((h) => (h.id === householdId ? updated : h)),
    };
    return updated;
  }

  removeHouseholdMember(
    householdId: string,
    personId: EntityId<"person">,
  ): HouseholdRecord | undefined {
    this.scope.assertOwner("family");
    const hh = this.state.households.find((h) => h.id === householdId);
    if (!hh) return undefined;

    const updated: HouseholdRecord = {
      ...hh,
      members: hh.members.filter((m) => m.personId !== personId),
    };

    this.state = {
      ...this.state,
      households: this.state.households.map((h) => (h.id === householdId ? updated : h)),
    };
    return updated;
  }

  getHousehold(householdId: string): HouseholdRecord | undefined {
    return this.state.households.find((h) => h.id === householdId);
  }

  householdForPerson(personId: EntityId<"person">): HouseholdRecord | undefined {
    return this.state.households.find(
      (h) => !h.dissolvedAt && h.members.some((m) => m.personId === personId),
    );
  }

  // --- Lineage & Genealogy Methods ---

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

  recordParentChild(
    parentId: EntityId<"person">,
    childId: EntityId<"person">,
    kind: "biological" | "adoptive" = "biological",
  ): void {
    this.scope.assertOwner("family");
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
}
