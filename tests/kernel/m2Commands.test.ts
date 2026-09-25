/**
 * M2 command surface: activities, social interaction, rent/bills, work shifts
 * and world save/load.
 *
 * Every test drives a real command through Validation -> Authority ->
 * Resolution -> Event -> Consequence -> New State and then asserts the state
 * the owning engine actually holds. Fixtures are the minimum records a command
 * needs (ledger accounts, an employment) and they are created through the
 * owning engine inside its ownership scope, never by poking state directly.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { asEntityId, type EntityId } from "../../src/engine/primitives/ids.ts";
import { currencyId, money } from "../../src/engine/primitives/money.ts";
import { durationOf } from "../../src/engine/primitives/time.ts";
import type { CommandResult } from "../../src/engine/commands/types.ts";
import {
  ACTIVITY_COMMAND_TYPES,
  ASSET_COMMAND_TYPES,
  EMPLOYMENT_COMMAND_TYPES,
  SOCIAL_COMMAND_TYPES,
} from "../../src/engine/commands/domain/index.ts";
import { WORLD_COMMAND_TYPES } from "../../src/engine/commands/builtin/worldCommands.ts";
import { FinanceEngine } from "../../src/engine/finance/engine.ts";
import { EmploymentEngine } from "../../src/engine/employment/engine.ts";
import { RelationshipsEngine } from "../../src/engine/relationships/engine.ts";
import type { FinanceSystemState } from "../../src/engine/finance/types.ts";
import type { EmploymentSystemState } from "../../src/engine/employment/types.ts";
import type { Relationship } from "../../src/engine/primitives/relationship.ts";

const SEED = "reellife-m2-commands-seed";
const ACTOR = asEntityId<"person">("PER-000001");
const FRIEND = asEntityId<"person">("PER-000002");
const LANDLORD = asEntityId<"person">("PER-000003");
const ACR = currencyId("ACR");

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
}

function dispatch(
  sim: Simulation,
  type: string,
  params: Record<string, unknown>,
  actor: EntityId<"person"> = ACTOR,
  origin: "player" | "npc" | "system" = "player",
): CommandResult {
  return sim.dispatcher.dispatch(sim.dispatcher.createCommand(type, actor, params, origin));
}

function openAccount(
  sim: Simulation,
  ownerId: EntityId<"person"> | string,
  type: "checking" | "savings",
  balanceMinorUnits = 0,
): string {
  let accountId = "";
  sim.guard.mutate("finance", () => {
    accountId = new FinanceEngine(sim.scope, sim.world).openAccount(
      sim.ids,
      ownerId,
      type,
      ACR,
      sim.clock.time,
      money(ACR, balanceMinorUnits),
    ).id;
  });
  return accountId;
}

function tieOf(sim: Simulation, from: EntityId<"person">, to: EntityId<"person">): Relationship {
  const relationship = new RelationshipsEngine(sim.scope, sim.world).get(from, to);
  if (!relationship) throw new Error(`No relationship ${String(from)} -> ${String(to)}`);
  return relationship;
}


describe("activity commands (System 05)", () => {
  it("activity.start creates and starts an activity in one event", () => {
    const sim = newWorld();
    const result = dispatch(sim, ACTIVITY_COMMAND_TYPES.start, {
      kind: "rest",
      durationMinutes: 45,
    });

    expect(result.status).toBe("applied");
    expect(result.events.map((event) => event.type)).toContain("activity.started");

    const activities = sim.activities.forActor(ACTOR);
    expect(activities).toHaveLength(1);
    expect(activities[0].kind).toBe("rest");
    expect(activities[0].state).toBe("started");
    expect(activities[0].actualStart).toBe(sim.clock.time);
    expect(activities[0].scheduledEnd as number).toBe((sim.clock.time as number) + 45);
    expect(activities[0].commandId).toBe(result.commandId);
    expect(sim.dispatcher.unhandledConsequenceTypes.size).toBe(0);
  });

  it("activity.stop completes a running activity and cancels an unstarted one", () => {
    const sim = newWorld();
    dispatch(sim, ACTIVITY_COMMAND_TYPES.start, { kind: "leisure", durationMinutes: 30 });
    const activityId = sim.activities.forActor(ACTOR)[0].id;

    // A second, still-planned activity, as the scheduler would leave it.
    const planned = sim.guard.mutate("activities", () =>
      sim.activities.create(
        { ids: sim.ids, calendar: sim.calendar },
        {
          actor: ACTOR,
          kind: "errand",
          start: sim.clock.time,
          duration: durationOf(20),
          createdBy: "system",
        },
      ),
    );

    expect(dispatch(sim, ACTIVITY_COMMAND_TYPES.stop, { activityId }).status).toBe("applied");
    expect(sim.activities.get(activityId)?.state).toBe("completed");

    expect(dispatch(sim, ACTIVITY_COMMAND_TYPES.stop, { activityId: planned.id }).status).toBe(
      "applied",
    );
    expect(sim.activities.get(planned.id)?.state).toBe("cancelled");
  });

  it("activity.stop on an unknown id changes nothing and is reported as a warning", () => {
    const sim = newWorld();
    const result = dispatch(sim, ACTIVITY_COMMAND_TYPES.stop, { activityId: "ACT-999999" });

    expect(result.status).toBe("applied");
    expect(sim.activities.all()).toHaveLength(0);
    expect(
      sim.trace
        .diagnosticEntries()
        .some((entry) => entry.message.includes("unknown activity ACT-999999")),
    ).toBe(true);
  });

  it("activity.stop rejects a command with no activity id", () => {
    const sim = newWorld();
    const result = dispatch(sim, ACTIVITY_COMMAND_TYPES.stop, {});
    expect(result.status).toBe("rejected");
    expect(result.issues.some((issue) => issue.code === "missing_activity")).toBe(true);
  });

describe("social commands (System 18)", () => {
  it("social.message creates both directional ties and nudges them separately", () => {
    const sim = newWorld();
    const result = dispatch(sim, SOCIAL_COMMAND_TYPES.message, { otherPersonId: FRIEND });

    expect(result.status).toBe("applied");
    expect(result.events.map((event) => event.type)).toContain("social.message_sent");

    const forward = tieOf(sim, ACTOR, FRIEND);
    const reverse = tieOf(sim, FRIEND, ACTOR);
    expect(forward.origin).toBe("social.message");
    expect(forward.turningPoints.map((point) => point.kind)).toEqual(["met"]);
    // A message shifts the sender's view more than the recipient's.
    expect(forward.evaluation.closeness).toBeGreaterThan(reverse.evaluation.closeness);
    expect(forward.evaluation.familiarity).toBeGreaterThan(reverse.evaluation.familiarity);
    // The tie has not existed long enough to imply trust either way.
    expect(reverse.evaluation.trust).toBe(0);
    expect(sim.dispatcher.unhandledConsequenceTypes.size).toBe(0);
  });

  it("social.visit records the interaction and the time it occupied", () => {
    const sim = newWorld();
    const result = dispatch(sim, SOCIAL_COMMAND_TYPES.visit, {
      otherPersonId: FRIEND,
      durationMinutes: 90,
    });

    expect(result.status).toBe("applied");
    const activity = sim.activities.forActor(ACTOR);
    expect(activity).toHaveLength(1);
    expect(activity[0].kind).toBe("socialVisit");
    expect(activity[0].state).toBe("started");
    expect(activity[0].participants).toEqual([ACTOR, FRIEND]);
    expect(activity[0].notes).toBe("social:visit");
    expect(activity[0].scheduledEnd as number).toBe((sim.clock.time as number) + 90);

    // Both parties rate the visit the same way; it is mutual experience.
    const forward = tieOf(sim, ACTOR, FRIEND);
    const reverse = tieOf(sim, FRIEND, ACTOR);
    expect(forward.evaluation.closeness).toBe(reverse.evaluation.closeness);
    expect(forward.evaluation.affection).toBeGreaterThan(0);
  });

  it("social.apologize lowers conflict and records a turning point for the recipient", () => {
    const sim = newWorld();
    dispatch(sim, SOCIAL_COMMAND_TYPES.message, { otherPersonId: FRIEND });

    // Manufacture a grievance the apology has to repair.
    sim.guard.mutate("relationships", () => {
      new RelationshipsEngine(sim.scope, sim.world).recordInteraction(
        FRIEND,
        ACTOR,
        { conflict: 0.5, trust: -0.2 },
        sim.clock.time,
      );
    });
    const before = tieOf(sim, FRIEND, ACTOR).evaluation.conflict;

    const result = dispatch(sim, SOCIAL_COMMAND_TYPES.apologize, { otherPersonId: FRIEND });
    expect(result.status).toBe("applied");

    const after = tieOf(sim, FRIEND, ACTOR);
    expect(after.evaluation.conflict).toBeLessThan(before);
    expect(after.turningPoints.map((point) => point.kind)).toContain("apology");
    // The apologiser's own account does not gain an apology turning point.
    expect(tieOf(sim, ACTOR, FRIEND).turningPoints.map((point) => point.kind)).not.toContain(
      "apology",
    );
    expect(sim.dispatcher.unhandledConsequenceTypes.size).toBe(0);
  });

  it("rejects a self-directed social interaction", () => {
    const sim = newWorld();
    const result = dispatch(sim, SOCIAL_COMMAND_TYPES.message, { otherPersonId: ACTOR });
    expect(result.status).toBe("rejected");
    expect(result.issues.some((issue) => issue.code === "invalid_target")).toBe(true);
    expect(sim.world.systems.relationships).toBeUndefined();
  });
});


describe("rent, bills and work shifts (Systems 24 / 27 / 33)", () => {
  it("housing.pay_rent posts a balanced ledger transfer classified as rent", () => {
    const sim = newWorld();
    const tenantAccount = openAccount(sim, ACTOR, "checking", 120_000);
    const landlordAccount = openAccount(sim, LANDLORD, "savings");

    const result = dispatch(sim, ASSET_COMMAND_TYPES.housingPayRent, {
      fromAccountId: tenantAccount,
      toAccountId: landlordAccount,
      amount: money(ACR, 45_000),
      leaseId: "lease-1",
      propertyId: "PRP-ARDEN-001",
    });
    expect(result.status).toBe("applied");
    expect(result.events.map((event) => event.type)).toContain("housing.rent_paid");

    const finance = sim.world.systems.finance as FinanceSystemState;
    expect(finance.ledger).toHaveLength(1);
    expect(finance.ledger[0].category).toBe("rent");

    const engine = new FinanceEngine(sim.scope, sim.world);
    expect(engine.getAccount(tenantAccount)?.balance).toEqual(money(ACR, 75_000));
    expect(engine.getAccount(landlordAccount)?.balance).toEqual(money(ACR, 45_000));
    expect(sim.dispatcher.unhandledConsequenceTypes.size).toBe(0);
  });

  it("finance.pay_bill is the same balanced posting with a bill classification", () => {
    const sim = newWorld();
    const account = openAccount(sim, ACTOR, "checking", 30_000);
    const utility = openAccount(sim, "ORG-ARDIN-UTILITY", "savings");

    const result = dispatch(sim, ASSET_COMMAND_TYPES.financePayBill, {
      fromAccountId: account,
      toAccountId: utility,
      amount: money(ACR, 8_500),
      billType: "electricity",
    });
    expect(result.status).toBe("applied");

    const finance = sim.world.systems.finance as FinanceSystemState;
    expect(finance.ledger[0].category).toBe("bill");
    expect(finance.ledger[0].description).toBe("electricity bill");
    expect(new FinanceEngine(sim.scope, sim.world).getAccount(account)?.balance).toEqual(
      money(ACR, 21_500),
    );
  });

  it("employment.work_shift records the shift as an activity for an active job", () => {
    const sim = newWorld();
    let employmentId = "";
    sim.guard.mutate("employment", () => {
      employmentId = new EmploymentEngine(sim.scope, sim.world).hire(
        sim.ids,
        ACTOR,
        "ORG-ARDIN-DOCKS",
        "Dockhand",
        "dockhand",
        money(ACR, 2_400),
        40,
        sim.clock.time,
      ).id;
    });

    const result = dispatch(sim, EMPLOYMENT_COMMAND_TYPES.workShift, { employmentId });
    expect(result.status).toBe("applied");

    const activity = sim.activities.forActor(ACTOR);
    expect(activity).toHaveLength(1);
    expect(activity[0].kind).toBe("workShift");
    expect(activity[0].state).toBe("started");
    expect(activity[0].notes).toBe(`employment:${employmentId}`);
    expect(activity[0].scheduledEnd as number).toBe((sim.clock.time as number) + 480);
  });

  it("discards a shift whose employment was terminated before the event resolved", () => {
    const sim = newWorld();
    let employmentId = "";
    sim.guard.mutate("employment", () => {
      employmentId = new EmploymentEngine(sim.scope, sim.world).hire(
        sim.ids,
        ACTOR,
        "ORG-ARDIN-DOCKS",
        "Dockhand",
        "dockhand",
        money(ACR, 2_400),
        40,
        sim.clock.time,
      ).id;
    });

    // A delayed effect means the event is queued now and resolved later, which
    // is exactly the window in which the precondition has to be revalidated.
    sim.guard.mutate("employment", () => {
      new EmploymentEngine(sim.scope, sim.world).terminate(
        employmentId,
        "terminated",
        sim.clock.time,
      );
    });

    dispatch(sim, EMPLOYMENT_COMMAND_TYPES.workShift, { employmentId });
    sim.advanceTo((sim.clock.time as number + 60) as never);

    const employment = sim.world.systems.employment as EmploymentSystemState;
    expect(employment.employments[0].status).toBe("terminated");
    // No shift activity was created for a job that no longer exists.
    expect(sim.activities.forActor(ACTOR)).toHaveLength(0);
  });
});

describe("world persistence commands (System 06)", () => {
  it("world.save captures a snapshot and queues the store write", async () => {
    const sim = newWorld();
    const result = dispatch(sim, WORLD_COMMAND_TYPES.save, { slotName: "slot-m2" });
    expect(result.status).toBe("applied");
    expect(result.events.map((event) => event.type)).toContain("persistence.save_requested");

    await sim.awaitPendingSaves();
    expect(await sim.saveStore.has("slot-m2")).toBe(true);

    // The snapshot is a pure observation of the world at dispatch time, so its
    // header describes the live clock rather than anything the save invented.
    const file = await sim.saveStore.read("slot-m2");
    expect(file).not.toBeNull();
    if (!file) throw new Error("save slot was not written");
    expect(file.header.slotName).toBe("slot-m2");
    expect(file.header.worldId).toBe(sim.world.meta.worldId);
    expect(file.header.rootTimeMinutes).toBe(sim.clock.time);
    const savedWorld = file.body.world as { meta: { worldId: string } };
    expect(savedWorld.meta.worldId).toBe(sim.world.meta.worldId);
    expect(sim.dispatcher.unhandledConsequenceTypes.size).toBe(0);
  });

  it("world.load records the intent without replacing the running instance", () => {
    const sim = newWorld();
    const beforeWorldId = sim.world.meta.worldId;
    const beforeStep = sim.clock.stepIndex;

    const result = dispatch(sim, WORLD_COMMAND_TYPES.load, { slotName: "slot-m2" });
    expect(result.status).toBe("applied");
    expect(result.events.map((event) => event.type)).toContain("world.load_requested");
    // The running instance is still the running instance: a load is performed by
    // the platform through `loadKernelSimulation`, never mid-dispatch.
    expect(sim.world.meta.worldId).toBe(beforeWorldId);
    expect(sim.clock.stepIndex).toBe(beforeStep);
    expect(sim.registeredSystems()).toContain("time");
    expect(sim.dispatcher.unhandledConsequenceTypes.size).toBe(0);
  });

  it("rejects a save with an empty slot name", () => {
    const sim = newWorld();
    const result = dispatch(sim, WORLD_COMMAND_TYPES.save, { slotName: "  " });
    expect(result.status).toBe("rejected");
    expect(result.issues.some((issue) => issue.code === "invalid_slot")).toBe(true);
  });
});

});
