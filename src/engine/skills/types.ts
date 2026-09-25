import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";

/**
 * ReelLife System 14 — Skills & Competence.
 *
 * Skill is what a person has learned and can demonstrate under conditions —
 * not an abstract destiny score. This system owns skill definitions and
 * per-person skill state: proficiency, practice, experience, familiarity,
 * reliability, specialization, mastery, learning/decay and demonstrated
 * competence.
 *
 * Experience and skill are deliberately distinct: experience is accumulated
 * lifetime hours (never decreases), proficiency is current demonstrated
 * capability (decays without practice). Certification is recognition, not a
 * synonym for competence — it records that an institution acknowledged a
 * level; it never alters the capability stored here (architectural law 4).
 */

/**
 * Where learning came from. Methods weight the practical/theoretical split
 * differently (see LEARNING_METHOD_WEIGHTS in the engine); the kind is
 * recorded so education/employment systems can drive structured learning.
 */
export type LearningMethod =
  | "education"
  | "practice"
  | "employment"
  | "apprenticeship"
  | "mentorship"
  | "observation"
  | "reading"
  | "experimentation"
  | "hobby"
  | "failure"
  | "teaching";

/** Link to a related skill; transferability is 0..1 learning bleed-through. */
export interface RelatedSkillLink {
  readonly skillId: string;
  readonly transferability: number;
}

/**
 * Static definition of a skill. Definitions are data-driven content owned by
 * this system; the list is open (content files may add skills) and the
 * engine treats them uniformly.
 */
export interface SkillDefinition {
  readonly id: string;
  readonly name: string;
  /** Broad domain tag ("craft", "reasoning", "social", ...). Not an owner. */
  readonly domain: string;
  /** Parent skill id when this is a subskill; makes skills hierarchical. */
  readonly parentId?: string;
  readonly subskillIds: readonly string[];
  /** Skill ids that should exist before structured learning starts. */
  readonly prerequisites: readonly string[];
  readonly relatedSkills: readonly RelatedSkillLink[];
  readonly learningMethods: readonly LearningMethod[];
  /** Fraction of practical proficiency lost per day without practice. */
  readonly decayRatePerDay: number;
  /** Practical proficiency at which the skill counts as mastered (derived). */
  readonly masteryThreshold: number;
  /** External certification identifiers that recognise this skill. */
  readonly certificationLinks: readonly string[];
}

/**
 * An issued certification. This is a record of recognition by an
 * institution — explicitly NOT capability. A person can hold a "master"
 * certificate with low practical proficiency; realized performance reads
 * the capability, not the certificate.
 */
export interface SkillCertification {
  readonly id: string;
  readonly issuerOrgId: string;
  readonly issuedAt: WorldTime;
  /** Free-form level label ("beginner" | "journeyman" | "master" | ...). */
  readonly level: string;
}

export interface PersonSkillState {
  readonly skillId: string;
  /** Demonstrated capability, 0..1. Decays without practice. */
  readonly practical: number;
  /** Understanding, 0..1. Decays slower than practical. */
  readonly theoretical: number;
  /** Exposure/recognition, 0..1. Decays slowest. */
  readonly familiarity: number;
  /** Consistency under pressure, 0..1. Lags practical; erodes faster. */
  readonly reliability: number;
  /** Accumulated lifetime practice hours. Never decreases. */
  readonly experienceHours: number;
  /** Deliberate narrow focus depth, 0..1. Raised only via specialize(). */
  readonly specialization: number;
  /** Highest practical ever reached. Drives faster relearning after decay. */
  readonly peakPractical: number;
  readonly lastPracticedAt: WorldTime;
  /** Recognition records only — never alter practical. */
  readonly certifications: readonly SkillCertification[];
}

export interface PersonSkillsState {
  readonly personId: EntityId<"person">;
  readonly skills: readonly PersonSkillState[];
}

export interface SkillsSystemState {
  readonly definitions: readonly SkillDefinition[];
  readonly persons: readonly PersonSkillsState[];
}

/** Caller-supplied learning context (aptitude comes from System 13). */
export interface PracticeFactors {
  /** 0..1 domain aptitude; defaults to 0.5 (neutral) when omitted. */
  readonly aptitude?: number;
  /** 0..1 quality of instruction; defaults to 0.5 when omitted. */
  readonly instruction?: number;
}

export interface PracticeTransfer {
  readonly skillId: string;
  readonly gained: number;
}

export interface PracticeResult {
  readonly skillId: string;
  readonly practicalBefore: number;
  readonly practicalAfter: number;
  readonly theoreticalAfter: number;
  readonly experienceHours: number;
  readonly transferred: readonly PracticeTransfer[];
}

/**
 * The conditions a performance happens under. Performance is contextual:
 * health, mental state, fatigue, equipment, difficulty, preparation,
 * environment and uncertainty all shape the realized outcome.
 */
export interface PerformanceContext {
  /** 0..1 required proficiency for the task to succeed. */
  readonly difficulty: number;
  /** 0..1 */
  readonly healthFactor: number;
  /** 0..1 */
  readonly mentalFactor: number;
  /** 0..1 */
  readonly fatigue: number;
  /** 0..1 */
  readonly equipmentQuality: number;
  /** 0..1 */
  readonly preparation: number;
  /** 0..1, where 1 is an ideal environment. */
  readonly environment: number;
  /** 0..1 how aligned the task is with the person's declared specialty. */
  readonly specialtyFit: number;
  /** 0..1 spread of the realized outcome around the expected performance. */
  readonly uncertainty: number;
}

export interface PerformanceOutcome {
  /** Context-adjusted expected performance, 0..1. */
  readonly expected: number;
  /** The realized performance draw, 0..1. */
  readonly outcome: number;
  readonly success: boolean;
}
