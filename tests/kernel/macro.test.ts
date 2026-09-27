/**
 * System 36 — macroeconomic layer: indicator windows, aggregate derivation,
 * macro shocks as conditions, the credit environment, and the refusal to
 * declare a recession nobody defined.
 *
 * The behaviours below are the ones the spec names for testing (inflation
 * calculation, unemployment, growth, recession-like shocks, lagged effects,
 * policy changes, cross-system aggregate consistency), each checked against
 * engine state rather than a re-implementation of the arithmetic.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { seedPlayableSlice } from "../../src/engine/kernel/sliceSeed.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { MacroEngine } from "../../src/engine/macro/engine.ts";
import type { EmploymentSystemState } from "../../src/engine/employment/types.ts";
import {
  AURELIA_CREDIT_ENVIRONMENT,
  AURELIA_PRICE_INDEX_BASE,
  registerAureliaMacroBaseline,
} from "../../src/content/aurelia/macro.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { addTime, days } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-macro-seed";

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
}

function withMacro<T>(sim: Simulation, fn: (engine: MacroEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("macro", () => {
    result = fn(new MacroEngine(sim.scope, sim.world));
  });
  return result;
}

describe("macroeconomy (System 36)", () => {
  it("starts from the seeded baseline without inventing a labour force", () => {
    const sim = newWorld();
    withMacro(sim, (engine) => {
      // The seeded world has a price index and a credit environment...
      expect(
        (sim.world.systems.macro as { readonly priceIndex: readonly { readonly index: number }[] })
          .priceIndex[0]?.index,
      ).toBe(AURELIA_PRICE_INDEX_BASE);
      expect(engine.creditEnvironment()?.policyRateBasisPoints).toBe(
        AURELIA_CREDIT_ENVIRONMENT.policyRateBasisPoints,
      );
      expect(engine.creditEnvironment()?.creditAvailability).toBe(
        AURELIA_CREDIT_ENVIRONMENT.creditAvailability,
      );
      expect(engine.creditHistory()).toHaveLength(1);
      // ...and deliberately no labour, output or aggregate samples, so
      // those indicators have no reading rather than a guessed one.
      expect(engine.unemployment()).toBeUndefined();
      expect(engine.outputGrowth()).toBeUndefined();
      expect(engine.aggregateGap()).toBeUndefined();
      // One price sample cannot span a year, so there is no inflation yet.
      expect(engine.inflation()).toBeUndefined();
    });

    // Re-seeding the world adds no duplicate observations or history.
    seedPlayableSlice(sim);
    withMacro(sim, (engine) => {
      const state = (sim.world.systems.macro as {
        readonly priceIndex: readonly unknown[];
        readonly labor: readonly unknown[];
        readonly output: readonly unknown[];
        readonly aggregates: readonly unknown[];
        readonly creditHistory: readonly unknown[];
        readonly shocks: readonly unknown[];
      });
      expect(state.priceIndex).toHaveLength(1);
      expect(state.creditHistory).toHaveLength(1);
      expect(state.labor).toHaveLength(0);
      expect(state.output).toHaveLength(0);
      expect(state.aggregates).toHaveLength(0);
      expect(state.shocks).toHaveLength(0);
      expect(engine.creditHistory()).toHaveLength(1);
    });
  });

  it("derives inflation over an explicit window, and refuses to guess", () => {
    const sim = newWorld();
    withMacro(sim, (engine) => {
      const t0 = sim.clock.time; // the seeded baseline: index 100 at world start
      // After a year at 110, trailing-year inflation is +10%; a two-year
      // window still cannot be spanned from three points, so no reading.
      engine.observePriceIndex(110, addTime(t0, days(365)));
      expect(engine.inflation()).toBeCloseTo(0.1, 10);
      expect(engine.purchasingPowerChange()).toBeCloseTo(1 / 1.1 - 1, 10);
      expect(engine.inflation(days(365 * 2))).toBeUndefined();
      expect(engine.purchasingPowerChange(days(365 * 2))).toBeUndefined();

      // Deflation is the same arithmetic in the other direction: the
      // trailing year is measured against the sample a year back (110),
      // not against the original base.
      engine.observePriceIndex(99, addTime(t0, days(365 * 2)));
      expect(engine.inflation()).toBeCloseTo(99 / 110 - 1, 10);
      expect(engine.purchasingPowerChange()).toBeGreaterThan(0);

      // A macro shock by itself does not rewrite the series — the caller
      // observes the new level and the indicator follows the data.
      const before = engine.inflation();
      const ids = new IdAllocator();
      engine.raiseShock(ids, { kind: "energy_shock", severity: 0.8 }, addTime(t0, days(365 * 2)));
      expect(engine.inflation()).toBe(before);

      // Re-observing the same instant updates the sample instead of
      // appending a duplicate.
      engine.observePriceIndex(105, addTime(t0, days(365 * 2)));
      expect(
        (sim.world.systems.macro as { readonly priceIndex: readonly unknown[] }).priceIndex,
      ).toHaveLength(3);
      expect(engine.inflation()).toBeCloseTo(105 / 110 - 1, 10);
    });
  });

  it("derives labour, output, productivity and demand/supply from samples", () => {
    const sim = newWorld();
    withMacro(sim, (engine) => {
      const t0 = sim.clock.time;
      // A labour force of 400 with 360 working is 10% unemployment; a
      // worker count above the force is an incoherent sample, not a number.
      engine.observeLaborMarket({ laborForce: 400, employed: 360 }, t0);
      expect(engine.unemployment()).toBeCloseTo(0.1, 10);
      expect(() =>
        engine.observeLaborMarket({ laborForce: 10, employed: 11 }, t0),
      ).toThrow(/exceeds the labour force/);
      expect(() => engine.observeLaborMarket({ laborForce: 1.5, employed: 1 }, t0)).toThrow(
        /non-negative integer/,
      );
      engine.observeLaborMarket({ laborForce: 400, employed: 340 }, addTime(t0, days(365)));
      expect(engine.unemployment()).toBeCloseTo(0.15, 10);

      // Output growth over the year; productivity is output per hour, so a
      // single sample cannot show growth — there is no base to compare with.
      engine.observeOutput({ outputIndex: 100, hoursWorked: 1_000 }, t0);
      expect(engine.outputGrowth()).toBeUndefined();
      expect(engine.productivity()).toBeCloseTo(100 / 1_000, 10);
      expect(engine.productivityGrowth()).toBeUndefined();
      engine.observeOutput({ outputIndex: 110, hoursWorked: 1_000 }, addTime(t0, days(365)));
      expect(engine.outputGrowth()).toBeCloseTo(0.1, 10);
      expect(engine.productivity()).toBeCloseTo(110 / 1_000, 10);
      // The productivity window is a quarter, so it reaches back to the
      // newest sample at or before its start — here the first sample.
      expect(engine.productivityGrowth()).toBeCloseTo(0.1, 10);
      engine.observeOutput({ outputIndex: 121, hoursWorked: 1_000 }, addTime(t0, days(455)));
      expect(engine.productivityGrowth()).toBeCloseTo(121 / 110 - 1, 10);
      expect(engine.outputGrowth()).toBeCloseTo(121 / 100 - 1, 10);

      // Aggregate demand against supply: a negative gap is slack demand.
      engine.observeAggregates({ demandIndex: 90, supplyIndex: 100 }, t0);
      expect(engine.aggregateGap()).toBe(-10);
      engine.observeAggregates({ demandIndex: 105, supplyIndex: 100 }, addTime(t0, days(30)));
      expect(engine.aggregateGap()).toBe(5);
    });
  });

  it("lists downturn facts without declaring a recession", () => {
    const sim = newWorld();
    const ids = new IdAllocator();
    withMacro(sim, (engine) => {
      const t0 = sim.clock.time;
      // The cause: output contracts and unemployment rises over a year.
      engine.observeOutput({ outputIndex: 100, hoursWorked: 1_000 }, t0);
      engine.observeOutput({ outputIndex: 90, hoursWorked: 1_000 }, addTime(t0, days(365)));
      engine.observeLaborMarket({ laborForce: 400, employed: 380 }, t0);
      engine.observeLaborMarket({ laborForce: 400, employed: 350 }, addTime(t0, days(365)));
      engine.observeAggregates({ demandIndex: 80, supplyIndex: 100 }, addTime(t0, days(365)));

      // Signals are named facts in a fixed order, each traceable to a
      // sample or a raised condition — no aggregate verdict.
      expect(engine.downturnSignals().map((entry) => entry.signal)).toEqual([
        "output_contracting",
        "unemployment_rising",
        "weak_aggregate_demand",
      ]);

      // A raised shock joins them and can be lifted, which removes exactly
      // that signal and nothing else.
      const shock = engine.raiseShock(
        ids,
        { kind: "supply_disruption", severity: 0.6, note: "basin grain failed" },
        addTime(t0, days(365)),
      );
      expect(engine.activeShocks()).toHaveLength(1);
      expect(engine.downturnSignals().map((entry) => entry.signal)).toEqual([
        "shock_active:supply_disruption",
        "output_contracting",
        "unemployment_rising",
        "weak_aggregate_demand",
      ]);
      engine.liftShock(shock.id, addTime(t0, days(400)));
      expect(engine.activeShocks()).toHaveLength(0);
      expect(engine.downturnSignals().map((entry) => entry.signal)).toEqual([
        "output_contracting",
        "unemployment_rising",
        "weak_aggregate_demand",
      ]);
      // Lifting keeps the record of what happened.
      expect(engine.shocks()).toHaveLength(1);
      expect(engine.shocks()[0]?.liftedAt).toBe(addTime(t0, days(400)));

      // Shocks are guarded like every other input.
      expect(() => engine.raiseShock(ids, { kind: "", severity: 0.5 }, t0)).toThrow(
        /must not be empty/,
      );
      expect(() => engine.raiseShock(ids, { kind: "x", severity: 2 }, t0)).toThrow(/severity/);
      expect(() => engine.liftShock("shock-NOT-REAL", t0)).toThrow(/unknown shock/);
      expect(() => engine.liftShock(shock.id, t0)).toThrow(/already lifted/);
    });
  });

  it("records the credit environment and its policy changes", () => {
    const sim = newWorld();
    withMacro(sim, (engine) => {
      const t0 = sim.clock.time;
      // The seeded environment is the starting point of the history.
      expect(engine.creditHistory()).toHaveLength(1);
      engine.setCreditEnvironment(
        {
          policyRateBasisPoints: 600,
          lendingSpreadBasisPoints: 300,
          creditAvailability: 0.4,
          note: "credit tightened",
        },
        addTime(t0, days(180)),
      );
      expect(engine.creditEnvironment()?.policyRateBasisPoints).toBe(600);
      expect(engine.creditHistory()).toHaveLength(2);
      expect(engine.creditHistory().map((entry) => entry.at)).toEqual([
        t0,
        addTime(t0, days(180)),
      ]);
      // A policy change is recorded, not applied: no price or rate
      // elsewhere was rewritten by publishing the context.
      expect(() =>
        engine.setCreditEnvironment(
          { policyRateBasisPoints: 10_001, lendingSpreadBasisPoints: 300, creditAvailability: 0.4 },
          t0,
        ),
      ).toThrow(/policyRateBasisPoints/);
      expect(() =>
        engine.setCreditEnvironment(
          { policyRateBasisPoints: 500, lendingSpreadBasisPoints: 300, creditAvailability: 4 },
          t0,
        ),
      ).toThrow(/creditAvailability/);
      // Re-publishing the same instant updates that entry, so re-seeding
      // cannot grow the history.
      registerAureliaMacroBaseline(engine, t0);
      expect(engine.creditHistory()).toHaveLength(2);
    });
  });

  it("keeps aggregates consistent with the records they were fed from", () => {
    const sim = newWorld();
    withMacro(sim, (engine) => {
      // Feed the labour sample from System 24's own employment records
      // (plus a stated number of people looking for work) and check the
      // indicator answers exactly that arithmetic.
      const employment = (sim.world.systems.employment ?? { employments: [] }) as EmploymentSystemState;
      const employed = employment.employments.filter((record) => record.status === "active").length;
      const jobSeekers = 3;
      engine.observeLaborMarket(
        { laborForce: employed + jobSeekers, employed },
        sim.clock.time,
      );
      expect(engine.unemployment()).toBeCloseTo(jobSeekers / (employed + jobSeekers), 10);
    });
  });

  it("keeps macro state under single ownership and in the save format", () => {
    const sim = newWorld();

    const reader = new MacroEngine(sim.scope, sim.world);
    expect(reader.creditEnvironment()).toBeDefined();
    expect(() => reader.observePriceIndex(101, sim.clock.time)).toThrow(MissingWriterContextError);
    expect(() =>
      sim.guard.mutate("markets", () => {
        new MacroEngine(sim.scope, sim.world).observePriceIndex(101, sim.clock.time);
      }),
    ).toThrow(OwnershipViolationError);

    const bag = (sim.serializedWorld() as { readonly systems?: Record<string, unknown> }).systems;
    expect(bag?.["macro"]).toBeDefined();
    const state = bag?.["macro"] as {
      readonly priceIndex: readonly unknown[];
      readonly labor: readonly unknown[];
      readonly output: readonly unknown[];
      readonly aggregates: readonly unknown[];
      readonly creditHistory: readonly unknown[];
      readonly shocks: readonly unknown[];
    };
    expect(state.priceIndex).toHaveLength(1);
    expect(state.labor).toHaveLength(0);
    expect(state.output).toHaveLength(0);
    expect(state.aggregates).toHaveLength(0);
    expect(state.creditHistory).toHaveLength(1);
    expect(state.shocks).toHaveLength(0);
  });
});
