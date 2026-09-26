/**
 * End-to-end domain command wiring (M2/M3 vertical slice).
 *
 * Each test dispatches a real command through the full pipeline —
 * Validation -> Authority -> Resolution -> Event -> Consequence ->
 * New State — and asserts the owning engine's state actually changed.
 * No test writes engine state directly except for the minimal fixtures
 * (person registered in needs, accounts, item) that must exist before a
 * command can act on them, and those fixtures go through the owning
 * engine inside its ownership scope.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { asEntityId, type EntityId } from "../../src/engine/primitives/ids.ts";
import { currencyId, money } from "../../src/engine/primitives/money.ts";
import type { CommandResult } from "../../src/engine/commands/types.ts";
import {
  NEEDS_COMMAND_TYPES,
  EMPLOYMENT_COMMAND_TYPES,
  ASSET_COMMAND_TYPES,
} from "../../src/engine/commands/domain/index.ts";
import { NeedsEngine } from "../../src/engine/needs/engine.ts";
import { FinanceEngine } from "../../src/engine/finance/engine.ts";
import { InventoryEngine } from "../../src/engine/inventory/engine.ts";
import { OrganizationsEngine } from "../../src/engine/organizations/engine.ts";
import type { EmploymentSystemState } from "../../src/engine/employment/types.ts";
import type { HousingSystemState } from "../../src/engine/housing/types.ts";
import type { FinanceSystemState } from "../../src/engine/finance/types.ts";
import type { InventorySystemState } from "../../src/engine/inventory/types.ts";

const SEED = "reellife-domain-commands-seed";
const ACTOR = asEntityId<"person">("PER-000001");
const OTHER = asEntityId<"person">("PER-000002");
const ACR = currencyId("ACR");

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
}

function dispatch(
  sim: Simulation,
  type: string,
  params: Record<string, unknown>,
  actor: EntityId<"person"> = ACTOR,
): CommandResult {
  return sim.dispatcher.dispatch(sim.dispatcher.createCommand(type, actor, params, "player"));
}

/** Employers must exist (System 32) before employment can exist at them. */
function registerEmployer(sim: Simulation, id: string, name: string): void {
  sim.guard.mutate("organizations", () => {
    new OrganizationsEngine(sim.scope, sim.world).create(
      sim.ids,
      { id: asEntityId<"organization">(id), legalName: name, type: "commercial" },
      sim.clock.time,
    );
  });
}

