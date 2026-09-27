/**
 * System 31 — insurance: policies, the claim lifecycle, deductibles, limits,
 * partial coverage, exclusions, underwriting shifts, fraud signals and
 * payout accounting.
 *
 * Every behaviour below is one the spec names for testing, and each is
 * checked against engine state: a payout is arithmetic over the policy, not
 * a number a test decided, and the claim lifecycle is enforced as the spec's
 * own graph rather than as a straight line.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { seedPlayableSlice } from "../../src/engine/kernel/sliceSeed.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { InsuranceEngine, payoutOf, quotePremium, type IssuePolicyRequest } from "../../src/engine/insurance/engine.ts";
import {
  AURELIA_BAKERY_VAN_POLICY,
  AURELIA_DOCKS_TRACTOR_POLICY,
  AURELIA_MUTUAL_SOCIETY,
  AURELIA_SLICE_POLICY_COUNT,
  aureliaArdenPolicies,
  registerAureliaInsurance,
} from "../../src/content/aurelia/insurance.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { currencyId, money } from "../../src/engine/primitives/money.ts";
import { atTime, days } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-insurance-seed";
const AUR = currencyId("AUR");
const NOW = atTime(days(365));
const VAN_DEDUCTIBLE = money(AUR, 2_000);
const VAN_LIMIT = money(AUR, 40_000);

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
}

function withInsurance<T>(sim: Simulation, fn: (engine: InsuranceEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("insurance", () => {
    result = fn(new InsuranceEngine(sim.scope, sim.world));
  });
  return result;
}

describe("insurance (System 31)", () => {
  it("issues the slice's cover on real vehicles, idempotently", () => {
    const sim = newWorld();
    withInsurance(sim, (engine) => {
      expect(aureliaArdenPolicies()).toHaveLength(AURELIA_SLICE_POLICY_COUNT);
      expect(engine.policies()).toHaveLength(AURELIA_SLICE_POLICY_COUNT);
      expect(engine.claims()).toHaveLength(0);
      expect(engine.activePolicies()).toHaveLength(AURELIA_SLICE_POLICY_COUNT);

      // The insurer is a real organization (System 32) and the insured
      // subjects are real vehicles (System 28) — insurance is not floating.
      const organizations = sim.world.systems.organizations as {
        readonly organizations: readonly { readonly id: string }[];
      };
      const orgIds = new Set(organizations.organizations.map((entry) => entry.id));
      const transport = sim.world.systems.transport as {
        readonly vehicles: readonly { readonly id: string }[];
      };
      const vehicleIds = new Set(transport.vehicles.map((entry) => entry.id));
      for (const policy of engine.policies()) {
        expect(orgIds.has(policy.insurerOrgId)).toBe(true);
        expect(orgIds.has(policy.policyholderId)).toBe(true);
        expect(vehicleIds.has(policy.subjectId)).toBe(true);
      }
      expect(engine.policy(AURELIA_BAKERY_VAN_POLICY)?.insurerOrgId).toBe(
        AURELIA_MUTUAL_SOCIETY.orgId,
      );
      // The premium is the rating function's output, so a reader can see
      // what the price is made of rather than trusting a typed-in number.
      const van = engine.policy(AURELIA_BAKERY_VAN_POLICY);
      expect(van?.premium.minorUnits).toBeGreaterThan(0);
      expect(van?.history[0]?.kind).toBe("issued");
    });

    // Re-seeding re-issues nothing.
    seedPlayableSlice(sim);
    withInsurance(sim, (engine) => {
      expect(engine.policies()).toHaveLength(AURELIA_SLICE_POLICY_COUNT);
      expect(registerAureliaInsurance(engine, NOW)).toEqual({ policies: 0 });
    });
  });

  it("refuses an incoherent policy", () => {
    const sim = newWorld();
    withInsurance(sim, (engine) => {
      const base = aureliaArdenPolicies()[0] as IssuePolicyRequest;
      expect(() => engine.issuePolicy(base, NOW)).toThrow(/already exists/);
      // A phantom insurer is refused when System 32 is present.
      expect(() =>
        engine.issuePolicy({ ...base, id: "POL-PROBE", insurerOrgId: "ORG-NOT-REAL" }, NOW),
      ).toThrow(/not a registered organization/);
      // A deductible larger than the cover is a promise nobody can keep.
      expect(() =>
        engine.issuePolicy({ ...base, id: "POL-PROBE", deductible: money(AUR, 50_000) }, NOW),
      ).toThrow(/exceeds the coverage limit/);
      expect(() =>
        engine.issuePolicy({ ...base, id: "POL-PROBE", coverageLimit: money(AUR, 0) }, NOW),
      ).toThrow(/must be positive/);
      // A policy cannot expire before it starts.
      expect(() =>
        engine.issuePolicy({ ...base, id: "POL-PROBE", expiresAt: atTime(days(1)) }, atTime(days(365))),
      ).toThrow(/expire before it starts/);
    });
  });

  it("pays a claim as arithmetic: deductible first, then the limit", () => {
    const sim = newWorld();
    const ids = new IdAllocator();
    withInsurance(sim, (engine) => {
      // The pure rule, stated once: loss less deductible, capped by cover.
      expect(payoutOf(money(AUR, 5_000), VAN_DEDUCTIBLE, VAN_LIMIT).minorUnits).toBe(3_000);
      // A loss below the deductible pays nothing — that is what a
      // deductible is for.
      expect(payoutOf(money(AUR, 1_000), VAN_DEDUCTIBLE, VAN_LIMIT).minorUnits).toBe(0);

      const claim = engine.fileClaim(
        ids,
        {
          policyId: AURELIA_BAKERY_VAN_POLICY,
          incidentKind: "vehicle_breakdown",
          incidentRef: "dis-PROBE",
          incidentAt: NOW,
          claimedAmount: money(AUR, 5_000),
        },
        NOW,
      );
      expect(claim.status).toBe("claimed");
      // The quote before approval is the same arithmetic, so what is paid
      // cannot surprise anyone after the fact.
      expect(engine.quotePayout(claim.id, money(AUR, 5_000)).minorUnits).toBe(3_000);

      engine.transitionClaim(claim.id, "reviewing", NOW, "adjuster assigned");
      const approved = engine.approveClaim(claim.id, money(AUR, 5_000), NOW, "genuine breakdown");
      expect(approved.status).toBe("approved");
      expect(approved.deductibleApplied?.minorUnits).toBe(2_000);
      expect(approved.payout?.minorUnits).toBe(3_000);

      // Paying records the caller's ledger entry; the money itself is 25's.
      const paid = engine.payClaim(claim.id, NOW, "tx-000001");
      expect(paid.status).toBe("paid");
      expect(paid.ledgerEntryId).toBe("tx-000001");
      expect(engine.paidTotal(AURELIA_BAKERY_VAN_POLICY).minorUnits).toBe(3_000);
      expect(engine.remainingCover(AURELIA_BAKERY_VAN_POLICY).minorUnits).toBe(37_000);

      // A second, larger loss is capped by what cover is left: partial
      // coverage falls out of the arithmetic rather than a decision.
      const second = engine.fileClaim(
        ids,
        {
          policyId: AURELIA_BAKERY_VAN_POLICY,
          incidentKind: "vehicle_collision",
          incidentRef: "dis-PROBE-2",
          incidentAt: NOW,
          claimedAmount: money(AUR, 100_000),
        },
        NOW,
      );
      engine.transitionClaim(second.id, "reviewing", NOW, "second loss");
      const capped = engine.approveClaim(second.id, money(AUR, 100_000), NOW);
      expect(capped.payout?.minorUnits).toBe(37_000);
      engine.payClaim(second.id, NOW, "tx-000002");
      expect(engine.remainingCover(AURELIA_BAKERY_VAN_POLICY).minorUnits).toBe(0);
      // A policyholder with no cover left still cannot invent any.
      const third = engine.fileClaim(
        ids,
        {
          policyId: AURELIA_BAKERY_VAN_POLICY,
          incidentKind: "vehicle_collision",
          incidentRef: "dis-PROBE-3",
          incidentAt: NOW,
          claimedAmount: money(AUR, 10_000),
        },
        NOW,
      );
      engine.transitionClaim(third.id, "reviewing", NOW, "third loss");
      expect(engine.approveClaim(third.id, money(AUR, 10_000), NOW).payout?.minorUnits).toBe(0);
    });
  });

  it("honours exclusions, and suspicion is a state rather than a denial", () => {
    const sim = newWorld();
    const ids = new IdAllocator();
    withInsurance(sim, (engine) => {
      // Gradual wear is excluded; a breakdown is not.
      expect(engine.covers(AURELIA_BAKERY_VAN_POLICY, "wear_and_tear")).toBe(false);
      expect(engine.covers(AURELIA_BAKERY_VAN_POLICY, "vehicle_breakdown")).toBe(true);

      const wear = engine.fileClaim(
        ids,
        {
          policyId: AURELIA_BAKERY_VAN_POLICY,
          incidentKind: "wear_and_tear",
          incidentRef: "dis-WEAR",
          incidentAt: NOW,
          claimedAmount: money(AUR, 3_000),
        },
        NOW,
      );
      engine.transitionClaim(wear.id, "reviewing", NOW, "reviewing wear");
      // The exclusion is the contract: it cannot be approved past.
      expect(() => engine.approveClaim(wear.id, money(AUR, 3_000), NOW)).toThrow(/excludes/);

      // Fraud suspicion records a state and a reason; the claim stays
      // reviewable rather than vanishing into a denial.
      const suspect = engine.fileClaim(
        ids,
        {
          policyId: AURELIA_DOCKS_TRACTOR_POLICY,
          incidentKind: "loading_error",
          incidentRef: "dis-LOAD",
          incidentAt: NOW,
          claimedAmount: money(AUR, 9_000),
        },
        NOW,
      );
      engine.transitionClaim(suspect.id, "reviewing", NOW, "adjuster review");
      const flagged = engine.suspectFraud(suspect.id, "damage predates the shift", NOW);
      expect(flagged.status).toBe("fraud_suspected");
      expect(flagged.decisionReason).toMatch(/predates/);
      // A suspected claim counts against the holder's rating input…
      expect(engine.claimsHistoryScore("ORG-ARDIN-DOCKS")).toBe(1);
      // …and can still be appealed: suspicion is reviewable, not final.
      engine.appealClaim(suspect.id, "the yard log disagrees", NOW);
      engine.transitionClaim(suspect.id, "reviewing", NOW, "reopened");
      // `loading_error` is excluded on the docks' policy too, so even a
      // reopened claim cannot be approved past the exclusion.
      expect(() => engine.approveClaim(suspect.id, money(AUR, 9_000), NOW)).toThrow(/excludes/);
    });
  });

  it("moves claims only along the lifecycle, and never pays a denial", () => {
    const sim = newWorld();
    const ids = new IdAllocator();
    withInsurance(sim, (engine) => {
      const claim = engine.fileClaim(
        ids,
        {
          policyId: AURELIA_BAKERY_VAN_POLICY,
          incidentKind: "vehicle_breakdown",
          incidentRef: "dis-LIFE",
          incidentAt: NOW,
          claimedAmount: money(AUR, 6_000),
        },
        NOW,
      );
      // A claim cannot jump straight to paid, and cannot be approved before
      // anyone has reviewed it.
      expect(() => engine.payClaim(claim.id, NOW, "tx-000009")).toThrow(/the lifecycle allows/);
      expect(() => engine.approveClaim(claim.id, money(AUR, 6_000), NOW)).toThrow(
        /the lifecycle allows/,
      );

      // The full reviewable path: claimed -> reviewing -> denied -> appealed
      // -> reviewing -> approved -> paid.
      engine.transitionClaim(claim.id, "reviewing", NOW, "review");
      engine.denyClaim(claim.id, "no damage visible at first inspection", NOW);
      expect(engine.openClaims()).toHaveLength(0);
      engine.appealClaim(claim.id, "damage found after teardown", NOW);
      expect(engine.openClaims()).toHaveLength(1);
      engine.transitionClaim(claim.id, "reviewing", NOW, "reopened");
      const approved = engine.approveClaim(claim.id, money(AUR, 6_000), NOW);
      expect(approved.payout?.minorUnits).toBe(4_000);
      engine.payClaim(claim.id, NOW, "tx-000010");
      // A paid claim is terminal: nothing moves it any more.
      expect(() => engine.appealClaim(claim.id, "more", NOW)).toThrow(/the lifecycle allows/);
      expect(engine.openClaims()).toHaveLength(0);
      // A denial cannot be paid, whatever anyone tries.
      const denied = engine.fileClaim(
        ids,
        {
          policyId: AURELIA_BAKERY_VAN_POLICY,
          incidentKind: "vehicle_breakdown",
          incidentRef: "dis-DENIED",
          incidentAt: NOW,
          claimedAmount: money(AUR, 4_000),
        },
        NOW,
      );
      engine.denyClaim(denied.id, "pre-existing damage", NOW);
      expect(() => engine.payClaim(denied.id, NOW, "tx-000011")).toThrow(/the lifecycle allows/);
    });
  });

  it("stops cover on cancellation, and records an underwriting shift", () => {
    const sim = newWorld();
    const ids = new IdAllocator();
    withInsurance(sim, (engine) => {
      // An underwriting shift moves the risk score and the premium together,
      // and leaves both in the policy's history.
      const rerated = engine.reratePolicy(
        AURELIA_BAKERY_VAN_POLICY,
        { riskScore: 0.8, premium: money(AUR, 1_500) },
        NOW,
      );
      expect(rerated.riskScore).toBe(0.8);
      expect(rerated.premium.minorUnits).toBe(1_500);
      expect(rerated.history.at(-1)?.note).toMatch(/risk 0\.45 -> 0\.8, premium/);
      expect(() =>
        engine.reratePolicy(
          AURELIA_BAKERY_VAN_POLICY,
          { riskScore: 0.9, premium: money(AUR, -1) },
          NOW,
        ),
      ).toThrow(/must not be negative/);

      // Cancellation ends cover from now; the policy remains, with a reason.
      engine.cancelPolicy(AURELIA_DOCKS_TRACTOR_POLICY, NOW, "member sold the tractor");
      expect(engine.activePolicies()).toHaveLength(1);
      expect(engine.policy(AURELIA_DOCKS_TRACTOR_POLICY)?.closeReason).toMatch(/sold the tractor/);
      expect(() =>
        engine.fileClaim(
          ids,
          {
            policyId: AURELIA_DOCKS_TRACTOR_POLICY,
            incidentKind: "vehicle_breakdown",
            incidentRef: "dis-LATE",
            incidentAt: NOW,
            claimedAmount: money(AUR, 2_000),
          },
          NOW,
        ),
      ).toThrow(/is cancelled/);
      // A cancelled policy is not a second time cancellable.
      expect(() => engine.cancelPolicy(AURELIA_DOCKS_TRACTOR_POLICY, NOW, "again")).toThrow(
        /is cancelled, not active/,
      );
      // Expiry is its own recorded outcome.
      engine.closePolicy(AURELIA_BAKERY_VAN_POLICY, "expired", NOW, "term ended");
      expect(engine.activePolicies()).toHaveLength(0);
    });
  });

  it("rates a premium from the spec's own inputs, and says so", () => {
    const basis = { limitMinorUnits: 40_000, expectedLossMinorUnits: 2_400 };
    const calm = quotePremium(
      { probability: 0.05, severity: 0.3, exposure: 0.2, claimsHistory: 0 },
      basis,
    );
    const risky = quotePremium(
      { probability: 0.4, severity: 0.8, exposure: 0.7, claimsHistory: 0.5 },
      basis,
    );
    // Risk raises the price; the components are visible, not folded away.
    expect(risky.premiumMinorUnits).toBeGreaterThan(calm.premiumMinorUnits);
    expect(risky.riskLoadMinorUnits).toBeGreaterThan(calm.riskLoadMinorUnits);
    expect(calm.basisMinorUnits).toBe(basis.expectedLossMinorUnits);

    // Competition discounts and regulation load — neither moves the risk.
    const crowded = quotePremium(
      { probability: 0.05, severity: 0.3, exposure: 0.2, claimsHistory: 0, marketPressure: 1 },
      basis,
    );
    expect(crowded.premiumMinorUnits).toBeLessThan(calm.premiumMinorUnits);
    const regulated = quotePremium(
      { probability: 0.05, severity: 0.3, exposure: 0.2, claimsHistory: 0, regulatoryLoading: 1 },
      basis,
    );
    expect(regulated.premiumMinorUnits).toBeGreaterThan(calm.premiumMinorUnits);
    expect(regulated.premiumMinorUnits).toBe(
      calm.premiumMinorUnits + regulated.regulatoryLoadingMinorUnits,
    );
  });

  it("keeps insurance state under single ownership and in the save format", () => {
    const sim = newWorld();

    const reader = new InsuranceEngine(sim.scope, sim.world);
    expect(reader.policies()).toHaveLength(AURELIA_SLICE_POLICY_COUNT);
    expect(() => reader.cancelPolicy(AURELIA_BAKERY_VAN_POLICY, NOW, "x")).toThrow(
      MissingWriterContextError,
    );
    expect(() =>
      sim.guard.mutate("markets", () => {
        new InsuranceEngine(sim.scope, sim.world).cancelPolicy(AURELIA_BAKERY_VAN_POLICY, NOW, "x");
      }),
    ).toThrow(OwnershipViolationError);

    const bag = (sim.serializedWorld() as { readonly systems?: Record<string, unknown> }).systems;
    expect(bag?.["insurance"]).toBeDefined();
    const state = bag?.["insurance"] as {
      readonly policies: readonly unknown[];
      readonly claims: readonly unknown[];
    };
    expect(state.policies).toHaveLength(AURELIA_SLICE_POLICY_COUNT);
    expect(state.claims).toHaveLength(0);
  });
});

