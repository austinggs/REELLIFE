/**
 * System 51 — technology: existence separated from availability and from
 * adoption, prerequisite chains that refuse anachronism, adoption as a
 * factor-weighted probability, diffusion with a declared denominator, and
 * obsolescence that is recorded rather than erased.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { TechnologyEngine } from "../../src/engine/technology/engine.ts";
import type { AdoptionConditions } from "../../src/engine/technology/types.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { addTime, days, type WorldTime } from "../../src/engine/primitives/time.ts";
import type { RandomSource } from "../../src/engine/rng/distributions.ts";
import { RngRegistry } from "../../src/engine/rng/streams.ts";
import {
  AURELIA_TECHNOLOGIES,
  AURELIA_TECHNOLOGY_COUNT,
  registerAureliaTechnologies,
} from "../../src/content/aurelia/technologies.ts";

const SEED = "reellife-technology-seed";
const WHEEL = "TECH-ARDEN-WATER-WHEEL";
const MILLSTONE = "TECH-ARDEN-MILLSTONE";
const BERTH = "TECH-ARDEN-TIDAL-BERTH";
const CRANE = "TECH-ARDEN-MECHANICAL-CRANE";
let T0: WorldTime;

/** Everything in the subject's favour: affordable, reachable, permitted, known. */
const FAVOURABLE: AdoptionConditions = {
  price: 1,
  infrastructure: 1,
  knowledge: 1,
  institutions: 1,
  culture: 1,
  regulation: 1,
  compatibility: 1,
  geography: 1,
  network: 1,
};

function newWorld(): Simulation {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
  T0 = sim.clock.time;
  return sim;
}

function withTech<T>(
  sim: Simulation,
  fn: (engine: TechnologyEngine, ids: IdAllocator) => T,
  random?: RandomSource,
): T {
  let result: T = undefined as T;
  sim.guard.mutate("technology", () => {
    const engine =
      random === undefined
        ? new TechnologyEngine(sim.scope, sim.world)
        : new TechnologyEngine(sim.scope, sim.world, random);
    result = fn(engine, new IdAllocator());
  });
  return result;
}

