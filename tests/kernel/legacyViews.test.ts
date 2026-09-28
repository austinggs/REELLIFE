/**
 * U6 — continuity and legacy (System 53).
 *
 * The seeded world has nobody dead, so the interesting half of this phase is
 * about what the read does when a life *has* ended. These tests record real
 * determinations through the engine's own API and then assert that the
 * projection reports them faithfully — the certainty, the determiner, the
 * referenced evidence, the estate's items and beneficiaries, and the control
 * handoff — rather than flattering them into a tidy summary.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { seedPlayableSlice } from "../../src/engine/kernel/sliceSeed.ts";
import { getLegacyView } from "../../src/engine/query/legacyViews.ts";
import { LifeContinuityEngine } from "../../src/engine/continuity/engine.ts";
import { asEntityId } from "../../src/engine/primitives/ids.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import type { FamilySystemState } from "../../src/engine/family/types.ts";

const SEED = "reellife-u6-legacy";

function seededWorld(): { sim: Simulation; playerId: string } {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
  return { sim, playerId: seedPlayableSlice(sim).playerId };
}

/** Another member of the viewer's household, so a determination is about a real person. */
function otherHouseholdMember(sim: Simulation, viewer: string): string {
  const family = sim.world.systems.family as FamilySystemState;
  const household = family.households.find((candidate) =>
    candidate.members.some((member) => member.personId === viewer),
  );
  const other = household?.members.find((member) => member.personId !== viewer);
  if (other === undefined) throw new Error("expected a second household member");
  return other.personId;
}

