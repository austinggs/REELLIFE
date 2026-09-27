/**
 * System 34 — supply chains: procurement, lead times, dependency cascades,
 * substitution, breaches and single ownership.
 *
 * Every behaviour below is one the spec names for testing: supplier failure,
 * port/road disruption, substitute sourcing, delayed inputs, cascading
 * shortages, contract breaches and demand shocks. Cascades are checked
 * against the *derived* graph walk, never against a scripted sequence, and
 * every ranking claim is checked against the engine's own scoring rather
 * than a re-implementation of it.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { SupplyChainsEngine } from "../../src/engine/supplyChains/engine.ts";
import type { SupplierOffer } from "../../src/engine/supplyChains/types.ts";
import { BusinessesEngine } from "../../src/engine/businesses/engine.ts";
import { OrganizationsEngine } from "../../src/engine/organizations/engine.ts";
import {
  AURELIA_SLICE_DEPENDENCY_COUNT,
  AURELIA_SLICE_OFFER_COUNT,
  aureliaArdenSupplyDependencies,
  aureliaArdenSupplierOffers,
  registerAureliaSupplyChains,
} from "../../src/content/aurelia/supplyChains.ts";
import { M2_SETTLEMENT_ID } from "../../src/content/aurelia/geography.ts";
import { entityRef } from "../../src/engine/primitives/entity.ts";
import { asEntityId, IdAllocator } from "../../src/engine/primitives/ids.ts";
import { currencyId, money } from "../../src/engine/primitives/money.ts";
import { addTime, atTime, days } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-supplychains-seed";
const AUR = currencyId("AUR");
const NOW = atTime(days(365));
const COOP = "ORG-GRAIN-BASIN-COOP";
const DOCKS = "ORG-ARDIN-DOCKS";
const BAKERY = "ORG-ARDEN-MILL-BAKERY";
const CAFE = "ORG-QUAY-CAFE";
const FENWICK = "ORG-FENWICK-STALL";
const BREAD = "GOOD-BREAD-LOAF";

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
}

function withSupplyChains<T>(sim: Simulation, fn: (engine: SupplyChainsEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("supplyChains", () => {
    result = fn(new SupplyChainsEngine(sim.scope, sim.world));
  });
  return result;
}

/** Registers a probe business (System 32 org + System 33 commercial side). */
function registerProbeBusiness(sim: Simulation, id: string): void {
  const probe = asEntityId<"organization">(id);
  sim.guard.mutate("organizations", () => {
    new OrganizationsEngine(sim.scope, sim.world).create(
      new IdAllocator(),
      {
        id: probe,
        legalName: `${id} Ltd`,
        commonName: id,
        type: "commercial",
        legalStatus: "sole_trader",
        locationIds: [entityRef("settlement", asEntityId(M2_SETTLEMENT_ID))],
      },
      NOW,
    );
  });
  sim.guard.mutate("businesses", () => {
    new BusinessesEngine(sim.scope, sim.world).register(
      { organizationId: probe, form: "corporation", sector: "food_production" },
      NOW,
    );
  });
}

/** One probe offer for bread; every term overridable for ranking tests. */
function breadOffer(
  supplierId: string,
  overrides: Partial<Omit<SupplierOffer, "supplierId" | "inputId">> = {},
): SupplierOffer {
  return {
    supplierId: asEntityId<"organization">(supplierId),
    inputId: BREAD,
    unitPrice: money(AUR, 60),
    leadTimeDays: 1,
    capacityUnits: 100,
    quality: 0.7,
    reputation: 0.6,
    distanceKm: 3,
    switchingCost: money(AUR, 200),
    ...overrides,
  };
}

