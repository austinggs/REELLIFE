/**
 * Conflict, negotiation & reconciliation (System 21).
 *
 * "Conflict should have a believable causal path toward resolution,
 * transformation, or persistent unresolved tension" (System 21 core principle).
 * That last option is the one every conflict system forgets, so it is modelled
 * first-class here: `unresolved` is a terminal state, not a failure state.
 *
 * The separations that keep this from turning into a bar-fight simulator:
 *
 *   1. **A dispute is not a fight.** Opening a conflict records positions and
 *      nothing else. It creates no crime, no injury, no hatred and no legal
 *      case, because System 21 owns none of those and the spec says plainly that
 *      conflict does not imply them. Escalation to violence has to *happen*,
 *      visibly, through System 48.
 *   2. **A claim is not a fact, and a party's belief is not a claim's state.**
 *      `Claim.state` is the world's answer (true / partial / false / uncertain /
 *      disputed / misunderstood) and is set by whoever has grounds to set it.
 *      What a party *believes* is a separate field, so "everyone is wrong" and
 *      "someone is lying" stay distinguishable from "it is actually true".
 *   3. **Positions are not interests.** A party can concede its stated position
 *      completely and still have its underlying interest unmet — which is how
 *      settlements fail — and the settlement reading weighs the interests, not
 *      the positions.
 *   4. **Bargaining power is contextual and supplied.** It is a per-party input
 *      for a moment, not a trait, and it is not derived here from reputation
 *      (22), wealth (25) or the law (41); those systems feed it and this one
 *      does not guess.
 *   5. **Informal agreements are not contracts.** `Agreement.formal` is
 *      explicit, because the spec insists the two differ, and a broken agreement
 *      is recorded with its consequences rather than quietly reverted.
 */

import type { WorldTime } from "../primitives/time.ts";

/** The lifecycle, including the three ways a conflict can end without resolving. */
export const CONFLICT_STAGES = [
  "emerging",
  "active",
  "negotiating",
  "escalating",
  "deescalating",
  "resolved",
  "unresolved",
  "withdrawn",
  "expired",
] as const;
export type ConflictStage = (typeof CONFLICT_STAGES)[number];

/** Stages from which no further transition is allowed. */
export const TERMINAL_STAGES = ["resolved", "unresolved", "withdrawn", "expired"] as const;
export type TerminalStage = (typeof TERMINAL_STAGES)[number];

/** The world's answer to a claim — never the party's belief. */
export const CLAIM_STATES = [
  "true",
  "partial",
  "false",
  "uncertain",
  "disputed",
  "misunderstood",
] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

/** A party is a person or a group; group conflict is supported on purpose. */
export interface ConflictParty {
  readonly conflictId: string;
  readonly partyId: string;
  /** What they are actually asking for, as opposed to `position`. */
  readonly position: string;
  /** What would actually settle it for them. Optional, and often unstated. */
  readonly underlyingInterest?: string;
  /** Contextual bargaining power, -1..1, supplied per moment. Never a trait. */
  readonly power: number;
  /** 0..1 — how much of the other side's case this party has understood. */
  readonly informedness: number;
  /** What this party believes about each claim, keyed by claim id. */
  readonly beliefs: Readonly<Record<string, string>>;
}

export interface ConflictRecord {
  readonly id: string;
  readonly title: string;
  readonly openedAt: WorldTime;
  readonly stage: ConflictStage;
  readonly partyIds: readonly string[];
  readonly mediatorId?: string;
  readonly note?: string;
}

/**
 * A claim made in a dispute, with the world's own answer to it.
 *
 * Named `ConflictClaim` because System 31 (insurance) already exports a `Claim`
 * for a policy claim — two unrelated meanings behind one exported name is how a
 * reader ends up checking the wrong one.
 */
export interface ConflictClaim {
  readonly id: string;
  readonly conflictId: string;
  readonly byPartyId: string;
  readonly againstPartyId?: string;
  readonly text: string;
  readonly state: ClaimState;
  readonly settledAt: WorldTime;
  /** Which party set `state`, and on what grounds. */
  readonly settledBy?: string;
}

export const OFFER_KINDS = ["offer", "demand"] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

export interface Offer {
  readonly id: string;
  readonly conflictId: string;
  readonly at: WorldTime;
  readonly byPartyId: string;
  readonly kind: OfferKind;
  readonly terms: string;
  /** What giving this up costs the offerer, in their own words. */
  readonly concedes?: string;
}

