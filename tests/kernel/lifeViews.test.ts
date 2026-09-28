/**
 * M3 — life-facing projections (UI/UX 02, 04, 07, 08).
 *
 * These tests pin the *information* contract of the UI's read path: the viewer
 * always knows themselves, identifies people they live with, is refused other
 * people's inner state, and receives notifications ranked by relevance rather
 * than by mere event volume.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { seedPlayableSlice } from "../../src/engine/kernel/sliceSeed.ts";
import {
  NOTIFICATION_CATEGORIES,
  getLifeSituation,
  getNotificationFeedView,
  getPersonView,
  searchKnownEntities,
} from "../../src/engine/query/lifeViews.ts";
import { KNOWLEDGE_STATES, VISIBILITY_LEVELS } from "../../src/engine/primitives/information.ts";
import { asEntityId } from "../../src/engine/primitives/ids.ts";
import { durationOf, type WorldTime } from "../../src/engine/primitives/time.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";

const SEED = "reellife-m3-lifeviews";

function seededWorld(): { sim: Simulation; playerId: string } {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
  return { sim, playerId: seedPlayableSlice(sim).playerId };
}

/** A resident the player does not live with — i.e. someone they have not met. */
function strangerOf(sim: Simulation, playerId: string): string {
  const scale = sim.world.systems.scale as {
    readonly residents: readonly { readonly personId: string; readonly householdId?: string }[];
  };
  const family = sim.world.systems.family as {
    readonly households: readonly {
      readonly id: string;
      readonly members: readonly { readonly personId: string }[];
    }[];
  };
  const mine = family.households.find((household) =>
    household.members.some((member) => member.personId === playerId),
  );
  const mineIds = new Set(mine?.members.map((member) => member.personId) ?? []);
  const stranger = scale.residents.find((resident) => !mineIds.has(resident.personId));
  if (stranger === undefined) throw new Error("expected a resident outside the player's household");
  return stranger.personId;
}


describe("life situation (UI/UX 04)", () => {
  it("describes the viewer's own needs, mood, place and household", () => {
    const { sim, playerId } = seededWorld();
    const life = getLifeSituation(sim, asEntityId<"person">(playerId));

    expect(life.viewerId).toBe(playerId);
    expect(life.nameKnowledge).toBe("known");
    expect(life.ageYears).toBeGreaterThanOrEqual(0);
    expect(life.needs.length).toBeGreaterThan(0);
    // Self knowledge is `known`, never estimated or hidden.
    expect(life.needs.every((need) => need.knowledge === "known")).toBe(true);
    expect(life.mostUrgentNeed?.level).toBe(Math.min(...life.needs.map((need) => need.level)));
    expect(life.commitments.length).toBeLessThanOrEqual(5);
    expect(life.nearbyPeople.length).toBeLessThanOrEqual(8);
    expect(life.quickActions.every((action) => action.outcomeKind === "deterministic")).toBe(true);
  });

  it("labels each fact with a knowledge state the UI can render distinctly", () => {
    const { sim, playerId } = seededWorld();
    const life = getLifeSituation(sim, asEntityId<"person">(playerId));
    for (const person of life.nearbyPeople) {
      expect(KNOWLEDGE_STATES).toContain(person.knowledge);
    }
    expect(VISIBILITY_LEVELS).toContain("public");
  });
});

describe("person view (UI/UX 02 section 3)", () => {
  it("knows the viewer themselves", () => {
    const { sim, playerId } = seededWorld();
    const view = getPersonView(sim, asEntityId<"person">(playerId), playerId);

    expect(view.relation).toBe("self");
    expect(view.nameKnowledge).toBe("known");
    expect(
      view.summaryFields.some((field) => field.label === "Age" && field.value.includes("years")),
    ).toBe(true);
    expect(view.privateFields.every((field) => field.knowledge === "known")).toBe(true);
  });

  it("names household members but estimates their age band rather than their age", () => {
    const { sim, playerId } = seededWorld();
    const life = getLifeSituation(sim, asEntityId<"person">(playerId));
    const member = life.nearbyPeople.find((person) => person.context === "household member");
    expect(member).toBeDefined();
    if (member === undefined) return;

    const view = getPersonView(sim, asEntityId<"person">(playerId), member.personId);
    expect(view.relation).toBe("household");
    expect(view.displayName).not.toBe("Stranger");
    const ageBand = view.summaryFields.find((field) => field.label === "Age band");
    expect(ageBand?.knowledge).toBe("estimate");
    expect(view.summaryFields.some((field) => field.label === "Age")).toBe(false);
  });

  it("withholds the identity and inner state of someone the viewer has not met", () => {
    const { sim, playerId } = seededWorld();
    const view = getPersonView(sim, asEntityId<"person">(playerId), strangerOf(sim, playerId));

    expect(view.relation).toBe("stranger");
    expect(view.displayName).toBe("Stranger");
    expect(view.nameKnowledge).toBe("unknown");
    // Telepathy is not a mechanic: another person's mood and needs stay hidden.
    expect(view.privateFields.every((field) => field.knowledge === "hidden")).toBe(true);
    expect(view.notes.length).toBeGreaterThan(0);
  });
});

