/**
 * M8 — marriage: two people, a household, and what the world records about it.
 *
 * The chain this scenario asserts:
 *
 *   acquaintance -> time together -> courtship -> marriage -> shared household,
 *   with the marriage on the timeline and its causal chain still walkable.
 *
 * Two properties are the point, and both are easy to get wrong:
 *
 *  1. **Status is not quality.** `spouse` and `dating` are *contexts* on a
 *     relationship, not a verdict on it. Two people can marry and still be
 *     strained, and the scenario asserts the evaluation moved independently of
 *     the status — a marriage that reset the relationship's quality would be a
 *     claim the player could not detect and the engine cannot support.
 *  2. **Marriage is not a flag.** It lives in System 18 as relationship context
 *     and in System 19 as household structure. No system holds a private
 *     "isMarried" boolean, and the scenario asserts the serialized world contains
 *     none, so the fact is only ever readable by asking the owner.
 *
 * The player's decision to propose is played by the harness: System 17's
 * autonomy governs NPCs, and a player's own marriage is not an NPC decision.
 * Everything the marriage *causes* is real engine work in each owner's scope.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { asEntityId, type EntityId } from "../../src/engine/primitives/ids.ts";
import { atTime, MINUTES_PER_DAY } from "../../src/engine/primitives/time.ts";
import { RelationshipsEngine } from "../../src/engine/relationships/engine.ts";
import { FamilyEngine } from "../../src/engine/family/engine.ts";
import { IdentityEngine } from "../../src/engine/identity/engine.ts";
import { M2_SETTLEMENT_ID } from "../../src/content/aurelia/geography.ts";
import type { RelationshipContext } from "../../src/engine/primitives/relationship.ts";

const SEED = "reellife-scenario-marriage";
const CHAIN = "chain-courtship";
const DAY = MINUTES_PER_DAY;

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
}

function makePerson(sim: Simulation, first: string, last: string): EntityId<"person"> {
  let id: EntityId<"person"> = asEntityId<"person">("PER-999999");
  sim.guard.mutate("identity", () => {
    id = new IdentityEngine(sim.scope, sim.world).create(sim.ids, {
      name: { first, last },
      birth: { dateOfBirth: atTime(0) },
      appearanceFoundationSeed: "marriage-fixture",
    }).id;
  });
  return id;
}

/** Establishes (or extends) a relationship through System 18. */
function tie(
  sim: Simulation,
  from: EntityId<"person">,
  to: EntityId<"person">,
  contexts: readonly RelationshipContext[],
  at: number,
) {
  sim.guard.mutate("relationships", () => {
    new RelationshipsEngine(sim.scope, sim.world).establish(
      sim.ids,
      from,
      to,
      contexts,
      "met at the mill",
      atTime(at),
    );
  });
}

function read(
  sim: Simulation,
  from: EntityId<"person">,
  to: EntityId<"person">,
) {
  return new RelationshipsEngine(sim.scope, sim.world).get(from, to);
}

/** Records time spent together, through System 18, in its own scope. */
function spendTimeTogether(
  sim: Simulation,
  from: EntityId<"person">,
  to: EntityId<"person">,
  at: number,
) {
  sim.guard.mutate("relationships", () => {
    new RelationshipsEngine(sim.scope, sim.world).recordInteraction(
      from,
      to,
      { closeness: 0.04, familiarity: 0.06, trust: 0.02 },
      atTime(at),
    );
  });
}

