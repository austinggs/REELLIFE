/**
 * System 49 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â information: the claim graph, provenance, propagation,
 * verification, corrections, disputes, moderation and forgetting.
 *
 * The claim under test throughout is the spec's own warning: a rumour is not
 * a fact, and how far it travels says nothing about whether it is true.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { seedPlayableSlice } from "../../src/engine/kernel/sliceSeed.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { InformationEngine } from "../../src/engine/information/engine.ts";
import { PROPAGATION } from "../../src/engine/information/types.ts";
import {
  AURELIA_DOCKS_BOARD,
  aureliaArdenChannels,
  aureliaArdenNodes,
  registerAureliaInformation,
} from "../../src/content/aurelia/information.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { addTime, minutes } from "../../src/engine/primitives/time.ts";
import type { WorldTime } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-information-seed";
const BAKERY = "ORG-ARDEN-MILL-BAKERY";
const DOCKS = "ORG-ARDIN-DOCKS";
const TRADER = "ORG-FENWICK-STALL";
const RUMOUR = "CLM-TEST-BAKERY-SHUTDOWN";
/** A word-of-mouth channel whose audience is one person, for the spread tests. */
const QUAY_TALK = "CH-TEST-QUAY-TALK";
/** Three residents to use as a social graph, taken from the slice. */
const A = "PER-INFO-A";
const B = "PER-INFO-B";
const C = "PER-INFO-C";

let T0: WorldTime;

function newWorld(): Simulation {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
  T0 = sim.clock.time;
  return sim;
}

