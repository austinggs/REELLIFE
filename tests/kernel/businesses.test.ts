/**
 * System 33 — businesses: creation, lifecycle, capacity, cash flow, failure
 * signals and single ownership.
 *
 * Every behaviour below is one the spec names (startup creation, staffing, cash
 * flow, supply failure, demand shocks, closures, restructures, ownership
 * changes) and every claim is checked against engine state rather than a
 * re-implementation of it.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import {
  BusinessesEngine,
  bindingConstraintOf,
  businessFailureSignals,
  fullCapacity,
  usableCapacityOf,
} from "../../src/engine/businesses/engine.ts";
import {
  AURELIA_SLICE_BUSINESS_COUNT,
  aureliaArdenBusinessSeeds,
  registerAureliaBusinesses,
} from "../../src/content/aurelia/businesses.ts";
import { M2_SETTLEMENT_ID } from "../../src/content/aurelia/geography.ts";
import { OrganizationsEngine } from "../../src/engine/organizations/engine.ts";
import type { EmploymentRecord } from "../../src/engine/employment/types.ts";
import type { LedgerEntry } from "../../src/engine/finance/types.ts";
import type { BusinessConditionInputs } from "../../src/engine/businesses/types.ts";
import { asEntityId, IdAllocator, type EntityId } from "../../src/engine/primitives/ids.ts";
import { currencyId, money } from "../../src/engine/primitives/money.ts";
import { atTime, days } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-businesses-seed";
const AUR = currencyId("AUR");
const NOW = atTime(days(365));
const DOCKS = "ORG-ARDIN-DOCKS";
const CAFE = "ORG-QUAY-CAFE";
const COOP = "ORG-GRAIN-BASIN-COOP";

function newWorld(): Simulation {
  // A slice world, so the organizations and businesses come up the way the
  // real world builds them (System 32 first, then the commercial side).
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
}

function withBusinesses<T>(sim: Simulation, fn: (engine: BusinessesEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("businesses", () => {
    result = fn(new BusinessesEngine(sim.scope, sim.world));
  });
  return result;
}

/** Everything a business is exposed to, at values that trigger nothing. */
function mildConditions(): BusinessConditionInputs {
  return {
    cash: money(AUR, 500_000),
    demandUnits: 100,
    suppliedUnits: 100,
    supplyReliability: 0.95,
    competitorCount: 1,
    staffing: 0.9,
    regulatoryRestrictions: [],
    activeDisasterImpacts: 0,
    reputation: 0.7,
    fundingDaysRemaining: 180,
  };
}

