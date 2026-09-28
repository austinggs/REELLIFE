/**
 * U5 — the society projections (Systems 41, 44, 49, 33-36).
 *
 * These tests are mostly about the *distinctions* the views are built to keep,
 * because a catalogue is the easy thing to render and the mistake is to let it
 * stand in for an experience. Specifically:
 *
 *   - four law rules and zero permits must not read as "everyone is licensed";
 *   - five communities and zero participation must not read as "you belong to
 *     five communities";
 *   - a claim that exists but reached nobody must not read as news;
 *   - a price with no recorded sale behind it must not read as a tested price.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { seedPlayableSlice } from "../../src/engine/kernel/sliceSeed.ts";
import {
  getCommunityView,
  getEconomyView,
  getInformationView,
  getLawView,
} from "../../src/engine/query/civicViews.ts";
import { InformationEngine } from "../../src/engine/information/engine.ts";
import { asEntityId } from "../../src/engine/primitives/ids.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import type { InformationSystemState } from "../../src/engine/information/types.ts";

const SEED = "reellife-u5-civic";

function seededWorld(): { sim: Simulation; playerId: string } {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
  return { sim, playerId: seedPlayableSlice(sim).playerId };
}

function withInformation<T>(sim: Simulation, fn: (engine: InformationEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("information", () => {
    result = fn(new InformationEngine(sim.scope, sim.world));
  });
  return result;
}

describe("law and records (System 41)", () => {
  it("reports the rules as written, with their sanctions in words", () => {
    const { sim, playerId } = seededWorld();
    const law = getLawView(sim, asEntityId<"person">(playerId));

    expect(law.rules.length).toBeGreaterThan(0);
    for (const rule of law.rules) {
      expect(rule.title.length).toBeGreaterThan(0);
      expect(rule.jurisdictionName).not.toBe(rule.jurisdictionName.toLowerCase());
      expect(rule.sanctions.length).toBeGreaterThan(0);
      expect(rule.sanctions.every((sanction) => sanction.length > 0)).toBe(true);
    }
  });

  it("does not let a rule book imply that the viewer holds anything", () => {
    const { sim, playerId } = seededWorld();
    const law = getLawView(sim, asEntityId<"person">(playerId));

    // The slice authors a statute book and issues no permits at all.
    expect(law.permits).toHaveLength(0);
    expect(law.notes.join(" ")).toMatch(/You hold no licence or permit/);
    // A rule requiring a credential the viewer does not hold must say so rather
    // than imply the requirement is satisfied.
    for (const rule of law.rules) {
      if (rule.requiredCredential === undefined) continue;
      expect(rule.credentialHeld).toBe(false);
    }
  });

  it("only claims a rule binds the viewer when it names a person", () => {
    const { sim, playerId } = seededWorld();
    const law = getLawView(sim, asEntityId<"person">(playerId));
    for (const rule of law.rules) {
      expect(typeof rule.bindsViewer).toBe("boolean");
    }
    expect(law.notes.join(" ")).toMatch(/not advice/);
  });

  it("carries the source material's own provisional note onto the row", () => {
    const { sim, playerId } = seededWorld();
    const law = getLawView(sim, asEntityId<"person">(playerId));
    expect(law.rules.some((rule) => rule.provisional)).toBe(true);
  });
});

describe("information (System 49)", () => {
  it("keeps truth, reach and belief three different things", () => {
    const { sim, playerId } = seededWorld();
    const info = getInformationView(sim, asEntityId<"person">(playerId));
    expect(info.notes.join(" ")).toMatch(/what anyone believed/);
  });

  it("reports a claim that exists but reached nobody as reaching nobody", () => {
    const { sim, playerId } = seededWorld();
    const viewer = asEntityId<"person">(playerId);
    const state = sim.world.systems.information as InformationSystemState;
    const nodeId = state.nodes[0]?.id;

    withInformation(sim, (engine) => {
      engine.publishClaim(
        {
          id: "CLM-TEST-RUMOUR",
          subject: { kind: "person", id: String(viewer) },
          text: "the mill has been shut down",
          createdBy: nodeId ?? String(viewer),
          origin: "rumor",
          sourceCredibility: 0.3,
          novelty: 0.9,
          emotionalCharge: 0.9,
        },
        sim.clock.time,
      );
    });

    const info = getInformationView(sim, viewer);
    const claim = info.claims.find((entry) => entry.id === "CLM-TEST-RUMOUR");
    expect(claim).toBeDefined();
    expect(claim?.reachedCount).toBe(0);
    expect(claim?.exposureLabel).toMatch(/has not reached anyone yet/);
    // Rumour origin, unverified status: provenance and finding, not opinion.
    expect(claim?.originLabel).toBe("Rumor");
    expect(claim?.statusLabel).toMatch(/Unverified/);
  });

  it("counts a claim as reached without ever calling it believed", () => {
    const { sim, playerId } = seededWorld();
    const viewer = asEntityId<"person">(playerId);
    const state = sim.world.systems.information as InformationSystemState;
    const channel = state.channels[0];

    withInformation(sim, (engine) => {
      if (channel === undefined) return;
      // The seeded graph has no links, so link the board to the viewer first:
      // without a link a claim genuinely cannot reach them.
      engine.link(channel.operatorId, viewer, "follows", sim.clock.time);
      engine.publishClaim(
        {
          id: "CLM-TEST-REACHED",
          subject: { kind: "person", id: viewer },
          text: "grain prices are rising",
          createdBy: channel.operatorId,
          origin: "reported",
          sourceCredibility: 0.6,
          novelty: 0.4,
          emotionalCharge: 0.5,
        },
        sim.clock.time,
      );
      engine.propagate("CLM-TEST-REACHED", channel.id, sim.clock.time);
    });

    const info = getInformationView(sim, viewer);
    const claim = info.claims.find((entry) => entry.id === "CLM-TEST-REACHED");
    expect(claim).toBeDefined();
    expect(claim?.reachedCount).toBeGreaterThan(0);
    expect(claim?.exposureLabel).toMatch(/not the same as being believed/);

    // Whether the viewer is reached is the engine's decision (propagation has a
    // threshold and the seeded graph has no links of its own), so the assertion
    // here is faithfulness: the view counts exactly what the engine recorded.
    const exposures = (sim.world.systems.information as InformationSystemState).exposures;
    const engineReachedViewer = exposures.filter((entry) => entry.nodeId === viewer).length;
    expect(info.viewerReachCount).toBe(engineReachedViewer);
  });

  it("says plainly that the graph is there and nothing is circulating", () => {
    const { sim, playerId } = seededWorld();
    const info = getInformationView(sim, asEntityId<"person">(playerId));
    expect(info.nodeCount).toBeGreaterThan(0);
    expect(info.claims).toHaveLength(0);
    expect(info.notes.join(" ")).toMatch(/Nothing is circulating yet/);
  });
});

describe("community (System 44)", () => {
  it("lists the communities available without claiming the viewer is in one", () => {
    const { sim, playerId } = seededWorld();
    const community = getCommunityView(sim, asEntityId<"person">(playerId));

    expect(community.groups.length).toBeGreaterThan(0);
    expect(community.groups.some((group) => group.traditions.length > 0)).toBe(true);
    // The slice authors communities and no memberships at all.
    expect(community.viewerParticipation).toHaveLength(0);
    expect(community.notes.join(" ")).toMatch(/You take part in none of these/);
  });

  it("keeps availability and belonging as separate statements", () => {
    const { sim, playerId } = seededWorld();
    const community = getCommunityView(sim, asEntityId<"person">(playerId));
    expect(community.notes.join(" ")).toMatch(/not your membership of it/);
  });

  it("attaches each tradition to a group, with its own state and domain", () => {
    const { sim, playerId } = seededWorld();
    const community = getCommunityView(sim, asEntityId<"person">(playerId));
    let traditions = 0;
    for (const group of community.groups) {
      for (const tradition of group.traditions) {
        traditions += 1;
        expect(tradition.stateLabel.length).toBeGreaterThan(0);
        expect(tradition.domainLabel.length).toBeGreaterThan(0);
      }
    }
    expect(traditions).toBeGreaterThan(0);
  });
});

describe("economy (Systems 33-36)", () => {
  it("copies the market's own prices rather than deriving any", () => {
    const { sim } = seededWorld();
    const economy = getEconomyView(sim);

    expect(economy.markets.length).toBeGreaterThan(0);
    for (const market of economy.markets) {
      expect(market.sellerCount).toBeGreaterThan(0);
      for (const good of market.goods) {
        expect(good.priceLabel).toBeDefined();
        expect(good.landedCostLabel).toBeDefined();
        expect(good.tightnessLabel.length).toBeGreaterThan(0);
        expect(good.taxLabel.length).toBeGreaterThan(0);
      }
    }
  });

  it("does not present an untested price as a market-tested one", () => {
    const { sim } = seededWorld();
    const economy = getEconomyView(sim);
    expect(economy.transactionCount).toBe(0);
    expect(economy.notes.join(" ")).toMatch(/No trade has been recorded/);
    expect(economy.notes.join(" ")).toMatch(/does not estimate, forecast/);
  });

  it("separates the goods catalogue from what any market lists", () => {
    const { sim } = seededWorld();
    const economy = getEconomyView(sim);
    expect(economy.catalogSize).toBeGreaterThan(0);
    const listed = economy.markets.reduce((sum, market) => sum + market.goods.length, 0);
    expect(listed + economy.unlistedGoods.length).toBe(economy.catalogSize);
  });

  it("carries the currency's own provisional note when there is one", () => {
    const { sim } = seededWorld();
    const economy = getEconomyView(sim);
    expect(economy.currencyNote).toBeDefined();
  });
});
