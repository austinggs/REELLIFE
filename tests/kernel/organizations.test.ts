/**
 * System 32 — organization core: registry, hierarchy, memberships, lifecycle.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { OrganizationsEngine } from "../../src/engine/organizations/engine.ts";
import { asEntityId } from "../../src/engine/primitives/ids.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";

const SEED = "reellife-organizations-seed";
const PERSON = asEntityId<"person">("PER-000001");
const OTHER = asEntityId<"person">("PER-000002");

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
}

function withOrgs<T>(sim: Simulation, fn: (engine: OrganizationsEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("organizations", () => {
    result = fn(new OrganizationsEngine(sim.scope, sim.world));
  });
  return result;
}

describe("organization engine (System 32)", () => {
  it("creates organizations with authored or allocated IDs", () => {
    const sim = newWorld();
    const [docks, allocated] = withOrgs(sim, (engine) => {
      const docks = engine.create(
        sim.ids,
        { id: asEntityId<"organization">("ORG-ARDIN-DOCKS"), legalName: "Ardin Docks Authority", type: "commercial" },
        sim.clock.time,
      );
      const allocated = engine.create(
        sim.ids,
        { legalName: "Arden Mutual Aid", type: "civic" },
        sim.clock.time,
      );
      return [docks, allocated] as const;
    });
    expect(docks.id).toBe("ORG-ARDIN-DOCKS");
    expect(String(allocated.id)).toMatch(/^ORG-/);
    expect(docks.lifecycle).toBe("active");
    expect(docks.capacity.publicTrust).toBe(0.5);
    expect(withOrgs(sim, (engine) => engine.all())).toHaveLength(2);
  });

  it("rejects duplicates, empty names and unknown parents; links subsidiaries", () => {
    const sim = newWorld();
    const outcome = withOrgs(sim, (engine) => {
      expect(() =>
        engine.create(sim.ids, { legalName: "", type: "commercial" }, sim.clock.time),
      ).toThrow(/legalName/);
      engine.create(
        sim.ids,
        { id: asEntityId<"organization">("ORG-PARENT"), legalName: "Parent", type: "commercial" },
        sim.clock.time,
      );
      expect(() =>
        engine.create(
          sim.ids,
          { id: asEntityId<"organization">("ORG-PARENT"), legalName: "Dup", type: "commercial" },
          sim.clock.time,
        ),
      ).toThrow(/already exists/);
      expect(() =>
        engine.create(
          sim.ids,
          { legalName: "Orphan", type: "commercial", parentOrganizationId: asEntityId<"organization">("ORG-GONE") },
          sim.clock.time,
        ),
      ).toThrow(/does not exist/);
      engine.create(
        sim.ids,
        {
          id: asEntityId<"organization">("ORG-CHILD"),
          legalName: "Child",
          type: "commercial",
          parentOrganizationId: asEntityId<"organization">("ORG-PARENT"),
        },
        sim.clock.time,
      );
      return engine.get("ORG-PARENT")?.subsidiaryIds ?? [];
    });
    expect(outcome).toEqual(["ORG-CHILD"]);
  });

  it("tracks memberships and refuses duplicate active roles", () => {
    const sim = newWorld();
    withOrgs(sim, (engine) => {
      engine.create(
        sim.ids,
        { id: asEntityId<"organization">("ORG-CLUB"), legalName: "Arden Rowing Club", type: "civic" },
        sim.clock.time,
      );
      engine.addMembership("ORG-CLUB", PERSON, "member", [], sim.clock.time);
      engine.addMembership("ORG-CLUB", PERSON, "officer", ["admit_members"], sim.clock.time, "Treasurer");
      expect(() =>
        engine.addMembership("ORG-CLUB", PERSON, "member", [], sim.clock.time),
      ).toThrow(/already holds/);
      expect(engine.membershipsFor(PERSON, sim.clock.time)).toHaveLength(2);
      expect(engine.membershipsFor(OTHER, sim.clock.time)).toHaveLength(0);

      expect(engine.endMembership("ORG-CLUB", PERSON, sim.clock.time)).toBe(2);
      expect(engine.membershipsFor(PERSON, sim.clock.time)).toHaveLength(0);
      expect(engine.endMembership("ORG-CLUB", PERSON, sim.clock.time)).toBe(0);
    });
  });

  it("enforces legal lifecycle transitions", () => {
    const sim = newWorld();
    withOrgs(sim, (engine) => {
      const org = engine.create(
        sim.ids,
        { id: asEntityId<"organization">("ORG-CAFE"), legalName: "Quayside Cafe", type: "commercial" },
        sim.clock.time,
      );
      expect(org.lifecycle).toBe("active");
      // active may not jump straight to dissolved.
      expect(() => engine.setLifecycle(org.id, "dissolved", sim.clock.time)).toThrow(
        /invalid transition/,
      );
      const suspended = engine.setLifecycle(org.id, "suspended", sim.clock.time);
      expect(suspended.lifecycle).toBe("suspended");
      expect(engine.setLifecycle(org.id, "active", sim.clock.time).lifecycle).toBe("active");
      const closed = engine.setLifecycle(org.id, "closed", sim.clock.time);
      expect(closed.closedAt).toBe(sim.clock.time);
      const dissolved = engine.setLifecycle(org.id, "dissolved", sim.clock.time);
      expect(dissolved.lifecycle).toBe("dissolved");
      expect(() => engine.setLifecycle(org.id, "active", sim.clock.time)).toThrow(
        /invalid transition/,
      );
    });
  });
});
