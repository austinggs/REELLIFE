/**
 * Provisional education content for the Arden slice (M5 / System 23).
 *
 * The World Bible authors no schools, curricula or credentials (deferred
 * canon), and the slice has no civic or educational organization to run one.
 * So this module authors only what the slice's *existing* content already
 * implies: the **docks' stevedore certification** (a working port with 140
 * shift workers, a stated shift rotation and a "harbour pilotage"
 * operation trains the people it needs), and the **mill bakery's
 * flour-milling course** (a bakery whose operations are authored as
 * "mill, bake overnight, sell at dawn"). Both institutions are real System 32
 * organizations in the slice — no new school was invented to hold them.
 *
 * The player's seeded application is left at `applied`: education creates
 * the opportunity, and whether the player takes it is System 17's decision,
 * not the seed's. Teacher ids are free-text because System 24 owns
 * employment records and System 14 owns competence; this system only records
 * that a name is assigned. Every record is flagged `provisional`.
 */

import type {
  DefineProgramRequest,
  EducationEngine,
} from "../../engine/education/engine.ts";
import type { EntityId, IdAllocator } from "../../engine/primitives/ids.ts";
import { currencyId, money } from "../../engine/primitives/money.ts";
import type { WorldTime } from "../../engine/primitives/time.ts";
import { AURELIA_CURRENCY } from "./countries.ts";
import { M2_SETTLEMENT_ID } from "./geography.ts";

const AUR = currencyId(AURELIA_CURRENCY.code);
const aur = (major: number): number => Math.round(major * 100);

const PROVISIONAL_NOTE =
  "Provisional: the World Bible authors no schools, curricula or credentials (M5/S23 gap list).";

export const AURELIA_STEVEDORE_PROGRAM = "EDU-ARDEN-STEVEDORE-CERT";
export const AURELIA_MILLING_COURSE = "EDU-ARDEN-MILLING-COURSE";
export const AURELIA_SLICE_PROGRAM_COUNT = 2;

/** The slice's programs, both run by slice organizations that need the work. */
export function aureliaArdenPrograms(): readonly DefineProgramRequest[] {
  return [
    {
      id: AURELIA_STEVEDORE_PROGRAM,
      institutionOrgId: "ORG-ARDIN-DOCKS",
      name: "Stevedore certification",
      qualificationSlug: "CERT-STEVEDORE",
      locationId: M2_SETTLEMENT_ID,
      // Twenty seats for 140 shift workers: a working port trains its gangs
      // in cohorts, and not everyone gets a berth on a gang.
      capacityUnits: 20,
      durationTerms: 2,
      cost: money(AUR, aur(25)),
      entryRequirements: ["age_18", "medical_fitness"],
      teacherIds: ["TEACHER-ARDEN-QUAYSIDE-1"],
      provisional: true,
      note: PROVISIONAL_NOTE,
    },
    {
      id: AURELIA_MILLING_COURSE,
      institutionOrgId: "ORG-ARDEN-MILL-BAKERY",
      name: "Flour milling basics",
      qualificationSlug: "CERT-MILLING",
      locationId: M2_SETTLEMENT_ID,
      capacityUnits: 8,
      durationTerms: 1,
      cost: money(AUR, aur(8)),
      entryRequirements: ["age_16"],
      teacherIds: ["TEACHER-ARDEN-MILL-1"],
      provisional: true,
      note: PROVISIONAL_NOTE,
    },
  ];
}

/**
 * Registers the slice's programs. Idempotent: an existing program is left
 * alone, so re-seeding never re-defines a course mid-cohort.
 */
export function registerAureliaEducation(engine: EducationEngine): { readonly programs: number } {
  let programs = 0;
  for (const request of aureliaArdenPrograms()) {
    if (engine.program(request.id) !== undefined) continue;
    engine.defineProgram(request);
    programs += 1;
  }
  return { programs };
}

/**
 * The player's opening application — an opportunity, not an outcome. Only
 * records an application that does not already exist, so re-seeding never
 * duplicates it and never enrolls the player by surprise.
 */
export function registerAureliaPlayerApplication(
  engine: EducationEngine,
  ids: IdAllocator,
  studentId: EntityId<"person">,
  now: WorldTime,
): boolean {
  const existing = engine.enrollmentsOf(studentId);
  if (existing.some((enrollment) => enrollment.programId === AURELIA_STEVEDORE_PROGRAM)) {
    return false;
  }
  engine.apply(ids, { studentId, programId: AURELIA_STEVEDORE_PROGRAM }, now);
  return true;
}
