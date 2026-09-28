/**
 * System 53 (partial) — life continuity: death lifecycle without erasing the
 * causal graph. PersonId persists across death; identity and continuity each
 * take their own write through pronounceDeath.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import {
  LifeContinuityEngine,
  pronounceDeath,
} from "../../src/engine/continuity/engine.ts";
import { IdentityEngine } from "../../src/engine/identity/engine.ts";
import { asEntityId, type EntityId } from "../../src/engine/primitives/ids.ts";
import { HealthEngine } from "../../src/engine/health/engine.ts";
import { FamilyEngine } from "../../src/engine/family/engine.ts";
import { EmploymentEngine } from "../../src/engine/employment/engine.ts";
import { LegalIdentityEngine } from "../../src/engine/legalIdentity/engine.ts";
import { currencyId, money } from "../../src/engine/primitives/money.ts";
import { processDeath } from "../../src/engine/continuity/death.ts";
import { checkMortality, annualMortalityHazard } from "../../src/engine/continuity/mortality.ts";
import { AgingEngine } from "../../src/engine/aging/engine.ts";


import { atTime } from "../../src/engine/primitives/time.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";

const SEED = "reellife-continuity-seed";
const UNKNOWN = asEntityId<"person">("PER-999999");

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
}

function createPerson(sim: Simulation): EntityId<"person"> {
  let id: EntityId<"person"> = UNKNOWN;
  sim.guard.mutate("identity", () => {
    id = new IdentityEngine(sim.scope, sim.world).create(sim.ids, {
      name: { first: "Test", last: "Subject" },
      birth: { dateOfBirth: atTime(0) },
      appearanceFoundationSeed: "continuity-fixture",
    }).id;
  });
  return id;
}

/** Constructs the engine inside its ownership scope; state may not exist yet. */
function continuityOf(sim: Simulation): LifeContinuityEngine {
  let engine!: LifeContinuityEngine;
  sim.guard.mutate("continuity", () => {
    engine = new LifeContinuityEngine(sim.scope, sim.world);
  });
  return engine;
}

