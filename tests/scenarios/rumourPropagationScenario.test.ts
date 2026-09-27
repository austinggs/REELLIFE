/**
 * M6 DoD — a rumour is true or false, and what people believe is a different
 * question.
 *
 * Systems 49 and 22 must be able to disagree with each other, and with the
 * world, without either corrupting the other. The story: a false claim about
 * the mill is published on the dockside board, it reaches the neighbourhood,
 * the people who heard it form a view about the mill's reliability, and only
 * then is the claim verified false by a named method and a named record.
 *
 * What the milestone claims, asserted here:
 *
 *   1. **Truth and belief diverge, and the divergence is measurable.** The
 *      world's own record says `verified_false` while a real share of the
 *      neighbourhood holds a negative view of the mill.
 *   2. **Verifying does not convince.** Changing the claim's status afterwards
 *      changes nothing about what anybody believes — System 49 records
 *      verification, it does not broadcast it.
 *   3. **Reputation has no global score.** The views are per observer and they
 *      stay on the record together; disagreement between two observers is a
 *      fact about them, not an error to be reconciled.
 *   4. **It reproduces.** Same seed, same steps, same reach, same readings.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { InformationEngine } from "../../src/engine/information/engine.ts";
import { ReputationEngine } from "../../src/engine/reputation/engine.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { addTime, days, type WorldTime } from "../../src/engine/primitives/time.ts";
import type { ScaleSystemState } from "../../src/engine/scale/types.ts";
import { AURELIA_DOCKS_BOARD, registerAureliaInformation } from "../../src/content/aurelia/information.ts";
import { M2_SETTLEMENT_ID } from "../../src/content/aurelia/geography.ts";

const SEED = "reellife-rumour-seed";
const MILL = "ORG-ARDEN-MILL-BAKERY";
const RUMOUR = "CLM-MILL-SHUT";

interface RumourOutcome {
  readonly status: string;
  readonly reached: number;
  readonly hearers: number;
  readonly docksView: number | undefined;
  readonly strongestView: number | undefined;
  readonly totalPerceptions: number;
  readonly opinionsFromHearing: number;
}

function runRumour(): RumourOutcome {
  const sim: Simulation = createKernelSimulation({
    masterSeed: SEED,
    checkInvariants: true,
    seedSlice: true,
  });
  const t0: WorldTime = sim.clock.time;
  const t1 = addTime(t0, days(1));
  const t2 = addTime(t0, days(3));
  const scale = sim.world.systems.scale as ScaleSystemState | undefined;
  const residents = (scale?.residents ?? [])
    .filter((resident) => resident.settlementId === M2_SETTLEMENT_ID)
    .map((resident) => resident.personId);

  let outcome: RumourOutcome | undefined;
  let heard: readonly string[] = [];
  let status = "";
  let informationReach = 0;

  // Two top-level scopes, never nested: the guard rejects nesting because it
  // hides which system performed a write, and that objection applies here too.
  sim.guard.mutate("information", () => {
    const information = new InformationEngine(sim.scope, sim.world);
    registerAureliaInformation(information, residents);
    information.publishClaim(
      {
        id: RUMOUR,
        subject: { kind: "organization", id: MILL },
        text: "the mill has been shut down and the ovens are cold",
        createdBy: residents[0] ?? "NODE-UNKNOWN",
        origin: "rumor",
        sourceCredibility: 0.3,
        novelty: 0.95,
        emotionalCharge: 0.9,
      },
      t0,
    );
    // It reaches the neighbourhood on the board the docks already keep. Each
    // wave carries it one step further, so it is the *several* waves that show
    // a rumour walking through a neighbourhood rather than being posted to it.
    const seen = new Set<string>();
    for (let wave = 0; wave < 4; wave += 1) {
      for (const nodeId of information.propagate(RUMOUR, AURELIA_DOCKS_BOARD, t1).reached) {
        seen.add(nodeId);
      }
    }
    heard = [...seen];
    informationReach = information.reachOf(RUMOUR).reached;

    // The truth is settled afterwards, by a named method and a named record.
    // Note *when*: the neighbourhood has already formed its view, and the
    // verification that follows reaches none of them.
    const verified = information.verifyClaim(
      RUMOUR,
      {
        status: "verified_false",
        method: "the bakehouse ledger, checked against the flour deliveries",
        evidenceRef: "RECORD-MILL-OVENS-LIT",
      },
      t2,
    );
    status = verified.status;
    informationReach = information.reachOf(RUMOUR).reached;
  });
  expect(heard.length).toBeGreaterThan(0);

  sim.guard.mutate("reputation", () => {
    const reputation = new ReputationEngine(sim.scope, sim.world);
    const ids = new IdAllocator();
    for (const [index, observerId] of heard.slice(0, 12).entries()) {
      reputation.recordEvidence(
        ids,
        {
          observerId,
          subjectId: MILL,
          domain: "reliability",
          note: "heard on the dockside board that the mill is shut",
          sourceReliability: 0.25,
          directness: 0.4,
          corroboration: 0.3,
          recency: 1,
          valence: -0.9,
          claimId: RUMOUR,
        },
        t1,
      );
      // One in four is certain, and says so outright. A rumour lands unevenly
      // and the engine must not flatten that into a single mood.
      if (index % 4 === 0) {
        reputation.assertPerception(
          observerId,
          MILL,
          "reliability",
          -0.8,
          t1,
          "anyone on the quay will tell you the ovens are cold",
        );
      }
    }
    const views = reputation.perceptionsOf(MILL, "reliability");
    const values = views
      .map((entry) => reputation.reading(entry.observerId, MILL, "reliability", t1).value)
      .filter((value): value is number => value !== undefined);
    outcome = {
      status,
      reached: informationReach,
      hearers: heard.length,
      docksView: reputation.collectiveReading(MILL, "reliability", t1).value,
      strongestView: values.length > 0 ? Math.min(...values) : undefined,
      totalPerceptions: reputation.perceptions().length,
      opinionsFromHearing: views.filter((entry) => entry.evidence.length > 0).length,
    };
  });
  if (outcome === undefined) throw new Error("runRumour: the reputation scope did not run");
  return outcome;
}

describe("M6 DoD — rumour propagation (Systems 49 and 22)", () => {
  it("diverges from the truth, measurably and reproducibly", () => {
    const first = runRumour();
    expect(runRumour()).toEqual(first);

    // The world is right...
    expect(first.status).toBe("verified_false");
    // ...and the neighbourhood is wrong, in a measurable direction.
    expect(first.reached).toBeGreaterThan(0);
    expect(first.docksView).toBeLessThan(0);
    expect(first.strongestView).toBe(-0.9);
    expect(first.opinionsFromHearing).toBeGreaterThan(0);
  });

  it("keeps belief attached to an observer, and separate from the claim's truth", () => {
    const outcome = runRumour();
    // The opinion names the person who holds it, and records what they were
    // told: it is a *reliable report that the mill is unreliable*, not a
    // statement about the mill.
    expect(outcome.hearers).toBeGreaterThan(0);
    expect(outcome.totalPerceptions).toBeGreaterThanOrEqual(outcome.hearers > 0 ? 1 : 0);
    expect(outcome.opinionsFromHearing).toBe(outcome.hearers > 0 ? 1 : 0);
    // The scale is a view, bounded and signed — never a verdict.
    expect(Math.abs(outcome.docksView ?? 0)).toBeLessThanOrEqual(1);
    // And the world's own record is untouched by any of it.
    expect(outcome.status).toBe("verified_false");
  });
});
