/**
 * System 23 — education: programs, access inequality, capacity, the
 * enrollment state graph, attendance versus enrollment, assessment and
 * credentials, and recognition variance.
 *
 * The spec's own warnings are the claims under test: attendance is not
 * enrollment, teaching does not guarantee learning (grades are the
 * institution's opinion, not skill truth), access depends on named things,
 * and a credential is recognition rather than competence.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { seedPlayableSlice } from "../../src/engine/kernel/sliceSeed.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import {
  ACCESS_BLOCKER_FLOOR,
  EducationEngine,
  assessAccess,
  type DefineProgramRequest,
} from "../../src/engine/education/engine.ts";
import {
  AURELIA_MILLING_COURSE,
  AURELIA_SLICE_PROGRAM_COUNT,
  AURELIA_STEVEDORE_PROGRAM,
  aureliaArdenPrograms,
  registerAureliaEducation,
} from "../../src/content/aurelia/education.ts";
import { asEntityId, IdAllocator, type EntityId } from "../../src/engine/primitives/ids.ts";
import { currencyId, money } from "../../src/engine/primitives/money.ts";
import { atTime, days } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-education-seed";
const AUR = currencyId("AUR");
const NOW = atTime(days(365));
const student = (id: string): EntityId<"person"> => asEntityId(id);

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
}

function withEducation<T>(sim: Simulation, fn: (engine: EducationEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("education", () => {
    result = fn(new EducationEngine(sim.scope, sim.world));
  });
  return result;
}

describe("education (System 23)", () => {
  it("runs the slice's programs under real organizations, idempotently", () => {
    const sim = newWorld();
    withEducation(sim, (engine) => {
      expect(aureliaArdenPrograms()).toHaveLength(AURELIA_SLICE_PROGRAM_COUNT);
      expect(engine.programs()).toHaveLength(AURELIA_SLICE_PROGRAM_COUNT);

      // Institutions *are* Organizations: every program names one that exists.
      const organizations = sim.world.systems.organizations as {
        readonly organizations: readonly { readonly id: string }[];
      };
      const orgIds = new Set(organizations.organizations.map((entry) => entry.id));
      for (const program of engine.programs()) {
        expect(orgIds.has(program.institutionOrgId)).toBe(true);
        expect(engine.programsOf(program.institutionOrgId).length).toBeGreaterThan(0);
      }
      // Nothing holds a seat yet: capacity is available until it is taken.
      expect(engine.availableSeats(AURELIA_STEVEDORE_PROGRAM)).toBe(20);

      // The player is seeded with an application and nothing more.
      const scale = sim.world.systems.scale as {
        readonly residents: readonly { readonly personId: string }[];
      };
      const mine = engine.enrollmentsOf(scale.residents[0]?.personId ?? "");
      expect(mine).toHaveLength(1);
      expect(mine[0]?.status).toBe("applied");
      expect(mine[0]?.programId).toBe(AURELIA_STEVEDORE_PROGRAM);
    });

    // Re-seeding adds neither a program nor a second application.
    seedPlayableSlice(sim);
    withEducation(sim, (engine) => {
      expect(engine.programs()).toHaveLength(AURELIA_SLICE_PROGRAM_COUNT);
      expect(registerAureliaEducation(engine)).toEqual({ programs: 0 });
      const scale = sim.world.systems.scale as {
        readonly residents: readonly { readonly personId: string }[];
      };
      expect(engine.enrollmentsOf(scale.residents[0]?.personId ?? "")).toHaveLength(1);
    });
  });

  it("refuses a program with no institution, no capacity or no qualification", () => {
    const sim = newWorld();
    withEducation(sim, (engine) => {
      const base = aureliaArdenPrograms()[0] as DefineProgramRequest;
      expect(() => engine.defineProgram(base)).toThrow(/already exists/);
      expect(() =>
        engine.defineProgram({ ...base, id: "EDU-PROBE", institutionOrgId: "ORG-NOT-REAL" }),
      ).toThrow(/not a registered organization/);
      expect(() => engine.defineProgram({ ...base, id: "EDU-PROBE", capacityUnits: 0 })).toThrow(
        /capacityUnits/,
      );
      expect(() =>
        engine.defineProgram({ ...base, id: "EDU-PROBE", qualificationSlug: "  " }),
      ).toThrow(/must not be empty/);
      expect(() => engine.defineProgram({ ...base, id: "EDU-PROBE", cost: money(AUR, -1) })).toThrow(
        /must not be negative/,
      );
    });
  });

  it("names what stands between a student and a seat", () => {
    // Everything open: the student can get there and afford it.
    const open = assessAccess({
      distanceBurden: 0.1,
      transportAccess: 0.9,
      affordability: 0.8,
      resources: 0.7,
      accommodation: 0.9,
      legalEligibility: 1,
      languageFit: 0.9,
      familyDuties: 0.1,
      employmentLoad: 0.2,
      childcare: 0.8,
      safety: 0.9,
    });
    expect(open.accessible).toBe(true);
    expect(open.blockers).toEqual([]);

    // Everything closed: no bus, cannot pay, far away, unsafe.
    const shut = assessAccess({
      distanceBurden: 1,
      transportAccess: 0,
      affordability: 0,
      resources: 0.1,
      accommodation: 0.5,
      legalEligibility: 1,
      languageFit: 0.4,
      familyDuties: 0.9,
      employmentLoad: 0.9,
      childcare: 0,
      safety: 0.1,
    });
    expect(shut.accessible).toBe(false);
    // The blockers are named, so an institution can say what the problem was.
    expect(shut.blockers).toEqual(
      expect.arrayContaining(["distanceBurden", "transportAccess", "affordability", "safety"]),
    );
    // A burden is inverted: more burden must always mean a lower score.
    const near = assessAccess({ distanceBurden: 0, transportAccess: 1, affordability: 1 });
    const far = assessAccess({ distanceBurden: 1, transportAccess: 1, affordability: 1 });
    expect(near.score).toBeGreaterThan(far.score);
    // And an input below the floor is a blocker, exactly at the floor is not.
    expect(assessAccess({ legalEligibility: ACCESS_BLOCKER_FLOOR - 0.01 }).blockers).toContain(
      "legalEligibility",
    );
    expect(assessAccess({ legalEligibility: ACCESS_BLOCKER_FLOOR }).blockers).toEqual([]);
  });

  it("keeps attendance separate from enrollment, and follows the state graph", () => {
    const sim = newWorld();
    const ids = new IdAllocator();
    withEducation(sim, (engine) => {
      const mine = engine.apply(
        ids,
        { studentId: student("PER-TEST-1"), programId: AURELIA_MILLING_COURSE },
        NOW,
      );
      // One live application per student per program.
      expect(() =>
        engine.apply(
          ids,
          { studentId: student("PER-TEST-1"), programId: AURELIA_MILLING_COURSE },
          NOW,
        ),
      ).toThrow(/already holds applied/);
      // An application is not a seat: attendance is refused before admission.
      expect(() => engine.recordAttendance(mine.id, true, NOW)).toThrow(
        /is applied, not enrolled or active/,
      );
      expect(engine.attendanceRate(mine.id)).toBeUndefined();

      // The graph is the spec's: applied -> admitted -> enrolled -> active.
      expect(() => engine.enroll(mine.id, NOW)).toThrow(/the lifecycle allows/);
      engine.admit(mine.id, NOW);
      engine.enroll(mine.id, NOW);
      expect(engine.enrollment(mine.id)?.enrolledAt).toBe(NOW);
      engine.transitionEnrollment(mine.id, "active", NOW, "first term under way");

      // Attendance is now a fact, and it is its own number (rounded to the
      // four decimals the engine publishes, so a rate is stable to compare).
      engine.recordAttendance(mine.id, true, NOW);
      engine.recordAttendance(mine.id, false, NOW);
      engine.recordAttendance(mine.id, true, NOW);
      expect(engine.attendanceRate(mine.id)).toBe(0.6667);

      // Interruption and return: leave, then back — the spec's dropout/return.
      engine.transitionEnrollment(mine.id, "leave", NOW, "family illness");
      expect(() => engine.recordAttendance(mine.id, true, NOW)).toThrow(/is leave/);
      engine.transitionEnrollment(mine.id, "enrolled", NOW, "returned");
      engine.recordAttendance(mine.id, true, NOW);
      expect(engine.attendanceRate(mine.id)).toBe(0.75);
      // A completed enrollment is terminal.
      engine.assess(mine.id, 0.7, "TEACHER-ARDEN-MILL-1", NOW, "practical passed");
      engine.complete(mine.id, NOW);
      expect(() => engine.transitionEnrollment(mine.id, "enrolled", NOW, "back again")).toThrow(
        /no further change/,
      );
    });
  });

  it("assesses, certifies, and lets recognition vary by authority", () => {
    const sim = newWorld();
    const ids = new IdAllocator();
    withEducation(sim, (engine) => {
      const mine = engine.apply(
        ids,
        { studentId: student("PER-TEST-2"), programId: AURELIA_MILLING_COURSE },
        NOW,
      );
      // A credential cannot exist before an assessment and a completion.
      expect(() =>
        engine.issueCredential(ids, { enrollmentId: mine.id, recognizedBy: ["AUTH-ARDIN"] }, NOW),
      ).toThrow(/is applied and cannot be certified/);
      engine.admit(mine.id, NOW);
      engine.enroll(mine.id, NOW);
      expect(() => engine.complete(mine.id, NOW)).toThrow(/no assessment on record/);

      // The institution's own score, with a named assessor: an opinion, not
      // competence (System 14's truth).
      const graded = engine.assess(
        mine.id,
        0.82,
        "TEACHER-ARDEN-MILL-1",
        NOW,
        "written and practical",
      );
      expect(graded.assessment?.score).toBe(0.82);
      expect(graded.assessment?.assessorId).toBe("TEACHER-ARDEN-MILL-1");
      expect(() => engine.assess(mine.id, 1.4, "TEACHER-ARDEN-MILL-1", NOW)).toThrow(/score/);
      expect(() => engine.assess(mine.id, 0.5, "  ", NOW)).toThrow(/assessorId/);

      engine.complete(mine.id, NOW);
      const credential = engine.issueCredential(
        ids,
        { enrollmentId: mine.id, recognizedBy: ["AUTH-ARDIN", "AUTH-CALDOR"] },
        NOW,
      );
      expect(credential.awardedScore).toBe(0.82);
      expect(engine.credentialsOf("PER-TEST-2")).toHaveLength(1);
      // Recognition varies: the mill recognizes it, Veyra does not.
      expect(engine.isCredentialRecognized(credential.id, "AUTH-ARDIN")).toBe(true);
      expect(engine.isCredentialRecognized(credential.id, "AUTH-VEYRA")).toBe(false);
      // A second certificate for the same course is not issued.
      expect(() =>
        engine.issueCredential(ids, { enrollmentId: mine.id, recognizedBy: ["AUTH-ARDIN"] }, NOW),
      ).toThrow(/already holds a live/);

      // Revocation ends recognition everywhere, with the reason kept.
      engine.revokeCredential(credential.id, NOW, "assessment re-marked down");
      expect(engine.isCredentialRecognized(credential.id, "AUTH-ARDIN")).toBe(false);
      expect(engine.credential(credential.id)?.revocationReason).toMatch(/re-marked/);
      expect(() => engine.revokeCredential(credential.id, NOW, "again")).toThrow(/already revoked/);
    });
  });

  it("moves a student between programs, keeping both ends of the move", () => {
    const sim = newWorld();
    const ids = new IdAllocator();
    withEducation(sim, (engine) => {
      const mine = engine.apply(
        ids,
        { studentId: student("PER-TEST-3"), programId: AURELIA_STEVEDORE_PROGRAM },
        NOW,
      );
      engine.admit(mine.id, NOW);
      engine.enroll(mine.id, NOW);
      expect(() => engine.transfer(ids, mine.id, AURELIA_STEVEDORE_PROGRAM, NOW)).toThrow(
        /is already on/,
      );

      const arrival = engine.transfer(ids, mine.id, AURELIA_MILLING_COURSE, NOW);
      expect(arrival.status).toBe("admitted");
      expect(arrival.transferredFromProgramId).toBe(AURELIA_STEVEDORE_PROGRAM);
      expect(arrival.history[0]?.note).toMatch(/transferred from/);
      // The origin keeps its own record: a transfer is not an erasure.
      expect(engine.enrollment(mine.id)?.status).toBe("transferred");
      expect(engine.enrollment(mine.id)?.history.at(-1)?.note).toMatch(/moved to/);
      // Both sides count the student, each in its own program.
      expect(engine.classSize(AURELIA_STEVEDORE_PROGRAM)).toBe(0);
      expect(engine.classSize(AURELIA_MILLING_COURSE)).toBe(1);
      expect(engine.enrollmentsOf("PER-TEST-3")).toHaveLength(2);
    });
  });

  it("admits only as many students as it has seats", () => {
    const sim = newWorld();
    const ids = new IdAllocator();
    withEducation(sim, (engine) => {
      // The milling course has eight seats; fill it and try once more.
      for (let index = 0; index < 8; index += 1) {
        const enrollment = engine.apply(
          ids,
          { studentId: student(`PER-CAP-${index}`), programId: AURELIA_MILLING_COURSE },
          NOW,
        );
        engine.admit(enrollment.id, NOW);
      }
      expect(engine.classSize(AURELIA_MILLING_COURSE)).toBe(8);
      expect(engine.availableSeats(AURELIA_MILLING_COURSE)).toBe(0);
      const ninth = engine.apply(
        ids,
        { studentId: student("PER-CAP-9"), programId: AURELIA_MILLING_COURSE },
        NOW,
      );
      expect(() => engine.admit(ninth.id, NOW)).toThrow(/is full \(8 of 8 seats\)/);
      // A student who gives up their seat frees it for the next one.
      const leaving = engine.enrollmentsIn(AURELIA_MILLING_COURSE)[0];
      expect(leaving).toBeDefined();
      engine.transitionEnrollment(leaving?.id as string, "withdrawn", NOW, "found work");
      expect(engine.availableSeats(AURELIA_MILLING_COURSE)).toBe(1);
      expect(engine.admit(ninth.id, NOW).status).toBe("admitted");
      // Retention is derived from the enrollments, not asserted.
      expect(engine.retentionRate(AURELIA_MILLING_COURSE)).toBeUndefined();
    });
  });

  it("keeps education state under single ownership and in the save format", () => {
    const sim = newWorld();

    const reader = new EducationEngine(sim.scope, sim.world);
    expect(reader.programs()).toHaveLength(AURELIA_SLICE_PROGRAM_COUNT);
    expect(() => reader.enroll("enr-NOT-REAL", NOW)).toThrow(MissingWriterContextError);
    expect(() =>
      sim.guard.mutate("markets", () => {
        new EducationEngine(sim.scope, sim.world).enroll("enr-NOT-REAL", NOW);
      }),
    ).toThrow(OwnershipViolationError);

    const bag = (sim.serializedWorld() as { readonly systems?: Record<string, unknown> }).systems;
    expect(bag?.["education"]).toBeDefined();
    const state = bag?.["education"] as {
      readonly programs: readonly unknown[];
      readonly enrollments: readonly unknown[];
      readonly credentials: readonly unknown[];
    };
    expect(state.programs).toHaveLength(AURELIA_SLICE_PROGRAM_COUNT);
    expect(state.enrollments).toHaveLength(1);
    expect(state.credentials).toHaveLength(0);
  });
});
