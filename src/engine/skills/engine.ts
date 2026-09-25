/**
 * ReelLife System 14 — Skills & Competence.
 *
 * Learning follows a diminishing-returns curve so spam-practice cannot
 * teleport a skill: each gain is scaled by (1 - currentLevel). Decay is
 * gradual and mastery slows it; because peakPractical is retained, relearning
 * below the peak runs faster than first learning. Practicing one skill bleeds
 * into its related skills at their transferability. Realized performance is
 * always contextual — the same person performs differently under fatigue,
 * poor equipment or a hostile environment — and resolution draws from a
 * caller-supplied seeded stream (law 8), never from ambient randomness.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import { MINUTES_PER_DAY } from "../primitives/time.ts";
import type { RandomSource } from "../rng/distributions.ts";
import { clamp, normal } from "../rng/distributions.ts";
import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type {
  LearningMethod,
  PerformanceContext,
  PerformanceOutcome,
  PersonSkillState,
  PersonSkillsState,
  PracticeFactors,
  PracticeResult,
  SkillCertification,
  SkillDefinition,
  SkillsSystemState,
} from "./types.ts";

/** Practical gain per hour before method weights and diminishing returns. */
const BASE_PRACTICAL_LEARN_PER_HOUR = 0.08;
const BASE_THEORETICAL_LEARN_PER_HOUR = 0.08;
const FAMILIARITY_PER_HOUR = 0.05;
/** How far reliability eases toward practical per practice event. */
const RELIABILITY_APPROACH_RATE = 0.2;
/** Fraction of a gain that transfers into a related skill (× transferability). */
const TRANSFER_FACTOR = 0.3;
/** Multiplier on learning while below the previously reached peak. */
const RELEARN_MULTIPLIER = 1.6;
const THEORETICAL_DECAY_SHARE = 0.3;
const FAMILIARITY_DECAY_SHARE = 0.1;
/** Reliability erodes faster than capability when practice stops. */
const RELIABILITY_DECAY_SHARE = 1.5;
const DEFAULT_DECAY_PER_DAY = 0.01;
/** Mastery halves the decay rate. */
const MASTERY_DECAY_REDUCTION = 0.5;

/** Practical/theoretical learning weight per method (spec §Rules). */
const LEARNING_METHOD_WEIGHTS: Readonly<
  Record<LearningMethod, { readonly practical: number; readonly theoretical: number }>
> = {
  education: { practical: 0.4, theoretical: 1.0 },
  practice: { practical: 1.0, theoretical: 0.25 },
  employment: { practical: 0.8, theoretical: 0.3 },
  apprenticeship: { practical: 0.9, theoretical: 0.6 },
  mentorship: { practical: 0.6, theoretical: 0.7 },
  observation: { practical: 0.25, theoretical: 0.3 },
  reading: { practical: 0.05, theoretical: 0.6 },
  experimentation: { practical: 0.7, theoretical: 0.5 },
  hobby: { practical: 0.6, theoretical: 0.1 },
  failure: { practical: 0.5, theoretical: 0.4 },
  teaching: { practical: 0.3, theoretical: 0.8 },
};

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function blankSkill(skillId: string, now: WorldTime): PersonSkillState {
  return {
    skillId,
    practical: 0,
    theoretical: 0,
    familiarity: 0,
    reliability: 0,
    experienceHours: 0,
    specialization: 0,
    peakPractical: 0,
    lastPracticedAt: now,
    certifications: [],
  };
}

/** Mastery is derived: practical at or above the definition's threshold. */
export function isMastered(
  skill: PersonSkillState,
  def: SkillDefinition | undefined,
): boolean {
  return def !== undefined && skill.practical >= def.masteryThreshold;
}