describe("businesses (System 33)", () => {
  it("builds commerce on top of Organization Core, idempotently", () => {
    const sim = newWorld();
    const seeds = aureliaArdenBusinessSeeds(M2_SETTLEMENT_ID);
    expect(seeds).toHaveLength(AURELIA_SLICE_BUSINESS_COUNT);

    withBusinesses(sim, (engine) => {
      const businesses = engine.all();
      expect(businesses).toHaveLength(AURELIA_SLICE_BUSINESS_COUNT);
      expect(new Set(businesses.map((business) => business.id)).size).toBe(businesses.length);

      // Every business has its System 32 actor, and the two agree about what
      // kind of actor it is — a business cannot float free of an organization.
      const expectedType: Record<string, string> = {
        cooperative: "cooperative",
        informal: "informal",
        soleProprietorship: "commercial",
        corporation: "commercial",
      };
      for (const business of businesses) {
        const organization = engine.organizationOf(business.organizationId);
        expect(organization).toBeDefined();
        expect(organization?.type).toBe(expectedType[business.form]);
      }

      // Suppliers precede their dependents in the authored order, so System
      // 34's dependency graph is acyclic by construction.
      const position = new Map(businesses.map((business, index) => [business.id, index]));
      for (const business of businesses) {
        for (const supplierId of business.supplierIds) {
          expect(position.get(supplierId)).toBeLessThan(position.get(business.id) ?? Infinity);
        }
      }

      // Re-seeding is a no-op, never a duplicate.
      expect(registerAureliaBusinesses(engine, M2_SETTLEMENT_ID, NOW)).toHaveLength(0);
      expect(engine.all()).toHaveLength(AURELIA_SLICE_BUSINESS_COUNT);
    });
  });

  it("refuses an incoherent business: missing organization or mismatched form", () => {
    const sim = newWorld();
    const probeOrgId: EntityId<"organization"> = asEntityId("ORG-NOT-REGISTERED");
    withBusinesses(sim, (engine) => {
      expect(() =>
        engine.register(
          { organizationId: probeOrgId, form: "corporation", sector: "freight_handling" },
          NOW,
        ),
      ).toThrow(/does not exist/);

      // The grain cooperative's organization is a cooperative, so a
      // corporation cannot be registered against it.
      expect(() =>
        engine.register(
          {
            organizationId: asEntityId<"organization">(COOP),
            form: "corporation",
            sector: "agriculture_wholesale",
          },
          NOW,
        ),
      ).toThrow(/must be an organization of type commercial/);

      // One commercial side per organization: the dock business already exists.
      expect(() =>
        engine.register(
          { organizationId: asEntityId<"organization">(DOCKS), form: "corporation", sector: "x" },
          NOW,
        ),
      ).toThrow(/already exists/);

      // Offerings are identified, so a duplicate is a wiring mistake.
      expect(() =>
        engine.addOffering(DOCKS, {
          id: "OFFER-ARDIN-DOCKS-BONDED-STORAGE",
          name: "duplicate",
          kind: "service",
          unit: "tonne-day",
          unitCost: money(AUR, 40),
        }),
      ).toThrow(/already offers/);
    });
  });

  it("moves through the lifecycle only along allowed edges, remembering why", () => {
    const sim = newWorld();
    withBusinesses(sim, (engine) => {
      const opened = engine.register(
        {
          id: "ORG-PROBE-STARTUP",
          organizationId: asEntityId<"organization">(DOCKS),
          form: "partnership",
          sector: "consulting",
          lifecycle: "idea",
        },
        NOW,
      );
      expect(opened.history.map((entry) => entry.kind)).toEqual(["idea"]);

      // idea -> forming -> opening -> active -> expanding, each recorded.
      engine.setLifecycle(opened.id, "forming", NOW, "founders agreed terms");
      engine.setLifecycle(opened.id, "opening", NOW, "doors open");
      engine.setLifecycle(opened.id, "active", NOW, "first paying work");
      engine.setLifecycle(opened.id, "expanding", NOW, "second office");
      expect(engine.business(opened.id)?.history.map((entry) => entry.kind)).toEqual([
        "idea",
        "forming",
        "opening",
        "active",
        "expanding",
      ]);

      // Skipping history is refused: no expanding -> idea.
      expect(() => engine.setLifecycle(opened.id, "idea", NOW, "rewind")).toThrow(
        /invalid transition/,
      );

      // A supply shock sends a trading business into restructuring, not death.
      const shaken = engine.declareFailure(opened.id, "supply_shock", NOW, "inputs stopped arriving");
      expect(shaken.lifecycle).toBe("restructuring");
      expect(shaken.history.at(-2)?.kind).toBe("failure:supply_shock");
      expect(shaken.closedAt).toBeUndefined();
      expect(engine.trading().map((business) => business.id)).not.toContain(opened.id);

      // A business that is not trading cannot fail again.
      expect(() => engine.declareFailure(opened.id, "insolvency", NOW, "no cash")).toThrow(
        /not a trading business/,
      );

      // Insolvency does end a business, and the cause survives the closure.
      const closed = engine.declareFailure(CAFE, "insolvency", NOW, "wages unpaid");
      expect(closed.lifecycle).toBe("closed");
      expect(closed.closedAt).toBe(NOW);
      expect(closed.history.map((entry) => entry.kind)).toContain("failure:insolvency");
      expect(engine.trading().map((business) => business.id)).not.toContain(CAFE);

      // Ownership changes and spin-offs are recorded history, while the rights
      // themselves stay with System 26.
      const withOwner = engine.recordHistory(opened.id, "ownership_change", "shares sold to the coop", NOW);
      expect(withOwner.history.at(-1)).toEqual({
        at: NOW,
        kind: "ownership_change",
        note: "shares sold to the coop",
      });
    });
  });

  it("derives capacity as named dimensions and names the binding one", () => {
    const sim = newWorld();
    withBusinesses(sim, (engine) => {
      engine.setCapacity(CAFE, { staffing: 0.6, supply: 0.4 });
      expect(engine.usableCapacity(CAFE)).toBe(0.4);
      expect(engine.bindingConstraint(CAFE)).toEqual({ dimension: "supply", value: 0.4 });

      // Ties resolve in CAPACITY_DIMENSIONS order, so the answer is stable.
      expect(bindingConstraintOf({ ...fullCapacity(), capital: 0.5, space: 0.5 })).toEqual({
        dimension: "space",
        value: 0.5,
      });
      expect(usableCapacityOf(fullCapacity())).toBe(1);

      // Throughput scales with usable capacity; an offering with no stated
      // throughput contributes nothing rather than being invented.
      const before = engine.throughputPerStaffHour(CAFE);
      engine.setCapacity(CAFE, { supply: 0.2 });
      expect(engine.throughputPerStaffHour(CAFE)).toBeCloseTo(before / 2, 6);

      expect(() => engine.setCapacity(CAFE, { staffing: 1.4 })).toThrow(/must be in \[0, 1\]/);
      expect(() => engine.setWorkforceTarget(CAFE, 2.5)).toThrow(/non-negative integer/);
    });
  });

  it("derives the roster from System 24 rather than keeping a second copy", () => {
    const sim = newWorld();
    withBusinesses(sim, (engine) => {
      const employments: EmploymentRecord[] = [
        {
          id: "JOB-000001",
          employeeId: asEntityId<"person">("PER-000001"),
          employerOrgId: DOCKS,
          title: "Stevedore",
          occupationId: "occ:stevedore",
          wage: money(AUR, 6_000),
          hoursPerWeek: 40,
          status: "active",
          startedAt: NOW,
        },
        {
          id: "JOB-000002",
          employeeId: asEntityId<"person">("PER-000002"),
          employerOrgId: DOCKS,
          title: "Former stevedore",
          occupationId: "occ:stevedore",
          wage: money(AUR, 6_000),
          hoursPerWeek: 40,
          status: "resigned",
          startedAt: NOW,
          endedAt: NOW,
        },
        {
          id: "JOB-000003",
          employeeId: asEntityId<"person">("PER-000003"),
          employerOrgId: CAFE,
          title: "Counter hand",
          occupationId: "occ:barista",
          wage: money(AUR, 2_400),
          hoursPerWeek: 20,
          status: "active",
          startedAt: NOW,
        },
      ];

      expect(engine.roster(DOCKS, employments).map((record) => record.id)).toEqual(["JOB-000001"]);
      expect(engine.roster(CAFE, employments).map((record) => record.id)).toEqual(["JOB-000003"]);
      // The roster is a view: nothing was written back into the business.
      const docks = engine.requireBusiness(DOCKS, "test");
      expect(docks.workforceTarget).toBe(140);
      expect(Object.keys(docks)).not.toContain("employees");
    });
  });

  it("derives cash flow from the ledger, ignoring other currencies", () => {
    const sim = newWorld();
    withBusinesses(sim, (engine) => {
      const ledger: LedgerEntry[] = [
        {
          id: "tx-000001",
          fromAccountId: "acc-buyer",
          toAccountId: "acc-cafe",
          amount: money(AUR, 20_000),
          category: "business.revenue",
          description: "counter takings",
          timestamp: NOW,
        },
        {
          id: "tx-000002",
          fromAccountId: "acc-cafe",
          toAccountId: "acc-baker",
          amount: money(AUR, 5_000),
          category: "business.cost",
          description: "bread delivery",
          timestamp: NOW,
        },
        {
          id: "tx-000003",
          fromAccountId: "acc-abroad",
          toAccountId: "acc-docks",
          amount: money(currencyId("XAC"), 999_999),
          category: "business.revenue",
          description: "foreign charter",
          timestamp: NOW,
        },
      ];

      engine.linkAccount(CAFE, asEntityId<"account">("acc-cafe"));
      engine.linkAccount(DOCKS, asEntityId<"account">("acc-docks"));
      // Linking is idempotent: the same account is not recorded twice.
      engine.linkAccount(CAFE, asEntityId<"account">("acc-cafe"));
      expect(engine.requireBusiness(CAFE, "test").accountIds).toHaveLength(1);

      const flow = engine.cashFlow(CAFE, ledger, AUR);
      expect(flow.revenue.minorUnits).toBe(20_000);
      expect(flow.costs.minorUnits).toBe(5_000);
      expect(flow.net.minorUnits).toBe(15_000);

      // A different currency is ignored rather than silently converted.
      expect(engine.cashFlow(DOCKS, ledger, AUR).revenue.minorUnits).toBe(0);
    });
  });

  it("reports only failure causes the facts can show", () => {
    const sim = newWorld();
    withBusinesses(sim, (engine) => {
      const base = mildConditions();
      expect(engine.failureSignals(CAFE, base)).toEqual([]);

      const stressed = engine.failureSignals(CAFE, {
        ...base,
        cash: money(AUR, -1),
        demandUnits: 10,
        suppliedUnits: 100,
        supplyReliability: 0.4,
        competitorCount: 6,
        staffing: 0.3,
        regulatoryRestrictions: ["licence suspended"],
        activeDisasterImpacts: 1,
        reputation: 0.1,
        fundingDaysRemaining: 10,
      });
      // Every cause the facts can show, in FAILURE_CAUSES order.
      expect(stressed).toEqual([
        "insolvency",
        "low_demand",
        "supply_shock",
        "competition",
        "disaster",
        "regulation",
        "staff_loss",
        "financing",
        "reputation",
      ]);
      // "Poor management" is a judgement about people, not a readable number:
      // System 33 routes it through organizational decision processes.
      expect(stressed).not.toContain("poor_management");

      // Signals only fire where they mean something: a business with no
      // premises cannot be struck by a location disaster, and a business with
      // nothing to sell cannot have a demand slump.
      const premisesLess = { ...engine.requireBusiness(CAFE, "test"), locationIds: [] };
      expect(businessFailureSignals(premisesLess, { ...base, activeDisasterImpacts: 3 })).toEqual(
        [],
      );
      const offeringLess = { ...engine.requireBusiness(CAFE, "test"), offerings: [] };
      expect(
        businessFailureSignals(offeringLess, { ...base, demandUnits: 0, suppliedUnits: 100 }),
      ).toEqual([]);
    });
  });

  it("keeps businesses under single ownership and visible in the save format", () => {
    const sim = newWorld();

    // Reads need no writer context; writes do.
    const reader = new BusinessesEngine(sim.scope, sim.world);
    expect(reader.all()).toHaveLength(AURELIA_SLICE_BUSINESS_COUNT);
    expect(() => reader.setWorkforceTarget(CAFE, 9)).toThrow(MissingWriterContextError);
    expect(() =>
      sim.guard.mutate("organizations", () => {
        new BusinessesEngine(sim.scope, sim.world).setWorkforceTarget(CAFE, 9);
      }),
    ).toThrow(OwnershipViolationError);

    // The two halves stay apart: the businesses scope cannot create the actor
    // (that is System 32's), and the organizations scope cannot write the
    // commercial record.
    expect(() =>
      sim.guard.mutate("businesses", () => {
        new OrganizationsEngine(sim.scope, sim.world).create(
          new IdAllocator({ counters: {} }),
          { legalName: "Probe Trading", type: "commercial" },
          NOW,
        );
      }),
    ).toThrow(OwnershipViolationError);

    // The state is carried in the native save document (System 06).
    const bag = (sim.serializedWorld() as { readonly systems?: Record<string, unknown> }).systems;
    expect(bag?.["businesses"]).toBeDefined();
    const state = bag?.["businesses"] as { businesses: readonly { id: string }[] };
    expect(state.businesses).toHaveLength(AURELIA_SLICE_BUSINESS_COUNT);
  });
});
