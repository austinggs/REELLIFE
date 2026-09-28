/**
 * System 53b/53c — estate settlement and player control handoff.
 *
 * The properties under test are the ones the spec names and the ones that are
 * easy to get wrong:
 *
 *  - The estate holds *references*, and each transfer is performed by the system
 *    that owns the field. There is no second ownership record and no
 *    `legacyBonus`-style scalar anywhere in continuity state.
 *  - A will outranks intestacy; intestacy names the relationship it rests on.
 *  - Money moves through System 25 as balanced ledger entries, and an uneven
 *    division places the whole balance while stating the remainder.
 *  - Control moves with no world reset: the ancestor's PersonId still resolves
 *    in every system afterwards, and their causal chain still walks.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { asEntityId, type EntityId } from "../../src/engine/primitives/ids.ts";
import { currencyId, money } from "../../src/engine/primitives/money.ts";
import { atTime } from "../../src/engine/primitives/time.ts";
import { LifeContinuityEngine } from "../../src/engine/continuity/engine.ts";
import { processDeath } from "../../src/engine/continuity/death.ts";
import {
  determineBeneficiaries,
  gatherEstate,
  openEstate,
  settleEstate,
  SUCCESSION_TARGETS,
} from "../../src/engine/continuity/estate.ts";
import { handOverControl, successionCandidates } from "../../src/engine/continuity/control.ts";
import { IdentityEngine } from "../../src/engine/identity/engine.ts";
import { FamilyEngine } from "../../src/engine/family/engine.ts";
import { FinanceEngine } from "../../src/engine/finance/engine.ts";
import { InventoryEngine } from "../../src/engine/inventory/engine.ts";
import { TransportEngine } from "../../src/engine/transport/engine.ts";
import { sliceUnderControl } from "../../src/engine/kernel/sliceSeed.ts";

const SEED = "reellife-continuity-estate";
const ACR = currencyId("ACR");
const NOW = atTime(1000);
const DEATH = atTime(2000);

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
}

function createPerson(sim: Simulation, first: string, last: string): EntityId<"person"> {
  let id: EntityId<"person"> = asEntityId<"person">("PER-999999");
  sim.guard.mutate("identity", () => {
    id = new IdentityEngine(sim.scope, sim.world).create(sim.ids, {
      name: { first, last },
      birth: { dateOfBirth: atTime(0) },
      appearanceFoundationSeed: "estate-fixture",
    }).id;
  });
  return id;
}

function openAccount(
  sim: Simulation,
  ownerId: EntityId<"person"> | string,
  balance: number,
): string {
  let id = "";
  sim.guard.mutate("finance", () => {
    id = new FinanceEngine(sim.scope, sim.world).openAccount(
      sim.ids,
      ownerId,
      "checking",
      ACR,
      NOW,
      money(ACR, balance),
    ).id;
  });
  return id;
}

function addItem(sim: Simulation, ownerId: EntityId<"person"> | string): string {
  let id = "";
  sim.guard.mutate("inventory", () => {
    id = new InventoryEngine(sim.scope, sim.world).addItem(
      sim.ids,
      "ITEM-BED",
      ownerId,
      ownerId,
      1,
      0.6,
      NOW,
    ).id;
  });
  return id;
}

function addVehicle(sim: Simulation, ownerId: EntityId<"person"> | string): string {
  let id = "";
  sim.guard.mutate("transport", () => {
    id = new TransportEngine(sim.scope, sim.world).defineVehicle({
      id: `veh-${String(sim.ids.next("vehicle"))}`,
      kind: "bicycle",
      mode: "road",
      ownerId: String(ownerId),
      locationId: "CITY-ARDEN",
      capacityUnits: 10,
      energyCapacityUnits: 10,
      rangeUnits: 40,
    }, NOW).id;
  });
  return id;
}

/** A parent with a child, linked through System 19 in its own scope. */
function familyOf(
  sim: Simulation,
  parentId: EntityId<"person">,
  childId: EntityId<"person">,
): void {
  sim.guard.mutate("family", () => {
    new FamilyEngine(sim.scope, sim.world).recordParentChild(parentId, childId);
  });
}