describe("marriage scenario (M8)", () => {
  it("runs a courtship to a marriage, in the systems that own each fact", () => {
    const sim = newWorld();
    const ada = makePerson(sim, "Ada", "Byron");
    const nell = makePerson(sim, "Nell", "Byron");

    // 1. They meet. System 18 holds the tie, and it starts as an acquaintance.
    tie(sim, ada, nell, ["acquaintance"], DAY);
    expect(read(sim, ada, nell)?.contexts).toEqual(["acquaintance"]);
    // A brand new relationship starts neutral — neither warm nor cold.
    expect(read(sim, ada, nell)?.evaluation.closeness).toBe(0);

    // 2. Time together moves the quality on its own — long before anyone is a
    //    spouse of anybody.
    for (let index = 2; index <= 6; index += 1) {
      spendTimeTogether(sim, ada, nell, DAY * index);
    }
    const qualityBefore = read(sim, ada, nell)?.evaluation.closeness ?? 0;
    expect(qualityBefore).toBeGreaterThan(0);
    // Still only acquaintances: spending time is not a status change.
    expect(read(sim, ada, nell)?.contexts).toEqual(["acquaintance"]);

    // 3. The courtship. Contexts accumulate rather than replace each other.
    tie(sim, ada, nell, ["romance"], DAY * 7);
    tie(sim, ada, nell, ["dating"], DAY * 8);
    expect(read(sim, ada, nell)?.contexts).toEqual(
      expect.arrayContaining(["acquaintance", "romance", "dating"]),
    );

    // 4. The marriage. It is a relationship context and nothing more.
    tie(sim, ada, nell, ["spouse"], DAY * 9);
    const married = read(sim, ada, nell);
    expect(married?.contexts).toContain("spouse");
    // The earlier contexts survive: a marriage does not erase how they met.
    expect(married?.contexts).toContain("acquaintance");
    expect(married?.contexts).toContain("romance");

    // 5. Status is not quality. The marriage did *not* reset the evaluation:
    //    two people can be married and still be exactly as close as they were.
    expect(married?.evaluation.closeness).toBe(qualityBefore);
  });

  it("a strained relationship can marry, and the strain is not hidden", () => {
    const sim = newWorld();
    const ada = makePerson(sim, "Ada", "Byron");
    const nell = makePerson(sim, "Nell", "Byron");

    tie(sim, ada, nell, ["acquaintance"], DAY);
    for (let index = 2; index <= 4; index += 1) {
      spendTimeTogether(sim, ada, nell, DAY * index);
    }
    // A real quarrel, recorded as one, with a reason.
    sim.guard.mutate("relationships", () => {
      new RelationshipsEngine(sim.scope, sim.world).recordInteraction(
        ada,
        nell,
        { closeness: -0.3, conflict: 0.5, trust: -0.2 },
        atTime(DAY * 5),
        { kind: "conflict", summary: "an argument about the mill accounts" },
      );
    });

    const strained = read(sim, ada, nell);
    expect(strained?.evaluation.conflict).toBeGreaterThan(0);
    expect(strained?.evaluation.closeness).toBeLessThan(0.5);

    // They marry anyway. The status is a fact; the strain is a separate fact,
    // and neither is allowed to overwrite the other.
    tie(sim, ada, nell, ["spouse"], DAY * 6);
    const married = read(sim, ada, nell);
    expect(married?.contexts).toContain("spouse");
    expect(married?.evaluation.conflict).toBe(strained?.evaluation.conflict);
    expect(married?.evaluation.closeness).toBe(strained?.evaluation.closeness);
    // And the argument stays on the record as a turning point, not written over.
    expect(married?.turningPoints.some((point) => point.kind === "conflict")).toBe(true);
  });

  it("a marriage is structure, and the household records it", () => {
    const sim = newWorld();
    const ada = makePerson(sim, "Ada", "Byron");
    const nell = makePerson(sim, "Nell", "Byron");
    tie(sim, ada, nell, ["spouse"], DAY);

    // System 19 holds the household. A marriage in System 18 does not silently
    // create one: the two systems agree because the world says they agree, not
    // because one of them guessed at the other.
    let householdId = "";
    sim.guard.mutate("family", () => {
      const family = new FamilyEngine(sim.scope, sim.world);
      const household = family.createHousehold(
        sim.ids,
        "Byron",
        ada,
        atTime(DAY),
        M2_SETTLEMENT_ID,
      );
      family.addHouseholdMember(household.id, nell, "spouse", atTime(DAY));
      householdId = household.id;
    });

    const family = new FamilyEngine(sim.scope, sim.world);
    const household = family.getHousehold(householdId);
    expect(household?.name).toBe("Byron");
    expect(household?.residenceLocationId).toBe(M2_SETTLEMENT_ID);
    expect(household?.members.map((member) => member.role)).toEqual(["head", "spouse"]);
    // Both stints are open: neither has ended.
    expect(family.currentMembers(householdId)).toHaveLength(2);
    // The spouse role is read off the household, so "who lives with whom" is a
    // structural question with a structural answer.
    expect(family.memberRole(householdId, nell)).toBe("spouse");

    // No system holds a private "isMarried" flag: the fact is only ever
    // readable by asking the systems that own it.
    expect(JSON.stringify(sim.world.systems)).not.toMatch(/"isMarried"|"marriedTo"/);
  });

  it("the marriage is on the timeline, and the chain that produced it walks", () => {
    const sim = newWorld();
    const ada = makePerson(sim, "Ada", "Byron");
    const nell = makePerson(sim, "Nell", "Byron");

    tie(sim, ada, nell, ["acquaintance"], DAY);
    spendTimeTogether(sim, ada, nell, DAY * 2);
    sim.guard.mutate("history", () => {
      sim.history.record({
        at: atTime(DAY * 2),
        kind: "relationship",
        summary: "Ada and Nell began spending time together",
        personId: ada,
        causalChainId: CHAIN,
        importance: 3,
        visibility: "public",
      });
    });
    tie(sim, ada, nell, ["spouse"], DAY * 3);
    sim.guard.mutate("history", () => {
      sim.history.record({
        at: atTime(DAY * 3),
        kind: "relationship",
        summary: "Ada and Nell married",
        personId: ada,
        causalChainId: CHAIN,
        importance: 4,
        visibility: "public",
      });
    });

    // The chain explains the marriage without the engine reconstructing it:
    // both entries are on it, in order.
    const chain = sim.history.forChain(CHAIN);
    expect(chain).toHaveLength(2);
    expect(chain[0]?.at).toBeLessThan(chain[1]?.at as number);
    expect(chain[1]?.summary).toContain("married");
    // A marriage is a milestone, so retention keeps it permanently.
    expect(chain[1]?.importance).toBeGreaterThanOrEqual(3);
    // Both people are on the timeline under their own PersonIds: a marriage is
    // attributed to each spouse rather than filed under one of them.
    expect(sim.history.forPerson(ada).length).toBeGreaterThan(0);
    sim.guard.mutate("history", () => {
      sim.history.record({
        at: atTime(DAY * 3),
        kind: "relationship",
        summary: "Nell married Ada",
        personId: nell,
        causalChainId: CHAIN,
        importance: 4,
        visibility: "public",
      });
    });
    expect(sim.history.forPerson(nell).length).toBeGreaterThan(0);
    // The timeline is a curated view; both entries describing the same marriage
    // coexist, because a player's own history is not deduplicated behind their
    // back.
    expect(sim.history.forChain(CHAIN)).toHaveLength(3);
  });

  it("the whole courtship reproduces from its seed", () => {
    const run = (): string => {
      const sim = newWorld();
      const ada = makePerson(sim, "Ada", "Byron");
      const nell = makePerson(sim, "Nell", "Byron");
      tie(sim, ada, nell, ["acquaintance"], DAY);
      for (let index = 2; index <= 6; index += 1) {
        spendTimeTogether(sim, ada, nell, DAY * index);
      }
      tie(sim, ada, nell, ["romance", "dating", "spouse"], DAY * 9);
      return sim.stateHash();
    };
    expect(run()).toBe(run());
  });
});
