/**
 * Insurance engine (System 31).
 *
 * Owns `systems.insurance`: policies (insurer, holder, subject, coverage,
 * limit, deductible, premium, risk score, exclusions, beneficiaries, dates,
 * status) and the claims made under them, each with the spec's lifecycle.
 * Every write asserts ownership on that slot; reads are scope-free.
 *
 * The engine distributes consequences; it does not create them. A claim
 * names the incident it refers to and the loss the caller assessed, and
 * from there everything — deductible, limit, partial coverage, what has
 * already been paid — is arithmetic over the policy. Money is System 25's:
 * a paid claim stores the caller's `ledgerEntryId`.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { IdAllocator } from "../primitives/ids.ts";
import type { Money } from "../primitives/money.ts";
import { addMoney, money, subtractMoney, zeroMoney } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";
import {
  CLAIM_TRANSITIONS,
  COVERAGE_KINDS,
  PREMIUM_WEIGHTS,
  TERMINAL_CLAIM_STATUSES,
  type Claim,
  type ClaimStatus,
  type CoverageBasis,
  type CoverageKind,
  type InsuranceSystemState,
  type Policy,
  type PremiumInputs,
  type PremiumQuote,
} from "./types.ts";

export interface IssuePolicyRequest {
  readonly id: string;
  readonly insurerOrgId: string;
  readonly policyholderId: string;
  readonly subjectId: string;
  readonly subjectKind: string;
  readonly coverage: CoverageKind;
  readonly coverageLimit: Money;
  readonly deductible: Money;
  readonly premium: Money;
  readonly riskScore?: number;
  readonly exclusions?: readonly string[];
  readonly beneficiaries?: readonly string[];
  readonly expiresAt?: WorldTime;
  readonly note?: string;
}

export interface FileClaimRequest {
  readonly policyId: string;
  readonly incidentKind: string;
  readonly incidentRef: string;
  readonly incidentAt: WorldTime;
  readonly claimedAmount: Money;
  readonly note?: string;
}

/**
 * What an insurer would actually pay on a claim: the assessed loss less the
 * policyholder's deductible, capped by the cover still available under the
 * policy's limit. This is the spec's "coverage exclusions and limits matter
 * to payouts", expressed once, so approval cannot quietly disagree with it.
 */
export function payoutOf(assessed: Money, deductible: Money, remainingCover: Money): Money {
  if (deductible.currency !== assessed.currency || remainingCover.currency !== assessed.currency) {
    throw new Error("InsuranceEngine: payout arithmetic mixes currencies");
  }
  const afterDeductible = assessed.minorUnits - deductible.minorUnits;
  const payable = Math.min(Math.max(0, afterDeductible), remainingCover.minorUnits);
  return money(assessed.currency, Math.max(0, payable));
}

/**
 * Rates a premium from the spec's own inputs. Expected loss is the basis;
 * risk (probability, severity, exposure, claims history) loads it up,
 * competition discounts it, regulation loads it separately — so a dear
 * market and a heavy regulatory regime cannot be confused with a risky
 * subject.
 */
export function quotePremium(inputs: PremiumInputs, basis: CoverageBasis): PremiumQuote {
  const riskIndex =
    PREMIUM_WEIGHTS.probability * clamp01(inputs.probability) +
    PREMIUM_WEIGHTS.severity * clamp01(inputs.severity) +
    PREMIUM_WEIGHTS.exposure * clamp01(inputs.exposure) +
    PREMIUM_WEIGHTS.claimsHistory * clamp01(inputs.claimsHistory);
  const riskLoad = Math.round(basis.expectedLossMinorUnits * riskIndex);
  const competitiveDiscount = Math.round(
    basis.expectedLossMinorUnits *
      clamp01(inputs.marketPressure ?? 0) *
      PREMIUM_WEIGHTS.marketPressure,
  );
  const regulatory = Math.round(
    basis.expectedLossMinorUnits *
      clamp01(inputs.regulatoryLoading ?? 0) *
      PREMIUM_WEIGHTS.regulatoryLoading,
  );
  const premium = Math.max(
    0,
    basis.expectedLossMinorUnits + riskLoad - competitiveDiscount + regulatory,
  );
  return {
    premiumMinorUnits: premium,
    riskLoadMinorUnits: riskLoad,
    competitiveDiscountMinorUnits: competitiveDiscount,
    regulatoryLoadingMinorUnits: regulatory,
    basisMinorUnits: basis.expectedLossMinorUnits,
  };
}

