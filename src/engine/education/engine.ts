/**
 * Education engine (System 23).
 *
 * Owns `systems.education`: programs, enrollments (with the spec's full
 * state graph), attendance and institutional assessments, and the
 * credentials handed out at the end. Every write asserts ownership on that
 * slot; reads are scope-free.
 *
 * Nothing here decides what a person can do. Grades are the institution's
 * own opinion, credentials are formal recognition with named recognising
 * authorities, and the access assessment weighs the spec's own list of
 * barriers so that a refusal can always be explained by name.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { EntityId, IdAllocator } from "../primitives/ids.ts";
import type { Money } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";
import {
  ACCESS_WEIGHTS,
  ENROLLMENT_TRANSITIONS,
  SEAT_HOLDING_STATUSES,
  type AccessAssessment,
  type AccessInputs,
  type Credential,
  type EducationSystemState,
  type Enrollment,
  type EnrollmentStatus,
  type Program,
} from "./types.ts";

/** Score at or above which access counts as open (provisional). */
export const ACCESS_THRESHOLD = 0.5;
/** Any single access input below this counts as a named blocker. */
export const ACCESS_BLOCKER_FLOOR = 0.35;

export interface DefineProgramRequest {
  readonly id: string;
  readonly institutionOrgId: string;
  readonly name: string;
  readonly qualificationSlug: string;
  readonly locationId: string;
  readonly capacityUnits: number;
  readonly durationTerms: number;
  readonly cost: Money;
  readonly entryRequirements?: readonly string[];
  readonly teacherIds?: readonly string[];
  readonly provisional?: boolean;
  readonly note?: string;
}

export interface IssueCredentialRequest {
  readonly enrollmentId: string;
  readonly recognizedBy: readonly string[];
  readonly note?: string;
}

/**
 * Weighs access from the spec's own list of what it depends on. Burden-type
 * inputs (distance, family duties, employment load) are inverted so that
 * "more" always means "worse", every weight is declared, and anything below
 * the blocker floor is reported by name — an institution that refuses a
 * student can say exactly what stood in the way.
 */
export function assessAccess(inputs: AccessInputs): AccessAssessment {
  const burden: Readonly<Record<string, number | undefined>> = {
    distanceBurden: inputs.distanceBurden,
    familyDuties: inputs.familyDuties,
    employmentLoad: inputs.employmentLoad,
  };
  const capability: Readonly<Record<string, number | undefined>> = {
    transportAccess: inputs.transportAccess,
    affordability: inputs.affordability,
    resources: inputs.resources,
    accommodation: inputs.accommodation,
    legalEligibility: inputs.legalEligibility,
    languageFit: inputs.languageFit,
    childcare: inputs.childcare,
    safety: inputs.safety,
  };
  let score = 0;
  const blockers: string[] = [];
  for (const [field, value] of Object.entries(burden)) {
    const weight = ACCESS_WEIGHTS[field as keyof typeof ACCESS_WEIGHTS];
    if (weight === undefined || value === undefined) continue;
    const effective = 1 - value;
    score += weight * effective;
    if (effective < ACCESS_BLOCKER_FLOOR) blockers.push(field);
  }
  for (const [field, value] of Object.entries(capability)) {
    const weight = ACCESS_WEIGHTS[field as keyof typeof ACCESS_WEIGHTS];
    if (weight === undefined || value === undefined) continue;
    score += weight * value;
    if (value < ACCESS_BLOCKER_FLOOR) blockers.push(field);
  }
  return {
    score: round4(clamp01(score)),
    accessible: score >= ACCESS_THRESHOLD,
    blockers,
  };
}