describe("supply chains (System 34)", () => {
  it("registers the slice's dependency network, idempotently", () => {
    const sim = newWorld();
    expect(aureliaArdenSupplierOffers()).toHaveLength(AURELIA_SLICE_OFFER_COUNT);
    expect(aureliaArdenSupplyDependencies()).toHaveLength(AURELIA_SLICE_DEPENDENCY_COUNT);

    withSupplyChains(sim, (engine) => {
      expect(engine.offers()).toHaveLength(AURELIA_SLICE_OFFER_COUNT);
      expect(engine.dependencies()).toHaveLength(AURELIA_SLICE_DEPENDENCY_COUNT);
      expect(engine.orders()).toHaveLength(0);
      expect(engine.history()).toHaveLength(0);

      // The graph is coherent: every dependency names a supplier that
      // genuinely offers the input, and no one depends on themselves.
      for (const dependency of engine.dependencies()) {
        expect(engine.offer(dependency.supplierId, dependency.inputId)).toBeDefined();
        expect(dependency.buyerId).not.toBe(dependency.supplierId);
      }

      // Re-seeding adds nothing and rewrites nothing.
      expect(registerAureliaSupplyChains(engine, NOW)).toEqual({
        offers: 0,
        dependencies: 0,
      });
      expect(engine.offers()).toHaveLength(AURELIA_SLICE_OFFER_COUNT);
      expect(engine.dependencies()).toHaveLength(AURELIA_SLICE_DEPENDENCY_COUNT);
    });
  });

  it("refuses an incoherent deal: phantom parties, self-supply, dead sources", () => {
    const sim = newWorld();
    withSupplyChains(sim, (engine) => {
      // A supplier must exist in System 33, and may not duplicate an offer.
      expect(() => engine.defineOffer(breadOffer("ORG-NOT-REAL"))).toThrow(
        /not a registered business/,
      );
      expect(() => engine.defineOffer(breadOffer(BAKERY))).toThrow(/already offers/);
      // Capacity and assessments are guarded, not silently coerced.
      expect(() => engine.defineOffer(breadOffer(BAKERY, { capacityUnits: 0 }))).toThrow(
        /capacityUnits/,
      );
      expect(() => engine.defineOffer(breadOffer(BAKERY, { quality: 1.5 }))).toThrow(/quality/);

      // Dependencies cannot lie about their source.
      expect(() =>
        engine.defineDependency(
          {
            id: "DEP-SELF",
            buyerId: asEntityId(BAKERY),
            inputId: BREAD,
            supplierId: asEntityId(BAKERY),
            requiredUnits: 10,
          },
          NOW,
        ),
      ).toThrow(/own supplier/);
      expect(() =>
        engine.defineDependency(
          {
            id: "DEP-DEAD-SOURCE",
            buyerId: asEntityId(CAFE),
            inputId: BREAD,
            supplierId: asEntityId(COOP),
            requiredUnits: 10,
          },
          NOW,
        ),
      ).toThrow(/does not offer/);
      expect(() =>
        engine.defineDependency(
          {
            id: "DEP-PHANTOM",
            buyerId: asEntityId("ORG-NOT-REAL"),
            inputId: BREAD,
            supplierId: asEntityId(BAKERY),
            requiredUnits: 10,
          },
          NOW,
        ),
      ).toThrow(/not a registered business/);
      expect(() =>
        engine.defineDependency(aureliaArdenSupplyDependencies()[0] as never, NOW),
      ).toThrow(/already exists/);
    });
  });

  it("agrees on lead times: due dates carry the logistics lag", () => {
    const sim = newWorld();
    const ids = new IdAllocator();
    withSupplyChains(sim, (engine) => {
      // The bakery's bread offer is due one day after placement — the lag is
      // part of the agreement, not a surprise at delivery time.
      const order = engine.placeOrder(
        ids,
        { buyerId: asEntityId(CAFE), supplierId: asEntityId(BAKERY), inputId: BREAD, quantity: 200 },
        NOW,
      );
      expect(order.status).toBe("issued");
      expect(order.dueAt).toBe(addTime(NOW, days(1)));
      // The agreed price is the supplier's, snapshotted at issue.
      expect(order.unitPrice.minorUnits).toBe(money(AUR, 55).minorUnits);
      expect(engine.history().at(-1)?.kind).toBe("order_placed");

      // Supplier capacity caps the order; a bigger ask is refused.
      expect(() =>
        engine.placeOrder(
          ids,
          {
            buyerId: asEntityId(CAFE),
            supplierId: asEntityId(BAKERY),
            inputId: BREAD,
            quantity: 301,
          },
          NOW,
        ),
      ).toThrow(/exceeds/);
      // Neither party may be a phantom.
      expect(() =>
        engine.placeOrder(
          ids,
          { buyerId: asEntityId("ORG-NOT-REAL"), supplierId: asEntityId(BAKERY), inputId: BREAD, quantity: 1 },
          NOW,
        ),
      ).toThrow(/not a registered business/);
      expect(() =>
        engine.placeOrder(
          ids,
          { buyerId: asEntityId(CAFE), supplierId: asEntityId(COOP), inputId: BREAD, quantity: 1 },
          NOW,
        ),
      ).toThrow(/does not offer/);

      // The lifecycle is enforced step by step: no skipping the ship, no
      // receiving what was never sent, no cancelling what has left.
      expect(() => engine.receiveOrder(order.id, NOW)).toThrow(/not in_transit/);
      engine.acceptOrder(order.id, NOW);
      expect(() => engine.acceptOrder(order.id, NOW)).toThrow(/is accepted/);
      engine.shipOrder(order.id, NOW);
      expect(() => engine.cancelOrder(order.id, NOW, "changed our mind")).toThrow(
        /not issued or accepted/,
      );
      engine.receiveOrder(order.id, addTime(NOW, days(1)));
      expect(() => engine.declareBreach(order.id, NOW, "too late")).toThrow(
        /not issued or accepted or in_transit/,
      );
      expect(engine.openOrders()).toHaveLength(0);
    });
  });


  it("cascades a port disruption through the network, not a script", () => {
    const sim = newWorld();
    const ids = new IdAllocator();
    withSupplyChains(sim, (engine) => {
      // Nothing is short while every supplier is working.
      expect(engine.shortages()).toEqual([]);
      expect(engine.supplyGap("DEP-BAKERY-GRAIN")).toBe(0);
      // Exposure is a share of the standing graph: the coop feeds two of the
      // five dependencies, the docks serve both of the coop's.
      expect(engine.concentration(COOP)).toBeCloseTo(2 / 5, 6);
      expect(engine.concentration(DOCKS)).toBeCloseTo(2 / 5, 6);
      expect(engine.concentration(BAKERY)).toBeCloseTo(1 / 5, 6);

      // A disruption at the port (the docks stop working): their two
      // dependents are short immediately, and only their dependents.
      engine.suspendSupplier(asEntityId(DOCKS), NOW, "quay road closed after a storm");
      const gaps = engine.shortages();
      expect(gaps.map((entry) => entry.dependencyId)).toEqual([
        "DEP-COOP-STORAGE",
        "DEP-COOP-STEVEDORE",
      ]);
      expect(gaps.map((entry) => entry.gapUnits)).toEqual([300, 40]);

      // The cascade is the graph walked breadth-first in registration order:
      // docks -> coop -> {bakery, fenwick} -> cafe. Nothing else is touched.
      expect(engine.cascadeFrom(DOCKS)).toEqual([COOP, BAKERY, FENWICK, CAFE]);
      expect(engine.cascadeFrom(COOP)).toEqual([BAKERY, FENWICK, CAFE]);
      expect(engine.cascadeFrom(CAFE)).toEqual([]);
      // Deterministic: the same query twice, same list.
      expect(engine.cascadeFrom(DOCKS)).toEqual([COOP, BAKERY, FENWICK, CAFE]);

      // A suspended supplier accepts no new orders: the delayed input
      // starts here, at the source, and stays visible.
      expect(() =>
        engine.placeOrder(
          ids,
          { buyerId: asEntityId(COOP), supplierId: asEntityId(DOCKS), inputId: "GOOD-STEVEDORE-SHIFT", quantity: 5 },
          NOW,
        ),
      ).toThrow(/suspended/);
      // Suspension is a fact that cannot be double-stated…
      expect(() => engine.suspendSupplier(asEntityId(DOCKS), NOW, "again")).toThrow(
        /already suspended/,
      );
      expect(() => engine.suspendSupplier(asEntityId("ORG-NOT-REAL"), NOW, "x")).toThrow(
        /offers nothing/,
      );

      // …and restoring it clears the shortages without erasing the outage.
      engine.restoreSupplier(asEntityId(DOCKS), addTime(NOW, days(2)));
      expect(engine.shortages()).toEqual([]);
      expect(engine.history().map((entry) => entry.kind)).toContain("supplier_suspended");
      expect(engine.history().map((entry) => entry.kind)).toContain("supplier_restored");
      expect(() => engine.restoreSupplier(asEntityId(DOCKS), NOW)).toThrow(/not suspended/);
    });
  });

  it("lets a demand shock outrun capacity and shows the shortfall", () => {
    const sim = newWorld();
    withSupplyChains(sim, (engine) => {
      // The coop can ship 400 sacks a cycle; the bakery normally needs 150.
      expect(engine.supplyGap("DEP-BAKERY-GRAIN")).toBe(0);

      // A demand shock pushes the requirement past the supplier's capacity —
      // no supplier failed, yet the network is short. That distinction is
      // why the gap is derived from capacity rather than from failure.
      engine.setRequiredUnits("DEP-BAKERY-GRAIN", 500, NOW);
      expect(engine.supplyGap("DEP-BAKERY-GRAIN")).toBe(100);
      expect(engine.shortages()).toEqual([
        { dependencyId: "DEP-BAKERY-GRAIN", gapUnits: 100 },
      ]);
      expect(engine.history().at(-1)).toMatchObject({
        kind: "demand_changed",
        subjectId: "DEP-BAKERY-GRAIN",
      });

      // Back to normal, and the shortfall disappears with it.
      engine.setRequiredUnits("DEP-BAKERY-GRAIN", 150, NOW);
      expect(engine.shortages()).toEqual([]);
      expect(() => engine.setRequiredUnits("DEP-BAKERY-GRAIN", 0, NOW)).toThrow(
        /positive integer/,
      );
      expect(() => engine.setRequiredUnits("DEP-NOT-REAL", 10, NOW)).toThrow(/unknown dependency/);
    });
  });


  it("substitutes sources on evidence, and records the switch", () => {
    const sim = newWorld();
    registerProbeBusiness(sim, "ORG-BASIN-BAKERY");
    registerProbeBusiness(sim, "ORG-QUAYSIDE-BAKERY");
    withSupplyChains(sim, (engine) => {
      // A dominant alternative (cheaper, better quality, closer, kinder
      // switching cost) and one that is worse on every weighted dimension.
      engine.defineOffer(
        breadOffer("ORG-BASIN-BAKERY", {
          unitPrice: money(AUR, 50),
          quality: 0.9,
          reputation: 0.85,
          distanceKm: 1,
          switchingCost: money(AUR, 100),
          capacityUnits: 200,
        }),
      );
      engine.defineOffer(
        breadOffer("ORG-QUAYSIDE-BAKERY", {
          unitPrice: money(AUR, 70),
          quality: 0.5,
          reputation: 0.4,
          distanceKm: 9,
          switchingCost: money(AUR, 400),
          leadTimeDays: 2,
        }),
      );

      // One source for an input means there is no choice to model.
      expect(engine.substitutionCandidates("DEP-COOP-STEVEDORE")).toEqual([]);

      const ranked = engine.substitutionCandidates("DEP-CAFE-BREAD");
      expect(ranked.map((candidate) => candidate.supplierId)).toEqual([
        "ORG-BASIN-BAKERY",
        "ORG-QUAYSIDE-BAKERY",
      ]);
      expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
      expect(ranked.every((candidate) => candidate.available)).toBe(true);
      // Ranking is deterministic: same query, same order and scores.
      expect(engine.substitutionCandidates("DEP-CAFE-BREAD")).toEqual(ranked);

      // The graph shows the cafe reachable from the coop through the bakery…
      expect(engine.cascadeFrom(COOP)).toEqual([BAKERY, FENWICK, CAFE]);

      // A suspended option stays visible with its score zeroed — an
      // unavailable option is information, not a disappearance.
      engine.suspendSupplier(asEntityId("ORG-QUAYSIDE-BAKERY"), NOW, "refit");
      const afterSuspend = engine.substitutionCandidates("DEP-CAFE-BREAD");
      expect(afterSuspend.map((candidate) => candidate.supplierId)).toEqual([
        "ORG-BASIN-BAKERY",
        "ORG-QUAYSIDE-BAKERY",
      ]);
      expect(afterSuspend[1]).toMatchObject({ available: false, score: 0 });
      expect(() =>
        engine.switchSupplier("DEP-CAFE-BREAD", asEntityId("ORG-QUAYSIDE-BAKERY"), NOW),
      ).toThrow(/suspended/);

      // The switch itself: a recorded fact, carrying the cost that was paid.
      const switched = engine.switchSupplier(
        "DEP-CAFE-BREAD",
        asEntityId("ORG-BASIN-BAKERY"),
        NOW,
        "tx-switch",
      );
      expect(switched.supplierId).toBe("ORG-BASIN-BAKERY");
      expect(switched.switchedAt).toBe(NOW);
      const entry = engine.history().at(-1);
      expect(entry?.kind).toBe("supplier_switched");
      expect(entry?.note).toContain(`${BAKERY} -> ORG-BASIN-BAKERY`);
      expect(entry?.note).toContain("switching cost 100");
      expect(entry?.note).toContain("tx-switch");

      // Refused switches: onto the current source, onto a source that does
      // not offer the input, or against a dependency that does not exist.
      expect(() =>
        engine.switchSupplier("DEP-CAFE-BREAD", asEntityId("ORG-BASIN-BAKERY"), NOW),
      ).toThrow(/already supplies/);
      expect(() => engine.switchSupplier("DEP-CAFE-BREAD", asEntityId(DOCKS), NOW)).toThrow(
        /does not offer/,
      );
      expect(() => engine.switchSupplier("DEP-NOT-REAL", asEntityId(BAKERY), NOW)).toThrow(
        /unknown dependency/,
      );

      // The cascade follows the *current* graph: the cafe left the coop's
      // subtree the moment it switched source.
      expect(engine.cascadeFrom(COOP)).toEqual([BAKERY, FENWICK]);
      expect(engine.cascadeFrom("ORG-BASIN-BAKERY")).toEqual([CAFE]);
    });
  });


  it("turns delayed inputs and breaches into facts of the clock", () => {
    const sim = newWorld();
    const ids = new IdAllocator();
    withSupplyChains(sim, (engine) => {
      // No completed orders yet: reliability reports no evidence, not guilt.
      expect(engine.reliability(BAKERY)).toBe(1);
      expect(engine.reliability(DOCKS)).toBe(1);

      // A late delivery: received, but two days past the due date. The lag
      // is measured, recorded, and drags the supplier's record with it.
      const late = engine.placeOrder(
        ids,
        { buyerId: asEntityId(CAFE), supplierId: asEntityId(BAKERY), inputId: BREAD, quantity: 50 },
        NOW,
      );
      engine.acceptOrder(late.id, NOW);
      engine.shipOrder(late.id, NOW);
      engine.receiveOrder(late.id, addTime(NOW, days(3)));
      const lateEntry = engine
        .history()
        .find((entry) => entry.kind === "late_delivery" && entry.subjectId === late.id);
      expect(lateEntry?.note).toMatch(/2 day\(s\) after the due date/);
      expect(engine.reliability(BAKERY)).toBe(0);

      // A non-delivery: past due and still open, breached by the clock —
      // not by a scripted sequence, and only where it actually applies.
      const undelivered = engine.placeOrder(
        ids,
        {
          buyerId: asEntityId(COOP),
          supplierId: asEntityId(DOCKS),
          inputId: "GOOD-STEVEDORE-SHIFT",
          quantity: 5,
        },
        NOW,
      );
      engine.acceptOrder(undelivered.id, NOW);
      const breached = engine.breachExpiredOrders(addTime(NOW, days(1)));
      expect(breached.map((order) => order.id)).toEqual([undelivered.id]);
      expect(engine.order(undelivered.id)?.status).toBe("breached");
      expect(engine.order(undelivered.id)?.closeReason).toBe("not delivered by the due date");
      expect(engine.reliability(DOCKS)).toBe(0);
      expect(engine.openOrders()).toHaveLength(0);

      // An order that is not yet due is left alone.
      const future = engine.placeOrder(
        ids,
        {
          buyerId: asEntityId(COOP),
          supplierId: asEntityId(DOCKS),
          inputId: "GOOD-STEVEDORE-SHIFT",
          quantity: 5,
        },
        addTime(NOW, days(5)),
      );
      expect(engine.breachExpiredOrders(addTime(NOW, days(1)))).toEqual([]);
      expect(engine.order(future.id)?.status).toBe("issued");

      // Cancellation is a stand-down before shipment, once.
      const abandoned = engine.placeOrder(
        ids,
        { buyerId: asEntityId(CAFE), supplierId: asEntityId(BAKERY), inputId: BREAD, quantity: 10 },
        NOW,
      );
      engine.cancelOrder(abandoned.id, NOW, "bakery closed for the week");
      expect(engine.order(abandoned.id)?.status).toBe("cancelled");
      expect(() => engine.cancelOrder(abandoned.id, NOW, "again")).toThrow(
        /is cancelled, not issued or accepted/,
      );
      // A cancelled order never resolved a delivery, so it says nothing
      // about reliability.
      expect(engine.reliability(BAKERY)).toBe(0);
    });
  });

  it("keeps supply-chain state under single ownership and in the save format", () => {
    const sim = newWorld();

    const reader = new SupplyChainsEngine(sim.scope, sim.world);
    expect(reader.offers()).toHaveLength(AURELIA_SLICE_OFFER_COUNT);
    expect(reader.dependencies()).toHaveLength(AURELIA_SLICE_DEPENDENCY_COUNT);
    expect(() => reader.defineOffer(breadOffer("ORG-PROBE"))).toThrow(MissingWriterContextError);
    expect(() =>
      sim.guard.mutate("businesses", () => {
        new SupplyChainsEngine(sim.scope, sim.world).defineOffer(breadOffer("ORG-PROBE"));
      }),
    ).toThrow(OwnershipViolationError);

    const bag = (sim.serializedWorld() as { readonly systems?: Record<string, unknown> }).systems;
    expect(bag?.["supplyChains"]).toBeDefined();
    const state = bag?.["supplyChains"] as {
      readonly offers: readonly unknown[];
      readonly dependencies: readonly unknown[];
      readonly purchaseOrders: readonly unknown[];
      readonly history: readonly unknown[];
    };
    expect(state.offers).toHaveLength(AURELIA_SLICE_OFFER_COUNT);
    expect(state.dependencies).toHaveLength(AURELIA_SLICE_DEPENDENCY_COUNT);
    expect(state.purchaseOrders).toHaveLength(0);
    expect(state.history).toHaveLength(0);
  });
});