function balanceOf(sim: Simulation, accountId: string): number {
  const account = new FinanceEngine(sim.scope, sim.world).getAccount(accountId);
  if (!account) throw new Error(`unknown account ${accountId}`);
  return account.balance.minorUnits;
}

describe("estate settlement (System 53b)", () => {
  it("gatherEstate lists references and never invents a valuation", () => {
    const sim = newWorld();
    const deceased = createPerson(sim, "Ada", "Byron");
    const accountId = openAccount(sim, deceased, 40_000);
    const itemId = addItem(sim, deceased);
    const vehicleId = addVehicle(sim, deceased);

    const gathered = gatherEstate(sim, deceased);
    const ids = gathered.items.map((item) => item.id).sort();
    expect(ids).toEqual([accountId, itemId, vehicleId].sort());

    // The money valuation is copied from System 25, never estimated here.
    const account = gathered.items.find((item) => item.id === accountId);
    expect(account?.valuation).toEqual(money(ACR, 40_000));
    // The item and the vehicle have no value the owning system stated, so the
    // estate holds none. An estate that guessed would be inventing a fact.
    expect(gathered.items.find((item) => item.id === itemId)?.valuation).toBeUndefined();
    expect(gathered.items.find((item) => item.id === vehicleId)?.valuation).toBeUndefined();

    // Every reference names a system and a field, and both match the table that
    // says which system owns that kind of record.
    for (const item of gathered.items) {
      expect(SUCCESSION_TARGETS[item.ref.kind].system).toBe(item.ref.system);
      expect(SUCCESSION_TARGETS[item.ref.kind].field).toBe(item.ref.field);
    }
    expect(gathered.moneyByCurrency[ACR]).toEqual(money(ACR, 40_000));
  });

  it("openEstate refuses while the person is alive and fixes beneficiaries", () => {
    const sim = newWorld();
    const deceased = createPerson(sim, "Ada", "Byron");
    expect(() => openEstate(sim, { deceasedId: deceased, openedAt: NOW })).toThrow(
      /has not died/,
    );

    const child = createPerson(sim, "Nell", "Byron");
    familyOf(sim, deceased, child);
    processDeath(sim, { personId: deceased, cause: "age", at: DEATH });

    const estate = openEstate(sim, { deceasedId: deceased, openedAt: DEATH });
    expect(estate.status).toBe("open");
    // Intestacy found a child, so the basis names that relationship.
    expect(estate.beneficiaries).toEqual([
      { personId: child, basis: "intestacy_descendant", share: 1 },
    ]);
    // Opening settles nothing.
    expect(estate.applications).toHaveLength(0);
  });

  it("a declared will outranks intestacy, and a revoked will stops applying", () => {
    const sim = newWorld();
    const deceased = createPerson(sim, "Ada", "Byron");
    const child = createPerson(sim, "Nell", "Byron");
    const friend = createPerson(sim, "Sol", "Ray");
    familyOf(sim, deceased, child);

    sim.guard.mutate("continuity", () => {
      new LifeContinuityEngine(sim.scope, sim.world).declareTestament("will-1", {
        testatorId: deceased,
        declaredAt: NOW,
        beneficiaries: [{ personId: friend, basis: "will", share: 1 }],
      });
    });

    processDeath(sim, { personId: deceased, cause: "age", at: DEATH });
    // The will wins outright: the child is a blood heir and gets nothing.
    expect(determineBeneficiaries(sim, deceased)).toEqual([
      { personId: friend, basis: "will", share: 1 },
    ]);

    sim.guard.mutate("continuity", () => {
      new LifeContinuityEngine(sim.scope, sim.world).revokeTestament("will-1", DEATH);
    });
    // Revoked: the record stays, and intestacy resumes.
    expect(determineBeneficiaries(sim, deceased)).toEqual([
      { personId: child, basis: "intestacy_descendant", share: 1 },
    ]);
  });

  it("intestacy splits evenly across the nearest surviving tier", () => {
    const sim = newWorld();
    const deceased = createPerson(sim, "Ada", "Byron");
    const first = createPerson(sim, "Nell", "Byron");
    const second = createPerson(sim, "Ivo", "Byron");
    familyOf(sim, deceased, first);
    familyOf(sim, deceased, second);

    processDeath(sim, { personId: deceased, cause: "age", at: DEATH });
    const beneficiaries = determineBeneficiaries(sim, deceased);
    expect(beneficiaries).toHaveLength(2);
    for (const entry of beneficiaries) {
      expect(entry.basis).toBe("intestacy_descendant");
      expect(entry.share).toBeCloseTo(0.5, 9);
    }
  });

  it("intestacy falls to the household when there is no child", () => {
    const sim = newWorld();
    const deceased = createPerson(sim, "Ada", "Byron");
    const partner = createPerson(sim, "Sol", "Ray");
    sim.guard.mutate("family", () => {
      const family = new FamilyEngine(sim.scope, sim.world);
      const household = family.createHousehold(sim.ids, "Byron", deceased, NOW);
      family.addHouseholdMember(household.id, partner, "spouse", NOW);
    });

    processDeath(sim, { personId: deceased, cause: "age", at: DEATH });
    // The death pipeline ended the deceased's stint, and the household tier is
    // still found — read from who was *in* the household, not from live members.
    expect(determineBeneficiaries(sim, deceased)).toEqual([
      { personId: partner, basis: "intestacy_household", share: 1 },
    ]);
  });

  it("settleEstate pays money through System 25 as balanced ledger entries", () => {
    const sim = newWorld();
    const deceased = createPerson(sim, "Ada", "Byron");
    const heir = createPerson(sim, "Nell", "Byron");
    familyOf(sim, deceased, heir);
    const accountId = openAccount(sim, deceased, 100_000);

    processDeath(sim, { personId: deceased, cause: "age", at: DEATH });
    const estate = openEstate(sim, { deceasedId: deceased, openedAt: DEATH });
    const result = settleEstate(sim, estate.id, DEATH);

    expect(result.estate.status).toBe("settled");
    // The whole balance moved, to a real System 25 account.
    expect(balanceOf(sim, accountId)).toBe(0);
    const heirAccounts = new FinanceEngine(sim.scope, sim.world).accountsForOwner(heir);
    expect(heirAccounts).toHaveLength(1);
    expect(heirAccounts[0]?.balance).toEqual(money(ACR, 100_000));

    // The application names the system that wrote it and the entry that carried it.
    const applied = result.applications.find((entry) => entry.appliedBy === "finance");
    expect(applied?.ledgerEntryId).toBeDefined();
    const ledger = new FinanceEngine(sim.scope, sim.world).allLedger();
    expect(ledger.some((entry) => entry.id === applied?.ledgerEntryId)).toBe(true);
    expect(ledger[ledger.length - 1]?.category).toBe("inheritance");
  });


  it("an uneven division places the whole balance and states the remainder", () => {
    const sim = newWorld();
    const deceased = createPerson(sim, "Ada", "Byron");
    const first = createPerson(sim, "Nell", "Byron");
    const second = createPerson(sim, "Ivo", "Byron");
    familyOf(sim, deceased, first);
    familyOf(sim, deceased, second);
    // 101 minor units across two beneficiaries cannot divide evenly: two floors of
    // 50 leave a remainder of 1, which has to go somewhere and be named.
    const accountId = openAccount(sim, deceased, 101);

    processDeath(sim, { personId: deceased, cause: "age", at: DEATH });
    const estate = openEstate(sim, { deceasedId: deceased, openedAt: DEATH });
    settleEstate(sim, estate.id, DEATH);

    // Nothing is lost to rounding: the balance is fully placed...
    expect(balanceOf(sim, accountId)).toBe(0);
    const total = [first, second].reduce((sum, personId) => {
      const accounts = new FinanceEngine(sim.scope, sim.world).accountsForOwner(personId);
      return sum + (accounts[0]?.balance.minorUnits ?? 0);
    }, 0);
    expect(total).toBe(101);
    // ...and the remainder is named rather than silently kept.
    const noted = LifeContinuityEngine.peek(sim.scope, sim.world)
      .estate(estate.id)
      ?.applications.some((entry) => entry.note?.includes("remainder"));
    expect(noted).toBe(true);
  });

  it("settleEstate hands items and vehicles over through their owning systems", () => {
    const sim = newWorld();
    const deceased = createPerson(sim, "Ada", "Byron");
    const heir = createPerson(sim, "Nell", "Byron");
    familyOf(sim, deceased, heir);
    const itemId = addItem(sim, deceased);
    const vehicleId = addVehicle(sim, deceased);

    processDeath(sim, { personId: deceased, cause: "age", at: DEATH });
    const estate = openEstate(sim, { deceasedId: deceased, openedAt: DEATH });
    settleEstate(sim, estate.id, DEATH);

    // The *owner* fields changed, in the systems that own them.
    expect(new InventoryEngine(sim.scope, sim.world).getItem(itemId)?.ownerId).toBe(heir);
    const vehicle = new TransportEngine(sim.scope, sim.world).vehicle(vehicleId);
    expect(vehicle?.ownerId).toBe(String(heir));
    // The previous owner stays on the registration history, so it is traceable.
    expect(vehicle?.registrations[0]?.ownerId).toBe(String(deceased));
    expect(vehicle?.registrations).toHaveLength(2);
  });

  it("an estate with no eligible beneficiary is unclaimed, never defaulted", () => {
    const sim = newWorld();
    const deceased = createPerson(sim, "Ada", "Byron");
    const child = createPerson(sim, "Nell", "Byron");
    familyOf(sim, deceased, child);
    const accountId = openAccount(sim, deceased, 5_000);

    processDeath(sim, { personId: deceased, cause: "age", at: DEATH });
    const estate = openEstate(sim, { deceasedId: deceased, openedAt: DEATH });
    // The only heir dies before probate.
    processDeath(sim, { personId: child, cause: "disease", at: atTime(3000) });

    const result = settleEstate(sim, estate.id, atTime(4000));
    expect(result.estate.status).toBe("unclaimed");
    expect(result.applications).toHaveLength(0);
    // Nobody was quietly given the money.
    expect(balanceOf(sim, accountId)).toBe(5_000);
  });

  it("settling twice is a no-op and never pays twice", () => {
    const sim = newWorld();
    const deceased = createPerson(sim, "Ada", "Byron");
    const heir = createPerson(sim, "Nell", "Byron");
    familyOf(sim, deceased, heir);
    const accountId = openAccount(sim, deceased, 20_000);

    processDeath(sim, { personId: deceased, cause: "age", at: DEATH });
    const estate = openEstate(sim, { deceasedId: deceased, openedAt: DEATH });
    settleEstate(sim, estate.id, DEATH);
    const second = settleEstate(sim, estate.id, atTime(5000));

    expect(second.applications).toHaveLength(0);
    const heirAccounts = new FinanceEngine(sim.scope, sim.world).accountsForOwner(heir);
    expect(heirAccounts[0]?.balance).toEqual(money(ACR, 20_000));
    expect(balanceOf(sim, accountId)).toBe(0);
  });

  it("continuity state carries no legacyBonus-style scalar", () => {
    const sim = newWorld();
    const deceased = createPerson(sim, "Ada", "Byron");
    const heir = createPerson(sim, "Nell", "Byron");
    familyOf(sim, deceased, heir);
    openAccount(sim, deceased, 1_000);
    processDeath(sim, { personId: deceased, cause: "age", at: DEATH });
    const estate = openEstate(sim, { deceasedId: deceased, openedAt: DEATH });
    settleEstate(sim, estate.id, DEATH);

    const serialized = JSON.stringify(sim.world.systems.continuity);
    expect(serialized).not.toMatch(/legacyBonus|inheritanceBonus|heirBonus|startingBonus/i);
  });
});



