/**
 * System 41 — laws: the rule register, effective dates and amendment history,
 * exemptions, licensing permits, and the legality verdict.
 *
 * The spec's warnings drive the test cases: law and enforcement are distinct,
 * historical laws change over time, exemptions and overlapping jurisdictions
 * must be representable, and ambiguous cases must not be silently resolved.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { seedPlayableSlice } from "../../src/engine/kernel/sliceSeed.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { LawsEngine, conditionHolds } from "../../src/engine/laws/engine.ts";
import type { LawRule } from "../../src/engine/laws/types.ts";
import {
  AURELIA_SLICE_RULE_COUNT,
  ARDIN_JURISDICTION,
  aureliaArdenRules,
  registerAureliaLaws,
} from "../../src/content/aurelia/laws.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { currencyId, money } from "../../src/engine/primitives/money.ts";
import { addTime, atTime, days, type WorldTime } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-laws-seed";
const AUR = currencyId("AUR");
const MILL = "ORG-ARDEN-MILL-BAKERY";

/**
 * The slice's start, taken from the simulation rather than an epoch offset.
 * The seeded rules are in force from exactly this moment, so asking the law
 * about anything earlier would test nothing but the calendar.
 */
let T0: WorldTime = atTime(0);

function newWorld(): Simulation {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
  T0 = sim.clock.time;
  return sim;
}

