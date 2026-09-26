import type { Organization } from "../primitives/organization.ts";

/**
 * Organization state (System 32): the registry of collective actors.
 *
 * Membership, roles, hierarchy, capacity and institutional memory all live on
 * the Organization records themselves; this section is just the authoritative
 * list. Employment, education, government and institutions all resolve their
 * collective counterparties through here.
 */
export interface OrganizationsSystemState {
  readonly organizations: readonly Organization[];
}