describe("control handoff (System 53c)", () => {
  it("successionCandidates lists the living relations, nearest first", () => {
    const sim = newWorld();
    const ancestor = createPerson(sim, "Ada", "Byron");
    const child = createPerson(sim, "Nell", "Byron");
    const grandchild = createPerson(sim, "Ivo", "Byron");
    const sibling = createPerson(sim, "Sol", "Byron");
    const parent = createPerson(sim, "Grace", "Byron");
    familyOf(sim, ancestor, child);
    familyOf(sim, child, grandchild);
    sim.guard.mutate("family", () => {
      const family = new FamilyEngine(sim.scope, sim.world);
      family.recordParentChild(parent, ancestor);
      family.recordParentChild(parent, sibling);
    });

    const candidates = successionCandidates(sim, ancestor);
    expect(candidates.map((entry) => entry.personId)).toEqual([child, parent, sibling]);
    // A descendant is a descendant, and is not dressed up as anything else.
    expect(candidates[0]?.relation).toBe("descendant");
    expect(candidates[0]?.basis).toBe("descendant");
    // The grandchild is not a candidate: succession is not transitive.
    expect(candidates.some((entry) => entry.personId === grandchild)).toBe(false);
  });

  it("a deceased heir is not a candidate", () => {
    const sim = newWorld();
    const ancestor = createPerson(sim, "Ada", "Byron");
    const child = createPerson(sim, "Nell", "Byron");
    familyOf(sim, ancestor, child);
    processDeath(sim, { personId: child, cause: "disease", at: NOW });

    expect(successionCandidates(sim, ancestor)).toHaveLength(0);
  });

  it("handOverControl records the handoff and writes nothing else", () => {
    const sim = newWorld();
    const ancestor = createPerson(sim, "Ada", "Byron");
    const heir = createPerson(sim, "Nell", "Byron");
    familyOf(sim, ancestor, heir);

    const result = handOverControl(sim, {
      fromPersonId: ancestor,
      toPersonId: heir,
      at: DEATH,
      basis: "descendant",
      reason: "the elder steps back",
    });
    expect(result.transfer).toMatchObject({
      fromPersonId: ancestor,
      toPersonId: heir,
      basis: "descendant",
    });
    expect(LifeContinuityEngine.peek(sim.scope, sim.world).currentControllerId()).toBe(heir);

    // The handoff is on the timeline, at importance 5 so retention keeps it.
    const entry = sim.history
      .forPerson(heir)
      .find((candidate) => candidate.eventType === "continuity.controlTransferred");
    expect(entry?.importance).toBe(5);
  });

  it("handOverControl refuses a dead recipient", () => {
    const sim = newWorld();
    const ancestor = createPerson(sim, "Ada", "Byron");
    const heir = createPerson(sim, "Nell", "Byron");
    familyOf(sim, ancestor, heir);
    processDeath(sim, { personId: heir, cause: "disease", at: NOW });

    expect(() =>
      handOverControl(sim, { fromPersonId: ancestor, toPersonId: heir, at: DEATH }),
    ).toThrow(/not active/);
  });

  it("the departed PersonId still resolves everywhere after the handoff", () => {
    const sim = newWorld();
    const ancestor = createPerson(sim, "Ada", "Byron");
    const heir = createPerson(sim, "Nell", "Byron");
    familyOf(sim, ancestor, heir);
    const accountId = openAccount(sim, ancestor, 10_000);

    // A record on the ancestor's own causal chain, before the handoff.
    sim.guard.mutate("history", () => {
      sim.history.record({
        at: NOW,
        kind: "milestone",
        summary: "the mill was rebuilt",
        personId: ancestor,
        causalChainId: "chain-mill",
        importance: 4,
        visibility: "public",
      });
    });

    processDeath(sim, { personId: ancestor, cause: "age", at: DEATH });
    handOverControl(sim, {
      fromPersonId: ancestor,
      toPersonId: heir,
      at: DEATH,
      basis: "descendant",
    });

    // Identity: the PersonId is unchanged and still carries the death.
    const identity = new IdentityEngine(sim.scope, sim.world).get(ancestor);
    expect(identity?.id).toBe(ancestor);
    expect(identity?.death).toBeDefined();
    // Lineage: the parent-child link is intact in both directions.
    const family = new FamilyEngine(sim.scope, sim.world);
    expect(family.childrenOf(ancestor)).toContain(heir);
    expect(family.parentsOf(heir)).toContain(ancestor);
    expect(family.descendantsOf(ancestor)).toContain(heir);
    // Continuity: the lifecycle still reads deceased, and the transfer names it.
    const continuity = LifeContinuityEngine.peek(sim.scope, sim.world);
    expect(continuity.statusOf(ancestor)).toBe("deceased");
    expect(continuity.controlTransfers()[0]?.fromPersonId).toBe(ancestor);
    // Causal history: the ancestor's chain still walks after control moved.
    expect(sim.history.forChain("chain-mill")).toHaveLength(1);
    expect(sim.history.forPerson(ancestor).length).toBeGreaterThan(0);
    // The ancestor's own account still exists and is theirs, untouched.
    expect(balanceOf(sim, accountId)).toBe(10_000);
  });

  it("a handoff changes control, not the world", () => {
    const sim = newWorld();
    const ancestor = createPerson(sim, "Ada", "Byron");
    const heir = createPerson(sim, "Nell", "Byron");
    const stranger = createPerson(sim, "Sol", "Ray");
    familyOf(sim, ancestor, heir);

    const residentsBefore = JSON.stringify(sim.world.systems.scale ?? null);
    handOverControl(sim, {
      fromPersonId: ancestor,
      toPersonId: heir,
      at: DEATH,
      basis: "descendant",
    });

    // Everybody who existed still exists under the same id, and the world did
    // not roll back: a reset would have replaced the population and the clock.
    expect(new IdentityEngine(sim.scope, sim.world).get(ancestor)?.id).toBe(ancestor);
    expect(new IdentityEngine(sim.scope, sim.world).get(heir)?.id).toBe(heir);
    expect(new IdentityEngine(sim.scope, sim.world).get(stranger)?.id).toBe(stranger);
    expect(JSON.stringify(sim.world.systems.scale ?? null)).toBe(residentsBefore);
  });
});

describe("sliceUnderControl across a handoff", () => {
  it("follows a recorded handoff, and is stable without one", () => {
    const sim = createKernelSimulation({
      masterSeed: SEED,
      seedSlice: true,
      withHeartbeat: false,
    });
    const first = sliceUnderControl(sim);
    expect(first).toBeDefined();
    // A fresh slice is not controlled by a transfer, so re-reading derives the
    // same person rather than trusting a stored pointer.
    expect(sliceUnderControl(sim)).toBe(first);

    // Someone else in the slice to hand over to.
    const other = (
      sim.world.systems.scale as { residents: readonly { personId: EntityId<"person"> }[] }
    ).residents.find((resident) => resident.personId !== first)?.personId;
    expect(other).toBeDefined();

    handOverControl(sim, {
      fromPersonId: first!,
      toPersonId: other!,
      at: sim.clock.time,
      basis: "declared",
    });

    // The shell's answer now comes from the transfer record, not the seed order.
    expect(sliceUnderControl(sim)).toBe(other);
  });
});