describe("domain commands wired into the dispatcher (M2/M3)", () => {
  it("registers every domain command and declares no unhandled consequences", () => {
    const sim = newWorld();
    const owners = sim.registry.byOwner();
    expect(owners.needs).toContain(NEEDS_COMMAND_TYPES.personEat);
    expect(owners.employment).toContain(EMPLOYMENT_COMMAND_TYPES.apply);
    expect(owners.housing).toContain(ASSET_COMMAND_TYPES.housingSignLease);
    expect(owners.finance).toContain(ASSET_COMMAND_TYPES.financeTransfer);
    expect(owners.inventory).toContain(ASSET_COMMAND_TYPES.inventoryTransfer);
    expect(sim.dispatcher.unhandledConsequenceTypes.size).toBe(0);
  });

  it("person.eat satisfies hunger through the NeedsEngine", () => {
    const sim = newWorld();
    sim.guard.mutate("needs", () => {
      const engine = new NeedsEngine(sim.scope, sim.world);
      engine.registerPerson(ACTOR, sim.clock.time);
      // Deplete hunger from 0.8 by 5h * 0.05/h = 0.25 -> 0.55.
      engine.tick(ACTOR, 300, sim.clock.time);
    });

    const before = new NeedsEngine(sim.scope, sim.world).getNeed(ACTOR, "hunger");
    expect(before?.level).toBeCloseTo(0.55, 5);

    const result = dispatch(sim, NEEDS_COMMAND_TYPES.personEat, {});
    expect(result.status).toBe("applied");
    expect(result.events.map((event) => event.type)).toContain("person.ate");

    const after = new NeedsEngine(sim.scope, sim.world).getNeed(ACTOR, "hunger");
    expect(after?.level).toBeCloseTo(0.95, 5);
    expect(after?.lastSatisfied).toBe(sim.clock.time);
    expect(sim.dispatcher.unhandledConsequenceTypes.size).toBe(0);
  });

  it("employment.apply and employment.resign drive the EmploymentEngine", () => {
    const sim = newWorld();
    const wage = money(ACR, 180000);
    registerEmployer(sim, "ORG-ARDIN-DOCKS", "Ardin Docks Authority");

    const hired = dispatch(sim, EMPLOYMENT_COMMAND_TYPES.apply, {
      employerOrgId: "ORG-ARDIN-DOCKS",
      roleTitle: "Dockhand",
      occupationCode: "OCC-8511",
      wage,
      weeklyHours: 40,
    });
    expect(hired.status).toBe("applied");

    const employment = sim.world.systems.employment as EmploymentSystemState;
    expect(employment.employments).toHaveLength(1);
    const record = employment.employments[0];
    expect(record.employeeId).toBe(ACTOR);
    expect(record.employerOrgId).toBe("ORG-ARDIN-DOCKS");
    expect(record.status).toBe("active");
    expect(record.wage).toEqual(wage);

    const resigned = dispatch(sim, EMPLOYMENT_COMMAND_TYPES.resign, {
      employmentId: record.id,
    });
    expect(resigned.status).toBe("applied");
    const after = sim.world.systems.employment as EmploymentSystemState;
    expect(after.employments[0].status).toBe("resigned");
    expect(after.employments[0].endedAt).toBe(sim.clock.time);
    expect(sim.dispatcher.unhandledConsequenceTypes.size).toBe(0);
  });

  it("employment.apply at an unknown organization creates no employment", () => {
    const sim = newWorld();
    const result = dispatch(sim, EMPLOYMENT_COMMAND_TYPES.apply, {
      employerOrgId: "ORG-NOWHERE",
      roleTitle: "Ghost",
      occupationCode: "OCC-0000",
      wage: money(ACR, 1000),
      weeklyHours: 10,
    });
    // The command resolves — an occurrence happened — but the consequence is
    // dropped at the cross-system boundary: no organization, no employment.
    expect(result.status).toBe("applied");
    expect(sim.world.systems.employment).toBeUndefined();
    expect(sim.dispatcher.unhandledConsequenceTypes.size).toBe(0);
  });

  it("housing.sign_lease and housing.move_in create a lease and a residence", () => {
    const sim = newWorld();

    const leased = dispatch(sim, ASSET_COMMAND_TYPES.housingSignLease, {
      propertyId: "PRP-ARDEN-001",
      landlordId: "PER-LANDLORD",
      rentPerCycle: money(ACR, 90000),
    });
    expect(leased.status).toBe("applied");

    const housing = sim.world.systems.housing as HousingSystemState;
    expect(housing.leases).toHaveLength(1);
    expect(housing.leases[0].tenantPersonId).toBe(ACTOR);
    expect(housing.leases[0].propertyId).toBe("PRP-ARDEN-001");
    expect(housing.leases[0].active).toBe(true);

    const moved = dispatch(sim, ASSET_COMMAND_TYPES.housingMoveIn, {
      propertyId: "PRP-ARDEN-001",
      occupancyType: "tenant",
    });
    expect(moved.status).toBe("applied");
    const after = sim.world.systems.housing as HousingSystemState;
    expect(after.residences).toHaveLength(1);
    expect(after.residences[0].residentId).toBe(ACTOR);
    expect(after.residences[0].type).toBe("tenant");
    expect(sim.dispatcher.unhandledConsequenceTypes.size).toBe(0);
  });

  it("finance.transfer posts a balanced ledger entry between two accounts", () => {
    const sim = newWorld();
    let fromAccountId = "";
    let toAccountId = "";
    sim.guard.mutate("finance", () => {
      const engine = new FinanceEngine(sim.scope, sim.world);
      fromAccountId = engine.openAccount(
        sim.ids,
        ACTOR,
        "checking",
        ACR,
        sim.clock.time,
        money(ACR, 100000),
      ).id;
      toAccountId = engine.openAccount(sim.ids, ACTOR, "savings", ACR, sim.clock.time).id;
    });

    const result = dispatch(sim, ASSET_COMMAND_TYPES.financeTransfer, {
      fromAccountId,
      toAccountId,
      amount: money(ACR, 25000),
      description: "rent share",
    });
    expect(result.status).toBe("applied");

    const finance = sim.world.systems.finance as FinanceSystemState;
    expect(finance.ledger).toHaveLength(1);
    expect(finance.ledger[0].amount).toEqual(money(ACR, 25000));
    expect(finance.ledger[0].category).toBe("transfer");

    const engine = new FinanceEngine(sim.scope, sim.world);
    expect(engine.getAccount(fromAccountId)?.balance).toEqual(money(ACR, 75000));
    expect(engine.getAccount(toAccountId)?.balance).toEqual(money(ACR, 25000));
    expect(sim.dispatcher.unhandledConsequenceTypes.size).toBe(0);
  });

  it("inventory.transfer moves item possession to another person", () => {
    const sim = newWorld();
    let itemId = "";
    sim.guard.mutate("inventory", () => {
      itemId = new InventoryEngine(sim.scope, sim.world).addItem(
        sim.ids,
        "DEF-TOASTER",
        ACTOR,
        ACTOR,
        1,
        0.9,
        sim.clock.time,
      ).id;
    });

    const result = dispatch(sim, ASSET_COMMAND_TYPES.inventoryTransfer, {
      itemId,
      toHolderId: OTHER,
    });
    expect(result.status).toBe("applied");

    const inventory = sim.world.systems.inventory as InventorySystemState;
    expect(inventory.items).toHaveLength(1);
    expect(inventory.items[0].possessorId).toBe(OTHER);
    expect(sim.dispatcher.unhandledConsequenceTypes.size).toBe(0);
  });

  it("rejects a malformed command without touching domain state", () => {
    const sim = newWorld();
    const result = dispatch(sim, EMPLOYMENT_COMMAND_TYPES.apply, {
      employerOrgId: "ORG-ARDIN-DOCKS",
      roleTitle: "Dockhand",
      // occupationCode, wage and weeklyHours missing on purpose.
    });
    expect(result.status).toBe("rejected");
    expect(result.issues.some((issue) => issue.code === "invalid_params")).toBe(true);
    expect(sim.world.systems.employment).toBeUndefined();
  });
});