export class EducationEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.education) {
      this.scope.assertOwner("education");
      this.world.systems.education = {
        programs: [],
        enrollments: [],
        credentials: [],
      } satisfies EducationSystemState;
    }
  }

  private get state(): EducationSystemState {
    return this.world.systems.education as EducationSystemState;
  }

  private set state(value: EducationSystemState) {
    this.world.systems.education = value;
  }

  // ---------------------------------------------------------------- reads ---

  programs(): readonly Program[] {
    return this.state.programs;
  }

  program(id: string): Program | undefined {
    return this.state.programs.find((candidate) => candidate.id === id);
  }

  requireProgram(id: string, caller: string): Program {
    const found = this.program(id);
    if (found === undefined) {
      throw new Error(`EducationEngine.${caller}: unknown program ${id}`);
    }
    return found;
  }

  /** Programs a place runs (a System 32 organization may run several). */
  programsOf(institutionOrgId: string): readonly Program[] {
    return this.state.programs.filter((program) => program.institutionOrgId === institutionOrgId);
  }

  enrollments(): readonly Enrollment[] {
    return this.state.enrollments;
  }

  enrollment(id: string): Enrollment | undefined {
    return this.state.enrollments.find((candidate) => candidate.id === id);
  }

  requireEnrollment(id: string, caller: string): Enrollment {
    const found = this.enrollment(id);
    if (found === undefined) {
      throw new Error(`EducationEngine.${caller}: unknown enrollment ${id}`);
    }
    return found;
  }

  enrollmentsOf(studentId: string): readonly Enrollment[] {
    return this.state.enrollments.filter((candidate) => candidate.studentId === studentId);
  }

  enrollmentsIn(programId: string): readonly Enrollment[] {
    return this.state.enrollments.filter((candidate) => candidate.programId === programId);
  }

  credentials(): readonly Credential[] {
    return this.state.credentials;
  }

  credential(id: string): Credential | undefined {
    return this.state.credentials.find((candidate) => candidate.id === id);
  }

  credentialsOf(studentId: string): readonly Credential[] {
    return this.state.credentials.filter((candidate) => candidate.studentId === studentId);
  }

  // -------------------------------------------------------------- derived ---

  /** Students currently holding a seat in a program. */
  classSize(programId: string): number {
    return this.enrollmentsIn(programId).filter((enrollment) =>
      SEAT_HOLDING_STATUSES.includes(enrollment.status),
    ).length;
  }

  /** Seats the institution can still offer — its teacher capacity, stated. */
  availableSeats(programId: string): number {
    const program = this.requireProgram(programId, "availableSeats");
    return Math.max(0, program.capacityUnits - this.classSize(programId));
  }

  /**
   * Attendance as its own fact. A student can hold a seat and never attend;
   * the spec insists these are different things, so a rate exists only
   * once a session has been recorded either way.
   */
  attendanceRate(enrollmentId: string): number | undefined {
    const enrollment = this.requireEnrollment(enrollmentId, "attendanceRate");
    const sessions = enrollment.attendedSessions + enrollment.missedSessions;
    if (sessions === 0) return undefined;
    return round4(enrollment.attendedSessions / sessions);
  }

  /**
   * Retention: completed over everyone who finished or left badly. Derived
   * from the enrollments themselves, so a program's dropout rate cannot be
   * quoted differently from its roster.
   */
  retentionRate(programId: string): number | undefined {
    const finished = this.enrollmentsIn(programId).filter((enrollment) =>
      ["completed", "dropped", "expelled"].includes(enrollment.status),
    );
    if (finished.length === 0) return undefined;
    const completed = finished.filter((enrollment) => enrollment.status === "completed").length;
    return round4(completed / finished.length);
  }

  /** Whether a named authority recognises this credential (recognition varies). */
  isCredentialRecognized(credentialId: string, authorityId: string): boolean {
    const credential = this.credential(credentialId);
    if (credential === undefined) {
      throw new Error(`EducationEngine.isCredentialRecognized: unknown credential ${credentialId}`);
    }
    return credential.revokedAt === undefined && credential.recognizedBy.includes(authorityId);
  }

  // --------------------------------------------------------------- writes ---

  /**
   * Defines a program. The institution must be a real organization (System
   * 32) when that registry is present: the spec says institutions *are*
   * organizations, and a floating program would be one that cannot employ
   * a teacher or be held to account.
   */
  defineProgram(request: DefineProgramRequest): Program {
    this.scope.assertOwner("education");
    if (this.program(request.id) !== undefined) {
      throw new Error(`EducationEngine.defineProgram: program ${request.id} already exists`);
    }
    requirePositiveInteger(request.capacityUnits, "capacityUnits", "defineProgram");
    requirePositiveInteger(request.durationTerms, "durationTerms", "defineProgram");
    if (request.cost.minorUnits < 0) {
      throw new Error("EducationEngine.defineProgram: cost must not be negative");
    }
    if (request.qualificationSlug.trim().length === 0) {
      throw new Error("EducationEngine.defineProgram: qualificationSlug must not be empty");
    }
    if (!this.knownOrganization(request.institutionOrgId)) {
      throw new Error(
        `EducationEngine.defineProgram: ${request.institutionOrgId} is not a registered organization (System 32)`,
      );
    }
    const program: Program = {
      id: request.id,
      institutionOrgId: request.institutionOrgId,
      name: request.name,
      qualificationSlug: request.qualificationSlug,
      locationId: request.locationId,
      capacityUnits: request.capacityUnits,
      durationTerms: request.durationTerms,
      cost: request.cost,
      entryRequirements: [...(request.entryRequirements ?? [])],
      teacherIds: [...(request.teacherIds ?? [])],
      ...(request.provisional === undefined ? {} : { provisional: request.provisional }),
      ...(request.note === undefined ? {} : { note: request.note }),
    };
    this.state = { ...this.state, programs: [...this.state.programs, program] };
    return program;
  }

  /**
   * An application: the spec's first state. Recording the access assessment
   * with it means the reasons a seat may be refused later were visible from
   * the start — access inequality is not a mystery, it is a record.
   */
  apply(
    ids: IdAllocator,
    request: {
      readonly studentId: EntityId<"person">;
      readonly programId: string;
      readonly access?: AccessInputs;
    },
    at: WorldTime,
  ): Enrollment {
    this.scope.assertOwner("education");
    this.requireProgram(request.programId, "apply");
    const duplicate = this.state.enrollments.find(
      (candidate) =>
        candidate.programId === request.programId &&
        candidate.studentId === request.studentId &&
        ["applied", "admitted", "enrolled", "active", "suspended", "leave"].includes(
          candidate.status,
        ),
    );
    if (duplicate !== undefined) {
      throw new Error(
        `EducationEngine.apply: ${request.studentId} already holds ${duplicate.status} on ${request.programId}`,
      );
    }
    const access = request.access === undefined ? undefined : assessAccess(request.access);
    const enrollment: Enrollment = {
      id: `enr-${ids.next("activity")}`,
      programId: request.programId,
      studentId: request.studentId,
      status: "applied",
      appliedAt: at,
      attendedSessions: 0,
      missedSessions: 0,
      ...(access === undefined
        ? {}
        : { access: { at, score: access.score, blockers: [...access.blockers] } }),
      history: [
        {
          at,
          kind: "applied",
          note:
            `applied to ${request.programId}` +
            (access === undefined
              ? ""
              : ` (access ${access.score}${
                  access.blockers.length === 0
                    ? ""
                    : `, blocked by ${access.blockers.join(", ")}`
                })`),
        },
      ],
    };
    this.state = { ...this.state, enrollments: [...this.state.enrollments, enrollment] };
    return enrollment;
  }

  /**
   * Admission is where capacity bites: the program may not admit more
   * students than it has seats, and the refusal says so in those words.
   */
  admit(enrollmentId: string, at: WorldTime, note?: string): Enrollment {
    this.scope.assertOwner("education");
    const enrollment = this.requireStatus(enrollmentId, "admitted", "admit");
    if (this.availableSeats(enrollment.programId) <= 0) {
      const program = this.requireProgram(enrollment.programId, "admit");
      throw new Error(
        `EducationEngine.admit: ${program.id} is full (${this.classSize(program.id)} of ${program.capacityUnits} seats)`,
      );
    }
    return this.replace({
      ...enrollment,
      status: "admitted",
      history: [...enrollment.history, { at, kind: "admitted", note: note ?? "seat offered" }],
    });
  }

  /** Enrols an admitted student: the seat becomes theirs, dated. */
  enroll(enrollmentId: string, at: WorldTime, note?: string): Enrollment {
    this.scope.assertOwner("education");
    const enrollment = this.requireStatus(enrollmentId, "enrolled", "enroll");
    return this.replace({
      ...enrollment,
      status: "enrolled",
      enrolledAt: at,
      history: [...enrollment.history, { at, kind: "enrolled", note: note ?? "enrolled" }],
    });
  }

  /**
   * Records one session as attended or missed. Attendance is a fact about a
   * room, and only a student actually enrolled has one to be in — which is
   * why this is a separate method from `enroll`, not a field on it.
   */
  recordAttendance(enrollmentId: string, present: boolean, at: WorldTime): Enrollment {
    this.scope.assertOwner("education");
    const enrollment = this.requireEnrollment(enrollmentId, "recordAttendance");
    if (!["enrolled", "active"].includes(enrollment.status)) {
      throw new Error(
        `EducationEngine.recordAttendance: ${enrollmentId} is ${enrollment.status}, not enrolled or active`,
      );
    }
    return this.replace({
      ...enrollment,
      attendedSessions: enrollment.attendedSessions + (present ? 1 : 0),
      missedSessions: enrollment.missedSessions + (present ? 0 : 1),
      lastAttendanceAt: at,
    });
  }

  /**
   * The institution's assessment — the spec's "grades are institutional
   * assessments, not objective skill truth", kept as the institution's own
   * scored opinion with a named assessor. Nothing here feeds System 14.
   */
  assess(
    enrollmentId: string,
    score: number,
    assessorId: string,
    at: WorldTime,
    note?: string,
  ): Enrollment {
    this.scope.assertOwner("education");
    requireRatio(score, "score", "assess");
    if (assessorId.trim().length === 0) {
      throw new Error("EducationEngine.assess: assessorId must not be empty");
    }
    const enrollment = this.requireEnrollment(enrollmentId, "assess");
    if (!["enrolled", "active", "suspended", "leave"].includes(enrollment.status)) {
      throw new Error(`EducationEngine.assess: ${enrollmentId} is ${enrollment.status}`);
    }
    return this.replace({
      ...enrollment,
      assessment: {
        at,
        score,
        assessorId,
        ...(note === undefined ? {} : { note }),
      },
      history: [
        ...enrollment.history,
        { at, kind: "assessed", note: `${score} by ${assessorId}${note === undefined ? "" : ` — ${note}`}` },
      ],
    });
  }

  /** Completion is a progression: it requires an assessment to stand on. */
  complete(enrollmentId: string, at: WorldTime, note?: string): Enrollment {
    this.scope.assertOwner("education");
    const enrollment = this.requireStatus(enrollmentId, "completed", "complete");
    if (enrollment.assessment === undefined) {
      throw new Error(`EducationEngine.complete: ${enrollmentId} has no assessment on record`);
    }
    return this.replace({
      ...enrollment,
      status: "completed",
      history: [...enrollment.history, { at, kind: "completed", note: note ?? "course completed" }],
    });
  }

  /**
   * Issues a credential: formal recognition, with the authorities that
   * recognise it named. The awarded score is the institution's grade carried
   * across — not a claim about what the holder can do (System 14's business).
   */
  issueCredential(
    ids: IdAllocator,
    request: IssueCredentialRequest,
    at: WorldTime,
  ): Credential {
    this.scope.assertOwner("education");
    const enrollment = this.requireEnrollment(request.enrollmentId, "issueCredential");
    if (enrollment.status !== "completed" || enrollment.assessment === undefined) {
      throw new Error(
        `EducationEngine.issueCredential: ${request.enrollmentId} is ${enrollment.status} and cannot be certified`,
      );
    }
    const already = this.state.credentials.some(
      (credential) => credential.programId === enrollment.programId &&
        credential.studentId === enrollment.studentId &&
        credential.revokedAt === undefined,
    );
    if (already) {
      throw new Error(
        `EducationEngine.issueCredential: ${enrollment.studentId} already holds a live ${enrollment.programId} credential`,
      );
    }
    const program = this.requireProgram(enrollment.programId, "issueCredential");
    const credential: Credential = {
      id: `cred-${ids.next("activity")}`,
      studentId: enrollment.studentId,
      programId: program.id,
      qualificationSlug: program.qualificationSlug,
      issuedAt: at,
      awardedScore: (enrollment.assessment as { readonly score: number }).score,
      recognizedBy: [...request.recognizedBy],
      ...(request.note === undefined ? {} : { note: request.note }),
    };
    this.state = { ...this.state, credentials: [...this.state.credentials, credential] };
    return credential;
  }

  /** Recognition withdrawn, with a reason. The credential stays on record. */
  revokeCredential(credentialId: string, at: WorldTime, reason: string): Credential {
    this.scope.assertOwner("education");
    const credential = this.credential(credentialId);
    if (credential === undefined) {
      throw new Error(`EducationEngine.revokeCredential: unknown credential ${credentialId}`);
    }
    if (credential.revokedAt !== undefined) {
      throw new Error(`EducationEngine.revokeCredential: ${credentialId} was already revoked`);
    }
    const revoked: Credential = { ...credential, revokedAt: at, revocationReason: reason };
    this.state = {
      ...this.state,
      credentials: this.state.credentials.map((candidate) =>
        candidate.id === credentialId ? revoked : candidate,
      ),
    };
    return revoked;
  }

  /**
   * A transfer: the old enrollment closes as `transferred` and a new one
   * opens at the destination, carrying the origin. Interruption and transfer
   * are therefore both visible in one student's history, as the spec asks.
   */
  transfer(ids: IdAllocator, enrollmentId: string, toProgramId: string, at: WorldTime): Enrollment {
    this.scope.assertOwner("education");
    const enrollment = this.requireStatus(enrollmentId, "transferred", "transfer");
    if (enrollment.programId === toProgramId) {
      throw new Error(`EducationEngine.transfer: ${enrollmentId} is already on ${toProgramId}`);
    }
    const destination = this.requireProgram(toProgramId, "transfer");
    if (this.availableSeats(toProgramId) <= 0) {
      throw new Error(
        `EducationEngine.transfer: ${destination.id} is full (${this.classSize(destination.id)} of ${destination.capacityUnits} seats)`,
      );
    }
    this.replace({
      ...enrollment,
      status: "transferred",
      history: [
        ...enrollment.history,
        { at, kind: "transferred", note: `moved to ${toProgramId}` },
      ],
    });
    const arrival: Enrollment = {
      id: `enr-${ids.next("activity")}`,
      programId: toProgramId,
      studentId: enrollment.studentId,
      status: "admitted",
      appliedAt: at,
      enrolledAt: enrollment.enrolledAt,
      attendedSessions: 0,
      missedSessions: 0,
      transferredFromProgramId: enrollment.programId,
      history: [
        { at, kind: "admitted", note: `transferred from ${enrollment.programId}` },
      ],
    };
    this.state = { ...this.state, enrollments: [...this.state.enrollments, arrival] };
    return arrival;
  }

  /** Moves an enrollment along the spec's state graph, with a note. */
  transitionEnrollment(
    enrollmentId: string,
    status: EnrollmentStatus,
    at: WorldTime,
    note: string,
  ): Enrollment {
    this.scope.assertOwner("education");
    const enrollment = this.requireStatus(enrollmentId, status, "transitionEnrollment");
    return this.replace({
      ...enrollment,
      status,
      history: [...enrollment.history, { at, kind: status, note }],
    });
  }

  // -------------------------------------------------------------- private ---

  private replace(updated: Enrollment): Enrollment {
    this.state = {
      ...this.state,
      enrollments: this.state.enrollments.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      ),
    };
    return updated;
  }

  /** The enrollment must be in a status that can move to `target`. */
  private requireStatus(
    enrollmentId: string,
    target: EnrollmentStatus,
    caller: string,
  ): Enrollment {
    const enrollment = this.requireEnrollment(enrollmentId, caller);
    if (enrollment.status === target) return enrollment;
    const allowed = ENROLLMENT_TRANSITIONS[enrollment.status];
    if (!allowed.includes(target)) {
      throw new Error(
        `EducationEngine.${caller}: ${enrollmentId} is ${enrollment.status}; the lifecycle allows ${
          allowed.length === 0 ? "no further change" : allowed.join(" or ")
        }`,
      );
    }
    return enrollment;
  }

  /**
   * Cross-system reference check (read-only): institutions are Organizations
   * (System 32), so when that registry is present a program may not name one
   * that does not exist.
   */
  private knownOrganization(id: string): boolean {
    const state = this.world.systems.organizations as
      | { readonly organizations: readonly { readonly id: string }[] }
      | undefined;
    if (state === undefined) return true;
    return state.organizations.some((organization) => organization.id === id);
  }
}

// --------------------------------------------------------------- helpers ---

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function requireRatio(value: number, field: string, caller: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `EducationEngine.${caller}: ${field} must be in [0, 1], received ${String(value)}`,
    );
  }
}

function requirePositiveInteger(value: number, field: string, caller: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `EducationEngine.${caller}: ${field} must be a positive integer, received ${String(value)}`,
    );
  }
}

