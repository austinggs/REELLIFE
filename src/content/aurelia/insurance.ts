/**
 * Provisional insurance content for the Arden slice (M5 / System 31).
 *
 * The World Bible authors no insurers, policies or premiums (deferred
 * canon), so this module invents nothing grand: it authors the two cover
 * notes a working port would plausibly already carry, underwritten by the
 * **grain cooperative's mutual society** — a cooperative running its members'
 * mutual insurance is exactly the kind of arrangement the Bible's
 * "member_share_payouts" policy for the co-op implies, and it keeps every
 * party in the slice a real System 32 organization.
 *
 * The insured subjects are real vehicles from `transport.ts`, and the
 * premiums are **rated, not typed**: `quotePremium` computes them from
 * stated risk inputs, so a reader can see what the price is made of.
 * Every record is flagged `provisional`, and nothing here is canon.
 */

import type { IssuePolicyRequest, InsuranceEngine } from "../../engine/insurance/engine.ts";
import { quotePremium } from "../../engine/insurance/engine.ts";
import { currencyId, money } from "../../engine/primitives/money.ts";
import type { WorldTime } from "../../engine/primitives/time.ts";
import { AURELIA_CURRENCY } from "./countries.ts";

const AUR = currencyId(AURELIA_CURRENCY.code);
const aur = (major: number): number => Math.round(major * 100);

const PROVISIONAL_NOTE =
  "Provisional: the World Bible authors no insurers, policies or premiums (M5/S31 gap list).";

/** The co-op's mutual society — the slice's only insurer, on the record. */
export const AURELIA_MUTUAL_SOCIETY = {
  orgId: "ORG-GRAIN-BASIN-COOP",
  name: "Basin Mutual Assurance Society",
} as const;

export const AURELIA_SLICE_POLICY_COUNT = 2;

/** The bakery's delivery van: modest cover, a real deductible. */
export const AURELIA_BAKERY_VAN_POLICY = "POL-ARDEN-BAKERY-VAN";
/** The docks' tractor: heavier cover for heavier cargo. */
export const AURELIA_DOCKS_TRACTOR_POLICY = "POL-ARDEN-DOCKS-TRACTOR";

/**
 * The slice's policies. Premiums are computed by `quotePremium` from the
 * risk inputs stated beside each one, so the price is explainable.
 */
export function aureliaArdenPolicies(): readonly IssuePolicyRequest[] {
  const vanQuote = quotePremium(
    {
      probability: 0.12,
      severity: 0.5,
      exposure: 0.6,
      claimsHistory: 0,
      marketPressure: 0.2,
      regulatoryLoading: 0.1,
    },
    { limitMinorUnits: aur(400), expectedLossMinorUnits: aur(24) },
  );
  const tractorQuote = quotePremium(
    {
      probability: 0.18,
      severity: 0.65,
      exposure: 0.8,
      claimsHistory: 0.1,
      marketPressure: 0.15,
      regulatoryLoading: 0.15,
    },
    { limitMinorUnits: aur(1_200), expectedLossMinorUnits: aur(60) },
  );
  return [
    {
      id: AURELIA_BAKERY_VAN_POLICY,
      insurerOrgId: AURELIA_MUTUAL_SOCIETY.orgId,
      policyholderId: "ORG-ARDEN-MILL-BAKERY",
      subjectId: "VEH-ARDEN-BAKERY-VAN",
      subjectKind: "vehicle",
      coverage: "vehicle",
      coverageLimit: money(AUR, aur(400)),
      deductible: money(AUR, aur(20)),
      premium: money(AUR, vanQuote.premiumMinorUnits),
      riskScore: 0.45,
      // Gradual wear is not an accident, and nobody is covered for driving
      // without a licence: the two exclusions a mutual society always writes.
      exclusions: ["wear_and_tear", "unlicensed_driving"],
      beneficiaries: ["ORG-ARDEN-MILL-BAKERY"],
      note: PROVISIONAL_NOTE,
    },
    {
      id: AURELIA_DOCKS_TRACTOR_POLICY,
      insurerOrgId: AURELIA_MUTUAL_SOCIETY.orgId,
      policyholderId: "ORG-ARDIN-DOCKS",
      subjectId: "VEH-ARDEN-DOCKS-TRACTOR",
      subjectKind: "vehicle",
      coverage: "vehicle",
      coverageLimit: money(AUR, aur(1_200)),
      deductible: money(AUR, aur(50)),
      premium: money(AUR, tractorQuote.premiumMinorUnits),
      riskScore: 0.6,
      exclusions: ["wear_and_tear", "unlicensed_driving", "loading_error"],
      beneficiaries: ["ORG-ARDIN-DOCKS"],
      note: PROVISIONAL_NOTE,
    },
  ];
}

/**
 * Registers the slice's cover notes. Idempotent: an existing policy is left
 * alone, so re-seeding never re-issues a policy (which in the world would
 * quietly void the claims attached to the old one).
 */
export function registerAureliaInsurance(
  engine: InsuranceEngine,
  now: WorldTime,
): { readonly policies: number } {
  let policies = 0;
  for (const request of aureliaArdenPolicies()) {
    if (engine.policy(request.id) !== undefined) continue;
    engine.issuePolicy(request, now);
    policies += 1;
  }
  return { policies };
}