// ---------------------------------------------------------------------------
// Engine — state lives in WorldState.systems.skills
// ---------------------------------------------------------------------------
export class SkillsEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.skills) {
      this.scope.assertOwner("skills");
      this.world.systems.skills = {
        definitions: [],
        persons: [],
      } satisfies SkillsSystemState;
    }
  }

  private get state(): SkillsSystemState {
    return this.world.systems.skills as SkillsSystemState;
  }

  private set state(value: SkillsSystemState) {
    this.world.systems.skills = value;
  }

  /** Register or replace a skill definition (content-driven, idempotent by id). */
  registerDefinition(def: SkillDefinition): void {
    this.scope.assertOwner("skills");
    const definitions = [
      ...this.state.definitions.filter((d) => d.id !== def.id),
      def,
    ];
    this.state = { ...this.state, definitions };
  }

  getDefinition(skillId: string): SkillDefinition | undefined {
    return this.state.definitions.find((d) => d.id === skillId);
  }

  /**
   * Initialise a person's skill portfolio. `initialSkills` lets
   * materialization (System 07) seed an adult's prior life deterministically;
   * the seeded entries are stored verbatim and decay/tick normally after.
   */
  registerPerson(
    personId: EntityId<"person">,
    initialSkills: readonly PersonSkillState[] = [],
  ): PersonSkillsState {
    this.scope.assertOwner("skills");
    const pss: PersonSkillsState = { personId, skills: [...initialSkills] };
    this.state = { ...this.state, persons: [...this.state.persons, pss] };
    return pss;
  }

  /**
   * Apply `hours` of learning via `method`. Gains follow a diminishing-returns
   * curve (scaled by 1 - level) so repetition cannot grind a skill up
   * linearly; while below the person's own peak, learning runs at the
   * relearning multiplier. Related skills receive a transfer share.
   */
  practice(
    personId: EntityId<"person">,
    skillId: string,
    hours: number,
    method: LearningMethod,
    now: WorldTime,
    factors: PracticeFactors = {},
  ): PracticeResult {
    this.scope.assertOwner("skills");
    const def = this.getDefinition(skillId);
    const aptitudeMult = 0.7 + 0.6 * (factors.aptitude ?? 0.5);
    const instructionMult = 0.6 + 0.8 * (factors.instruction ?? 0.5);
    const weights = LEARNING_METHOD_WEIGHTS[method];

    let result: PracticeResult | undefined;
    this._mutatePerson(personId, (pss) => {
      const before = pss.skills.find((s) => s.skillId === skillId)
        ?? blankSkill(skillId, now);
      const relearning = before.practical < before.peakPractical - 1e-9;
      const learnMult = (relearning ? RELEARN_MULTIPLIER : 1) * aptitudeMult * instructionMult;

      const practicalGain =
        BASE_PRACTICAL_LEARN_PER_HOUR * hours * weights.practical *
        (1 - before.practical) * learnMult;
      const theoreticalGain =
        BASE_THEORETICAL_LEARN_PER_HOUR * hours * weights.theoretical *
        (1 - before.theoretical) * learnMult;

      const practicalAfter = clamp01(before.practical + practicalGain);
      const theoreticalAfter = clamp01(before.theoretical + theoreticalGain);
      const familiarityAfter = clamp01(
        before.familiarity + FAMILIARITY_PER_HOUR * hours * (1 - before.familiarity),
      );
      const reliabilityAfter = clamp01(
        before.reliability + (practicalAfter - before.reliability) * RELIABILITY_APPROACH_RATE,
      );

      const updated: PersonSkillState = {
        ...before,
        practical: practicalAfter,
        theoretical: theoreticalAfter,
        familiarity: familiarityAfter,
        reliability: reliabilityAfter,
        experienceHours: before.experienceHours + hours,
        peakPractical: Math.max(before.peakPractical, practicalAfter),
        lastPracticedAt: now,
      };

      let skills = pss.skills.some((s) => s.skillId === skillId)
        ? pss.skills.map((s) => (s.skillId === skillId ? updated : s))
        : [...pss.skills, updated];

      const transferred: { skillId: string; gained: number }[] = [];
      if (def) {
        for (const link of def.relatedSkills) {
          if (link.transferability <= 0) continue;
          const gain = practicalGain * link.transferability * TRANSFER_FACTOR;
          if (gain < 1e-6) continue;
          const target = skills.find((s) => s.skillId === link.skillId)
            ?? blankSkill(link.skillId, now);
          const targetPractical = clamp01(target.practical + gain * (1 - target.practical));
          const targetUpdated: PersonSkillState = {
            ...target,
            practical: targetPractical,
            familiarity: clamp01(target.familiarity + gain),
            peakPractical: Math.max(target.peakPractical, targetPractical),
            lastPracticedAt: now,
          };
          skills = [
            ...skills.filter((s) => s.skillId !== link.skillId),
            targetUpdated,
          ];
          transferred.push({ skillId: link.skillId, gained: targetPractical - target.practical });
        }
      }

      result = {
        skillId,
        practicalBefore: before.practical,
        practicalAfter,
        theoreticalAfter,
        experienceHours: updated.experienceHours,
        transferred,
      };
      return { ...pss, skills };
    });
    return result as PracticeResult;
  }

  /** Deliberate narrow focus within a skill. Raises specialization, tiny polish. */
  specialize(
    personId: EntityId<"person">,
    skillId: string,
    amount: number,
    now: WorldTime,
  ): void {
    this.scope.assertOwner("skills");
    this._mutateSkill(personId, skillId, now, (s) => ({
      ...s,
      specialization: clamp01(s.specialization + clamp(amount, 0, 1)),
      lastPracticedAt: now,
    }));
  }

  /** Record a certification. Recognition only — capability is untouched. */
  certify(
    personId: EntityId<"person">,
    skillId: string,
    certification: SkillCertification,
  ): void {
    this.scope.assertOwner("skills");
    this._mutateSkill(personId, skillId, certification.issuedAt, (s) => ({
      ...s,
      certifications: [
        ...s.certifications.filter((c) => c.id !== certification.id),
        certification,
      ],
    }));
  }

  /**
   * Apply skill decay over elapsed time. Practical decays at the definition's
   * daily rate (halved once mastered); theoretical and familiarity decay at
   * fractions of that rate; reliability erodes faster but never below the
   * decayed practical floor. Experience is never touched.
   */
  tick(
    personId: EntityId<"person">,
    elapsedMinutes: number,
  ): PersonSkillsState | undefined {
    this.scope.assertOwner("skills");
    const pss = this.getPerson(personId);
    if (!pss) return undefined;
    const days = elapsedMinutes / MINUTES_PER_DAY;

    const skills = pss.skills.map((s) => {
      const def = this.getDefinition(s.skillId);
      const rate = (def?.decayRatePerDay ?? DEFAULT_DECAY_PER_DAY) *
        (isMastered(s, def) ? 1 - MASTERY_DECAY_REDUCTION : 1);
      const practical = Math.max(0, s.practical - rate * days);
      const theoretical = Math.max(0, s.theoretical - rate * THEORETICAL_DECAY_SHARE * days);
      const familiarity = Math.max(0, s.familiarity - rate * FAMILIARITY_DECAY_SHARE * days);
      const reliability = Math.min(
        practical,
        Math.max(0, s.reliability - rate * RELIABILITY_DECAY_SHARE * days),
      );
      return { ...s, practical, theoretical, familiarity, reliability };
    });

    const updated: PersonSkillsState = { ...pss, skills };
    this.state = {
      ...this.state,
      persons: this.state.persons.map((p) => (p.personId === personId ? updated : p)),
    };
    return updated;
  }

  /**
   * Expected realized performance under the given context, 0..1. Blends the
   * competence dimensions, dampens by health/mental/fatigue/equipment/
   * preparation/environment, applies the reliability steadiness factor and
   * finally the specialty fit bonus. Certifications play no part.
   */
  effectivePerformance(
    personId: EntityId<"person">,
    skillId: string,
    context: PerformanceContext,
  ): number {
    const skill = this.getSkill(personId, skillId);
    if (!skill) return 0;
    const competence = clamp01(
      0.65 * skill.practical + 0.2 * skill.theoretical + 0.15 * skill.familiarity,
    );
    let effective = competence *
      (0.4 + 0.6 * context.healthFactor) *
      (0.4 + 0.6 * context.mentalFactor) *
      (1 - 0.5 * context.fatigue) *
      (0.5 + 0.5 * context.equipmentQuality) *
      (0.6 + 0.4 * context.preparation) *
      (1 - 0.5 * (1 - context.environment));
    effective = clamp01(effective * (0.75 + 0.25 * skill.reliability));
    const specialtyBonus =
      skill.specialization * context.specialtyFit * (1 - competence) * 0.5;
    return clamp01(effective + specialtyBonus);
  }

  /**
   * Resolve one performance draw from a caller-supplied seeded stream.
   * Uncertainty and low reliability widen the spread around the expected
   * performance; success means the outcome met the task difficulty.
   */
  resolvePerformance(
    personId: EntityId<"person">,
    skillId: string,
    context: PerformanceContext,
    source: RandomSource,
  ): PerformanceOutcome {
    const expected = this.effectivePerformance(personId, skillId, context);
    const reliability = this.getSkill(personId, skillId)?.reliability ?? 0;
    const spread = context.uncertainty * 0.2 + (1 - reliability) * 0.1;
    const outcome = clamp01(normal(source, expected, spread));
    return { expected, outcome, success: outcome >= context.difficulty };
  }

  getSkill(
    personId: EntityId<"person">,
    skillId: string,
  ): PersonSkillState | undefined {
    return this.getPerson(personId)?.skills.find((s) => s.skillId === skillId);
  }

  getPerson(personId: EntityId<"person">): PersonSkillsState | undefined {
    return this.state.persons.find((p) => p.personId === personId);
  }

  all(): readonly PersonSkillsState[] {
    return this.state.persons;
  }

  private _mutatePerson(
    personId: EntityId<"person">,
    fn: (pss: PersonSkillsState) => PersonSkillsState,
  ): void {
    const pss = this.getPerson(personId);
    if (!pss) throw new Error(`Unknown person in skills: ${personId}`);
    const updated = fn(pss);
    this.state = {
      ...this.state,
      persons: this.state.persons.map((p) => (p.personId === personId ? updated : p)),
    };
  }

  private _mutateSkill(
    personId: EntityId<"person">,
    skillId: string,
    now: WorldTime,
    fn: (s: PersonSkillState) => PersonSkillState,
  ): void {
    this._mutatePerson(personId, (pss) => {
      const existing = pss.skills.find((s) => s.skillId === skillId);
      const skills = existing
        ? pss.skills.map((s) => (s.skillId === skillId ? fn(s) : s))
        : [...pss.skills, fn(blankSkill(skillId, now))];
      return { ...pss, skills };
    });
  }
}