function withLaws<T>(sim: Simulation, fn: (engine: LawsEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("laws", () => {
    result = fn(new LawsEngine(sim.scope, sim.world));
  });
  return result;
}

describe("laws (System 41)", () => {
  it("seeds a rule register from the slice's own content, idempotently", () => {
    const sim = newWorld();
    withLaws(sim, (engine) => {
      expect(aureliaArdenRules(T0)).toHaveLength(AURELIA_SLICE_RULE_COUNT);
      expect(engine.rules()).toHaveLength(AURELIA_SLICE_RULE_COUNT);
      expect(engine.rulesInForceAt(ARDIN_JURISDICTION, T0)).toHaveLength(AURELIA_SLICE_RULE_COUNT);

      // Every rule names a jurisdiction that is a real country (System 39).
      const countries = sim.world.systems.countries as {
        readonly countries: readonly { readonly id: string }[];
      };
      const countryIds = new Set(countries.countries.map((entry) => entry.id));
      expect(countryIds.has(ARDIN_JURISDICTION)).toBe(true);
      for (const rule of engine.rules()) {
        expect(rule.jurisdictionId).toBe(ARDIN_JURISDICTION);
        expect(rule.action.length).toBeGreaterThan(0);
        expect(rule.subjectKinds.length).toBeGreaterThan(0);
      }

      // No rule names an enforcement authority: System 43 has not been built,
      // and a reference to a government that does not exist is a lie.
      expect(engine.rules().some((rule) => rule.enforcementAuthorityId !== undefined)).toBe(false);
    });

    // Re-seeding re-legislates nothing (outside the laws scope: scopes never
    // nest, and the seed opens its own).
    seedPlayableSlice(sim);
    withLaws(sim, (engine) => {
      expect(engine.rules()).toHaveLength(AURELIA_SLICE_RULE_COUNT);
      expect(registerAureliaLaws(engine, T0)).toEqual({ rules: 0 });
    });
  });

  it("judges an act by the law in force at the time, and not another", () => {
    const sim = newWorld();
    withLaws(sim, (engine) => {
      // A licensed mill with a current inspection is in order.
      const licensed = engine.assess(
        ARDIN_JURISDICTION,
        "operate_mill",
        {
          subjectKind: "organization",
          heldCredentials: ["LIC-MILL-OPERATIONS"],
          facts: { safety_certificate_held: true, days_since_inspection: 10 },
        },
        T0,
      );
      expect(licensed.outcome).toBe("allowed");
      expect(licensed.appliedRuleIds).toEqual([
        "RULE-ARDIN-MILL-LICENCE",
        "RULE-ARDIN-MILL-INSPECTION",
      ]);
      // Obligations remain even when the act is allowed.
      expect(licensed.obligations.length).toBeGreaterThan(0);
      expect(licensed.declaredSanctions).toEqual([]);

      // Unlicensed, the same act is conditional and names what is missing.
      const unlicensed = engine.assess(
        ARDIN_JURISDICTION,
        "operate_mill",
        {
          subjectKind: "organization",
          facts: { safety_certificate_held: true, days_since_inspection: 10 },
        },
        T0,
      );
      expect(unlicensed.outcome).toBe("conditional");
      expect(unlicensed.missingCredentials).toEqual(["LIC-MILL-OPERATIONS"]);

      // A mill overdue for inspection is conditional on that fact alone.
      const overdue = engine.assess(
        ARDIN_JURISDICTION,
        "operate_mill",
        {
          subjectKind: "organization",
          heldCredentials: ["LIC-MILL-OPERATIONS"],
          facts: { safety_certificate_held: true, days_since_inspection: 400 },
        },
        T0,
      );
      expect(overdue.outcome).toBe("conditional");
      expect(overdue.reasons.join(" ")).toMatch(/days_since_inspection lte 365/);

      // An idle mill is exempt from the inspection obligation: a rule that
      // cannot apply because its subject has stopped is not a violation.
      const idle = engine.assess(
        ARDIN_JURISDICTION,
        "operate_mill",
        {
          subjectKind: "organization",
          heldCredentials: ["LIC-MILL-OPERATIONS"],
          facts: { operating: false, safety_certificate_held: true, days_since_inspection: 400 },
        },
        T0,
      );
      expect(idle.outcome).toBe("allowed");
      expect(idle.reasons.join(" ")).toMatch(/exempted \(mills_idle_under_force_majeure\)/);
      expect(idle.appliedRuleIds).toEqual(["RULE-ARDIN-MILL-LICENCE"]);
    });
  });

  it("states sanctions without applying them", () => {
    const sim = newWorld();
    withLaws(sim, (engine) => {
      // A rule with no conditions and no exemption: a flat prohibition.
      engine.defineRule({
        id: "RULE-PROBE-BAN",
        title: "Unattended crane work",
        kind: "prohibition",
        jurisdictionId: ARDIN_JURISDICTION,
        action: "work_quayside",
        subjectKinds: ["person"],
        conditions: [],
        sanctions: [
          { kind: "fine", amount: money(AUR, 9_000), note: "unattended crane work" },
          { kind: "criminal_charge", note: "reckless operation" },
        ],
        exemptions: [],
        effectiveFrom: T0,
      });
      const verdict = engine.assess(
        ARDIN_JURISDICTION,
        "work_quayside",
        { subjectKind: "person", heldCredentials: ["CERT-STEVEDORE"], facts: {} },
        T0,
      );
      expect(verdict.outcome).toBe("prohibited");
      expect(verdict.declaredSanctions.map((sanction) => sanction.kind)).toEqual([
        "fine",
        "criminal_charge",
      ]);
      expect(verdict.declaredSanctions[0]?.amount?.minorUnits).toBe(9_000);

      // Declaring a sanction is the whole of this system's involvement: no
      // fine was levied and no charge filed — those are System 48's acts, and
      // the laws register has no field in which to record them.
      const state = sim.world.systems.laws as {
        readonly rules: readonly unknown[];
        readonly permits: readonly unknown[];
      };
      expect(state.rules).toHaveLength(AURELIA_SLICE_RULE_COUNT + 1);
      expect(state.permits).toHaveLength(0);
    });
  });

  it("amends rules without rewriting history", () => {
    const sim = newWorld();
    const reformDate = addTime(T0, days(365 * 3));
    withLaws(sim, (engine) => {
      const old = engine.requireRule("RULE-ARDIN-FOOD-TRADING", "test");
      // Before the reform the exemption reads "a temporary stall", and
      // "temporary" is never defined. The engine applies the text as written:
      // a stall claiming to be temporary trades without a permit.
      const before = engine.assess(
        ARDIN_JURISDICTION,
        "sell_food",
        { subjectKind: "organization", heldCredentials: [], facts: { temporary_stall: true } },
        T0,
      );
      expect(before.outcome).toBe("allowed");
      expect(before.reasons.join(" ")).toMatch(/exempted \(temporary_stall_under_threshold\)/);
      // A stall that makes no such claim still needs the permit.
      const permanent = engine.assess(
        ARDIN_JURISDICTION,
        "sell_food",
        { subjectKind: "organization", heldCredentials: [], facts: { temporary_stall: false } },
        T0,
      );
      expect(permanent.outcome).toBe("conditional");
      expect(permanent.missingCredentials).toEqual(["PRM-FOOD-TRADING"]);

      // The reform *defines* the undefined term rather than merely repeating
      // it: a temporary stall is now one under a stated footprint.
      engine.amendRule(
        {
          ...old,
          id: "RULE-ARDIN-FOOD-TRADING-V2",
          title: "Food trading at markets (2045 reform)",
          effectiveFrom: reformDate,
          supersedesRuleId: old.id,
          exemptions: [
            {
              reason: "temporary_stall_defined_under_footprint",
              fact: "stall_footprint",
              operator: "lte",
              value: 20,
            },
          ],
        },
        reformDate,
      );
      // The old rule is closed on the reform date, not deleted, so the act
      // above is still judged by the text that applied to it.
      expect(engine.isInForce(old.id, T0)).toBe(true);
      expect(engine.isInForce(old.id, reformDate)).toBe(false);
      expect(engine.rule(old.id)?.effectiveTo).toBe(reformDate);
      expect(engine.ruleLine(old.id).map((rule) => rule.id)).toEqual([
        "RULE-ARDIN-FOOD-TRADING",
        "RULE-ARDIN-FOOD-TRADING-V2",
      ]);
      // An amendment cannot take effect before the rule it replaces.
      expect(() =>
        engine.amendRule(
          { ...old, id: "RULE-ARDIN-FOOD-TRADING-V3", effectiveFrom: T0, supersedesRuleId: old.id },
          T0,
        ),
      ).toThrow(/cannot take effect before/);
    });

    // After the reform the same stall, once its size is stated, is judged
    // against the new text: a big "temporary" stall now needs the permit.
    withLaws(sim, (engine) => {
      const smallStall = engine.assess(
        ARDIN_JURISDICTION,
        "sell_food",
        { subjectKind: "organization", heldCredentials: [], facts: { stall_footprint: 10 } },
        reformDate,
      );
      expect(smallStall.outcome).toBe("allowed");
      expect(smallStall.reasons.join(" ")).toMatch(/temporary_stall_defined_under_footprint/);

      const largeStall = engine.assess(
        ARDIN_JURISDICTION,
        "sell_food",
        { subjectKind: "organization", heldCredentials: [], facts: { stall_footprint: 30 } },
        reformDate,
      );
      expect(largeStall.outcome).toBe("conditional");
      expect(largeStall.missingCredentials).toEqual(["PRM-FOOD-TRADING"]);
    });
  });

  it("issues, revokes and expires permits", () => {
    const sim = newWorld();
    const ids = new IdAllocator();
    withLaws(sim, (engine) => {
      // A permit can only be issued under a licensing rule, and only to a
      // holder who meets that rule's conditions.
      expect(() =>
        engine.issuePermit(
          ids,
          { ruleId: "RULE-ARDIN-MILL-INSPECTION", holderId: MILL },
          T0,
        ),
      ).toThrow(/is a inspection, not a licensing rule/);
      expect(() =>
        engine.issuePermit(
          ids,
          { ruleId: "RULE-ARDIN-MILL-LICENCE", holderId: MILL, facts: { safety_certificate_held: false } },
          T0,
        ),
      ).toThrow(/does not meet RULE-ARDIN-MILL-LICENCE/);
      expect(() => engine.issuePermit(ids, { ruleId: "RULE-NOT-REAL", holderId: MILL }, T0)).toThrow(
        /unknown rule/,
      );

      const expiry = addTime(T0, days(365));
      const permit = engine.issuePermit(
        ids,
        {
          ruleId: "RULE-ARDIN-MILL-LICENCE",
          holderId: MILL,
          facts: { safety_certificate_held: true },
          expiresAt: expiry,
        },
        T0,
      );
      expect(permit.status).toBe("valid");
      expect(engine.credentialsHeldBy(MILL, T0)).toEqual(["LIC-MILL-OPERATIONS"]);

      // Held before expiry, and counted as held by the assess path.
      expect(engine.credentialsHeldBy(MILL, addTime(T0, days(364)))).toEqual([
        "LIC-MILL-OPERATIONS",
      ]);
      const licensed = engine.assess(
        ARDIN_JURISDICTION,
        "operate_mill",
        {
          subjectKind: "organization",
          heldCredentials: engine.credentialsHeldBy(MILL, addTime(T0, days(364))),
          facts: { safety_certificate_held: true, days_since_inspection: 5 },
        },
        addTime(T0, days(364)),
      );
      expect(licensed.outcome).toBe("allowed");

      // At the expiry instant the credential is already spent, while the
      // stored status still says "valid" until someone records the lapse.
      expect(engine.credentialsHeldBy(MILL, expiry)).toEqual([]);
      expect(engine.permit(permit.id)?.status).toBe("valid");
      engine.expirePermit(permit.id, expiry);
      expect(engine.permit(permit.id)?.status).toBe("expired");
      expect(() => engine.expirePermit(permit.id, expiry)).toThrow(/is expired/);

      // Revocation is recorded with a reason and takes effect at once.
      const revoked = engine.revokePermit(permit.id, expiry, "mill found unseised");
      expect(revoked.revocationReason).toMatch(/unseised/);
      expect(engine.credentialsHeldBy(MILL, expiry)).toEqual([]);
      expect(() => engine.revokePermit(permit.id, expiry, "again")).toThrow(/already revoked/);
      // The record survives: the permit is still answerable as a fact.
      expect(engine.permitsOf(MILL)).toHaveLength(1);
    });
  });

  it("keeps ambiguous law ambiguous, and missing facts unmet", () => {
    const sim = newWorld();
    withLaws(sim, (engine) => {
      // The food-trading rule is flagged ambiguous: the engine reports what
      // the text says and does not resolve the ambiguity into a verdict. If
      // the stall fact is supplied, the exemption text applies as written.
      const rule = engine.requireRule("RULE-ARDIN-FOOD-TRADING", "test");
      expect(rule.ambiguous).toBe(true);
      expect(rule.note).toMatch(/Provisional/);

      // A fact that was never stated does not pass a condition. Silence is
      // missing evidence, not compliance: a caller must say what it means.
      expect(conditionHolds({ fact: "x", operator: "eq", value: 1 }, {})).toBe(false);
      expect(conditionHolds({ fact: "x", operator: "eq", value: 1 }, { x: 1 })).toBe(true);
      expect(conditionHolds({ fact: "x", operator: "gt", value: 1 }, { x: "big" })).toBe(false);
      expect(conditionHolds({ fact: "x", operator: "in", value: [1, 2] }, { x: 2 })).toBe(true);

      // Two jurisdictions can govern the same act without either knowing
      // about the other: an overlapping-jurisdiction answer is two answers.
      engine.defineRule({
        id: "RULE-VEYRA-FOOD-TRADING",
        title: "Food trading in Veyra",
        kind: "permit",
        jurisdictionId: "COUNTRY-VEYRA",
        action: "sell_food",
        subjectKinds: ["organization"],
        conditions: [],
        sanctions: [],
        exemptions: [],
        requiredCredential: "PRM-VEYRA-FOOD",
        effectiveFrom: T0,
      });
      const inArdin = engine.assess(
        ARDIN_JURISDICTION,
        "sell_food",
        { subjectKind: "organization", heldCredentials: [], facts: {} },
        T0,
      );
      const inVeyra = engine.assess(
        "COUNTRY-VEYRA",
        "sell_food",
        { subjectKind: "organization", heldCredentials: [], facts: {} },
        T0,
      );
      expect(inArdin.missingCredentials).toEqual(["PRM-FOOD-TRADING"]);
      expect(inVeyra.missingCredentials).toEqual(["PRM-VEYRA-FOOD"]);
    });
  });

  it("refuses a malformed rule", () => {
    const sim = newWorld();
    withLaws(sim, (engine) => {
      const base: LawRule = engine.requireRule("RULE-ARDIN-MILL-LICENCE", "test");
      expect(() => engine.defineRule(base)).toThrow(/already exists/);
      expect(() =>
        engine.defineRule({ ...base, id: "RULE-X", kind: "vibes" as never }),
      ).toThrow(/unknown rule kind/);
      expect(() => engine.defineRule({ ...base, id: "RULE-X", jurisdictionId: "  " })).toThrow(
        /names no jurisdiction/,
      );
      expect(() => engine.defineRule({ ...base, id: "RULE-X", action: "" })).toThrow(
        /names no action/,
      );
      expect(() => engine.defineRule({ ...base, id: "RULE-X", subjectKinds: [] })).toThrow(
        /binds no subjects/,
      );
      // A licensing rule with no credential would be a licence to nothing.
      expect(() =>
        engine.defineRule({ ...base, id: "RULE-X", requiredCredential: undefined }),
      ).toThrow(/names no credential/);
      // A rule that ends before it begins is incoherent.
      expect(() =>
        engine.defineRule({ ...base, id: "RULE-X", effectiveTo: addTime(T0, days(-1)) }),
      ).toThrow(/ends before it begins/);
    });
  });

  it("projects rules into the shared authority evaluator", () => {
    const sim = newWorld();
    withLaws(sim, (engine) => {
      const registered = engine.registerInto(sim.authority, T0);
      expect(registered).toBe(AURELIA_SLICE_RULE_COUNT);
      expect(sim.authority.rulesOf()).toHaveLength(AURELIA_SLICE_RULE_COUNT);

      // The shared evaluator now denies unlicensed quay work and unlicensed
      // milling, naming the rule it applied. No second permission model was
      // built for laws (architectural law 6).
      const unlicensed = sim.authority.check(
        {
          actor: "PER-000001" as never,
          action: "work_quayside",
          jurisdiction: ARDIN_JURISDICTION as never,
          time: T0,
        },
        {
          roles: [],
          credentials: [],
          permissions: [],
          ownedRefs: [],
          memberOf: [],
          legalStatus: "resident",
          secrecyClearance: 0,
        },
      );
      expect(unlicensed.outcome).toBe("denied");
      expect(unlicensed.reasons).toEqual(["insufficient_credentials"]);
      expect(unlicensed.ruleId).toBe("RULE-ARDIN-STEVEDORE-CERT");
    });
  });

  it("keeps law state under single ownership and in the save format", () => {
    const sim = newWorld();

    const reader = new LawsEngine(sim.scope, sim.world);
    expect(reader.rules()).toHaveLength(AURELIA_SLICE_RULE_COUNT);
    expect(() => reader.expirePermit("prm-NOT-REAL", T0)).toThrow(MissingWriterContextError);
    expect(() =>
      sim.guard.mutate("markets", () => {
        new LawsEngine(sim.scope, sim.world).expirePermit("prm-NOT-REAL", T0);
      }),
    ).toThrow(OwnershipViolationError);

    const bag = (sim.serializedWorld() as { readonly systems?: Record<string, unknown> }).systems;
    expect(bag?.["laws"]).toBeDefined();
    const state = bag?.["laws"] as {
      readonly rules: readonly unknown[];
      readonly permits: readonly unknown[];
    };
    expect(state.rules).toHaveLength(AURELIA_SLICE_RULE_COUNT);
    expect(state.permits).toHaveLength(0);
  });
});
