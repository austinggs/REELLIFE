/**
 * System 43 â€” Government & Public Services.
 *
 * "Government changes conditions through institutions, rules, budgets,
 * services, and authority" (System 43 core principle).
 *
 * The separations this system insists on are what keep it from swallowing
 * its neighbours:
 *
 *   - **Laws are System 41's.** Government holds no rule text; a GovernmentPolicy
 *     cites rule ids and a tax change is a change to a rule, made there.
 *   - **Balances are System 25's.** A budget is an *authorization* to spend,
 *     not a ledger: the government engine never holds money balances and
 *     never posts a transaction.
 *   - **Services are not infrastructure.** A service's *quality* is derived
 *     here from funding, capacity, staffing, demand and the infrastructure
 *     the caller reports; running the infrastructure is System 38's.
 *   - **Officials are ordinary people.** An official id is a person; their
 *     competence, workload and mistakes belong to Systems 14/17/24, and this
 *     system records only that they hold the role.
 */

import type { Money } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";

export interface Agency {
  readonly id: string;
  readonly name: string;
  readonly countryId: string;
  readonly parentAgencyId?: string;
  /** What this agency is for, in the government's own words. */
  readonly mandate: string;
  /** Authorized budget, not a balance. */
  readonly budget: Money;
  readonly budgetPeriod: "annual" | "quarterly" | "emergency";
  /** 0..1 administrative capacity. */
  readonly capacity: number;
  /** Official ids â€” people, owned by the systems that model them. */
  readonly officialIds: readonly string[];
  /** Demand reported against this agency, in service units. */
  readonly demandUnits: number;
  /** Units actually served in the last period. */
  readonly servedUnits: number;
  readonly serviceKind: string;
  readonly history: readonly { readonly at: WorldTime; readonly kind: string; readonly note: string }[];
}

export interface GovernmentPolicy {
  readonly id: string;
  readonly countryId: string;
  readonly title: string;
  /** The System 41 rules this GovernmentPolicy implements. */
  readonly ruleIds: readonly string[];
  readonly implementedAt: WorldTime;
  /** 0..1: how far implementation has actually got, per the spec's gaps. */
  readonly implementation: number;
  readonly note?: string;
}

export interface Government {
  readonly countryId: string;
  readonly agencies: readonly Agency[];
  readonly policies: readonly GovernmentPolicy[];
  /** 0..1 legitimacy, as perceived â€” reputation is System 22's, this is input. */
  readonly legitimacy: number;
  readonly establishedAt: WorldTime;
  readonly history: readonly { readonly at: WorldTime; readonly kind: string; readonly note: string }[];
}

export interface GovernmentSystemState {
  readonly governments: readonly Government[];
}

/** What a caller reports about the world an agency serves. */
export interface ServiceConditions {
  /** 0..1 how well the infrastructure it depends on is working. */
  readonly infrastructure: number;
  /** 0..1 corruption/fraud drag on delivery. */
  readonly integrity: number;
  /** Overload when demand exceeds what capacity and funding can serve. */
  readonly staffingRatio?: number;
}

/** How well a service is actually running, and what is limiting it. */
export interface ServiceReading {
  readonly agencyId: string;
  readonly quality: number;
  readonly served: number;
  readonly demand: number;
  readonly overload: number;
  /** The named constraint that is binding hardest, 0..1, or undefined. */
  readonly bindingConstraint: string | undefined;
  readonly unmetDemand: number;
}

/** Declared service-quality weights (provisional; docs/CONTENT_GAPS.md). */
export const SERVICE_WEIGHTS = {
  funding: 0.25,
  capacity: 0.25,
  staffing: 0.2,
  infrastructure: 0.2,
  integrity: 0.1,
} as const;