export interface Concession {
  readonly id: string;
  readonly conflictId: string;
  readonly offerId: string;
  readonly at: WorldTime;
  readonly byPartyId: string;
  readonly what: string;
}

export const AGREEMENT_STATUSES = ["kept", "broken", "renegotiated"] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

/**
 * An agreement. `formal` distinguishes a contract from a handshake — the spec
 * requires the difference, and the only honest way to hold it is a field.
 */
export interface Agreement {
  readonly id: string;
  readonly conflictId: string;
  readonly at: WorldTime;
  readonly partyIds: readonly string[];
  readonly terms: readonly string[];
  readonly formal: boolean;
  readonly status: AgreementStatus;
  readonly brokenReason?: string;
  /** What breaking it caused, recorded rather than left to be inferred. */
  readonly consequences: readonly string[];
}

export const APOLOGY_STATES = ["offered", "accepted", "refused", "unanswered"] as const;
export type ApologyState = (typeof APOLOGY_STATES)[number];

export interface Apology {
  readonly id: string;
  readonly conflictId: string;
  readonly at: WorldTime;
  readonly fromPartyId: string;
  readonly toPartyId: string;
  readonly text: string;
  readonly state: ApologyState;
  /** 0..1 — what the apology is worth given the relationship's history. */
  readonly weight: number;
}

export interface Reconciliation {
  readonly conflictId: string;
  readonly at: WorldTime;
  readonly partyIds: readonly string[];
  /** 0..1 — genuine repair, not the mere absence of a dispute. */
  readonly restored: number;
  readonly note?: string;
}

export interface ConflictHistoryEntry {
  readonly id: string;
  readonly at: WorldTime;
  readonly conflictId: string;
  readonly kind: string;
  readonly summary: string;
}

export interface ConflictSystemState {
  readonly conflicts: readonly ConflictRecord[];
  readonly parties: readonly ConflictParty[];
  readonly claims: readonly ConflictClaim[];
  readonly offers: readonly Offer[];
  readonly concessions: readonly Concession[];
  readonly agreements: readonly Agreement[];
  readonly apologies: readonly Apology[];
  readonly reconciliations: readonly Reconciliation[];
  readonly history: readonly ConflictHistoryEntry[];
}

export function emptyConflictState(): ConflictSystemState {
  return {
    conflicts: [],
    parties: [],
    claims: [],
    offers: [],
    concessions: [],
    agreements: [],
    apologies: [],
    reconciliations: [],
    history: [],
  };
}

/**
 * What the balance between the parties looks like right now.
 *
 * Everything here is read off the party records, not invented: power is what a
 * caller supplied for this moment, informedness is what a party is recorded as
 * understanding, and claims are the world's own answers. The `gap` between two
 * parties' understanding of each other is the asymmetry the spec asks for, and
 * it is reported rather than applied silently.
 */
export interface BalanceReading {
  readonly conflictId: string;
  readonly partyIds: readonly string[];
  /** Widest power gap between any two parties, 0..1. */
  readonly powerGap: number;
  /** Widest difference in informedness between any two parties, 0..1. */
  readonly informationAsymmetry: number;
  /** How many claims each party has *misunderstood* or believes falsely. */
  readonly misunderstoodClaims: number;
  /** 0..1 — how well the stated positions actually cover the interests. */
  readonly interestsAddressed: number;
  /** 0..1 — how much the bargaining power is balanced. 1 is even-handed. */
  readonly evenHandedness: number;
}

/** How a negotiation is likely to end, given what is on the record. */
export interface SettlementReading {
  readonly conflictId: string;
  readonly outcome: "likely_settlement" | "partial" | "deadlock";
  readonly rationale: string;
  readonly factors: readonly string[];
  readonly balance: BalanceReading;
}

/** Stages a conflict may move to from where it is now. */
export const STAGE_TRANSITIONS: Readonly<Record<ConflictStage, readonly ConflictStage[]>> = {
  emerging: ["active", "withdrawn", "expired"],
  active: ["negotiating", "escalating", "deescalating", "unresolved", "withdrawn", "expired"],
  negotiating: ["escalating", "deescalating", "resolved", "unresolved", "expired"],
  escalating: ["deescalating", "negotiating", "unresolved", "expired"],
  deescalating: ["negotiating", "resolved", "unresolved", "withdrawn", "expired"],
  resolved: [],
  unresolved: ["negotiating"],
  withdrawn: [],
  expired: [],
};

/** Two agreements cover all parties and the interests, or we call it partial. */
export const FULL_INTEREST_COVERAGE = 1;

