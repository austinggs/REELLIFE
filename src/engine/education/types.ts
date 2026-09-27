/**
 * System 23 — Education.
 *
 * "Education creates structured opportunities for learning; it does not
 * guarantee the outcome" (System 23 core principle).
 *
 * The system owns the *institution's* side of learning and is explicit
 * about what it is not:
 *
 *   1. **A grade is an institutional assessment, not skill truth.** System
 *      14 owns competence and System 12 owns aptitude; a credential here is
 *      "formal recognition", recorded with who recognises it, and nothing
 *      here feeds back into what a person *can do*.
 *   2. **Attendance is not enrollment.** The spec names them separately, so
 *      they are separate facts: a seat says a person is registered, a rate
 *      says they were ever in the room.
 *   3. **Access is a real constraint, and its causes are named.** Distance,
 *      transport, cost, resources, capacity, disability, law, language,
 *      family duties, employment, childcare and safety are the spec's own
 *      list, so each is an input to one declared assessment rather than a
 *      hidden modifier on an admission number.
 *   4. **Institutions are Organizations** (System 32), and a program may not
 *      name one that does not exist.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { Money } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";

/** The spec's enrollment states, exactly as listed. */
export const ENROLLMENT_STATUSES = [
  "applied",
  "admitted",
  "enrolled",
  "active",
  "suspended",
  "leave",
  "withdrawn",
  "dropped",
  "completed",
  "expelled",
  "transferred",
  "deferred",
] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

/** Which status moves are legal (the spec's states, as a graph). */
export const ENROLLMENT_TRANSITIONS: Readonly<Record<EnrollmentStatus, readonly EnrollmentStatus[]>> = {
  applied: ["admitted", "deferred", "withdrawn", "dropped"],
  admitted: ["enrolled", "deferred", "withdrawn", "dropped"],
  enrolled: ["active", "suspended", "leave", "withdrawn", "dropped", "completed", "transferred"],
  active: ["suspended", "leave", "withdrawn", "dropped", "completed", "transferred"],
  suspended: ["enrolled", "expelled", "withdrawn"],
  leave: ["enrolled", "withdrawn", "dropped"],
  withdrawn: ["applied"],
  dropped: ["applied"],
  completed: [],
  expelled: [],
  transferred: [],
  deferred: ["applied", "withdrawn"],
};

/** Statuses that occupy a seat (and therefore program capacity). */
export const SEAT_HOLDING_STATUSES: readonly EnrollmentStatus[] = [
  "admitted",
  "enrolled",
  "active",
  "suspended",
  "leave",
];

/** An institutional assessment, kept as the institution's own opinion. */
export interface Assessment {
  readonly at: WorldTime;
  /** 0..1 as the institution scored it. */
  readonly score: number;
  /** Who marked it (a teacher id; System 14 owns competence, not this). */
  readonly assessorId: string;
  readonly note?: string;
}

export interface Enrollment {
  readonly id: string;
  readonly programId: string;
  readonly studentId: EntityId<"person">;
  readonly status: EnrollmentStatus;
  readonly appliedAt: WorldTime;
  readonly enrolledAt?: WorldTime;
  /** Sessions attended and missed — attendance, kept apart from enrollment. */
  readonly attendedSessions: number;
  readonly missedSessions: number;
  readonly lastAttendanceAt?: WorldTime;
  readonly assessment?: Assessment;
  /** The access assessment recorded when the student applied, if supplied. */
  readonly access?: AccessRecord;
  /** Set when the student moved to another program (and where from). */
  readonly transferredFromProgramId?: string;
  readonly history: readonly EnrollmentHistoryEntry[];
}

/** What the access assessment said at the moment of application. */
export interface AccessRecord {
  readonly at: WorldTime;
  readonly score: number;
  readonly blockers: readonly string[];
}

export interface EnrollmentHistoryEntry {
  readonly at: WorldTime;
  readonly kind: string;
  readonly note: string;
}

/** Formal recognition — distinct from competence, by the spec's own words. */
export interface Credential {
  readonly id: string;
  readonly studentId: EntityId<"person">;
  readonly programId: string;
  readonly qualificationSlug: string;
  readonly issuedAt: WorldTime;
  /** The grade the institution awarded, carried onto the credential. */
  readonly awardedScore: number;
  /** Authorities that recognise this qualification (System 41/45 territory). */
  readonly recognizedBy: readonly string[];
  readonly revokedAt?: WorldTime;
  /** Why recognition was withdrawn, when it was. */
  readonly revocationReason?: string;
  readonly note?: string;
}

export interface Program {
  readonly id: string;
  /** The System 32 organization that runs it. */
  readonly institutionOrgId: string;
  readonly name: string;
  /** The credential the program leads to. */
  readonly qualificationSlug: string;
  readonly locationId: string;
  /** Seats; the spec's "capacity" and "teacher capacity" both land here. */
  readonly capacityUnits: number;
  /** How many terms a full course runs. */
  readonly durationTerms: number;
  /** What the program charges (System 25 posts the money, not 23). */
  readonly cost: Money;
  /** Formal entry requirements the institution states. */
  readonly entryRequirements: readonly string[];
  /** Teachers assigned, by id (System 14/24 own their competence). */
  readonly teacherIds: readonly string[];
  readonly provisional?: boolean;
  readonly note?: string;
}

export interface EducationSystemState {
  readonly programs: readonly Program[];
  readonly enrollments: readonly Enrollment[];
  readonly credentials: readonly Credential[];
}

/** The spec's own list of what access depends on, as 0..1 facts. */
export interface AccessInputs {
  /** Distance/travel burden, 0 (close) to 1 (unreachable). */
  readonly distanceBurden?: number;
  /** Whether transport exists at all, 0..1. */
  readonly transportAccess?: number;
  /** Ability to pay the program's cost, 0..1. */
  readonly affordability?: number;
  /** Learning resources available at home, 0..1. */
  readonly resources?: number;
  /** Support needs met, 0..1 (disability and accommodation). */
  readonly accommodation?: number;
  /** Legal eligibility to enrol, 0..1 (System 41's rules, supplied by it). */
  readonly legalEligibility?: number;
  /** Language of instruction understood, 0..1. */
  readonly languageFit?: number;
  /** Family duties competing with study, 0..1. */
  readonly familyDuties?: number;
  /** Competing employment hours, 0..1. */
  readonly employmentLoad?: number;
  /** Childcare available, 0..1. */
  readonly childcare?: number;
  /** Personal safety of the journey and place, 0..1. */
  readonly safety?: number;
}

/** Declared access weights (provisional; see docs/CONTENT_GAPS.md). */
export const ACCESS_WEIGHTS = {
  distanceBurden: 0.12,
  transportAccess: 0.12,
  affordability: 0.14,
  resources: 0.08,
  accommodation: 0.1,
  legalEligibility: 0.14,
  languageFit: 0.08,
  familyDuties: 0.06,
  employmentLoad: 0.06,
  childcare: 0.05,
  safety: 0.05,
} as const;

/** An access assessment: a score plus the named things standing in the way. */
export interface AccessAssessment {
  /** 0..1, weighted across the declared inputs. */
  readonly score: number;
  readonly accessible: boolean;
  /** The inputs that fell below their floor, by name. */
  readonly blockers: readonly string[];
}


