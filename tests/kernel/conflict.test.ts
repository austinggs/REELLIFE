/**
 * System 21 — conflict: a dispute is not a fight, a claim is not a fact, a
 * position is not an interest, and "unresolved" is a real ending.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { ConflictEngine } from "../../src/engine/conflict/engine.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { addTime, days, type WorldTime } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-conflict-seed";
const DOCKS = "ORG-ARDIN-DOCKS";
const MILL = "ORG-ARDEN-MILL-BAKERY";
const DISPUTE = "CONFLICT-BERTH";
let T0: WorldTime;

function newWorld(): Simulation {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
  T0 = sim.clock.time;
  return sim;
}

function withConflict<T>(sim: Simulation, fn: (engine: ConflictEngine, ids: IdAllocator) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("conflict", () => {
    result = fn(new ConflictEngine(sim.scope, sim.world), new IdAllocator());
  });
  return result;
}

/** A running dispute between the docks and the mill over berth priority. */
function seedDispute(engine: ConflictEngine, ids: IdAllocator, at: WorldTime): void {
  engine.openConflict(
    {
      id: DISPUTE,
      title: "Berth priority at the mill landing",
      // Group conflict: organizations, not people.
      partyIds: [DOCKS, MILL],
    },
    at,
    ids,
  );
}