export class InsuranceEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.insurance) {
      this.scope.assertOwner("insurance");
      this.world.systems.insurance = {
        policies: [],
        claims: [],
      } satisfies InsuranceSystemState;
    }
  }

  private get state(): InsuranceSystemState {
    return this.world.systems.insurance as InsuranceSystemState;
  }

  private set state(value: InsuranceSystemState) {
    this.world.systems.insurance = value;
  }

  // ---------------------------------------------------------------- reads ---

  policies(): readonly Policy[] {
    return this.state.policies;
  }

  policy(id: string): Policy | undefined {
    return this.state.policies.find((candidate) => candidate.id === id);
  }

  requirePolicy(id: string, caller: string): Policy {
    const found = this.policy(id);
    if (found === undefined) {
      throw new Error(`InsuranceEngine.${caller}: unknown policy ${id}`);
    }
    return found;
  }

  activePolicies(): readonly Policy[] {
    return this.state.policies.filter((policy) => policy.status === "active");
  }

  policiesOfHolder(policyholderId: string): readonly Policy[] {
    return this.state.policies.filter((policy) => policy.policyholderId === policyholderId);
  }

  claims(): readonly Claim[] {
    return this.state.claims;
  }

  claim(id: string): Claim | undefined {
    return this.state.claims.find((candidate) => candidate.id === id);
  }

  requireClaim(id: string, caller: string): Claim {
    const found = this.claim(id);
    if (found === undefined) {
      throw new Error(`InsuranceEngine.${caller}: unknown claim ${id}`);
    }
    return found;
  }

  claimsFor(policyId: string): readonly Claim[] {
    return this.state.claims.filter((claim) => claim.policyId === policyId);
  }

  openClaims(): readonly Claim[] {
    return this.state.claims.filter((claim) => !TERMINAL_CLAIM_STATUSES.includes(claim.status));
  }

  // -------------------------------------------------------------- derived ---

  /**
   * What this policy has already paid out. Derived from the claims, never
   * stored twice, so a policy's remaining cover cannot disagree with the
   * claims made under it.
   */
  paidTotal(policyId: string): Money {
    const policy = this.requirePolicy(policyId, "paidTotal");
    let total = zeroMoney(policy.coverageLimit.currency);
    for (const claim of this.claimsFor(policyId)) {
      if (claim.status === "paid" && claim.payout !== undefined) {
        total = addMoney(total, claim.payout);
      }
    }
    return total;
  }

  /** Cover still available under the policy's limit, after prior payouts. */
  remainingCover(policyId: string): Money {
    const policy = this.requirePolicy(policyId, "remainingCover");
    return subtractMoney(policy.coverageLimit, this.paidTotal(policyId));
  }

  /** The payout this claim would receive if approved at `assessed`. */
  quotePayout(claimId: string, assessed: Money): Money {
    const claim = this.requireClaim(claimId, "quotePayout");
    const policy = this.requirePolicy(claim.policyId, "quotePayout");
    if (assessed.currency !== policy.coverageLimit.currency) {
      throw new Error(
        `InsuranceEngine.quotePayout: ${claimId} is assessed in ${assessed.currency}, the policy is in ${policy.coverageLimit.currency}`,
      );
    }
    return payoutOf(assessed, policy.deductible, this.remainingCover(policy.id));
  }

  /**
   * A policyholder's claims history, 0..1 — their own rating input, derived
   * from their own claims rather than asserted by a caller.
   */
  claimsHistoryScore(policyholderId: string): number {
    const claims = this.state.claims.filter(
      (claim) => this.policy(claim.policyId)?.policyholderId === policyholderId,
    );
    if (claims.length === 0) return 0;
    const adverse = claims.filter((claim) =>
      TERMINAL_CLAIM_STATUSES.includes(claim.status) ||
      claim.status === "fraud_suspected",
    ).length;
    return round4(clamp01(adverse / claims.length));
  }

  // --------------------------------------------------------------- writes ---

  /**
   * Issues a policy. The insurer must be a real organization (System 32)
   * when that registry is present — insurance is an organizational act, not
   * a floating number — and the money fields must share one currency, so a
   * payout can never be arithmetic across two.
   */
  issuePolicy(request: IssuePolicyRequest, at: WorldTime): Policy {
    this.scope.assertOwner("insurance");
    if (this.policy(request.id) !== undefined) {
      throw new Error(`InsuranceEngine.issuePolicy: policy ${request.id} already exists`);
    }
    if (!COVERAGE_KINDS.includes(request.coverage)) {
      throw new Error(`InsuranceEngine.issuePolicy: unknown coverage ${String(request.coverage)}`);
    }
    requireSameCurrency([
      request.coverageLimit,
      request.deductible,
      request.premium,
    ]);
    if (request.coverageLimit.minorUnits <= 0) {
      throw new Error(
        `InsuranceEngine.issuePolicy: coverageLimit must be positive, received ${request.coverageLimit.minorUnits}`,
      );
    }
    if (request.deductible.minorUnits < 0 || request.premium.minorUnits < 0) {
      throw new Error("InsuranceEngine.issuePolicy: deductible and premium must not be negative");
    }
    if (request.deductible.minorUnits > request.coverageLimit.minorUnits) {
      throw new Error(
        `InsuranceEngine.issuePolicy: deductible ${request.deductible.minorUnits} exceeds the coverage limit ${request.coverageLimit.minorUnits}`,
      );
    }
    if (request.expiresAt !== undefined && (request.expiresAt as number) <= (at as number)) {
      throw new Error("InsuranceEngine.issuePolicy: a policy cannot expire before it starts");
    }
    requireRatio(request.riskScore ?? 0.5, "riskScore", "issuePolicy");
    if (!this.knownOrganization(request.insurerOrgId)) {
      throw new Error(
        `InsuranceEngine.issuePolicy: ${request.insurerOrgId} is not a registered organization (System 32)`,
      );
    }
    const policy: Policy = {
      id: request.id,
      insurerOrgId: request.insurerOrgId,
      policyholderId: request.policyholderId,
      subjectId: request.subjectId,
      subjectKind: request.subjectKind,
      coverage: request.coverage,
      coverageLimit: request.coverageLimit,
      deductible: request.deductible,
      premium: request.premium,
      riskScore: request.riskScore ?? 0.5,
      exclusions: [...(request.exclusions ?? [])],
      beneficiaries: [...(request.beneficiaries ?? [])],
      startedAt: at,
      ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
      status: "active",
      history: [
        {
          at,
          kind: "issued",
          note: `${request.coverage} cover for ${request.subjectId}` +
            (request.note === undefined ? "" : ` — ${request.note}`),
        },
      ],
    };
    this.state = { ...this.state, policies: [...this.state.policies, policy] };
    return policy;
  }

  /**
   * Cancellation ends cover from now; it is not a deletion, and the
   * policy's history keeps why. Claims already filed stay on the policy —
   * insurance that voided its own claims would defeat the purpose.
   */
  cancelPolicy(id: string, at: WorldTime, reason: string): Policy {
    this.scope.assertOwner("insurance");
    const policy = this.requirePolicy(id, "cancelPolicy");
    if (policy.status !== "active") {
      throw new Error(`InsuranceEngine.cancelPolicy: ${id} is ${policy.status}, not active`);
    }
    const cancelled: Policy = {
      ...policy,
      status: "cancelled",
      cancelledAt: at,
      closeReason: reason,
      history: [...policy.history, { at, kind: "cancelled", note: reason }],
    };
    return this.replacePolicy(cancelled);
  }

  /** Lapses (cover ran out) and expiry (term ended) are recorded, not erased. */
  closePolicy(id: string, status: "lapsed" | "expired", at: WorldTime, reason: string): Policy {
    this.scope.assertOwner("insurance");
    const policy = this.requirePolicy(id, "closePolicy");
    if (policy.status !== "active") {
      throw new Error(`InsuranceEngine.closePolicy: ${id} is ${policy.status}, not active`);
    }
    const closed: Policy = {
      ...policy,
      status,
      cancelledAt: at,
      closeReason: reason,
      history: [...policy.history, { at, kind: status, note: reason }],
    };
    return this.replacePolicy(closed);
  }

  /**
   * Underwriting shift: the insurer's view of this risk moves, and the
   * premium is re-rated to match. Both are recorded — a policy that quietly
   * became three times as expensive would be exactly the kind of thing the
   * spec's "underwriting" rule exists to make visible.
   */
  reratePolicy(id: string, request: { readonly riskScore: number; readonly premium: Money }, at: WorldTime): Policy {
    this.scope.assertOwner("insurance");
    requireRatio(request.riskScore, "riskScore", "reratePolicy");
    const policy = this.requirePolicy(id, "reratePolicy");
    if (request.premium.currency !== policy.premium.currency) {
      throw new Error("InsuranceEngine.reratePolicy: the new premium is in another currency");
    }
    if (request.premium.minorUnits < 0) {
      throw new Error("InsuranceEngine.reratePolicy: premium must not be negative");
    }
    const previous = policy.premium.minorUnits;
    const rerated: Policy = {
      ...policy,
      riskScore: request.riskScore,
      premium: request.premium,
      history: [
        ...policy.history,
        {
          at,
          kind: "rerated",
          note: `risk ${round2(policy.riskScore)} -> ${round2(request.riskScore)}, premium ${previous} -> ${request.premium.minorUnits}`,
        },
      ],
    };
    return this.replacePolicy(rerated);
  }

  /**
   * Files a claim against a live policy. The policy must be active and in
   * date, and the claim must be in the policy's own currency — and the
   * incident reference is kept exactly as the owning system named it,
   * because 31 redistributes a loss it did not witness.
   */
  fileClaim(ids: IdAllocator, request: FileClaimRequest, at: WorldTime): Claim {
    this.scope.assertOwner("insurance");
    const policy = this.requirePolicy(request.policyId, "fileClaim");
    if (policy.status !== "active") {
      throw new Error(`InsuranceEngine.fileClaim: ${request.policyId} is ${policy.status}`);
    }
    if (policy.expiresAt !== undefined && (at as number) > (policy.expiresAt as number)) {
      throw new Error(
        `InsuranceEngine.fileClaim: ${request.policyId} expired at ${String(policy.expiresAt)}`,
      );
    }
    if ((request.incidentAt as number) > (at as number)) {
      throw new Error("InsuranceEngine.fileClaim: a claim cannot be filed before its incident");
    }
    if (request.claimedAmount.currency !== policy.coverageLimit.currency) {
      throw new Error(
        `InsuranceEngine.fileClaim: claim is in ${request.claimedAmount.currency}, the policy is in ${policy.coverageLimit.currency}`,
      );
    }
    if (request.claimedAmount.minorUnits <= 0) {
      throw new Error("InsuranceEngine.fileClaim: claimedAmount must be positive");
    }
    const claim: Claim = {
      id: `clm-${ids.next("activity")}`,
      policyId: request.policyId,
      incidentKind: request.incidentKind,
      incidentRef: request.incidentRef,
      incidentAt: request.incidentAt,
      claimedAt: at,
      claimedAmount: request.claimedAmount,
      status: "claimed",
      history: [
        {
          at,
          kind: "claimed",
          note:
            `${request.incidentKind} ${request.incidentRef} for ${request.claimedAmount.minorUnits}` +
            (request.note === undefined ? "" : ` — ${request.note}`),
        },
      ],
    };
    this.state = { ...this.state, claims: [...this.state.claims, claim] };
    return claim;
  }

  /** Whether this policy's terms cover an incident of that kind. */
  covers(policyId: string, incidentKind: string): boolean {
    const policy = this.requirePolicy(policyId, "covers");
    return !policy.exclusions.includes(incidentKind);
  }

  /**
   * Approval is where the money is decided, and it is arithmetic: the
   * assessed loss less the deductible, capped by the cover still available.
   * An excluded incident cannot be approved — the exclusion is the contract.
   */
  approveClaim(claimId: string, assessed: Money, at: WorldTime, note?: string): Claim {
    this.scope.assertOwner("insurance");
    const claim = this.requireStatus(claimId, "approved", "approveClaim");
    const policy = this.requirePolicy(claim.policyId, "approveClaim");
    if (policy.exclusions.includes(claim.incidentKind)) {
      throw new Error(`InsuranceEngine.approveClaim: ${policy.id} excludes ${claim.incidentKind}`);
    }
    if (assessed.currency !== policy.coverageLimit.currency) {
      throw new Error("InsuranceEngine.approveClaim: the assessment is in another currency");
    }
    if (assessed.minorUnits < 0) {
      throw new Error("InsuranceEngine.approveClaim: an assessment must not be negative");
    }
    const payout = payoutOf(assessed, policy.deductible, this.remainingCover(policy.id));
    const deductibleApplied = money(
      assessed.currency,
      Math.min(policy.deductible.minorUnits, assessed.minorUnits),
    );
    const updated: Claim = {
      ...claim,
      status: "approved",
      assessedAmount: assessed,
      deductibleApplied,
      payout,
      ...(note === undefined ? {} : { decisionReason: note }),
      history: [
        ...claim.history,
        {
          at,
          kind: "approved",
          note:
            `assessed ${assessed.minorUnits}, deductible ${deductibleApplied.minorUnits}, payout ${payout.minorUnits}` +
            (note === undefined ? "" : ` — ${note}`),
        },
      ],
    };
    return this.replaceClaim(updated);
  }

  /** Denial, with a stated reason. A denial is a decision a human can revisit. */
  denyClaim(claimId: string, reason: string, at: WorldTime): Claim {
    this.scope.assertOwner("insurance");
    const claim = this.requireStatus(claimId, "denied", "denyClaim");
    return this.replaceClaim({
      ...claim,
      status: "denied",
      decisionReason: reason,
      history: [...claim.history, { at, kind: "denied", note: reason }],
    });
  }

  /** A claim the policyholder does not accept, sent back for review. */
  disputeClaim(claimId: string, reason: string, at: WorldTime): Claim {
    this.scope.assertOwner("insurance");
    const claim = this.requireStatus(claimId, "disputed", "disputeClaim");
    return this.replaceClaim({
      ...claim,
      status: "disputed",
      decisionReason: reason,
      history: [...claim.history, { at, kind: "disputed", note: reason }],
    });
  }

  /**
   * Fraud suspicion is recorded as a *state* with a reason, never as a
   * silent denial: the claim stays reviewable, and the policyholder's rating
   * input (`claimsHistoryScore`) can see it.
   */
  suspectFraud(claimId: string, reason: string, at: WorldTime): Claim {
    this.scope.assertOwner("insurance");
    const claim = this.requireStatus(claimId, "fraud_suspected", "suspectFraud");
    return this.replaceClaim({
      ...claim,
      status: "fraud_suspected",
      decisionReason: reason,
      history: [...claim.history, { at, kind: "fraud_suspected", note: reason }],
    });
  }

  /** The policyholder appeals; a denied or suspected claim can come back. */
  appealClaim(claimId: string, reason: string, at: WorldTime): Claim {
    this.scope.assertOwner("insurance");
    const claim = this.requireStatus(claimId, "appealed", "appealClaim");
    return this.replaceClaim({
      ...claim,
      status: "appealed",
      decisionReason: reason,
      history: [...claim.history, { at, kind: "appealed", note: reason }],
    });
  }

  /**
   * Settles an approved claim. The caller posts the money (System 25) and
   * hands back the ledger entry id, so a payout is traceable to an actual
   * transfer rather than to a promise inside this state.
   */
  payClaim(claimId: string, at: WorldTime, ledgerEntryId: string): Claim {
    this.scope.assertOwner("insurance");
    const claim = this.requireStatus(claimId, "paid", "payClaim");
    if (claim.payout === undefined) {
      throw new Error(`InsuranceEngine.payClaim: ${claimId} was never assessed`);
    }
    return this.replaceClaim({
      ...claim,
      status: "paid",
      paidAt: at,
      ledgerEntryId,
      history: [
        ...claim.history,
        { at, kind: "paid", note: `${claim.payout.minorUnits} settled by ${ledgerEntryId}` },
      ],
    });
  }

  /** Moves a claim to a status the lifecycle allows, with a note. */
  transitionClaim(claimId: string, status: ClaimStatus, at: WorldTime, note: string): Claim {
    this.scope.assertOwner("insurance");
    const claim = this.requireStatus(claimId, status, "transitionClaim");
    return this.replaceClaim({
      ...claim,
      status,
      decisionReason: note,
      history: [...claim.history, { at, kind: status, note }],
    });
  }

  // -------------------------------------------------------------- private ---

  private replacePolicy(updated: Policy): Policy {
    this.state = {
      ...this.state,
      policies: this.state.policies.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      ),
    };
    return updated;
  }

  private replaceClaim(updated: Claim): Claim {
    this.state = {
      ...this.state,
      claims: this.state.claims.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      ),
    };
    return updated;
  }

  /** The claim must be in a status that can move to `target`. */
  private requireStatus(claimId: string, target: ClaimStatus, caller: string): Claim {
    const claim = this.requireClaim(claimId, caller);
    if (claim.status === target) return claim;
    const allowed = CLAIM_TRANSITIONS[claim.status];
    if (!allowed.includes(target)) {
      throw new Error(
        `InsuranceEngine.${caller}: ${claimId} is ${claim.status}; the lifecycle allows ${allowed.length === 0 ? "no further change" : allowed.join(" or ")}`,
      );
    }
    return claim;
  }

  /**
   * Cross-system reference check (read-only): when System 32 is present, an
   * insurer must be a real organization. Without that registry there is
   * nothing to resolve against, so the check stands down.
   */
  private knownOrganization(id: string): boolean {
    const state = this.world.systems.organizations as
      | { readonly organizations: readonly { readonly id: string }[] }
      | undefined;
    if (state === undefined) return true;
    return state.organizations.some((organization) => organization.id === id);
  }
}

// --------------------------------------------------------------- helpers ---

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function requireSameCurrency(values: readonly Money[]): void {
  const first = values[0];
  if (first === undefined) return;
  for (const value of values) {
    if (value.currency !== first.currency) {
      throw new Error(
        `InsuranceEngine: amounts mix currencies (${first.currency} vs ${value.currency})`,
      );
    }
  }
}

function requireRatio(value: number, field: string, caller: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `InsuranceEngine.${caller}: ${field} must be in [0, 1], received ${String(value)}`,
    );
  }
}