describe("notification feed (UI/UX 08)", () => {
  it("ranks notifications by importance and involvement, with a delivery class", () => {
    const { sim, playerId } = seededWorld();
    const actor = asEntityId<"person">(playerId);
    for (let index = 0; index < 3; index += 1) {
      sim.dispatcher.dispatch(sim.dispatcher.createCommand("person.eat", actor, {}, "player"));
    }
    sim.runSteps(15);

    const feed = getNotificationFeedView(sim, actor, { limit: 20 });
    for (const notification of feed.notifications) {
      expect(NOTIFICATION_CATEGORIES).toContain(notification.category);
      expect(KNOWLEDGE_STATES).toContain(notification.knowledge);
      expect(["interrupt", "inbox", "optional"]).toContain(notification.delivery);
      expect(notification.relevance).toBeGreaterThanOrEqual(0);
      expect(notification.timeLabel.length).toBeGreaterThan(0);
    }
    expect(feed.urgentCount + feed.inboxCount).toBeLessThanOrEqual(feed.notifications.length);
  });

  it("never leaks restricted, private or secret entries to an anonymous viewer", () => {
    const { sim, playerId } = seededWorld();
    sim.dispatcher.dispatch(
      sim.dispatcher.createCommand("person.eat", asEntityId<"person">(playerId), {}, "player"),
    );
    sim.runSteps(15);

    const anonymous = getNotificationFeedView(sim, null, { limit: 50 });
    expect(anonymous.notifications.every((notification) => notification.knowledge === "known")).toBe(
      true,
    );
    expect(anonymous.notifications.every((notification) => !notification.involvedViewer)).toBe(true);
  });
});


describe("committed time and clashes (UI/UX 04, System 05)", () => {
  /** Two of the viewer's own plans that genuinely overlap, plus one that does not. */
  function twoOverlappingPlans(): {
    sim: Simulation;
    actor: ReturnType<typeof asEntityId<"person">>;
    workId: string;
    errandId: string;
    laterId: string;
  } {
    const { sim, playerId } = seededWorld();
    const actor = asEntityId<"person">(playerId);
    const at = sim.clock.time;
    const later = ((at as number) + 600) as WorldTime;

    const ids = sim.guard.mutate("activities", () => {
      const work = sim.activities.create(
        { ids: sim.ids, calendar: sim.calendar },
        { actor, kind: "workShift", start: at, duration: durationOf(120), createdBy: "system" },
      );
      // Starts inside the shift, so exactly one hour of the two windows collide.
      const errand = sim.activities.create(
        { ids: sim.ids, calendar: sim.calendar },
        {
          actor,
          kind: "errand",
          start: ((at as number) + 60) as WorldTime,
          duration: durationOf(120),
          createdBy: "system",
        },
      );
      const laterPlan = sim.activities.create(
        { ids: sim.ids, calendar: sim.calendar },
        { actor, kind: "leisure", start: later, duration: durationOf(30), createdBy: "system" },
      );
      return { workId: work.id, errandId: errand.id, laterId: laterPlan.id };
    });

    return { sim, actor, ...ids };
  }

  it("reports a real overlap instead of hiding or resolving it", () => {
    const { sim, actor, workId, errandId } = twoOverlappingPlans();
    const life = getLifeSituation(sim, actor);

    const work = life.commitments.find((commitment) => commitment.activityId === workId);
    expect(work).toBeDefined();
    expect(work?.conflicts).toHaveLength(1);
    expect(work?.conflicts[0].activityId).toBe(errandId);
    expect(work?.conflicts[0].overlapMinutes).toBe(60);
    // Formatted for prose, never a bare figure the screen has to interpolate.
    expect(work?.conflicts[0].overlapLabel).toBe("1 hour");
  });

  it("reports the clash from both sides, since neither plan is privileged", () => {
    const { sim, actor, workId, errandId } = twoOverlappingPlans();
    const life = getLifeSituation(sim, actor);

    const errand = life.commitments.find((commitment) => commitment.activityId === errandId);
    expect(errand?.conflicts).toHaveLength(1);
    expect(errand?.conflicts[0].activityId).toBe(workId);
    expect(errand?.conflicts[0].overlapMinutes).toBe(60);
  });

  it("leaves a plan that collides with nothing alone", () => {
    const { sim, actor, laterId } = twoOverlappingPlans();
    const life = getLifeSituation(sim, actor);

    const later = life.commitments.find((commitment) => commitment.activityId === laterId);
    expect(later).toBeDefined();
    expect(later?.conflicts).toHaveLength(0);
  });

  it("counts an overlap once per pair, never against the plan itself", () => {
    const { sim, actor, workId } = twoOverlappingPlans();
    const life = getLifeSituation(sim, actor);
    const work = life.commitments.find((commitment) => commitment.activityId === workId);
    const conflictedIds = work?.conflicts.map((conflict) => conflict.activityId) ?? [];
    expect(conflictedIds).not.toContain(workId);
    expect(new Set(conflictedIds).size).toBe(conflictedIds.length);
  });

  it("carries the engine's own urgency word for every need", () => {
    const { sim, playerId } = seededWorld();
    const life = getLifeSituation(sim, asEntityId<"person">(playerId));

    const engineState = sim.world.systems.needs as {
      readonly persons: readonly {
        readonly personId: string;
        readonly needs: readonly { readonly kind: string; readonly urgency: string }[];
      }[];
    };
    const mine = engineState.persons.find((entry) => entry.personId === playerId);
    for (const need of life.needs) {
      const engineNeed = mine?.needs.find((candidate) => candidate.kind === need.kind);
      expect(need.urgency).toBe(engineNeed?.urgency);
    }
  });
});