describe("technology and historical change (System 51)", () => {
  it("refuses to register a technology before what it stands on", () => {
    const sim = newWorld();
    withTech(sim, (engine) => {
      // The catalogue will not hold a forward reference, so an anachronism has
      // to be created deliberately rather than by an ordering mistake.
      expect(() =>
        engine.registerTechnology(
          {
            id: "TECH-X",
            name: "Something else",
            category: "production",
            prerequisites: ["TECH-NOT-YET-INVENTED"],
            knowledgeRequirement: 0.2,
            productionRequirement: 0.2,
            infrastructureRequirement: 0.2,
          },
          T0,
        ),
      ).toThrow(/not in the catalogue/);
      expect(engine.technologies()).toEqual([]);
    });
  });

  it("separates existing from available from adopted", () => {
    const sim = newWorld();
    withTech(sim, (engine) => {
      registerAureliaTechnologies(engine, T0);
      // Everything in the slice is settled, so availability is about the chain.
      expect(engine.availability(CRANE, T0)).toMatchObject({
        available: true,
        invented: true,
        anachronistic: false,
        unmetPrerequisites: [],
        retired: false,
      });
      // Available is not adopted: nobody has taken anything up yet.
      expect(engine.adoptions()).toEqual([]);
      expect(engine.diffusion(CRANE, 100)).toMatchObject({ adopters: 0, eligible: 100, rate: 0 });
    });
  });

  it("walks a prerequisite chain and names what is missing", () => {
    const sim = newWorld();
    withTech(sim, (engine) => {
      registerAureliaTechnologies(engine, T0);
      // Ask about a date *before* the slice's start, as if the wheel were newer
      // than the stone that grinds with it.
      const before = addTime(T0, days(-365));
      expect(engine.availability(MILLSTONE, before).anachronistic).toBe(true);
      expect(engine.availability(MILLSTONE, before).unmetPrerequisites).toEqual([WHEEL]);
      expect(engine.availability(MILLSTONE, addTime(T0, days(1))).available).toBe(true);
      // The chain is walked transitively. The crane stands on the *quay* side
      // of the world, not the mill's, so its missing link is the berth and not
      // the wheel — which is the point of a graph rather than a single list.
      expect(engine.availability(CRANE, before).unmetPrerequisites).toContain(BERTH);
      expect(engine.availability(CRANE, before).unmetPrerequisites).not.toContain(WHEEL);
      expect(engine.dependentsOf(WHEEL).map((entry) => entry.id)).toContain(MILLSTONE);
      expect(engine.dependentsOf(BERTH).map((entry) => entry.id).sort()).toEqual([
        CRANE,
        "TECH-ARDEN-LOADING-GAUGE",
      ].sort());
    });
  });

  it("weights the nine adoption factors and names every one", () => {
    const sim = newWorld();
    withTech(sim, (engine) => {
      registerAureliaTechnologies(engine, T0);
      const best = engine.adoptionDrivers(MILLSTONE, FAVOURABLE);
      expect(best.probability).toBe(1);
      expect(best.factors).toHaveLength(9);
      expect(best.factors.join(" ")).toContain("price=1.00");

      // Losing affordability costs exactly what affordability is worth.
      expect(engine.adoptionDrivers(MILLSTONE, { ...FAVOURABLE, price: 0 }).probability).toBe(0.8);
      // One absent factor damps the result rather than annihilating it: a mill
      // is adopted in spite of an unsympathetic local culture, and a product of
      // nine numbers could not say so.
      expect(engine.adoptionDrivers(MILLSTONE, { ...FAVOURABLE, culture: 0 }).probability).toBe(
        0.92,
      );
      expect(() => engine.adoptionDrivers(MILLSTONE, { ...FAVOURABLE, price: 4 })).toThrow(
        /must be 0\.\.1/,
      );
    });
  });

  it("reports every blocker, not just the worst one", () => {
    const sim = newWorld();
    withTech(sim, (engine) => {
      registerAureliaTechnologies(engine, T0);
      const blocked = engine.readiness(MILLSTONE, "ORG-ARDEN-MILL-BAKERY", {
        knowledge: 0.1,
        infrastructure: 0.2,
      });
      expect(blocked.ready).toBe(false);
      expect(blocked.blockers).toHaveLength(2);
      expect(blocked.blockers.join(" ")).toContain("knowledge 0.10 < 0.4");
      expect(blocked.blockers.join(" ")).toContain("infrastructure 0.20 < 0.5");
      expect(blocked.shortfall).toBe(0.3);

      const ready = engine.readiness(MILLSTONE, "ORG-ARDEN-MILL-BAKERY", {
        knowledge: 0.9,
        infrastructure: 0.9,
      });
      expect(ready).toMatchObject({ ready: true, blockers: [], shortfall: 0 });
    });
  });

  it("records a decline as a decline and writes nothing", () => {
    const sim = newWorld();
    withTech(
      sim,
      (engine) => {
        registerAureliaTechnologies(engine, T0);
        const refused = engine.adopt(MILLSTONE, "ORG-SOMEWHERE-ELSE", T0, {
          ...FAVOURABLE,
          price: 0,
          network: 0,
        });
        // Whatever the roll decided, the attempt reports it honestly.
        expect(refused.accepted).toBe(refused.roll < refused.probability);
        if (!refused.accepted) {
          // A decline is not a fact about the world, so nothing is written.
          expect(refused.adoption).toBeUndefined();
          expect(engine.adoptionsOf(MILLSTONE)).toEqual([]);
        }
        const first = engine.adopt(MILLSTONE, "ORG-ARDEN-MILL-BAKERY", T0, FAVOURABLE);
        if (first.accepted) {
          // Offering it again to somebody who already has it is not a second
          // adoption.
          const again = engine.adopt(MILLSTONE, "ORG-ARDEN-MILL-BAKERY", T0, FAVOURABLE);
          expect(again.alreadyAdopted).toBe(true);
          expect(
            engine.adoptionsOf(MILLSTONE).filter((a) => a.subjectId === "ORG-ARDEN-MILL-BAKERY"),
          ).toHaveLength(1);
        }
      },
      new RngRegistry(SEED).stream("technology"),
    );
  });

  it("refuses to adopt what is not available, and says which link is missing", () => {
    const sim = newWorld();
    withTech(
      sim,
      (engine) => {
        registerAureliaTechnologies(engine, T0);
        const before = addTime(T0, days(-365));
        expect(() => engine.adopt(CRANE, "ORG-ARDIN-DOCKS", before, FAVOURABLE)).toThrow(
          /not available at this time/,
        );
        expect(() => engine.adopt(CRANE, "ORG-ARDIN-DOCKS", before, FAVOURABLE)).toThrow(
          new RegExp(BERTH),
        );
        // A world that quietly held the anachronism is the failure the chain
        // exists to prevent, so this is a refusal and not a warning.
        expect(engine.adoptions()).toEqual([]);
      },
      new RngRegistry(SEED).stream("technology"),
    );
  });

  it("requires a reason before it will let a world run ahead of itself", () => {
    const sim = newWorld();
    withTech(sim, (engine) => {
      registerAureliaTechnologies(engine, T0);
      // The permission is a visible record, not a hidden switch: the world says
      // out loud that its timeline is now a scenario decision.
      expect(engine.permission()).toEqual({ enabled: false });
      expect(() => engine.setAnachronyPermission(true, "  ")).toThrow(/reason is required/);
      engine.setAnachronyPermission(true, "testing an early-industrial start");
      expect(engine.permission()).toMatchObject({ enabled: true });
      expect(engine.permission().reason).toBe("testing an early-industrial start");
      engine.setAnachronyPermission(false, "the scenario is back on its timeline");
      expect(engine.permission().enabled).toBe(false);
    });
  });

  it("keeps a superseded technology on the record", () => {
    const sim = newWorld();
    withTech(sim, (engine) => {
      registerAureliaTechnologies(engine, T0);
      const later = addTime(T0, days(365));
      const obsolescence = engine.supersede(
        MILLSTONE,
        later,
        "a roller mill grinds faster and needs less water",
        CRANE,
      );
      expect(obsolescence.replacedById).toBe(CRANE);
      // Still in the catalogue, and the replacement is named.
      expect(engine.technology(MILLSTONE)).toBeDefined();
      expect(engine.availability(MILLSTONE, later)).toMatchObject({
        retired: true,
        available: false,
        replacedById: CRANE,
      });
      expect(engine.availability(MILLSTONE, T0).retired).toBe(false);
    });
  });

  it("registers the slice's catalogue idempotently and refuses a foreign writer", () => {
    const sim = newWorld();
    withTech(sim, (engine) => {
      registerAureliaTechnologies(engine, T0);
      registerAureliaTechnologies(engine, addTime(T0, days(1)));
      expect(engine.technologies()).toHaveLength(AURELIA_TECHNOLOGY_COUNT);
      expect(AURELIA_TECHNOLOGIES).toHaveLength(AURELIA_TECHNOLOGY_COUNT);
      // Every technology in the slice is available on the morning it starts.
      for (const entry of AURELIA_TECHNOLOGIES) {
        expect(engine.availability(entry.id, T0).available).toBe(true);
      }
    });

    const reader = new TechnologyEngine(sim.scope, sim.world);
    expect(reader.permission().enabled).toBe(false);
    expect(() => reader.setAnachronyPermission(true, "no writer context")).toThrow(
      MissingWriterContextError,
    );
    expect(() =>
      sim.guard.mutate("laws", () => {
        new TechnologyEngine(sim.scope, sim.world).setAnachronyPermission(true, "from laws");
      }),
    ).toThrow(OwnershipViolationError);
  });
});