describe("conflict, negotiation and reconciliation (System 21)", () => {
  it("opens a disagreement and nothing more", () => {
    const sim = newWorld();
    withConflict(sim, (engine, ids) => {
      seedDispute(engine, ids, T0);
      const record = engine.conflict(DISPUTE)!;
      // Emerging, two parties, and no crime, injury, hatred or case anywhere: a
      // dispute is a disagreement, and it becomes the rest of those things only
      // if some system that owns them says so.
      expect(record.stage).toBe("emerging");
      expect(record.partyIds).toEqual([DOCKS, MILL]);
      const bag = (sim.serializedWorld() as { readonly systems?: Record<string, unknown> }).systems;
      expect(bag?.["security"]).toBeUndefined();
      expect(engine.offersOf(DISPUTE)).toEqual([]);
      expect(engine.claimsOf(DISPUTE)).toEqual([]);
    });
  });

  it("will not open a conflict with fewer than two parties", () => {
    const sim = newWorld();
    withConflict(sim, (engine, ids) => {
      expect(() =>
        engine.openConflict(
          { id: "C-1", title: "A complaint at nobody", partyIds: [DOCKS] },
          T0,
          ids,
        ),
      ).toThrow(/needs at least two/);
      expect(engine.conflicts()).toEqual([]);
    });
  });

  it("refuses a stage the lifecycle does not allow", () => {
    const sim = newWorld();
    withConflict(sim, (engine, ids) => {
      seedDispute(engine, ids, T0);
      // An emerging dispute cannot jump straight to resolved.
      expect(() => engine.transition(DISPUTE, "resolved", T0, ids)).toThrow(
        /cannot go from "emerging" to "resolved"/,
      );
      engine.transition(DISPUTE, "active", T0, ids);
      engine.transition(DISPUTE, "negotiating", T0, ids);
      engine.transition(DISPUTE, "resolved", T0, ids);
      // And a resolved conflict is finished, not quietly reopened.
      expect(() => engine.transition(DISPUTE, "active", T0, ids)).toThrow(
        /cannot go from "resolved" to "active"/,
      );
    });
  });

  it("keeps a claim's truth apart from what the parties believe", () => {
    const sim = newWorld();
    withConflict(sim, (engine, ids) => {
      seedDispute(engine, ids, T0);
      const claim = engine.fileClaim(
        {
          conflictId: DISPUTE,
          byPartyId: MILL,
          againstPartyId: DOCKS,
          text: "the docks took three berths that were ours",
          state: "true",
          settledBy: DOCKS,
        },
        T0,
        ids,
      );
      expect(claim.state).toBe("true");

      // The docks insist it never happened. That is their *belief*, recorded
      // beside the claim and never overwriting it.
      engine.addParty(
        {
          conflictId: DISPUTE,
          partyId: DOCKS,
          position: "nothing was taken",
          power: 0.5,
          informedness: 0.4,
          beliefs: { [claim.id]: "false" },
        },
        T0,
        ids,
      );
      expect(engine.claimsOf(DISPUTE)[0]?.state).toBe("true");
      expect(engine.party(DISPUTE, DOCKS)?.beliefs[claim.id]).toBe("false");
      expect(engine.balance(DISPUTE).misunderstoodClaims).toBe(1);
    });
  });

  it("reports deadlock when power is even and an interest is unstated", () => {
    const sim = newWorld();
    withConflict(sim, (engine, ids) => {
      seedDispute(engine, ids, T0);
      // Neither party has said what it actually wants, so there is nothing to
      // meet — which is deadlock, and deadlock is a legitimate reading.
      engine.addParty(
        {
          conflictId: DISPUTE,
          partyId: DOCKS,
          position: "the berths are ours by right",
          power: 0,
          informedness: 1,
        },
        T0,
        ids,
      );
      engine.addParty(
        {
          conflictId: DISPUTE,
          partyId: MILL,
          position: "the mill cannot afford the delay",
          power: 0,
          informedness: 1,
        },
        T0,
        ids,
      );
      const reading = engine.settlementReading(DISPUTE);
      expect(reading.outcome).toBe("deadlock");
      expect(reading.balance.evenHandedness).toBe(1);
      expect(reading.balance.interestsAddressed).toBe(0);
      expect(reading.rationale).toMatch(/nothing to meet/);
    });
  });

  it("names a partial settlement as partial rather than calling it resolved", () => {
    const sim = newWorld();
    withConflict(sim, (engine, ids) => {
      seedDispute(engine, ids, T0);
      engine.addParty(
        {
          conflictId: DISPUTE,
          partyId: DOCKS,
          position: "the berths are ours",
          underlyingInterest: "to finish the unload before the tide turns",
          power: 0.8,
          informedness: 0.9,
        },
        T0,
        ids,
      );
      engine.addParty(
        {
          conflictId: DISPUTE,
          partyId: MILL,
          position: "let us land first",
          underlyingInterest: "not to lose a day of milling",
          power: -0.4,
          informedness: 0.9,
        },
        T0,
        ids,
      );
      engine.transition(DISPUTE, "active", T0, ids);
      const offer = engine.makeOffer(
        { conflictId: DISPUTE, byPartyId: DOCKS, kind: "offer", terms: "alternate berths by tide" },
        T0,
        ids,
      );
      // A position is conceded whole; the interest behind it is not met.
      engine.concede(DISPUTE, offer.id, MILL, "the mill gives up its claim to berth two", T0, ids);
      expect(engine.conflict(DISPUTE)?.stage).toBe("negotiating");

      const { conflict, agreement } = engine.reachAgreement(
        {
          conflictId: DISPUTE,
          partyIds: [DOCKS, MILL],
          terms: ["alternate berths by tide"],
          formal: false,
          coversInterests: false,
        },
        T0,
        ids,
      );
      expect(agreement.formal).toBe(false);
      expect(conflict.stage).toBe("unresolved");
      // Unresolved is not a dead end: it can go back to negotiation.
      expect(engine.transition(DISPUTE, "negotiating", T0, ids).stage).toBe("negotiating");
    });
  });

  it("insists a broken agreement says what it caused", () => {
    const sim = newWorld();
    withConflict(sim, (engine, ids) => {
      seedDispute(engine, ids, T0);
      const { agreement } = engine.reachAgreement(
        {
          conflictId: DISPUTE,
          partyIds: [DOCKS, MILL],
          terms: ["alternate berths by tide"],
          formal: true,
          coversInterests: true,
        },
        T0,
        ids,
      );
      expect(() =>
        engine.breakAgreement(agreement.id, "the tide turned first", [], T0, ids),
      ).toThrow(/must say what it caused/);
      const broken = engine.breakAgreement(
        agreement.id,
        "the tide turned first",
        ["a day of milling lost", "the mill's standing order missed at the fenwick"],
        addTime(T0, days(1)),
        ids,
      );
      expect(broken.status).toBe("broken");
      expect(broken.consequences).toHaveLength(2);
    });
  });

  it("keeps an apology offered until it is answered, and separate from reconciliation", () => {
    const sim = newWorld();
    withConflict(sim, (engine, ids) => {
      seedDispute(engine, ids, T0);
      const apology = engine.apologize(
        DISPUTE,
        DOCKS,
        MILL,
        "the third berth was ours and we took it",
        0.4,
        T0,
        ids,
      );
      expect(apology.state).toBe("offered");
      // Accepting an apology is not being restored.
      expect(engine.respondToApology(apology.id, "accepted", T0, ids).state).toBe("accepted");
      expect(engine.reconciliation(DISPUTE)).toBeUndefined();
      const restored = engine.reconcile(DISPUTE, 0.6, T0, "they share the quay again");
      expect(restored.restored).toBe(0.6);
    });
  });

  it("will not let a party mediate its own dispute", () => {
    const sim = newWorld();
    withConflict(sim, (engine, ids) => {
      seedDispute(engine, ids, T0);
      expect(() => engine.appointMediator(DISPUTE, DOCKS)).toThrow(/cannot also mediate/);
      expect(engine.appointMediator(DISPUTE, "PERSON-TALLYMAN").mediatorId).toBe("PERSON-TALLYMAN");
    });
  });

  it("keeps conflict state under single ownership and refuses a foreign writer", () => {
    const sim = newWorld();
    withConflict(sim, (engine, ids) => {
      seedDispute(engine, ids, T0);
    });

    const reader = new ConflictEngine(sim.scope, sim.world);
    expect(reader.conflicts()).toHaveLength(1);
    expect(() =>
      reader.openConflict(
        { id: "C-X", title: "x", partyIds: [DOCKS, MILL] },
        T0,
        new IdAllocator(),
      ),
    ).toThrow(MissingWriterContextError);
    expect(() =>
      sim.guard.mutate("markets", () => {
        new ConflictEngine(sim.scope, sim.world).reconcile(DISPUTE, 0.5, T0);
      }),
    ).toThrow(OwnershipViolationError);
  });
});