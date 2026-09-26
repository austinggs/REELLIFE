/**
 * Organization engine (System 32).
 *
 * Organizations are persistent collective actors built from people, roles,
 * resources, procedures and authority — not super-NPCs. This engine owns the
 * registry, lifecycle transitions, memberships and the parent/child hierarchy.
 * Commercial strategy, market mechanics and legal rules belong to other
 * systems (Systems 33/35/41).
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { EntityId, IdAllocator } from "../primitives/ids.ts";
import type { EntityRef } from "../primitives/entity.ts";
import {
  type Organization,
  type OrganizationLifecycle,
  type MembershipRole,
  type OrganizationType,
} from "../primitives/organization.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { OrganizationsSystemState } from "./types.ts";

/** Valid lifecycle transitions; an organization cannot skip its own history. */
const LIFECYCLE_TRANSITIONS: Readonly<Record<OrganizationLifecycle, readonly OrganizationLifecycle[]>> = {
  forming: ["active", "dissolved"],
  active: ["suspended", "restructuring", "closed"],
  suspended: ["active", "closed"],
  restructuring: ["active", "closed"],
  closed: ["active", "dissolved"],
  dissolved: [],
};

export interface CreateOrganizationRequest {
  /** Authored content IDs (e.g. `ORG-ARDIN-DOCKS`); runtime IDs are allocated when absent. */
  readonly id?: EntityId<"organization">;
  readonly legalName: string;
  readonly commonName?: string;
  readonly type: OrganizationType;
  readonly legalStatus?: string;
  readonly founders?: readonly EntityId<"person">[];
  readonly parentOrganizationId?: EntityId<"organization">;
  readonly locationIds?: readonly EntityRef[];
  readonly policies?: readonly string[];
  readonly goals?: readonly string[];
  readonly foundedAt?: WorldTime;
  readonly foundedInCountryId?: EntityId<"country">;
}

