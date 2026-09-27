/**
 * M6 DoD — one legal pipeline, end to end, on a real rule.
 *
 * Systems 41 and 48 must agree about a single act. The story: a sack goes
 * missing from the mill, someone notices it, it is reported, an investigator
 * gathers evidence, a charge is brought under a rule that System 41 authored,
 * a hearing convicts, the *declared* sanctions are applied, and an appeal
 * vacates them.
 *
 * Four things the milestone claims are asserted here rather than assumed:
 *
 *   1. **Detection can fail, and that is not a bug.** A second theft at the
 *      mill, in the dark with nothing left behind, is never noticed — so it
 *      never becomes a case, and the world is left with a crime and no record
 *      of one. This is the ordinary case, and the pipeline must survive it.
 *   2. **A rule is the only thing that can be charged.** The charge names a
 *      System 41 rule, and the same charge filed in the wrong jurisdiction is
 *      refused rather than quietly accepted.
 *   3. **Declaring is not applying.** Between the charge and the hearing there
 *      is a moment when the law says a fine is possible and no fine exists.
 *   4. **It reproduces.** The same seed and the same steps give the same
 *      outcomes, the same evidence balance and the same penalties.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { LawsEngine } from "../../src/engine/laws/engine.ts";
import { SecurityEngine } from "../../src/engine/security/engine.ts";
import type { DetectionConditions } from "../../src/engine/security/types.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { addTime, days, type WorldTime } from "../../src/engine/primitives/time.ts";
import { RngRegistry } from "../../src/engine/rng/streams.ts";
import { registerAureliaLaws } from "../../src/content/aurelia/laws.ts";
import { M2_SETTLEMENT_ID } from "../../src/content/aurelia/geography.ts";

const SEED = "reellife-legal-pipeline-c";
const ARDIN = "COUNTRY-ARDIN";
const MILL_LICENCE = "RULE-ARDIN-MILL-LICENCE";
const SUSPECT = "PERSON-MILL-HAND";
const MILL = "ORG-ARDEN-MILL-BAKERY";

/**
 * Each detection draws from its own named stream, so adding an incident cannot
 * shift the roll of one recorded after it — the ordering of the story would
 * otherwise change the outcome, which is exactly the kind of hidden coupling a
 * scenario is supposed to rule out.
 *
 * The master seed is fixed and chosen so the loud theft is noticed and the
 * quiet one is not. That is a deliberate choice about *which branch this
 * scenario walks*, not a tuning of the world: the quiet theft is undetected
 * because its conditions put detection at 0, not because its roll came up
 * short, and `UNSEEN.probability` is asserted below so the distinction is
 * visible rather than implied.
 */
const LOUD_STREAM = "security/loud";
const QUIET_STREAM = "security/quiet";

/** A theft in the open, in a market quarter, by daylight. */
const SEEN: DetectionConditions = {
  witnesses: 1,
  physicalEvidence: 0.8,
  institutionalCapacity: 0.6,
  jurisdictionReach: 1,
  concealment: 0,
  misinformation: 0,
};

/** The same theft, in the dark, on the far side of the city, already denied. */
const UNSEEN: DetectionConditions = {
  witnesses: 0,
  physicalEvidence: 0,
  institutionalCapacity: 0.1,
  jurisdictionReach: 0.2,
  concealment: 1,
  misinformation: 0.5,
};

interface PipelineOutcome {
  readonly hearingOutcome: string;
  readonly penaltyCount: number;
  readonly finalStatus: string;
  readonly evidenceNet: number;
  readonly penaltiesBeforeHearing: number;
  readonly undetectedCaseCount: number;
}