describe("life continuity (System 53, M2 partial)", () => {
  it("pronounceDeath records identity and continuity without erasing PersonId", () => {
    const sim = newWorld();
    const personId = createPerson(sim);

    pronounceDeath(sim, personId, sim.clock.time, "workplace accident");

    const identity = new IdentityEngine(sim.scope, sim.world).get(personId);
    expect(identity?.id).toBe(personId);
    expect(identity?.death).toMatchObject({ date: sim.clock.time, cause: "workplace accident" });

    const continuity = new LifeContinuityEngine(sim.scope, sim.world);
    expect(continuity.statusOf(personId)).toBe("deceased");
    expect(continuity.deathOf(personId)).toMatchObject({
      personId,
      declaredAt: sim.clock.time,
      cause: "workplace accident",
    });

    // Death cannot be declared twice.
    expect(() => pronounceDeath(sim, personId, sim.clock.time)).toThrow(/already dead/);
  });

  it("pronounceDeath for an unknown person leaves continuity untouched", () => {
    const sim = newWorld();
    expect(() => pronounceDeath(sim, UNKNOWN, sim.clock.time, "unknown")).toThrow(/Unknown person/);
    expect(continuityOf(sim).statusOf(UNKNOWN)).toBe("active");
  });

  it("lifecycle runs active -> deceased -> historical exactly once each", () => {
    const sim = newWorld();
    const continuity = continuityOf(sim);
    expect(continuity.statusOf(UNKNOWN)).toBe("active");
    expect(() =>
      sim.guard.mutate("continuity", () => continuity.markHistorical(UNKNOWN)),
    ).toThrow(/not deceased/);

    sim.guard.mutate("continuity", () => continuity.registerDeath(UNKNOWN, sim.clock.time, "age"));
    expect(continuity.statusOf(UNKNOWN)).toBe("deceased");
    expect(() =>
      sim.guard.mutate("continuity", () => continuity.registerDeath(UNKNOWN, sim.clock.time)),
    ).toThrow(/not active/);

    sim.guard.mutate("continuity", () => continuity.markHistorical(UNKNOWN));
    expect(continuity.statusOf(UNKNOWN)).toBe("historical");
    // The death record survives the historical transition.
    expect(continuity.deathOf(UNKNOWN)).toMatchObject({ cause: "age" });
  });
  it("annualMortalityHazard scales realistically with age", () => {
    const youngAdult = annualMortalityHazard(25);
    const senior = annualMortalityHazard(75);
    const centenarian = annualMortalityHazard(102);

    expect(youngAdult).toBe(0); // Under minimumAgeYears (65)
    expect(senior).toBeGreaterThan(0);
    expect(centenarian).toBeGreaterThan(senior);
    expect(centenarian).toBeLessThanOrEqual(0.65);
  });

  it("processDeath orchestrates single-owner writes across domains sequentially", () => {
    const sim = newWorld();
    const aliceId = createPerson(sim);
    const bobId = createPerson(sim);
    const deathTime = atTime(5000);

    // Setup health, family, and employment
    sim.guard.mutate("health", () => {
      new HealthEngine(sim.scope, sim.world).registerPerson(aliceId);
    });

    sim.guard.mutate("family", () => {
      const family = new FamilyEngine(sim.scope, sim.world);
      const hh = family.createHousehold(sim.ids, "Smith", aliceId, atTime(0));
      family.addHouseholdMember(hh.id, bobId, "partner", atTime(0));
    });

    sim.guard.mutate("employment", () => {
      new EmploymentEngine(sim.scope, sim.world).hire(
        sim.ids,
        aliceId,
        "ORG-AURELIA-LAB",
        "Researcher",
        "OCC-RESEARCH",
        money(currencyId("AUREL"), 4000),
        40,
        atTime(100),
      );
    });

    // Execute death pipeline
    const outcome = processDeath(sim, {
      personId: aliceId,
      cause: "disease",
      causeNote: "acute coronary syndrome",
      at: deathTime,
      determinedBy: "medical",
      certainty: "certain",
    });

    expect(outcome.personId).toBe(aliceId);
    expect(outcome.determination.certainty).toBe("certain");
    expect(outcome.determination.cause).toBe("disease");
    expect(outcome.record.cause).toBe("disease");
    expect(outcome.civilRecordId).toBeDefined();

    // Verify identity death
    const identity = new IdentityEngine(sim.scope, sim.world).get(aliceId);
    expect(identity?.death).toEqual({
      date: deathTime,
      cause: "acute coronary syndrome",
    });

    // Verify health vital state
    const health = new HealthEngine(sim.scope, sim.world);
    expect(health.getPerson(aliceId)?.vitalState).toBe("deceased");

    // Verify continuity state
    const continuity = new LifeContinuityEngine(sim.scope, sim.world);
    expect(continuity.statusOf(aliceId)).toBe("deceased");
    expect(continuity.all()).toHaveLength(1);

    // Verify legal civil death record
    const legal = new LegalIdentityEngine(sim.scope, sim.world);
    const civilRecord = legal.get(outcome.civilRecordId!);
    expect(civilRecord?.type).toBe("deathRegistration");
    expect(civilRecord?.subject).toBe(aliceId);

    // Verify family household stint ended
    const family = new FamilyEngine(sim.scope, sim.world);
    const hh = family.householdsOf(aliceId)[0];
    const aliceMember = hh.members.find((m) => m.personId === aliceId);
    expect(aliceMember?.leftAt).toBe(deathTime);
    expect(aliceMember?.leftReason).toBe("death");
    expect(family.currentMembers(hh.id).map((m) => m.personId)).toEqual([bobId]);

    // Verify employment terminated
    const employment = new EmploymentEngine(sim.scope, sim.world);
    expect(employment.activeEmployments(aliceId)).toHaveLength(0);

    // Verify history timeline entry
    const entries = sim.history.forPerson(aliceId);
    expect(entries.some((e) => e.kind === "death" && e.importance === 5)).toBe(true);

    // Cannot die again
    expect(() =>
      processDeath(sim, {
        personId: aliceId,
        cause: "accident",
        at: deathTime,
      }),
    ).toThrow(/already deceased/);
  });

  it("checkMortality evaluates hazards deterministically per person seed", () => {
    const sim = newWorld();
    const elderlyId = createPerson(sim);

    sim.guard.mutate("aging", () => {
      new AgingEngine(sim.scope, sim.world).registerBirth(elderlyId, atTime(0));
    });

    // Sweep across at age 105 (105 mean-Gregorian years of minutes)
    const now = atTime(Math.round(105 * 365.2425 * 1440));
    const sweep = checkMortality(sim, [elderlyId], now);
    expect(sweep.assessments).toHaveLength(1);
    // Age is derived from the clock and fractional, so it is compared as an
    // approximate quantity rather than an exact integer.
    expect(sweep.assessments[0].ageYears).toBeCloseTo(105, 3);
    expect(sweep.assessments[0].annualHazard).toBeGreaterThan(0.3);
    // The draw is taken from this person's own named stream, and is recorded.
    expect(sweep.assessments[0].streamPath).toContain(String(elderlyId));
    expect(sweep.assessments[0].roll).toBeDefined();
  });

  it("checkMortality assesses a young person as ineligible and takes no draw", () => {
    const sim = newWorld();
    const youngId = createPerson(sim);
    sim.guard.mutate("aging", () => {
      new AgingEngine(sim.scope, sim.world).registerBirth(youngId, atTime(0));
    });

    const sweep = checkMortality(sim, [youngId], atTime(Math.round(30 * 365.2425 * 1440)));
    // Below the minimum age the answer is a recorded "no", not silence: the
    // sweep stays complete, and no randomness is consumed to reach it.
    expect(sweep.assessments).toHaveLength(1);
    expect(sweep.assessments[0].annualHazard).toBe(0);
    expect(sweep.assessments[0].roll).toBeUndefined();
    expect(sweep.deaths).toHaveLength(0);
  });

  it("checkMortality skips a person System 09 has never registered", () => {
    const sim = newWorld();
    const personId = createPerson(sim);
    // No aging record: there is no age to reason from, so no assessment.
    const sweep = checkMortality(sim, [personId], atTime(Math.round(105 * 365.2425 * 1440)));
    expect(sweep.assessments).toHaveLength(0);
    expect(sweep.deaths).toHaveLength(0);
  });

  it("checkMortality refuses to sweep someone already dead", () => {
    const sim = newWorld();
    const personId = createPerson(sim);
    sim.guard.mutate("aging", () => {
      new AgingEngine(sim.scope, sim.world).registerBirth(personId, atTime(0));
    });
    processDeath(sim, { personId, cause: "disease", at: atTime(10) });

    const sweep = checkMortality(sim, [personId], atTime(Math.round(105 * 365.2425 * 1440)));
    expect(sweep.assessments).toHaveLength(0);
    expect(sweep.deaths).toHaveLength(0);
  });
});