export class OrganizationsEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.organizations) {
      this.scope.assertOwner("organizations");
      this.world.systems.organizations = { organizations: [] } satisfies OrganizationsSystemState;
    }
  }

  private get state(): OrganizationsSystemState {
    return this.world.systems.organizations as OrganizationsSystemState;
  }

  private set state(value: OrganizationsSystemState) {
    this.world.systems.organizations = value;
  }

  get(id: string): Organization | undefined {
    return this.state.organizations.find((organization) => organization.id === id);
  }

  all(): readonly Organization[] {
    return this.state.organizations;
  }

  byType(type: OrganizationType): readonly Organization[] {
    return this.state.organizations.filter((organization) => organization.type === type);
  }

  /** Organizations a person is an active member of at `now`. */
  membershipsFor(
    person: EntityId<"person">,
    now: WorldTime,
  ): readonly { organization: Organization; role: MembershipRole }[] {
    const found: { organization: Organization; role: MembershipRole }[] = [];
    for (const organization of this.state.organizations) {
      for (const membership of organization.memberships) {
        if (membership.person !== person) continue;
        if (membership.endedAt !== undefined && (membership.endedAt as number) <= (now as number)) {
          continue;
        }
        found.push({ organization, role: membership.role });
      }
    }
    return found;
  }

  create(ids: IdAllocator, request: CreateOrganizationRequest, now: WorldTime): Organization {
    this.scope.assertOwner("organizations");
    if (!request.legalName || request.legalName.trim().length === 0) {
      throw new Error("OrganizationsEngine.create: legalName is required");
    }
    const id = request.id ?? ids.next("organization");
    if (this.get(id)) {
      throw new Error(`OrganizationsEngine.create: organization ${id} already exists`);
    }
    if (request.parentOrganizationId && !this.get(request.parentOrganizationId)) {
      throw new Error(
        `OrganizationsEngine.create: parent organization ${request.parentOrganizationId} does not exist`,
      );
    }

    const organization: Organization = {
      id,
      legalName: request.legalName,
      commonName: request.commonName ?? request.legalName,
      type: request.type,
      legalStatus: request.legalStatus ?? "registered",
      lifecycle: "active",
      foundedAt: request.foundedAt ?? now,
      founders: request.founders ?? [],
      parentOrganizationId: request.parentOrganizationId,
      subsidiaryIds: [],
      memberships: [],
      departments: [],
      locationIds: request.locationIds ?? [],
      accountIds: [],
      assetIds: [],
      contractIds: [],
      policies: request.policies ?? [],
      goals: request.goals ?? [],
      capacity: { funding: 0.5, staffing: 0.5, administrative: 0.5, infrastructure: 0.5, expertise: 0.5, publicTrust: 0.5 },
      institutionalMemory: { recordIds: [], policies: [], precedents: [], integrity: 1 },
      foundedInCountryId: request.foundedInCountryId,
    };

    this.state = { ...this.state, organizations: [...this.state.organizations, organization] };

    if (request.parentOrganizationId) {
      this.linkSubsidiary(request.parentOrganizationId, id);
    }
    return organization;
  }

  private linkSubsidiary(
    parentId: EntityId<"organization">,
    subsidiaryId: EntityId<"organization">,
  ): void {
    const parent = this.get(parentId);
    if (!parent) return;
    if (parent.subsidiaryIds.includes(subsidiaryId)) return;
    this.replace({ ...parent, subsidiaryIds: [...parent.subsidiaryIds, subsidiaryId] });
  }

  private replace(updated: Organization): void {
    this.state = {
      ...this.state,
      organizations: this.state.organizations.map((organization) =>
        organization.id === updated.id ? updated : organization,
      ),
    };
  }

  addMembership(
    organizationId: string,
    person: EntityId<"person">,
    role: MembershipRole,
    authorityScopes: readonly string[],
    now: WorldTime,
    title?: string,
  ): Organization {
    this.scope.assertOwner("organizations");
    const organization = this.get(organizationId);
    if (!organization) {
      throw new Error(`OrganizationsEngine.addMembership: unknown organization ${organizationId}`);
    }
    const alreadyActive = organization.memberships.some(
      (membership) =>
        membership.person === person &&
        membership.role === role &&
        (membership.endedAt === undefined || (membership.endedAt as number) > (now as number)),
    );
    if (alreadyActive) {
      throw new Error(
        `OrganizationsEngine.addMembership: ${person} already holds ${role} at ${organizationId}`,
      );
    }
    const updated: Organization = {
      ...organization,
      memberships: [
        ...organization.memberships,
        { person, role, title, joinedAt: now, authorityScopes: [...authorityScopes] },
      ],
    };
    this.replace(updated);
    return updated;
  }

  /** Ends every active membership the person holds at the organization. Returns how many ended. */
  endMembership(organizationId: string, person: EntityId<"person">, now: WorldTime): number {
    this.scope.assertOwner("organizations");
    const organization = this.get(organizationId);
    if (!organization) {
      throw new Error(`OrganizationsEngine.endMembership: unknown organization ${organizationId}`);
    }
    let ended = 0;
    const memberships = organization.memberships.map((membership) => {
      if (membership.person !== person) return membership;
      if (membership.endedAt !== undefined) return membership;
      ended += 1;
      return { ...membership, endedAt: now };
    });
    if (ended > 0) this.replace({ ...organization, memberships });
    return ended;
  }

  setLifecycle(organizationId: string, next: OrganizationLifecycle, now: WorldTime): Organization {
    this.scope.assertOwner("organizations");
    const organization = this.get(organizationId);
    if (!organization) {
      throw new Error(`OrganizationsEngine.setLifecycle: unknown organization ${organizationId}`);
    }
    if (organization.lifecycle === next) return organization;
    if (!LIFECYCLE_TRANSITIONS[organization.lifecycle].includes(next)) {
      throw new Error(
        `OrganizationsEngine.setLifecycle: invalid transition ${organization.lifecycle} -> ${next}`,
      );
    }
    const updated: Organization = {
      ...organization,
      lifecycle: next,
      closedAt: next === "closed" || next === "dissolved" ? now : undefined,
    };
    this.replace(updated);
    return updated;
  }
}
