/**
 * System 31 — Insurance & Risk Management.
 *
 * "Risk belongs to the world; insurance redistributes the financial
 * consequences of that risk" (System 31 core principle).
 *
 * The system's whole discipline is *not* to own the risk:
 *
 *   1. **Incidents are the world's, not ours.** A claim carries a reference
 *      to whatever happened (a System 28 breakdown, a System 46 disaster, a
 *      health event) plus the amount the caller assesses. 31 never decides
 *      that something was a loss.
 *   2. **Payouts are derived, never typed in.** A payout is the assessed
 *      amount minus the deductible, capped by the coverage limit minus what
 *      the policy has already paid. Partial coverage, deductibles and limits
 *      therefore fall out of the arithmetic rather than out of a decision.
 *   3. **Money stays System 25's.** A paid claim records the caller's
 *      `ledgerEntryId`; 31 decides who is owed, not which account moves.
 *   4. **Suspicion is a state, not a verdict.** `fraud_suspected` and
 *      `appealed` are visible, reviewable states a reviewer (System 48) can
 *      still overturn — the system never quietly denies a claim for being
 *      inconvenient.
 */

import type { Money } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";

/** What a policy covers. Slugs, not a closed enum: law (System 41) adds more. */
export const COVERAGE_KINDS = [
  "vehicle",
  "property",
  "health",
  "liability",
  "goods_in_transit",
  "business_interruption",
] as const;
export type CoverageKind = (typeof COVERAGE_KINDS)[number];

export type PolicyStatus = "active" | "cancelled" | "lapsed" | "expired";

/** A claim's lifecycle, exactly as the spec names it. */
export const CLAIM_STATUSES = [
  "claimed",
  "reviewing",
  "approved",
  "denied",
  "disputed",
  "fraud_suspected",
  "appealed",
  "paid",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Which status moves are legal (the spec's lifecycle, as a graph). */
export const CLAIM_TRANSITIONS: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> = {
  claimed: ["reviewing", "denied"],
  reviewing: ["approved", "denied", "fraud_suspected"],
  approved: ["paid", "disputed"],
  denied: ["appealed", "disputed"],
  disputed: ["reviewing", "approved", "denied"],
  fraud_suspected: ["appealed", "denied", "approved"],
  appealed: ["reviewing", "approved", "denied"],
  paid: [],
};

/** Claims stay open until they are paid or denied. */
export const TERMINAL_CLAIM_STATUSES: readonly ClaimStatus[] = ["paid", "denied"];

export interface Policy {
  readonly id: string;
  /** The organization carrying the risk (System 32 actor). */
  readonly insurerOrgId: string;
  /** Person or organization paying the premium. */
  readonly policyholderId: string;
  /** The thing covered: a vehicle id, a location id, a person id. */
  readonly subjectId: string;
  readonly subjectKind: string;
  readonly coverage: CoverageKind;
  /** Ceiling for this policy, in total, across its life. */
  readonly coverageLimit: Money;
  /** The policyholder's own share of any claim. */
  readonly deductible: Money;
  readonly premium: Money;
  /**
   * Underwriting's view of this risk, 0..1. It moves with claims history
   * and with the caller's assessment of the subject; it is a *rating*
   * input, not a prediction.
   */
  readonly riskScore: number;
  /** Causes this policy explicitly does not cover. */
  readonly exclusions: readonly string[];
  readonly beneficiaries: readonly string[];
  readonly startedAt: WorldTime;
  readonly expiresAt?: WorldTime;
  readonly status: PolicyStatus;
  readonly cancelledAt?: WorldTime;
  readonly closeReason?: string;
  readonly history: readonly PolicyHistoryEntry[];
}

export interface PolicyHistoryEntry {
  readonly at: WorldTime;
  readonly kind: string;
  readonly note: string;
}

/** A claim references the world's incident; it never restates the damage. */
export interface Claim {
  readonly id: string;
  readonly policyId: string;
  /** The incident kind ("vehicle_breakdown", "flood", …) — checked against exclusions. */
  readonly incidentKind: string;
  /** The incident's id in whichever system owns it. */
  readonly incidentRef: string;
  readonly incidentAt: WorldTime;
  readonly claimedAt: WorldTime;
  /** What the caller assesses the loss at. */
  readonly claimedAmount: Money;
  readonly status: ClaimStatus;
  /** Set on approval: the loss the insurer accepted. */
  readonly assessedAmount?: Money;
  readonly decisionReason?: string;
  /** How much the policyholder's deductible took off. */
  readonly deductibleApplied?: Money;
  /** What the insurer will actually pay, derived at approval. */
  readonly payout?: Money;
  readonly paidAt?: WorldTime;
  /** The System 25 ledger entry that settled the payout. */
  readonly ledgerEntryId?: string;
  readonly history: readonly ClaimHistoryEntry[];
}

export interface ClaimHistoryEntry {
  readonly at: WorldTime;
  readonly kind: string;
  readonly note: string;
}

export interface InsuranceSystemState {
  readonly policies: readonly Policy[];
  readonly claims: readonly Claim[];
}

/** The rating inputs the spec names; the caller supplies each one. */
export interface PremiumInputs {
  /** Chance of a loss in the coming period, 0..1 (the caller's model). */
  readonly probability: number;
  /** Average severity of a loss, 0..1. */
  readonly severity: number;
  /** How exposed the subject is, 0..1. */
  readonly exposure: number;
  /** The policyholder's claims history, 0..1 (worse = higher). */
  readonly claimsHistory: number;
  /** Market/competition pressure on the insurer, 0..1 (higher = cheaper). */
  readonly marketPressure?: number;
  /** Regulatory loading, 0..1 (higher = dearer). */
  readonly regulatoryLoading?: number;
}

/** Declared rating weights (provisional; see docs/CONTENT_GAPS.md). */
export const PREMIUM_WEIGHTS = {
  probability: 0.4,
  severity: 0.25,
  exposure: 0.15,
  claimsHistory: 0.2,
  /** Competition and regulation move the price without moving the risk. */
  marketPressure: 0.15,
  regulatoryLoading: 0.1,
} as const;

/** What is being rated. */
export interface CoverageBasis {
  /** The cover being rated, in minor units of limit. */
  readonly limitMinorUnits: number;
  /** Expected loss over the period, in minor units, before loading. */
  readonly expectedLossMinorUnits: number;
}

/** A rated premium, with each component of it stated. */
export interface PremiumQuote {
  readonly premiumMinorUnits: number;
  readonly riskLoadMinorUnits: number;
  readonly competitiveDiscountMinorUnits: number;
  readonly regulatoryLoadingMinorUnits: number;
  readonly basisMinorUnits: number;
}