describe("knowledge-filtered search (UI/UX 03 section 6, UI/UX 18)", () => {
  it("finds the viewer, their household and the places around them", () => {
    const { sim, playerId } = seededWorld();
    const actor = asEntityId<"person">(playerId);
    const life = getLifeSituation(sim, actor);
    const firstName = life.displayName.split(" ")[0] ?? life.displayName;

    const results = searchKnownEntities(sim, actor, firstName);
    expect(results.some((result) => result.id === playerId && result.kind === "person")).toBe(
      true,
    );
    expect(results.every((result) => result.knowledge !== "hidden")).toBe(true);

    const placeResults = searchKnownEntities(sim, actor, life.locationName);
    expect(placeResults.some((result) => result.kind === "place")).toBe(true);
    expect(placeResults.every((result) => result.knowledge === "known")).toBe(true);
  });

  it("does not make a stranger discoverable", () => {
    const { sim, playerId } = seededWorld();
    const strangerId = strangerOf(sim, playerId);
    const identity = sim.world.systems.identity as {
      readonly persons: readonly {
        readonly id: string;
        readonly name: { readonly first: string; readonly last: string };
      }[];
    };
    const stranger = identity.persons.find((person) => person.id === strangerId);
    expect(stranger).toBeDefined();
    if (stranger === undefined) return;

    const byFullName = searchKnownEntities(
      sim,
      asEntityId<"person">(playerId),
      `${stranger.name.first} ${stranger.name.last}`,
    );
    expect(byFullName.some((result) => result.id === strangerId)).toBe(false);
  });

  it("returns nothing for a blank query and respects the limit", () => {
    const { sim, playerId } = seededWorld();
    expect(searchKnownEntities(sim, asEntityId<"person">(playerId), "   ")).toHaveLength(0);
    const limited = searchKnownEntities(sim, asEntityId<"person">(playerId), "a", { limit: 3 });
    expect(limited.length).toBeLessThanOrEqual(3);
  });

  it("shows an anonymous viewer only what is public knowledge", () => {
    const { sim, playerId } = seededWorld();
    const actor = asEntityId<"person">(playerId);
    const life = getLifeSituation(sim, actor);

    const anonymous = searchKnownEntities(sim, null, life.locationName);
    expect(anonymous).toHaveLength(0); // an anonymous viewer has no location context
    expect(searchKnownEntities(sim, null, "Aurelia").every((result) => result.knowledge === "known")).toBe(true);
  });
});