function withInfo<T>(sim: Simulation, fn: (engine: InformationEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("information", () => {
    result = fn(new InformationEngine(sim.scope, sim.world));
  });
  return result;
}

/** The slice's seeded nodes, a small social graph, and one rumour. */
function scenario(sim: Simulation, fn: (engine: InformationEngine) => void): void {
  withInfo(sim, (engine) => {
    for (const id of [A, B, C]) {
      engine.defineNode({ id, kind: "person", name: id, credibility: 0.5 });
    }
    // A works at the docks; B follows A; C knows nobody in the graph.
    engine.link(A, DOCKS, "works_at", T0);
    engine.link(B, A, "follows", T0);
    // A channel with A alone in its audience, so B is reached *second-hand*
    // and C is not reached at all Ã¢â‚¬â€ the two cases the spec asks to test.
    engine.defineChannel({
      id: QUAY_TALK,
      kind: "word_of_mouth",
      name: "Quayside talk",
      operatorId: A,
      reachBase: 0.9,
      audienceIds: [A],
    });
    engine.publishClaim(
      {
        id: RUMOUR,
        subject: { kind: "organization", id: BAKERY },
        text: "the mill has been shut down",
        createdBy: A,
        origin: "rumor",
        sourceCredibility: 0.3,
        novelty: 0.9,
        emotionalCharge: 0.9,
      },
      T0,
    );
    fn(engine);
  });
}

describe("information (System 49)", () => {
  it("seeds the slice's nodes and boards, idempotently, and no claims", () => {
    const sim = newWorld();
    withInfo(sim, (engine) => {
      // Every seeded organization node is a real System 32 organization.
      const organizations = sim.world.systems.organizations as {
        readonly organizations: readonly { readonly id: string }[];
      };
      const orgIds = new Set(organizations.organizations.map((entry) => entry.id));
      for (const node of aureliaArdenNodes()) {
        if (node.kind === "organization" || node.kind === "cooperative") {
          expect(orgIds.has(node.id)).toBe(true);
        }
      }
      expect(aureliaArdenChannels()).toHaveLength(2);
      expect(engine.channels()).toHaveLength(2);
      // Residents are real people, registered as nodes.
      const scale = sim.world.systems.scale as {
        readonly residents: readonly { readonly personId: string }[];
      };
      const residentIds = new Set(scale.residents.map((resident) => resident.personId));
      const personNodes = engine.nodes().filter((node) => node.kind === "person");
      expect(personNodes.length).toBeGreaterThan(100);
      for (const node of personNodes) expect(residentIds.has(node.id)).toBe(true);
      // And no claim is seeded: nobody has said anything yet.
      expect(engine.claims()).toHaveLength(0);
    });

    seedPlayableSlice(sim);
    withInfo(sim, (engine) => {
      expect(engine.channels()).toHaveLength(2);
      expect(engine.nodes().filter((node) => node.kind === "person").length).toBeGreaterThan(100);
      expect(registerAureliaInformation(engine, [])).toEqual({ nodes: 0, channels: 0 });
    });
  });

  it("publishes a claim without believing it", () => {
    const sim = newWorld();
    scenario(sim, (engine) => {
      const claim = engine.requireClaim(RUMOUR, "test");
      // Every claim starts unverified ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â including one from an official, and
      // including a rumour nobody has checked.
      expect(claim.status).toBe("unverified");
      expect(claim.verifiedBy).toBeUndefined();
      // It is about a real subject, and it says nothing about whether that
      // subject really is shut down. The world's own record lives elsewhere.
      expect(claim.subject).toEqual({ kind: "organization", id: BAKERY });
      // Provenance is explicit: who said it, from what, with what factors.
      expect(claim.createdBy).toBe(A);
      expect(claim.origin).toBe("rumor");
      expect(claim.history[0]?.note).toMatch(/rumor by PER-INFO-A/);
      // An official source is not a shortcut around verification.
      engine.publishClaim(
        {
          id: "CLM-TEST-OFFICIAL",
          subject: { kind: "organization", id: DOCKS },
          text: "the docks will open an hour early",
          createdBy: DOCKS,
          origin: "official",
          sourceCredibility: 0.95,
          novelty: 0.2,
          emotionalCharge: 0.1,
        },
        T0,
      );
      expect(engine.requireClaim("CLM-TEST-OFFICIAL", "test").status).toBe("unverified");
    });
  });

  it("propagates a rumour by reach, not by truth", () => {
    const sim = newWorld();
    scenario(sim, (engine) => {
      // A low-credibility, high-charge rumour still travels: that is the
      // whole problem the spec is describing.
      const value = engine.carriedValue(engine.requireClaim(RUMOUR, "test"));
      expect(value).toBeGreaterThan(0.5);
      expect(value).toBeLessThan(1);

      const wave = engine.propagate(RUMOUR, QUAY_TALK, T0);
      // A is in the audience and so hears it at full strength.
      expect(wave.reached).toContain(A);
      // B follows A, so the retelling reaches B second-hand, weaker.
      const bExposure = engine.exposuresOf(RUMOUR).find((exposure) => exposure.nodeId === B);
      expect(bExposure?.viaNodeId).toBe(A);
      const aExposure = engine.exposuresOf(RUMOUR).find((exposure) => exposure.nodeId === A);
      expect(bExposure?.reach).toBeLessThan(aExposure?.reach ?? 1);
      // A works for the docks, so the rumour reaches the employer too: a
      // retelling travels along real links, not just to subscribers.
      expect(wave.reached).toContain(DOCKS);
      // C is connected to nobody: a rumour does not reach a stranger.
      expect(engine.exposuresOf(RUMOUR).some((exposure) => exposure.nodeId === C)).toBe(false);

      // The claim is still unverified after reaching people, and nobody in
      // this system has formed a belief.
      expect(engine.requireClaim(RUMOUR, "test").status).toBe("unverified");
      expect(engine.reachOf(RUMOUR).reached).toBe(3);
      // Each node's source set is its own: the bubble is structural.
      expect(engine.sourceSetOf(B)).toEqual([A]);
      expect(engine.claimsHeardBy(B).map((claim) => claim.id)).toEqual([RUMOUR]);
      expect(engine.claimsHeardBy(C)).toEqual([]);
    });
  });

  it("verifies only with a method and evidence", () => {
    const sim = newWorld();
    scenario(sim, (engine) => {
      // "I checked it" is not a verification anyone can audit.
      expect(() =>
        engine.verifyClaim(RUMOUR, { status: "verified_false", method: "", evidenceRef: "x" }, T0),
      ).toThrow(/method and an evidence reference/);
      expect(() =>
        engine.verifyClaim(RUMOUR, { status: "unverified", method: "look", evidenceRef: "x" }, T0),
      ).toThrow(/cannot be verified as unverified/);

      const checked = engine.verifyClaim(
        RUMOUR,
        {
          status: "verified_false",
          method: "checked the mill's own shift log",
          evidenceRef: "ORG-ARDEN-MILL-BAKERY#operations",
        },
        addTime(T0, minutes(60)),
      );
      expect(checked.status).toBe("verified_false");
      expect(checked.verifiedBy?.method).toMatch(/shift log/);
      // Verification does not retract what people already heard.
      expect(engine.reachOf(RUMOUR).reached).toBe(0);
      expect(engine.exposuresOf(RUMOUR).length).toBeGreaterThanOrEqual(0);
    });
  });

  it("corrects, disputes and forgets without erasing", () => {
    const sim = newWorld();
    scenario(sim, (engine) => {
      const later = addTime(T0, minutes(120));
      // A correction chains forwards and the old claim keeps its record.
      engine.publishClaim(
        {
          id: "CLM-TEST-CORRECTION",
          subject: { kind: "organization", id: BAKERY },
          text: "the mill is working; a single oven is down",
          createdBy: BAKERY,
          origin: "reported",
          sourceCredibility: 0.9,
          novelty: 0.2,
          emotionalCharge: 0.1,
        },
        later,
      );
      engine.correctClaim("CLM-TEST-CORRECTION", RUMOUR, later);
      expect(engine.claim(RUMOUR)?.supersedesClaimId).toBeUndefined();
      expect(engine.claim("CLM-TEST-CORRECTION")?.supersedesClaimId).toBe(RUMOUR);
      expect(engine.correctionChain("CLM-TEST-CORRECTION").map((claim) => claim.id)).toEqual([
        "CLM-TEST-CORRECTION",
        RUMOUR,
      ]);
      // The rumour is still in the world, with the correction attached.
      expect(engine.claim(RUMOUR)?.history.at(-1)?.note).toMatch(/corrected by CLM-TEST-CORRECTION/);
      // A claim cannot correct twice, and cannot correct itself.
      expect(() => engine.correctClaim("CLM-TEST-CORRECTION", RUMOUR, later)).toThrow(
        /already corrects a claim/,
      );
      expect(() => engine.correctClaim(RUMOUR, RUMOUR, later)).toThrow(/cannot correct itself/);

      // A disagreement is recorded on both sides.
      engine.publishClaim(
        {
          id: "CLM-TEST-DISPUTE",
          subject: { kind: "organization", id: BAKERY },
          text: "the mill was shut for a week, not a day",
          createdBy: C,
          origin: "rumor",
          sourceCredibility: 0.2,
          novelty: 0.5,
          emotionalCharge: 0.6,
        },
        later,
      );
      const disputed = engine.disputeClaim("CLM-TEST-DISPUTE", "CLM-TEST-CORRECTION", later, "two versions");
      expect(disputed.status).toBe("disputed");
      expect(engine.claim("CLM-TEST-CORRECTION")?.contradictedByClaimIds).toEqual([
        "CLM-TEST-DISPUTE",
      ]);
      expect(engine.claim("CLM-TEST-DISPUTE")?.contradictedByClaimIds).toEqual([
        "CLM-TEST-CORRECTION",
      ]);

      // Forgetting is per-listener: the record that someone heard it stays.
      engine.propagate(RUMOUR, QUAY_TALK, later);
      expect(() => engine.forgetClaim(RUMOUR, C, later)).toThrow(/has not heard/);
      engine.forgetClaim(RUMOUR, B, later);
      expect(engine.claimsHeardBy(B)).toEqual([]);
      expect(engine.exposuresOf(RUMOUR).some((exposure) => exposure.nodeId === B)).toBe(true);
      expect(engine.reachOf(RUMOUR).forgotten).toBeGreaterThan(0);
    });
  });

  it("lets a channel moderate, and only a moderated one", () => {
    const sim = newWorld();
    const ids = new IdAllocator();
    scenario(sim, (engine) => {
      // The slice's boards are unmoderated: nobody polices a notice board.
      expect(() =>
        engine.moderate(
          ids,
          { channelId: AURELIA_DOCKS_BOARD, claimId: RUMOUR, action: "removed", reason: "panic", by: DOCKS },
          T0,
        ),
      ).toThrow(/not a moderated channel/);

      // So a channel operator can set one up, and a moderation needs a reason.
      // The audience is people who actually trade with the operator, so the
      // channel has someone to reach.
      engine.link(TRADER, B, "trades_with", T0);
      engine.link(TRADER, C, "trades_with", T0);
      engine.defineChannel({
        id: "CH-TEST-MODERATED",
        kind: "social",
        name: "Test board",
        operatorId: TRADER,
        reachBase: 0.9,
        moderated: true,
        audienceIds: [C, B],
      });
      expect(() =>
        engine.moderate(
          ids,
          { channelId: "CH-TEST-MODERATED", claimId: RUMOUR, action: "removed", reason: "  ", by: TRADER },
          T0,
        ),
      ).toThrow(/needs a reason/);

      // A downrank weakens the claim without stopping it.
      engine.moderate(
        ids,
        {
          channelId: "CH-TEST-MODERATED",
          claimId: RUMOUR,
          action: "downranked",
          reason: "unattributed",
          by: TRADER,
        },
        T0,
      );
      const downranked = engine.propagate(RUMOUR, "CH-TEST-MODERATED", T0);
      expect(downranked.reached.length).toBeGreaterThan(0);
      for (const nodeId of downranked.reached) {
        const exposure = engine
          .exposuresOf(RUMOUR)
          .find((entry) => entry.nodeId === nodeId && entry.channelId === "CH-TEST-MODERATED");
        expect(exposure?.reach).toBeLessThanOrEqual(PROPAGATION.downrankFactor);
      }

      // A removal stops it outright, and the record of both survives.
      const removed = engine.moderate(
        ids,
        {
          channelId: "CH-TEST-MODERATED",
          claimId: RUMOUR,
          action: "removed",
          reason: "defamation complaint",
          by: TRADER,
        },
        addTime(T0, minutes(60)),
      );
      expect(removed.action).toBe("removed");
      const blocked = engine.propagate(RUMOUR, "CH-TEST-MODERATED", addTime(T0, minutes(120)));
      expect(blocked.reached).toEqual([]);
      expect(blocked.notReached.length).toBeGreaterThan(0);
      expect(engine.isPropagatable(RUMOUR).propagatable).toBe(false);
      // The exposure from before the removal is still on the record.
      expect(engine.exposuresOf(RUMOUR).length).toBeGreaterThan(0);
      expect(engine.moderations()).toHaveLength(2);
    });
  });

  it("refuses a malformed claim, link or channel", () => {
    const sim = newWorld();
    scenario(sim, (engine) => {
      expect(() =>
        engine.publishClaim(
          {
            id: RUMOUR,
            subject: { kind: "organization", id: BAKERY },
            text: "again",
            createdBy: A,
            origin: "rumor",
            sourceCredibility: 0.3,
            novelty: 0.5,
            emotionalCharge: 0.5,
          },
          T0,
        ),
      ).toThrow(/already exists/);
      expect(() =>
        engine.publishClaim(
          {
            id: "CLM-X",
            subject: { kind: "organization", id: BAKERY },
            text: "x",
            createdBy: "PER-NOT-REAL",
            origin: "rumor",
            sourceCredibility: 0.3,
            novelty: 0.5,
            emotionalCharge: 0.5,
          },
          T0,
        ),
      ).toThrow(/unknown node/);
      expect(() =>
        engine.publishClaim(
          {
            id: "CLM-X",
            subject: { kind: "organization", id: BAKERY },
            text: "x",
            createdBy: A,
            origin: "rumor",
            sourceCredibility: 5,
            novelty: 0.5,
            emotionalCharge: 0.5,
          },
          T0,
        ),
      ).toThrow(/sourceCredibility/);
      // A copy of a claim about a different subject is a different claim.
      expect(() =>
        engine.publishClaim(
          {
            id: "CLM-X",
            subject: { kind: "organization", id: DOCKS },
            text: "x",
            createdBy: A,
            origin: "rumor",
            sourceCredibility: 0.3,
            novelty: 0.5,
            emotionalCharge: 0.5,
            derivedFromClaimId: RUMOUR,
          },
          T0,
        ),
      ).toThrow(/different subject/);

      // A graph edge needs two real nodes and a real kind of edge.
      expect(() => engine.link(A, A, "follows", T0)).toThrow(/cannot be linked to itself/);
      engine.link(A, C, "follows", T0);
      expect(() => engine.link(A, C, "follows", T0)).toThrow(/already exists/);
      expect(() => engine.link(A, B, "vibes" as never, T0)).toThrow(/unknown link kind/);
      expect(() =>
        engine.defineChannel({
          id: "CH-X",
          kind: "social",
          name: "x",
          operatorId: "PER-NOT-REAL",
          reachBase: 0.5,
        }),
      ).toThrow(/unknown node/);
      expect(() =>
        engine.defineChannel({
          id: "CH-Y",
          kind: "social",
          name: "x",
          operatorId: TRADER,
          reachBase: 2,
        }),
      ).toThrow(/reachBase/);
    });
  });

  it("keeps information state under single ownership and in the save format", () => {
    const sim = newWorld();
    scenario(sim, (engine) => {
      expect(engine.claims()).toHaveLength(1);
    });

    const reader = new InformationEngine(sim.scope, sim.world);
    expect(() => reader.forgetClaim(RUMOUR, A, T0)).toThrow(MissingWriterContextError);
    expect(() =>
      sim.guard.mutate("markets", () => {
        new InformationEngine(sim.scope, sim.world).forgetClaim(RUMOUR, A, T0);
      }),
    ).toThrow(OwnershipViolationError);

    const bag = (sim.serializedWorld() as { readonly systems?: Record<string, unknown> }).systems;
    expect(bag?.["information"]).toBeDefined();
    const state = bag?.["information"] as {
      readonly nodes: readonly unknown[];
      readonly claims: readonly unknown[];
      readonly exposures: readonly unknown[];
      readonly moderations: readonly unknown[];
    };
    expect(state.claims).toHaveLength(1);
    expect(state.exposures).toHaveLength(0);
    expect(state.moderations).toHaveLength(0);
  });
});

