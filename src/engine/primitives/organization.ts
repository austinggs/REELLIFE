/**
 * ReelLife organization primitive (System 32).
 *
 * Organizations are persistent collective actors built from people, roles,
 * resources, procedures and authority. They are not super-NPCs: organization
 * behaviour emerges from leadership, policies, resources, members, incentives
 * and external conditions.
 *
 * This shape mirrors the World Build 09 Organization model.
 */

import type { EntityId } from "./ids.ts";
import type { EntityRef } from "./entity.ts";
import type { WorldTime } from "./time.ts";

export const ORGANIZATION_TYPES = [
  "governmental",
  "commercial",
  "financial",
  "educational",
  "healthcare",
  "religious",
  "civic",
  "labor",
  "media",
  "international",
  "informal",
  "cooperative",
  "householdEnterprise",
] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const ORGANIZATION_LIFECYCLE = [
  "forming",
  "active",
  "suspended",
  "restructuring",
  "closed",
  "dissolved",
] as const;
export type OrganizationLifecycle = (typeof ORGANIZATION_LIFECYCLE)[number];

/** Membership roles are distinct from employment status (System 32). */
export const MEMBERSHIP_ROLES = [
  "employee",
  "student",
  "member",
  "officer",
  "manager",
  "owner",
  "founder",
  "volunteer",
  "contractor",
  "customer",
  "participant",
] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export interface OrganizationMembership {
  readonly person: EntityId<"person">;
  readonly role: MembershipRole;
  readonly title?: string;
  readonly joinedAt: WorldTime;
  readonly endedAt?: WorldTime;
  /** Authority scopes this membership confers, e.g. "hire", "approve_leave". */
  readonly authorityScopes: readonly string[];
}

export interface OrganizationDepartment {
  readonly id: string;
  readonly name: string;
  readonly parentDepartmentId?: string;
  readonly purpose: string;
}

/**
 * Organizational capacity is deliberately multi-dimensional rather than one
 * score (World Build 09): funding, staffing, procedures, infrastructure,
 * expertise and trust are separate facts.
 */
export interface OrganizationCapacity {
  readonly funding: number;
  readonly staffing: number;
  readonly administrative: number;
  readonly infrastructure: number;
  readonly expertise: number;
  readonly publicTrust: number;
}

export interface OrganizationInstitutionalMemory {
  /** Durable records and precedents the organization still holds. */
  readonly recordIds: readonly string[];
  readonly policies: readonly string[];
  readonly precedents: readonly string[];
  /** Institutions can gain, lose or distort memory (World Build 09). */
  readonly integrity: number;
}

export interface Organization {
  readonly id: EntityId<"organization">;
  readonly legalName: string;
  readonly commonName: string;
  readonly type: OrganizationType;
  readonly legalStatus: string;
  readonly lifecycle: OrganizationLifecycle;
  readonly foundedAt?: WorldTime;
  readonly closedAt?: WorldTime;
  readonly founders: readonly EntityId<"person">[];
  readonly parentOrganizationId?: EntityId<"organization">;
  readonly subsidiaryIds: readonly EntityId<"organization">[];
  readonly memberships: readonly OrganizationMembership[];
  readonly departments: readonly OrganizationDepartment[];
  readonly locationIds: readonly EntityRef[];
  /** Accounts owned by the organization, in the financial ledger (System 25). */
  readonly accountIds: readonly EntityId<"account">[];
  readonly assetIds: readonly EntityRef[];
  readonly contractIds: readonly EntityId<"contract">[];
  readonly policies: readonly string[];
  readonly goals: readonly string[];
  readonly capacity: OrganizationCapacity;
  readonly institutionalMemory: OrganizationInstitutionalMemory;
  readonly reputationByObserver?: Readonly<Record<string, number>>;
  readonly foundedInCountryId?: EntityId<"country">;
}

export function activeMemberships(
  organization: Organization,
  at: WorldTime,
): readonly OrganizationMembership[] {
  return organization.memberships.filter(
    (membership) =>
      (membership.joinedAt as number) <= (at as number) &&
      (membership.endedAt === undefined || (membership.endedAt as number) > (at as number)),
  );
}

export function hasAuthorityScope(
  organization: Organization,
  person: EntityId<"person">,
  scope: string,
  at: WorldTime,
): boolean {
  return activeMemberships(organization, at).some(
    (membership) => membership.person === person && membership.authorityScopes.includes(scope),
  );
}