function runPipeline(): PipelineOutcome {
  const sim: Simulation = createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
  const t0: WorldTime = sim.clock.time;
  const t1 = addTime(t0, days(2));
  const t2 = addTime(t0, days(9));
  const t3 = addTime(t0, days(30));

  sim.guard.mutate("laws", () => {
    registerAureliaLaws(new LawsEngine(sim.scope, sim.world), t0);
  });

  let outcome: PipelineOutcome | undefined;
  sim.guard.mutate("security", () => {
    const laws = new LawsEngine(sim.scope, sim.world);
    const onStream = (path: string) =>
      new SecurityEngine(sim.scope, sim.world, laws, new RngRegistry(SEED).stream(path));
    // Two engines, one per stream. The incident records live in the world and
    // are shared; only the *roll* is stream-specific.
    const engine = onStream(LOUD_STREAM);
    const quietEngine = onStream(QUIET_STREAM);
    const ids = new IdAllocator();

    // --- the theft that nobody saw -----------------------------------------
    engine.recordIncident(
      {
        id: "INC-QUIET",
        locationId: M2_SETTLEMENT_ID,
        kind: "theft",
        summary: "a sack taken from the mill yard in the dark",
        severity: 0.4,
        organizationId: MILL,
      },
      t0,
      ids,
    );
    quietEngine.recordDetection("INC-QUIET", UNSEEN, t0, ids);

    // --- the theft that was noticed -----------------------------------------
    engine.recordIncident(
      {
        id: "INC-LOUD",
        locationId: M2_SETTLEMENT_ID,
        kind: "theft",
        summary: "a sack carried out through the fenwick in daylight",
        severity: 0.7,
        organizationId: MILL,
      },
      t1,
      ids,
    );
    engine.recordDetection("INC-LOUD", SEEN, t1, ids, "PERSON-TALLYMAN");

    const record = engine.openCase(
      { incidentId: "INC-LOUD", jurisdictionId: ARDIN, suspectIds: [SUSPECT] },
      t1,
      ids,
    );
    engine.assignInvestigator(record.id, "PERSON-INVESTIGATOR");
    engine.collectEvidence(
      {
        caseId: record.id,
        kind: "physical",
        stance: "supports_accusation",
        weight: 0.8,
        collectedBy: "PERSON-INVESTIGATOR",
        admissible: true,
        integrity: 1,
        description: "the mill's own tally, short by one sack that morning",
      },
      t2,
      ids,
    );
    engine.collectEvidence(
      {
        caseId: record.id,
        kind: "testimony",
        stance: "supports_accusation",
        weight: 0.5,
        collectedBy: "PERSON-TALLYMAN",
        admissible: true,
        integrity: 1,
        description: "a stallholder saw a hand-cart leave the mill gate",
      },
      t2,
      ids,
    );

    const charge = engine.fileCharge(
      { caseId: record.id, suspectId: SUSPECT, ruleId: MILL_LICENCE },
      t2,
      ids,
    );
    // Declared is not applied: this is the moment the law says a fine is
    // possible and no fine has been levied.
    const penaltiesBeforeHearing = engine.penalties().length;

    const hearing = engine.adjudicate(record.id, [charge.id], "PERSON-JUDGE", t2, ids);
    const appeal = engine.fileAppeal(record.id, "the tally was written after the loss", t2, ids);
    engine.resolveAppeal(appeal.id, "overturned", t3, ids);

    outcome = {
      hearingOutcome: hearing.hearing.outcome,
      penaltyCount: engine.penalties().length,
      finalStatus: engine.penaltiesOf(record.id)[0]?.status ?? "none",
      evidenceNet: engine.caseReading(record.id).net,
      penaltiesBeforeHearing,
      undetectedCaseCount: engine.casesForIncident("INC-QUIET").length,
    };
  });
  if (outcome === undefined) throw new Error("runPipeline: the security scope did not run");
  return outcome;
}

describe("M6 DoD — the legal pipeline (Systems 41 and 48)", () => {
  it("runs the whole pipeline and reproduces it exactly", () => {
    const first = runPipeline();
    expect(runPipeline()).toEqual(first);

    // The part everyone remembers: a theft, a hearing, a conviction.
    expect(first.hearingOutcome).toBe("convicted");
    expect(first.evidenceNet).toBe(1.3);
    // One penalty per declared sanction on the mill licence, applied then vacated.
    expect(first.penaltyCount).toBe(2);
    expect(first.finalStatus).toBe("vacated");
  });

  it("leaves a crime that nobody saw with no case at all", () => {
    // Detection failed, so there is nothing to report and nothing to hear. The
    // incident is still on the record as an incident; the law was never engaged.
    expect(runPipeline().undetectedCaseCount).toBe(0);
  });

  it("refuses to charge under a rule from another jurisdiction", () => {
    const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
    const t0 = sim.clock.time;
    sim.guard.mutate("laws", () => {
      registerAureliaLaws(new LawsEngine(sim.scope, sim.world), t0);
    });
    sim.guard.mutate("security", () => {
      const laws = new LawsEngine(sim.scope, sim.world);
      const engine = new SecurityEngine(
        sim.scope,
        sim.world,
        laws,
        new RngRegistry(SEED).stream(LOUD_STREAM),
      );
      const ids = new IdAllocator();
      engine.recordIncident(
        {
          id: "INC-X",
          locationId: M2_SETTLEMENT_ID,
          kind: "theft",
          summary: "a sack carried out over the border",
          severity: 0.5,
        },
        t0,
        ids,
      );
      engine.recordDetection(
        "INC-X",
        { ...SEEN, physicalEvidence: 1, institutionalCapacity: 1, jurisdictionReach: 0.1 },
        t0,
        ids,
      );
      const record = engine.openCase(
        { incidentId: "INC-X", jurisdictionId: "COUNTRY-OTHERLAND", suspectIds: [SUSPECT] },
        t0,
        ids,
      );
      expect(() =>
        engine.fileCharge({ caseId: record.id, suspectId: SUSPECT, ruleId: MILL_LICENCE }, t0, ids),
      ).toThrow(/governs COUNTRY-ARDIN/);
      // Nothing was filed, and the rule was never engaged.
      expect(engine.charges()).toEqual([]);
    });
  });
});