function withContinuity<T>(sim: Simulation, fn: (engine: LifeContinuityEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("continuity", () => {
    result = fn(new LifeContinuityEngine(sim.scope, sim.world));
  });
  return result;
}

describe("legacy (System 53)", () => {
  it("reports a living viewer and a real household even when nothing has ended", () => {
    const { sim, playerId } = seededWorld();
    const legacy = getLegacyView(sim, asEntityId<"person">(playerId));

    expect(legacy.viewerIsAlive).toBe(true);
    expect(legacy.viewerStatusLabel).toBe("Living");
    expect(legacy.household.length).toBeGreaterThan(0);
    expect(legacy.household.some((member) => member.isViewer)).toBe(true);
    // Nobody died, so there is nothing archived — and the read says why.
    expect(legacy.archivedLives).toHaveLength(0);
    expect(legacy.estates).toHaveLength(0);
    expect(legacy.viewerIsInControl).toBe(true);
    expect(legacy.notes.join(" ")).toMatch(/manufacturing a death to fill this page/);
  });

  it("never invents a life that ended", () => {
    const { sim, playerId } = seededWorld();
    const legacy = getLegacyView(sim, asEntityId<"person">(playerId));
    // The empty case is reported as empty, not padded from the household roster.
    for (const member of legacy.household) expect(member.status).toBe("active");
  });

  it("shows a determination with its certainty and who made it", () => {
    const { sim, playerId } = seededWorld();
    const viewer = asEntityId<"person">(playerId);
    const subjectId = otherHouseholdMember(sim, playerId);
    const subject = asEntityId<"person">(subjectId);

    withContinuity(sim, (engine) => {
      engine.determineDeath("DET-TEST-1", {
        personId: subject,
        occurredAt: sim.clock.time,
        determinedAt: sim.clock.time,
        cause: "age",
        certainty: "probable",
        determinedBy: "inference",
        evidence: [{ system: "health", recordId: "cond-1" }],
      });
      engine.registerDeath(subject, sim.clock.time, "age", "DET-TEST-1");
    });

    const legacy = getLegacyView(sim, viewer);
    const archived = legacy.archivedLives.find((life) => life.personId === subjectId);
    expect(archived).toBeDefined();
    expect(archived?.status).toBe("deceased");
    // `probable` must not be reported as certain, and an inference must not be
    // reported as a witness.
    expect(archived?.determination?.certainty).toBe("probable");
    expect(archived?.determination?.certaintyLabel).toMatch(/no one witnessed/);
    expect(archived?.determination?.determinedByLabel).toBe("an inference from the facts");
    // Evidence is referenced with its owning system, never restated.
    expect(archived?.determination?.evidenceCount).toBe(1);
    expect(archived?.determination?.evidenceSystems).toEqual(["health"]);
  });

  it("reports a control handoff with its basis and does not rewrite the person", () => {
    const { sim, playerId } = seededWorld();
    const viewer = asEntityId<"person">(playerId);
    const subjectId = otherHouseholdMember(sim, playerId);
    const subject = asEntityId<"person">(subjectId);

    withContinuity(sim, (engine) => {
      engine.recordControlTransfer("TRF-TEST-1", {
        fromPersonId: subject,
        toPersonId: viewer,
        at: sim.clock.time,
        basis: "declared",
        reason: "named in advance",
      });
    });

    const legacy = getLegacyView(sim, viewer);
    expect(legacy.controlTransfers).toHaveLength(1);
    expect(legacy.controlTransfers[0].basisLabel).toMatch(/declared handoff/);
    expect(legacy.controlTransfers[0].reason).toBe("named in advance");
    expect(legacy.viewerIsInControl).toBe(true);
    expect(legacy.currentControllerName).toBeDefined();
    // Whoever handed over keeps their own identity on the record.
    expect(legacy.controlTransfers[0].fromName).not.toBe(legacy.controlTransfers[0].toName);
  });

  it("reports an estate as concrete items and named beneficiaries, never a bonus", () => {
    const { sim, playerId } = seededWorld();
    const viewer = asEntityId<"person">(playerId);
    const subjectId = otherHouseholdMember(sim, playerId);
    const subject = asEntityId<"person">(subjectId);

    withContinuity(sim, (engine) => {
      engine.determineDeath("DET-TEST-2", {
        personId: subject,
        occurredAt: sim.clock.time,
        determinedAt: sim.clock.time,
        cause: "age",
        certainty: "certain",
        determinedBy: "medical",
        // The engine refuses a determination that cites no fact, so there is
        // always at least one — and the read only ever shows the reference.
        evidence: [{ system: "health", recordId: "cond-2" }],
      });
      engine.registerDeath(subject, sim.clock.time, "age", "DET-TEST-2");
      engine.addEstate({
        id: "EST-TEST-1",
        deceasedId: subject,
        openedAt: sim.clock.time,
        status: "open",
        items: [
          {
            id: "ITEM-1",
            ref: { system: "inventory", recordId: "ITEM-9", field: "ownerId", kind: "item" },
          },
          {
            id: "ITEM-2",
            ref: { system: "finance", recordId: "ACC-9", field: "ownerId", kind: "money" },
            retainedReason: "a tenancy is not an asset to hand on",
          },
        ],
        obligations: [],
        beneficiaries: [{ personId: viewer, basis: "intestacy_household", share: 1 }],
        applications: [],
        note: "settled as it stood",
      });
    });

    const legacy = getLegacyView(sim, viewer);
    const estate = legacy.estates.find((entry) => entry.id === "EST-TEST-1");
    expect(estate).toBeDefined();
    expect(estate?.items).toHaveLength(2);
    // Each item names the system that owns it, so nothing is a mystery holding.
    expect(estate?.items.map((item) => item.systemLabel)).toEqual(["inventory", "finance"]);
    expect(estate?.items[1].retainedReason).toMatch(/not an asset/);
    expect(estate?.beneficiaries[0].basisLabel).toMatch(/from the household/);
    expect(estate?.note).toBe("settled as it stood");
    // The whole record is names and references; there is no score for a life.
    expect(JSON.stringify(legacy)).not.toMatch(/legacyBonus|legacyScore|reputation/i);
  });
});
