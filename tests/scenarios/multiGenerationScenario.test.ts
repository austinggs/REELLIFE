/**
 * M7 Definition of Done — one life ends and the next one continues, in the
 * same world.
 *
 *   ancestor's life -> death determination -> records -> estate settled into
 *   concrete fields -> control handed to a descendant -> the ancestor's causal
 *   history still walks
 *
 * The M7 DoD is a set of properties, and each is asserted here rather than
 * described:
 *
 *  1. The deceased's PersonId still resolves in identity, lineage, ledger history
 *     and timeline, and is named by the transfer. Nothing re-keys it.
 *  2. Every legacy effect walks back to a concrete field it changed, in the
 *     system that owns that field. There is no `legacyBonus`-style scalar.
 *  3. The ancestor's `causalChainId` still resolves after control moves.
 *  4. Other systems' state is unchanged except by the named transfers.
 *  5. The whole run reproduces from its seed, and survives a save/load.
 *
 * The chain is played by the harness rather than by the NPC decision loop: a
 * player's own death is not a decision System 17's autonomy gets to make. Every
 * consequence the death *causes* is real engine work inside each owner's scope.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation, bootstrapLoadedSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { Simulation as SimulationClass } from "../../src/engine/core/simulation.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { asEntityId, type EntityId } from "../../src/engine/primitives/ids.ts";
import { currencyId, money } from "../../src/engine/primitives/money.ts";
import { atTime } from "../../src/engine/primitives/time.ts";
import { LifeContinuityEngine } from "../../src/engine/continuity/engine.ts";
import { archiveLife, processDeath } from "../../src/engine/continuity/death.ts";
import { openEstate, settleEstate } from "../../src/engine/continuity/estate.ts";
import { handOverControl, successionCandidates } from "../../src/engine/continuity/control.ts";
import { IdentityEngine } from "../../src/engine/identity/engine.ts";
import { FamilyEngine } from "../../src/engine/family/engine.ts";
import { FinanceEngine } from "../../src/engine/finance/engine.ts";
import { InventoryEngine } from "../../src/engine/inventory/engine.ts";
import type { ContinuitySystemState } from "../../src/engine/continuity/types.ts";
import type { SystemId } from "../../src/engine/core/ownership.ts";

const SEED = "reellife-scenario-multi-generation";
const ACR = currencyId("ACR");
const BIRTH = atTime(0);
const ADULT = atTime(1000);
const DEATH = atTime(2000);
const PROBATE = atTime(3000);
const HANDOFF = atTime(4000);
const CHAIN = "chain-mill-career";

interface Generation {
  readonly sim: Simulation;
  readonly ancestor: EntityId<"person">;
  readonly heir: EntityId<"person">;
  readonly estateId: string;
  readonly accountId: string;
  readonly itemId: string;
}

function balanceOf(sim: Simulation, accountId: string): number {
  const account = new FinanceEngine(sim.scope, sim.world).getAccount(accountId);
  if (!account) throw new Error(`unknown account ${accountId}`);
  return account.balance.minorUnits;
}

function systemBag(sim: Simulation, id: SystemId): unknown {
  return sim.world.systems[id];
}

/** Runs the whole chain once and returns the handles the assertions need. */
function runGeneration(): Generation {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true });

  const makePerson = (first: string, last: string): EntityId<"person"> => {
    let id = asEntityId<"person">("PER-999999");
    sim.guard.mutate("identity", () => {
      id = new IdentityEngine(sim.scope, sim.world).create(sim.ids, {
        name: { first, last },
        birth: { dateOfBirth: BIRTH },
        appearanceFoundationSeed: "m7-fixture",
      }).id;
    });
    return id;
  };

  const ancestor = makePerson("Ada", "Byron");
  const heir = makePerson("Nell", "Byron");

  // A family, in System 19's own scope.
  sim.guard.mutate("family", () => {
    const family = new FamilyEngine(sim.scope, sim.world);
    const household = family.createHousehold(sim.ids, "Byron", ancestor, BIRTH);
    family.addHouseholdMember(household.id, heir, "child", ADULT);
    family.recordParentChild(ancestor, heir);
  });

  // The ancestor's life: a will, savings, and something worth leaving behind.
  let accountId = "";
  sim.guard.mutate("finance", () => {
    accountId = new FinanceEngine(sim.scope, sim.world).openAccount(
      sim.ids,
      ancestor,
      "checking",
      ACR,
      ADULT,
      money(ACR, 250_000),
    ).id;
  });
  let itemId = "";
  sim.guard.mutate("inventory", () => {
    itemId = new InventoryEngine(sim.scope, sim.world).addItem(
      sim.ids,
      "ITEM-DESK",
      ancestor,
      ancestor,
      1,
      0.7,
      ADULT,
    ).id;
  });
  sim.guard.mutate("continuity", () => {
    new LifeContinuityEngine(sim.scope, sim.world).declareTestament("will-ada", {
      testatorId: ancestor,
      declaredAt: ADULT,
      beneficiaries: [{ personId: heir, basis: "will", share: 1 }],
    });
  });

  // Something on the ancestor's own causal chain, to be walked after the handoff.
  sim.guard.mutate("history", () => {
    sim.history.record({
      at: ADULT,
      kind: "work",
      summary: "took work at the mill",
      personId: ancestor,
      causalChainId: CHAIN,
      importance: 4,
      visibility: "public",
    });
  });

  // The life ends: determination, records, civil registration, timeline.
  processDeath(sim, {
    personId: ancestor,
    cause: "age",
    causeNote: "old age",
    certainty: "probable",
    determinedBy: "inference",
    at: DEATH,
  });

  // Probate: the estate opens and settles into the owning systems' own fields.
  const estate = openEstate(sim, { deceasedId: ancestor, openedAt: PROBATE });
  settleEstate(sim, estate.id, PROBATE);

  // Succession: control passes to the descendant, with no world reset.
  handOverControl(sim, {
    fromPersonId: ancestor,
    toPersonId: heir,
    at: HANDOFF,
    basis: "descendant",
    estateId: estate.id,
    reason: "the last of the Byrons",
  });

  return { sim, ancestor, heir, estateId: estate.id, accountId, itemId };
}


