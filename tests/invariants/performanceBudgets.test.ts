/**
 * M8 — performance budgets per resolution level.
 *
 * The point of these assertions is not that the numbers are fast; it is that a
 * budget *exists* and can be broken. A budget nobody has ever failed is not a
 * budget, so each test both proves a step can breach its ceiling and that the
 * engine's own slices stay inside theirs.
 *
 * The real-world leg deliberately measures a seeded slice rather than
 * micro-benchmarking a function: what matters is that a playable world of the
 * documented size sits inside the budget a player will actually run.
 */

import { describe, expect, it } from "vitest";
import {
  BudgetLedger,
  RESOLUTION_BUDGETS,
  RESOLUTION_LEVELS,
  RESOLUTION_ORDER,
  isAtLeast,
  judgeStep,
  resolutionLevelFor,
  type ResolutionLevel,
} from "../../src/engine/observability/budgets.ts";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { SLICE_RESIDENT_COUNT } from "../../src/engine/kernel/sliceSeed.ts";

describe("performance budgets (M8)", () => {
  it("defines a budget for every resolution level, in increasing cost", () => {
    expect(Object.keys(RESOLUTION_BUDGETS).sort()).toEqual([...RESOLUTION_LEVELS].sort());
    for (const level of RESOLUTION_LEVELS) {
      const budget = RESOLUTION_BUDGETS[level];
      expect(budget.level).toBe(level);
      expect(budget.maxResolvedPersonsPerStep).toBeGreaterThanOrEqual(0);
      expect(budget.maxWorkUnitsPerStep).toBeGreaterThan(0);
      expect(budget.maxSaveBytes).toBeGreaterThan(0);
    }
    // Finer resolution is allowed to cost more, never less.
    for (let index = 1; index < RESOLUTION_LEVELS.length; index += 1) {
      const coarser = RESOLUTION_BUDGETS[RESOLUTION_LEVELS[index - 1]!];
      const finer = RESOLUTION_BUDGETS[RESOLUTION_LEVELS[index]!];
      expect(finer.maxResolvedPersonsPerStep).toBeGreaterThanOrEqual(
        coarser.maxResolvedPersonsPerStep,
      );
      expect(finer.maxWorkUnitsPerStep).toBeGreaterThanOrEqual(coarser.maxWorkUnitsPerStep);
      expect(finer.maxSaveBytes).toBeGreaterThanOrEqual(coarser.maxSaveBytes);
    }
    expect(RESOLUTION_ORDER.household).toBeGreaterThan(RESOLUTION_ORDER.abstract);
  });

  it("passes a step that is inside its budget", () => {
    const verdict = judgeStep({
      level: "street",
      resolvedPersons: 120,
      eventsProcessed: 30,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.breaches).toHaveLength(0);
    // Work units default to the two obvious contributors.
    expect(verdict.workUnits).toBe(150);
  });

  it("a budget can actually be broken, and names what broke", () => {
    const budget = RESOLUTION_BUDGETS.street;
    const verdict = judgeStep({
      level: "street",
      resolvedPersons: budget.maxResolvedPersonsPerStep + 1,
      eventsProcessed: budget.maxEventsPerStep + 1,
    });
    expect(verdict.ok).toBe(false);
    // Every breach is reported, not just the first.
    const units = verdict.breaches.map((entry) => entry.unit);
    expect(units).toContain("resolvedPersons");
    expect(units).toContain("events");
    for (const entry of verdict.breaches) {
      expect(entry.measured).toBeGreaterThan(entry.budget);
      expect(entry.level).toBe("street");
      // The message has to be usable in a debug surface, not merely non-empty.
      expect(entry.message.length).toBeGreaterThan(10);
      expect(entry.message).toContain("street");
    }
  });

  it("judges a save-size breach separately from a step-cost breach", () => {
    const budget = RESOLUTION_BUDGETS.settlement;
    const verdict = judgeStep({
      level: "settlement",
      resolvedPersons: 0,
      eventsProcessed: 0,
      saveBytes: budget.maxSaveBytes + 1,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.breaches.map((entry) => entry.unit)).toEqual(["saveBytes"]);
    // A save-size breach is real even when the step itself cost nothing.
    expect(verdict.workUnits).toBe(0);
  });

  it("an abstract level tolerates no resolved persons at all", () => {
    expect(RESOLUTION_BUDGETS.abstract.maxResolvedPersonsPerStep).toBe(0);
    const verdict = judgeStep({ level: "abstract", resolvedPersons: 1, eventsProcessed: 0 });
    expect(verdict.ok).toBe(false);
    // Simulating somebody is a resolution change, and the budget says so
    // instead of quietly absorbing it.
    expect(verdict.breaches[0]?.unit).toBe("resolvedPersons");
  });

  it("the ledger tracks the worst step, not the average", () => {
    const ledger = new BudgetLedger("street");
    const budget = RESOLUTION_BUDGETS.street;
    for (let step = 0; step < 5; step += 1) {
      ledger.record({ resolvedPersons: 10, eventsProcessed: 1 });
    }
    expect(ledger.ok()).toBe(true);
    // One pathological step in the middle, while the rest are cheap.
    ledger.record({ resolvedPersons: budget.maxResolvedPersonsPerStep + 5, eventsProcessed: 1 });
    ledger.record({ resolvedPersons: 10, eventsProcessed: 1 });

    const summary = ledger.summary();
    expect(summary.ok).toBe(false);
    expect(summary.steps).toBe(7);
    expect(summary.worstResolvedPersons).toBe(budget.maxResolvedPersonsPerStep + 5);
    // The average hides it; the worst does not. That is the whole point.
    expect(summary.averageWorkUnits).toBeLessThan(budget.maxWorkUnitsPerStep);
    expect(ledger.breaches()).toHaveLength(1);
    expect(ledger.level()).toBe("street");
  });

  it("an empty ledger is vacuously fine", () => {
    const ledger = new BudgetLedger("abstract");
    expect(ledger.ok()).toBe(true);
    expect(ledger.steps()).toBe(0);
    expect(ledger.averageWorkUnits()).toBe(0);
    expect(ledger.summary().breachCount).toBe(0);
  });

  it("derives the resolution level from the work actually done", () => {
    expect(resolutionLevelFor(0)).toBe("abstract");
    expect(resolutionLevelFor(1)).toBe("settlement");
    expect(resolutionLevelFor(32)).toBe("settlement");
    expect(resolutionLevelFor(33)).toBe("street");
    expect(resolutionLevelFor(256)).toBe("street");
    expect(resolutionLevelFor(257)).toBe("household");
    for (const level of RESOLUTION_LEVELS) {
      const resolved = level === "abstract" ? 0 : 4;
      expect(RESOLUTION_BUDGETS[resolutionLevelFor(resolved)]).toBeDefined();
    }
  });

  it("compares levels by detail, not by declaration order", () => {
    expect(isAtLeast("household", "abstract")).toBe(true);
    expect(isAtLeast("abstract", "household")).toBe(false);
    expect(isAtLeast("street", "street")).toBe(true);
  });


  it("a seeded playable slice sits inside its own budget", () => {
    const sim = createKernelSimulation({
      masterSeed: "reellife-m8-budgets",
      seedSlice: true,
      withHeartbeat: false,
    });
    const residents = (
      sim.world.systems.scale as { residents: readonly { settlementId: string }[] } | undefined
    )?.residents.length ?? 0;
    expect(residents).toBe(SLICE_RESIDENT_COUNT);

    // A slice this size is household-detail work, and is judged as such.
    const level: ResolutionLevel = resolutionLevelFor(residents);
    expect(level).toBe("household");

    const verdict = judgeStep({ level, resolvedPersons: residents, eventsProcessed: 0 });
    expect(verdict.ok).toBe(true);
  });

  it("a real save of a seeded slice is inside the save-size budget", () => {
    const sim = createKernelSimulation({
      masterSeed: "reellife-m8-budgets",
      seedSlice: true,
      withHeartbeat: false,
    });
    const saveBytes = new TextEncoder().encode(JSON.stringify(sim.serializedWorld())).length;
    const residents =
      (sim.world.systems.scale as { residents: readonly unknown[] } | undefined)?.residents.length ?? 0;
    const verdict = judgeStep({
      level: resolutionLevelFor(residents),
      resolvedPersons: 0,
      eventsProcessed: 0,
      saveBytes,
    });
    expect(verdict.ok).toBe(true);
    // A size this small would suggest the slice never actually serialized.
    expect(saveBytes).toBeGreaterThan(1_000);
  });
});
