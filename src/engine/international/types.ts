/**
 * International relations & global events (System 52).
 *
 * "International events alter cross-border conditions; domestic consequences
 * emerge through connected systems" (System 52 core principle). The whole
 * design turns on the second half of that: this system changes *conditions* and
 * stops. It does not move a price, fail a business, close a supply chain or
 * decide that a person gets a job — those belong to Systems 35, 34, 33, 24 and
 * 16, and a shock engine that reached into them would be a second, hidden
 * version of all five.
 *
 *   1. **A relationship is several relationships.** Two countries are at once
 *      diplomatic, economic, military, cultural and trading partners, and a
 *      single "how do they feel about each other" number flattens the one thing
 *      that makes them interesting: being close allies and brutal competitors
 *      simultaneously is the normal case, not a contradiction. Standing is
 *      recorded *per domain, per pair*.
 *   2. **A sanction is a condition, not an outcome.** `tradeConditions` reports
 *      that trade is blocked and names the instrument, but never adjusts a
 *      volume or a price — System 35 does that, and this engine's job is to make
 *      the reason available to it.
 *   3. **Suspension is not termination.** A withdrawn treaty stays on the record
 *      with its terms, because "we were party to this until we were not" is a
 *      fact about the past that deleting it would erase.
 *   4. **A global shock names its channels and stops there.** The spec's cascade
 *      — country -> markets -> businesses -> supply chains -> employment ->
 *      households — is recorded as the *declared* route, per affected country.
 *      Walking it is not this system's job, and pretending otherwise would
 *      duplicate five systems badly.
 *   5. **Migration pressure is pressure.** It is a tendency with a direction and
 *      named causes; who actually crosses a border is System 45's decision, and
 *      this engine never records a person as having moved.
 */

import type { WorldTime } from "../primitives/time.ts";

/** Relations are held per domain: the spec has them happening at once. */
export const RELATION_DOMAINS = [
  "diplomatic",
  "economic",
  "military",
  "cultural",
  "trade",
] as const;
export type RelationDomain = (typeof RELATION_DOMAINS)[number];

export interface BilateralStanding {
  /** `A|B` in a stable order, so a pair has exactly one record per domain. */
  readonly pairId: string;
  readonly countryA: string;
  readonly countryB: string;
  readonly domain: RelationDomain;
  /** -1 hostile .. +1 aligned, for this domain only. */
  readonly standing: number;
  readonly at: WorldTime;
  readonly note?: string;
}

export const TREATY_KINDS = ["treaty", "alliance", "trade_agreement"] as const;
export type TreatyKind = (typeof TREATY_KINDS)[number];

export const TREATY_STATUSES = ["active", "suspended", "withdrawn"] as const;
export type TreatyStatus = (typeof TREATY_STATUSES)[number];

export interface Treaty {
  readonly id: string;
  readonly kind: TreatyKind;
  readonly partyIds: readonly string[];
  readonly signedAt: WorldTime;
  readonly terms: readonly string[];
  readonly status: TreatyStatus;
  /** Why it is suspended or withdrawn. Empty while it is in force. */
  readonly endedReason?: string;
  readonly endedAt?: WorldTime;
}

export const SANCTION_SCOPES = ["trade", "financial", "travel", "energy"] as const;
export type SanctionScope = (typeof SANCTION_SCOPES)[number];

export interface Sanction {
  readonly id: string;
  readonly imposedBy: string;
  readonly on: string;
  readonly at: WorldTime;
  readonly scope: SanctionScope;
  readonly reason: string;
  readonly active: boolean;
  readonly liftedAt?: WorldTime;
}

export const SHOCK_KINDS = [
  "financial_crisis",
  "pandemic",
  "war",
  "tech_breakthrough",
  "supply_shock",
  "commodity_shock",
  "climate",
] as const;
export type ShockKind = (typeof SHOCK_KINDS)[number];

/**
 * The declared route of a shock. This is a *description of where it will go*,
 * not a simulation of it having gone there.
 */
export const SHOCK_CHANNELS = [
  "markets",
  "businesses",
  "supplyChains",
  "employment",
  "households",
] as const;
export type ShockChannel = (typeof SHOCK_CHANNELS)[number];

export interface GlobalShock {
  readonly id: string;
  readonly at: WorldTime;
  readonly kind: ShockKind;
  readonly summary: string;
  readonly affectedCountryIds: readonly string[];
  /** How hard, 0..1, for the shock as a whole. */
  readonly magnitude: number;
  /** The routes this shock is declared to travel, per country. */
  readonly channels: Readonly<Record<string, readonly ShockChannel[]>>;
  readonly originCountryId?: string;
}

/**
 * A tendency to move, with a direction and named causes.
 *
 * Deliberately not a movement: nobody has crossed anything, and this system
 * never says they have. System 45 owns the crossing.
 */
export interface MigrationPressure {
  readonly countryId: string;
  readonly at: WorldTime;
  /** Where the pressure comes from. */
  readonly fromCountryIds: readonly string[];
  /** 0..1 — how strong the pressure is. */
  readonly pressure: number;
  readonly causes: readonly string[];
}

export interface InternationalOrganization {
  readonly id: string;
  /** A System 32 organization id. This is a membership list, not a structure. */
  readonly organizationId: string;
  readonly memberCountryIds: readonly string[];
  readonly mandate: string;
  readonly foundedAt: WorldTime;
}

export interface InternationalHistoryEntry {
  readonly id: string;
  readonly at: WorldTime;
  readonly kind: string;
  readonly summary: string;
  readonly countryIds: readonly string[];
}

export interface InternationalSystemState {
  readonly standings: readonly BilateralStanding[];
  readonly treaties: readonly Treaty[];
  readonly sanctions: readonly Sanction[];
  readonly shocks: readonly GlobalShock[];
  readonly migration: readonly MigrationPressure[];
  readonly organizations: readonly InternationalOrganization[];
  readonly history: readonly InternationalHistoryEntry[];
}

export function emptyInternationalState(): InternationalSystemState {
  return {
    standings: [],
    treaties: [],
    sanctions: [],
    shocks: [],
    migration: [],
    organizations: [],
    history: [],
  };
}

/** One pair's standing, domain by domain, plus the mean. */
export interface StandingReading {
  readonly pairId: string;
  readonly countryA: string;
  readonly countryB: string;
  readonly byDomain: Readonly<Record<RelationDomain, number | undefined>>;
  /** Mean across the domains actually recorded: unmeasured is not 0. */
  readonly overall: number | undefined;
  readonly measuredDomains: number;
}

/** Whether trade can happen, and what is in the way if it cannot. */
export interface TradeConditions {
  readonly countryA: string;
  readonly countryB: string;
  readonly at: WorldTime;
  readonly blocked: boolean;
  readonly reasons: readonly string[];
  /** The treaty that *supports* trade, when one is in force. */
  readonly supportedByTreatyId?: string;
}