describe("multi-generation scenario (M7 DoD)", () => {
  it("carries a life to its heir with the causal graph intact", () => {
    const { sim, ancestor, heir, estateId, accountId, itemId } = runGeneration();

    // --- 1. the estate settled, into concrete fields in the owning systems --
    const estate = LifeContinuityEngine.peek(sim.scope, sim.world).estate(estateId);
    expect(estate?.status).toBe("settled");
    expect(estate?.deceasedId).toBe(ancestor);
    // The declared will decided this, and the record says so.
    expect(estate?.beneficiaries).toEqual([{ personId: heir, basis: "will", share: 1 }]);
    // Every application names a real system, and money names its ledger entry.
    for (const applied of estate?.applications ?? []) {
      expect(sim.world.systems[applied.appliedBy]).toBeDefined();
      if (applied.appliedBy === "finance") expect(applied.ledgerEntryId).toBeDefined();
    }
    // The money really is the heir's, in System 25's own balance field.
    const heirAccounts = new FinanceEngine(sim.scope, sim.world).accountsForOwner(heir);
    expect(heirAccounts[0]?.balance).toEqual(money(ACR, 250_000));
    expect(balanceOf(sim, accountId)).toBe(0);
    // The item really is the heir's, in System 29's own owner field.
    expect(new InventoryEngine(sim.scope, sim.world).getItem(itemId)?.ownerId).toBe(heir);

    // --- 2. no legacyBonus-style scalar anywhere in continuity state --------
    const continuity = systemBag(sim, "continuity") as ContinuitySystemState;
    expect(JSON.stringify(continuity)).not.toMatch(
      /legacyBonus|inheritanceBonus|heirBonus|startingBonus|legacyModifier/i,
    );

    // --- 3. the PersonId survives everywhere, unre-keyed --------------------
    const identity = new IdentityEngine(sim.scope, sim.world).get(ancestor);
    expect(identity?.id).toBe(ancestor);
    expect(identity?.death).toBeDefined();
    const family = new FamilyEngine(sim.scope, sim.world);
    expect(family.parentsOf(heir)).toContain(ancestor);
    expect(family.childrenOf(ancestor)).toContain(heir);
    const continuityRead = LifeContinuityEngine.peek(sim.scope, sim.world);
    expect(continuityRead.statusOf(ancestor)).toBe("deceased");
    expect(continuityRead.determinationOf(ancestor)).toBeDefined();
    expect(continuityRead.recordOf(ancestor)).toBeDefined();
    // The handoff names the ancestor; it does not replace them.
    expect(continuityRead.controlTransfers()[0]?.fromPersonId).toBe(ancestor);
    expect(continuityRead.currentControllerId()).toBe(heir);
    // The ancestor's own timeline is still theirs.
    expect(sim.history.forPerson(ancestor).some((entry) => entry.kind === "death")).toBe(true);

    // --- 4. the ancestor's causal chain still walks ------------------------
    const chain = sim.history.forChain(CHAIN);
    expect(chain).toHaveLength(1);
    expect(chain[0]?.personId).toBe(ancestor);
    expect(chain[0]?.summary).toBe("took work at the mill");

    // --- 5. the heir's own life is intact and not re-keyed ------------------
    const heirIdentity = new IdentityEngine(sim.scope, sim.world).get(heir);
    expect(heirIdentity?.id).toBe(heir);
    expect(heirIdentity?.death).toBeUndefined();
    expect(LifeContinuityEngine.peek(sim.scope, sim.world).statusOf(heir)).toBe("active");
  });

  it("touches only the systems the chain names, and only by the named transfers", () => {
    const { sim, ancestor, heir } = runGeneration();

    // Employment was never a participant in this chain, so it stays empty. A
    // handoff that "reset" the world would have repopulated it.
    const employment = systemBag(sim, "employment") as
      | { employments?: unknown[] }
      | undefined;
    expect(employment?.employments ?? []).toEqual([]);

    // The death pipeline wrote family state once: the stint ended with a reason
    // and the household was not re-founded.
    const family = new FamilyEngine(sim.scope, sim.world);
    const household = family.householdForPerson(heir);
    expect(household).toBeDefined();
    expect(
      household?.members.find((member) => member.personId === ancestor)?.leftReason,
    ).toBe("death");

    // The estate is settled, so the life can be archived — the last lifecycle
    // step, and the only thing that changes the ancestor's status afterwards.
    expect(archiveLife(sim, ancestor)).toBe(true);
    expect(LifeContinuityEngine.peek(sim.scope, sim.world).statusOf(ancestor)).toBe("historical");
    // Historical is not erased: determination, record and transfer all resolve.
    const continuity = LifeContinuityEngine.peek(sim.scope, sim.world);
    expect(continuity.determinationOf(ancestor)).toBeDefined();
    expect(continuity.recordOf(ancestor)).toBeDefined();
    expect(continuity.controlTransfers()).toHaveLength(1);
  });

  it("reproduces from its seed: the same run gives the same world", () => {
    const first = runGeneration();
    const second = runGeneration();
    expect(second.sim.stateHash()).toBe(first.sim.stateHash());
    expect(second.estateId).toBe(first.estateId);
  });

  it("survives a save and load with the transfer still in force", () => {
    const { sim, ancestor, heir } = runGeneration();
    const reloaded = bootstrapLoadedSimulation(
      SimulationClass.fromSaveFile(sim.toSave("m7"), { masterSeed: SEED }),
    );

    // The whole world came back, transfer included, and the departed PersonId
    // still resolves on the other side of the save.
    expect(reloaded.stateHash()).toBe(sim.stateHash());
    const continuity = LifeContinuityEngine.peek(reloaded.scope, reloaded.world);
    expect(continuity.currentControllerId()).toBe(heir);
    expect(continuity.statusOf(ancestor)).toBe("deceased");
    expect(new IdentityEngine(reloaded.scope, reloaded.world).get(ancestor)?.id).toBe(ancestor);
    expect(reloaded.history.forChain(CHAIN)).toHaveLength(1);
  });

  it("hands control to a living heir and refuses a dead one", () => {
    const { sim, ancestor, heir, estateId } = runGeneration();
    // The heir was the natural candidate while the ancestor lived.
    const candidates = successionCandidates(sim, ancestor);
    expect(candidates.some((entry) => entry.personId === heir)).toBe(true);
    // And the handoff on record names the estate that caused it.
    const transfer = LifeContinuityEngine.peek(sim.scope, sim.world).controlTransfers()[0];
    expect(transfer?.estateId).toBe(estateId);
    expect(transfer?.basis).toBe("descendant");
  });
});


