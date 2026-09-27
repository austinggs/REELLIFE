/**
 * Children & parenting (System 20).
 *
 * "Parents influence children through ongoing conditions and interactions; they
 * do not author children into predetermined outcomes" (System 20 core principle).
 * The design keeps the parent *adjacent* to the child's development rather than
 * upstream of it:
 *
 *   1. **Care is a condition, not a verdict.** `careReading` is derived from
 *      eight supplied inputs and **names the binding one**, the way System 43
 *      names a service's binding constraint. "The child is not doing well" is
 *      never a sufficient answer here; it always arrives with "because".
 *   2. **Discipline is not a style switch.** The spec forbids "a single
 *      moralized style switch", so there is no `style: strict | lenient` field.
 *      A `DisciplineRecord` holds what was actually done, in the caregiver's
 *      framing, plus its justification — and the effect is *observed*, not
 *      assumed.
 *   3. **Parents are allowed to be wrong.** A `CareMistake` may have no
 *      `discoveredAt`, and an undiscovered mistake stays undiscovered. A model
 *      in which caregivers are always right is a model with no learning in it.
 *   4. **Autonomy is five dimensions, not one.** Practical, social, financial,
 *      emotional and decision-making develop separately: a child can manage
 *      money while still needing someone to choose their clothes. Collapsing
 *      that into one "independence" number is the easiest way to write a child
 *      as a smaller adult.
 *   5. **Caregivers are not only parents.** Parent, guardian, foster carer,
 *      relative, institution — and the scarcity of the *others* is a real
 *      condition, so a child may have several caregivers or none available.
 *
 * It owns none of parentage (19), development (9), institutions (23), health
 * truth (11), household membership (19) or money (25). It references them.
 */

import type { WorldTime } from "../primitives/time.ts";

export const CAREGIVER_KINDS = [
  "parent",
  "guardian",
  "foster",
  "relative",
  "institutional",
  "other",
] as const;
export type CaregiverKind = (typeof CAREGIVER_KINDS)[number];

/** Independence develops on five fronts, separately. */
export const INDEPENDENCE_DIMENSIONS = [
  "practical",
  "social",
  "financial",
  "emotional",
  "decision",
] as const;
export type IndependenceDimension = (typeof INDEPENDENCE_DIMENSIONS)[number];

export interface ParentingRelationship {
  readonly childId: string;
  readonly caregiverId: string;
  readonly kind: CaregiverKind;
  readonly since: WorldTime;
  readonly responsibilities: readonly string[];
  /** 0..1 — how much of the day this caregiver actually has. */
  readonly availability: number;
  /** 0..1 — how well this caregiver knows this child. Never assumed to be 1. */
  readonly knowledgeOfChild: number;
  /** 0..1 — what this caregiver can actually draw on. */
  readonly resources: number;
  /** 0..1 — how much the caregiver is building the child's own judgement. */
  readonly autonomySupport: number;
  readonly expectations: readonly string[];
}

/** One observed set of conditions under which a child is being cared for. */
export interface CareObservation {
  readonly childId: string;
  readonly caregiverId: string;
  readonly at: WorldTime;
  /** 0..1 — whether what the child currently needs is being met. */
  readonly needsMet: number;
  /** 0..1 — whether the caregiver can be there. */
  readonly caregiverAvailability: number;
  /** 0..1 — money, food, space. */
  readonly resources: number;
  /** 0..1 — whether the caregiver knows what this child needs. */
  readonly knowledge: number;
  /** 0..1 — the child's own health, from System 11. */
  readonly health: number;
  /** 0..1 — the conditions of the home, from System 19. */
  readonly household: number;
  /** 0..1 — what Systems 23/43 provide. */
  readonly institutionSupport: number;
  /** 0..1 — how high the caregiver ranks this among their own obligations. */
  readonly caregiverPriority: number;
}

/**
 * What was done, in the caregiver's own framing, and why.
 *
 * Deliberately *not* a `style` field. The spec rules out "a single moralized
 * style switch", and any enum of that kind smuggles a judgment in through the
 * back door; the text plus the observed effect keeps the record descriptive.
 */
export interface DisciplineRecord {
  readonly id: string;
  readonly childId: string;
  readonly caregiverId: string;
  readonly at: WorldTime;
  /** What was done, described without a style label. */
  readonly approach: string;
  /** Why the caregiver says they did it. */
  readonly justification: string;
  /** 0..1 — what the child did next, as observed rather than assumed. */
  readonly observedResponse?: number;
}

/**
 * A caregiver's mistake.
 *
 * `discoveredAt` is optional and that is the point: a mistake nobody has noticed
 * stays unnoticed, and a model where caregivers are always right has no room in
 * it for anyone learning.
 */
export interface CareMistake {
  readonly id: string;
  readonly childId: string;
  readonly caregiverId: string;
  readonly at: WorldTime;
  readonly what: string;
  /** Absent while the mistake is still unknown. */
  readonly discoveredAt?: WorldTime;
  /** 0..1 — what was done about it, once it was known. */
  readonly repair?: number;
}

export interface IndependenceRecord {
  readonly childId: string;
  readonly dimension: IndependenceDimension;
  /** 0..1 — how capable the child is in this dimension *now*. */
  readonly level: number;
  readonly at: WorldTime;
}

export const CARE_EVENT_KINDS = [
  "emergency",
  "handover",
  "caregiver_unavailable",
  "neglect_concern",
  "coordination",
] as const;
export type CareEventKind = (typeof CARE_EVENT_KINDS)[number];

export interface CareEvent {
  readonly id: string;
  readonly childId: string;
  readonly at: WorldTime;
  readonly kind: CareEventKind;
  readonly summary: string;
  /** Who was there. An empty list is a legitimate, recorded fact. */
  readonly caregiverIds: readonly string[];
  readonly response?: string;
}

export interface ParentingSystemState {
  readonly relationships: readonly ParentingRelationship[];
  readonly observations: readonly CareObservation[];
  readonly discipline: readonly DisciplineRecord[];
  readonly mistakes: readonly CareMistake[];
  readonly independence: readonly IndependenceRecord[];
  readonly events: readonly CareEvent[];
}

export function emptyParentingState(): ParentingSystemState {
  return {
    relationships: [],
    observations: [],
    discipline: [],
    mistakes: [],
    independence: [],
    events: [],
  };
}

/** How well a child is being cared for, and what is stopping it. */
export interface CareReading {
  readonly childId: string;
  readonly caregiverId: string;
  readonly quality: number;
  /** The weakest input, named. "Not doing well, because nobody is there." */
  readonly bindingConstraint: string;
  readonly factors: readonly string[];
}

/** Where a child stands on each dimension of independence. */
export interface IndependenceProfile {
  readonly childId: string;
  readonly byDimension: Readonly<Record<IndependenceDimension, number | undefined>>;
  /** 0..1 — the mean across the dimensions that have been measured. */
  readonly overall: number | undefined;
  /** How many dimensions have been measured: "unmeasured" is not the same as 0. */
  readonly measuredDimensions: number;
}

