/**
 * U3 — people, family and perception projections (UI/UX 02).
 *
 * Three separate guarantees, each one the reason the projection exists:
 *
 *   1. The directory lists people the viewer can *name* and counts the rest,
 *      because a screen that filled those rows in would be inventing knowledge.
 *   2. The family view obeys System 19 rather than guessing: everything it shows
 *      is a subset of what the engine's own walk returns, and a newly recorded
 *      link appears immediately in both directions.
 *   3. Perceptions come back observer by observer. There is no single score to
 *      read, and an observer the viewer cannot name is labelled, not identified.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { seedPlayableSlice } from "../../src/engine/kernel/sliceSeed.ts";
import {
  getFamilyView,
  getPeopleDirectory,
  getPerceptionView,
} from "../../src/engine/query/socialViews.ts";
import { FamilyEngine } from "../../src/engine/family/engine.ts";
import { ReputationEngine } from "../../src/engine/reputation/engine.ts";
import { IdAllocator, asEntityId } from "../../src/engine/primitives/ids.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import type { FamilySystemState } from "../../src/engine/family/types.ts";
import type { ScaleSystemState } from "../../src/engine/scale/types.ts";

const SEED = "reellife-u3-socialviews";

function seededWorld(): { sim: Simulation; playerId: string } {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
  return { sim, playerId: seedPlayableSlice(sim).playerId };
}

function residentsOf(sim: Simulation): readonly { readonly personId: string }[] {
  return (sim.world.systems.scale as ScaleSystemState | undefined)?.residents ?? [];
}

describe("people directory (UI/UX 02)", () => {
  it("lists the viewer first, then only people they can name", () => {
    const { sim, playerId } = seededWorld();
    const directory = getPeopleDirectory(sim, asEntityId<"person">(playerId));

    expect(directory.viewerId).toBe(playerId);
    expect(directory.entries[0]?.personId).toBe(playerId);
    expect(directory.entries[0]?.relation).toBe("self");
    expect(directory.entries.every((entry) => entry.displayName.length > 0)).toBe(true);
    expect(directory.entries.every((entry) => entry.canOpen)).toBe(true);
  });

  it("never lists the same person twice", () => {
    const { sim, playerId } = seededWorld();
    const ids = getPeopleDirectory(sim, asEntityId<"person">(playerId)).entries.map(
      (entry) => entry.personId,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("counts the people the viewer cannot name instead of inventing rows", () => {
    const { sim, playerId } = seededWorld();
    const directory = getPeopleDirectory(sim, asEntityId<"person">(playerId));

    expect(directory.unnamedNearbyCount).toBeGreaterThan(0);
    const listed = new Set(directory.entries.map((entry) => entry.personId));
    expect(listed.size).toBeLessThan(residentsOf(sim).length);
    expect(
      directory.notes.some((note) => note.includes(String(directory.unnamedNearbyCount))),
    ).toBe(true);
  });

  it("carries the household role System 19 actually recorded", () => {
    const { sim, playerId } = seededWorld();
    const viewer = asEntityId<"person">(playerId);
    const directory = getPeopleDirectory(sim, viewer);
    const household = directory.entries.filter((entry) => entry.relation === "household");
    expect(household.length).toBeGreaterThan(0);

    const state = sim.world.systems.family as FamilySystemState;
    const record = state.households.find((candidate) =>
      candidate.members.some((member) => member.personId === viewer),
    );
    for (const entry of household) {
      const member = record?.members.find((candidate) => candidate.personId === entry.personId);
      expect(entry.householdRole).toBe(member?.role);
    }
  });
});

describe("family and lineage (System 19)", () => {
  it("reads the household, its stints and the recorded kin", () => {
    const { sim, playerId } = seededWorld();
    const family = getFamilyView(sim, asEntityId<"person">(playerId));

    expect(family.personId).toBe(playerId);
    expect(family.stints.length).toBeGreaterThan(0);
    expect(family.stints.every((stint) => stint.joinedAtLabel.length > 0)).toBe(true);
    expect(family.householdName).toBeDefined();
    expect(family.recorded).toBe(true);
    // Structure, never feeling: the note has to send the reader to System 18.
    expect(family.notes.some((note) => note.includes("System 18"))).toBe(true);
  });

  it("shows a subset of the engine's own lineage walk, never an invented relative", () => {
    const { sim, playerId } = seededWorld();
    const viewer = asEntityId<"person">(playerId);
    const family = getFamilyView(sim, viewer);
    const engine = new FamilyEngine(sim.scope, sim.world);

    const engineAncestors = new Set(engine.ancestorsOf(viewer).map(String));
    const engineDescendants = new Set(engine.descendantsOf(viewer).map(String));
    const shownAncestors = family.ancestors.flatMap((row) => row.people.map((p) => p.personId));
    const shownDescendants = family.descendants.flatMap((row) => row.people.map((p) => p.personId));

    for (const id of shownAncestors) expect(engineAncestors.has(id)).toBe(true);
    for (const id of shownDescendants) expect(engineDescendants.has(id)).toBe(true);
    // Every direct parent is shown: the display cap must not hide a parent.
    for (const parentId of engine.parentsOf(viewer)) {
      expect(family.parents.map((person) => person.personId)).toContain(String(parentId));
    }
  });

  it("shows a newly recorded link at once, from both sides", () => {
    const { sim, playerId } = seededWorld();
    const viewer = asEntityId<"person">(playerId);
    const other = residentsOf(sim).find((resident) => resident.personId !== playerId);
    expect(other).toBeDefined();
    if (other === undefined) return;
    const childId = asEntityId<"person">(other.personId);

    const before = getFamilyView(sim, viewer);
    expect(before.children.map((person) => person.personId)).not.toContain(other.personId);

    sim.guard.mutate("family", () => {
      new FamilyEngine(sim.scope, sim.world).recordParentChild(viewer, childId, "biological");
    });

    const after = getFamilyView(sim, viewer);
    expect(after.children.map((person) => person.personId)).toContain(other.personId);
    expect(after.descendants[0]?.generationsAway).toBe(1);
    expect(after.descendants[0]?.label).toBe("Children");
    expect(after.descendants[0]?.people.map((person) => person.personId)).toContain(other.personId);

    const fromChild = getFamilyView(sim, childId);
    expect(fromChild.parents.map((person) => person.personId)).toContain(playerId);
    expect(fromChild.ancestors[0]?.generationsAway).toBe(1);
    expect(fromChild.ancestors[0]?.label).toBe("Parents");
    expect(fromChild.ancestors[0]?.people.map((person) => person.personId)).toContain(playerId);
  });

  it("says the record is empty rather than showing a family that is not there", () => {
    const { sim, playerId } = seededWorld();
    const family = getFamilyView(sim, asEntityId<"person">(playerId), "PER-999999");

    expect(family.displayName).toBe("Unknown person");
    expect(family.parents).toHaveLength(0);
    expect(family.children).toHaveLength(0);
    expect(family.ancestors).toHaveLength(0);
    expect(family.recorded).toBe(false);
    expect(family.notes.some((note) => note.includes("No household is on record"))).toBe(true);
  });
});

describe("perceptions (System 22)", () => {
  /** Records one community-held view of a subject, as System 22 stores it. */
  function recordView(sim: Simulation, subjectId: string, valence: number): void {
    sim.guard.mutate("reputation", () => {
      new ReputationEngine(sim.scope, sim.world).recordEvidence(
        new IdAllocator(),
        {
          observerId: "community:ELSEWHERE",
          subjectId,
          domain: "reliability",
          note: "three missed deliveries",
          sourceReliability: 0.8,
          directness: 0.9,
          corroboration: 0.4,
          recency: 1,
          valence,
        },
        sim.clock.time,
      );
    });
  }

  it("returns each observer's view separately instead of one score", () => {
    const { sim, playerId } = seededWorld();
    const viewer = asEntityId<"person">(playerId);
    const subject = residentsOf(sim).find((resident) => resident.personId !== playerId);
    expect(subject).toBeDefined();
    if (subject === undefined) return;

    recordView(sim, subject.personId, -0.9);
    const view = getPerceptionView(sim, viewer, subject.personId);

    expect(view.recorded).toBe(true);
    const domain = view.domains.find((entry) => entry.domain === "reliability");
    expect(domain).toBeDefined();
    expect(domain?.domainLabel).toBe("Reliability");
    expect(domain?.readings).toHaveLength(1);
    expect(domain?.readings[0].observerLabel).toBe("the local view");
    expect(domain?.readings[0].valueLabel).toBe("strongly negative");
    expect(domain?.readings[0].evidenceCount).toBeGreaterThan(0);
    expect(view.notes.some((note) => note.includes("No single reputation score"))).toBe(true);
  });

  it("withholds an observer's name the viewer was never given", () => {
    const { sim, playerId } = seededWorld();
    const viewer = asEntityId<"person">(playerId);
    const subject = residentsOf(sim).find((resident) => resident.personId !== playerId);
    if (subject === undefined) return;

    sim.guard.mutate("reputation", () => {
      new ReputationEngine(sim.scope, sim.world).recordEvidence(
        new IdAllocator(),
        {
          observerId: "PER-000042",
          subjectId: subject.personId,
          domain: "honesty",
          note: "kept a promise",
          sourceReliability: 0.7,
          directness: 0.6,
          corroboration: 0.3,
          recency: 1,
          valence: 0.5,
        },
        sim.clock.time,
      );
    });

    const view = getPerceptionView(sim, viewer, subject.personId);
    const domain = view.domains.find((entry) => entry.domain === "honesty");
    expect(domain?.readings[0].observerId).toBe("PER-000042");
    expect(domain?.readings[0].observerLabel).toBe("someone you have not met");
    expect(domain?.readings[0].observerLabel).not.toBe("PER-000042");
  });

  it("answers 'nothing is believed' rather than inventing neutrality", () => {
    const { sim, playerId } = seededWorld();
    const viewer = asEntityId<"person">(playerId);
    const residents = residentsOf(sim);
    const subject = residents.find((resident) => resident.personId !== playerId);
    if (subject === undefined) return;
    recordView(sim, subject.personId, -0.9);

    const untouched = residents.find(
      (resident) => resident.personId !== playerId && resident.personId !== subject.personId,
    );
    if (untouched === undefined) return;

    const view = getPerceptionView(sim, viewer, untouched.personId);
    expect(view.recorded).toBe(false);
    expect(view.domains).toHaveLength(0);
    expect(view.notes.join(" ")).toContain("Nothing is believed about this person yet");
  });
});

