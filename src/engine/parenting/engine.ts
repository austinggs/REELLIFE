import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import {
  INDEPENDENCE_DIMENSIONS,
  emptyParentingState,
  type CareEvent,
  type CareEventKind,
  type CareMistake,
  type CareObservation,
  type CareReading,
  type CaregiverKind,
  type DisciplineRecord,
  type IndependenceDimension,
  type IndependenceProfile,
  type IndependenceRecord,
  type ParentingRelationship,
  type ParentingSystemState,
} from "./types.ts";

/**
 * How much each observed condition contributes to the quality of care.
 *
 * Availability and needsMet lead, because a caregiver who is not there cannot
 * feed a child however much they care, and a child whose needs are not being met
 * is the thing the reading is for. Provisional — see docs/CONTENT_GAPS.md.
 */
export const CARE_WEIGHTS = {
  needsMet: 0.25,
  caregiverAvailability: 0.2,
  resources: 0.15,
  knowledge: 0.15,
  health: 0.1,
  household: 0.07,
  institutionSupport: 0.05,
  caregiverPriority: 0.03,
} as const;

export type CareInput = keyof typeof CARE_WEIGHTS;

export interface EstablishCareRequest {
  readonly childId: string;
  readonly caregiverId: string;
  readonly kind: CaregiverKind;
  readonly responsibilities: readonly string[];
  readonly availability: number;
  readonly knowledgeOfChild: number;
  readonly resources: number;
  readonly autonomySupport: number;
  readonly expectations?: readonly string[];
}

export interface RecordDisciplineRequest {
  readonly childId: string;
  readonly caregiverId: string;
  /** What was done, described without a style label. */
  readonly approach: string;
  readonly justification: string;
  readonly observedResponse?: number;
}

export class ParentingEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.parenting) {
      this.scope.assertOwner("parenting");
      this.world.systems.parenting = emptyParentingState();
    }
  }

  private get state(): ParentingSystemState {
    return this.world.systems.parenting as ParentingSystemState;
  }

  private set state(value: ParentingSystemState) {
    this.world.systems.parenting = value;
  }

  // ---------------------------------------------------------------- reads ---

  relationships(): readonly ParentingRelationship[] {
    return this.state.relationships;
  }

  caregiversOf(childId: string): readonly ParentingRelationship[] {
    return this.state.relationships.filter((entry) => entry.childId === childId);
  }

  relationship(childId: string, caregiverId: string): ParentingRelationship | undefined {
    return this.state.relationships.find(
      (entry) => entry.childId === childId && entry.caregiverId === caregiverId,
    );
  }

  requireRelationship(childId: string, caregiverId: string, caller: string): ParentingRelationship {
    const found = this.relationship(childId, caregiverId);
    if (found === undefined) {
      throw new Error(
        `ParentingEngine.${caller}: ${caregiverId} does not care for ${childId}`,
      );
    }
    return found;
  }

  observations(): readonly CareObservation[] {
    return this.state.observations;
  }

  latestObservation(childId: string): CareObservation | undefined {
    return [...this.state.observations]
      .filter((entry) => entry.childId === childId)
      .sort((a, b) => b.at - a.at)[0];
  }

  discipline(): readonly DisciplineRecord[] {
    return this.state.discipline;
  }

  mistakes(): readonly CareMistake[] {
    return this.state.mistakes;
  }

  /** Mistakes that nobody has noticed yet. Usually the interesting ones. */
  undiscoveredMistakes(): readonly CareMistake[] {
    return this.state.mistakes.filter((entry) => entry.discoveredAt === undefined);
  }

  independenceRecords(): readonly IndependenceRecord[] {
    return this.state.independence;
  }

  events(): readonly CareEvent[] {
    return this.state.events;
  }

  eventsOf(childId: string): readonly CareEvent[] {
    return this.state.events.filter((entry) => entry.childId === childId);
  }

  // -------------------------------------------------------------- derived ---

  /**
   * How well a child is being cared for, and *what is stopping it*.
   *
   * The eight inputs are the spec's own list — needs, caregiver availability,
   * resources, knowledge, health, household conditions, institutions and the
   * caregiver's own priorities — and the weakest of them is named. The point is
   * that "this child is not doing well" is never a sufficient answer: a
   * caregiver who is present, informed and well-resourced still cannot feed a
   * child who is ill, and the reading has to be able to say so.
   *
   * The reported quality is the one the constraint is drawn from, so the number
   * and the named reason can never disagree.
   */
  careReading(observation: CareObservation): CareReading {
    const parts: readonly (readonly [CareInput, number])[] = [
      ["needsMet", CARE_WEIGHTS.needsMet],
      ["caregiverAvailability", CARE_WEIGHTS.caregiverAvailability],
      ["resources", CARE_WEIGHTS.resources],
      ["knowledge", CARE_WEIGHTS.knowledge],
      ["health", CARE_WEIGHTS.health],
      ["household", CARE_WEIGHTS.household],
      ["institutionSupport", CARE_WEIGHTS.institutionSupport],
      ["caregiverPriority", CARE_WEIGHTS.caregiverPriority],
    ];
    let quality = 0;
    let worst: { name: CareInput; value: number } = { name: "needsMet", value: 1 };
    const factors: string[] = [];
    for (const [name, weight] of parts) {
      const value = requireRatio(observation[name], name, "careReading");
      quality += weight * value;
      factors.push(`${name}=${value.toFixed(2)}`);
      if (value < worst.value) worst = { name, value };
    }
    const reported = round4(clamp01(quality));
    return {
      childId: observation.childId,
      caregiverId: observation.caregiverId,
      quality: reported,
      bindingConstraint: worst.value < 1 ? worst.name : "none",
      factors,
    };
  }

  /**
   * Where a child stands on each dimension of independence.
   *
   * The latest record per dimension wins, and a dimension never measured reads
   * as `undefined` rather than 0 — "we have not looked" and "they cannot do it
   * at all" are different facts, and averaging them together would invent a
   * child who is uniformly helpless out of one nobody has assessed.
   */
  independenceProfile(childId: string, at: WorldTime): IndependenceProfile {
    const latest = new Map<IndependenceDimension, IndependenceRecord>();
    for (const record of this.state.independence) {
      if (record.childId !== childId || record.at > at) continue;
      const held = latest.get(record.dimension);
      if (held === undefined || held.at <= record.at) latest.set(record.dimension, record);
    }
    const byDimension = {} as Record<IndependenceDimension, number | undefined>;
    let total = 0;
    for (const dimension of INDEPENDENCE_DIMENSIONS) {
      const record = latest.get(dimension);
      byDimension[dimension] = record?.level;
      if (record !== undefined) total += record.level;
    }
    const measured = latest.size;
    return {
      childId,
      byDimension,
      overall: measured === 0 ? undefined : round4(total / measured),
      measuredDimensions: measured,
    };
  }

  /**
   * How much of this child's care is actually covered right now.
   *
   * Reported against the caregivers the child actually has *at this date*, so a
   * child with no caregiver reads 0 rather than being quietly assumed to have
   * someone — and a caregiver who has not started yet is not counted. `conflictingResponsibilities` names caregivers whose stated
   * duties overlap, which is the spec's "conflicting caregiver responsibilities"
   * — two adults who both believe the school run is theirs.
   */
  coverage(childId: string, at: WorldTime): {
    readonly childId: string;
    readonly available: number;
    readonly caregiverCount: number;
    readonly conflictingResponsibilities: readonly string[];
  } {
    const caregivers = this.caregiversOf(childId).filter((entry) => entry.since <= at);
    const byResponsibility = new Map<string, string[]>();
    for (const relationship of caregivers) {
      for (const duty of relationship.responsibilities) {
        byResponsibility.set(duty, [...(byResponsibility.get(duty) ?? []), relationship.caregiverId]);
      }
    }
    const conflicting = [...byResponsibility.entries()]
      .filter(([, holders]) => holders.length > 1)
      .map(([duty]) => duty);
    return {
      childId,
      available: round4(
        clamp01(caregivers.reduce((sum, entry) => sum + entry.availability, 0)),
      ),
      caregiverCount: caregivers.length,
      conflictingResponsibilities: conflicting,
    };
  }

  // --------------------------------------------------------------- writes ---

  /**
   * Establishes or updates a caregiving relationship.
   *
   * The `since` of an existing relationship is kept when it is re-established, so
   * a change of availability or of responsibilities does not silently restart
   * this child's tenure with the person who has been here all along.
   */
  establishCare(request: EstablishCareRequest, at: WorldTime): ParentingRelationship {
    const existing = this.relationship(request.childId, request.caregiverId);
    this.scope.assertOwner("parenting");
    const relationship: ParentingRelationship = {
      childId: request.childId,
      caregiverId: request.caregiverId,
      kind: request.kind,
      since: existing?.since ?? at,
      responsibilities: [...request.responsibilities],
      availability: requireRatio(request.availability, "availability", "establishCare"),
      knowledgeOfChild: requireRatio(request.knowledgeOfChild, "knowledgeOfChild", "establishCare"),
      resources: requireRatio(request.resources, "resources", "establishCare"),
      autonomySupport: requireRatio(request.autonomySupport, "autonomySupport", "establishCare"),
      expectations: [...(request.expectations ?? [])],
    };
    this.state = {
      ...this.state,
      relationships: [
        ...this.state.relationships.filter(
          (entry) =>
            !(entry.childId === request.childId && entry.caregiverId === request.caregiverId),
        ),
        relationship,
      ],
    };
    return relationship;
  }

  /**
   * Records an observation of how a child is actually doing. Observations are
   * the input to `careReading` and are kept as history, because the binding
   * constraint moves and a single snapshot would hide that.
   */
  observeCare(observation: CareObservation): CareObservation {
    this.requireRelationship(observation.childId, observation.caregiverId, "observeCare");
    this.scope.assertOwner("parenting");
    this.state = { ...this.state, observations: [...this.state.observations, observation] };
    return observation;
  }

  /**
   * Records what was done, and why, in the caregiver's own words.
   *
   * There is no `style` field and the engine refuses to invent one: the spec
   * rules out a single moralized style switch, and a lookup table of parenting
   * approaches would smuggle a judgment into what should be a description.
   */
  recordDiscipline(
    request: RecordDisciplineRequest,
    at: WorldTime,
    ids: IdAllocator,
  ): DisciplineRecord {
    this.requireRelationship(request.childId, request.caregiverId, "recordDiscipline");
    if (request.approach.trim().length === 0 || request.justification.trim().length === 0) {
      throw new Error(
        "ParentingEngine.recordDiscipline: a discipline record must say what was done " +
          "and why, in the caregiver's own framing",
      );
    }
    this.scope.assertOwner("parenting");
    const record: DisciplineRecord = {
      id: `dp-${ids.next("activity")}`,
      childId: request.childId,
      caregiverId: request.caregiverId,
      at,
      approach: request.approach,
      justification: request.justification,
      ...(request.observedResponse === undefined
        ? {}
        : {
            observedResponse: requireRatio(
              request.observedResponse,
              "observedResponse",
              "recordDiscipline",
            ),
          }),
    };
    this.state = { ...this.state, discipline: [...this.state.discipline, record] };
    return record;
  }

  /**
   * Records a caregiver's mistake, and it stays *undiscovered* until someone
   * notices. A model in which caregivers are always right has no room in it for
   * anyone learning, and pretending otherwise would make this system kinder than
   * the spec is willing to be.
   */
  recordMistake(
    childId: string,
    caregiverId: string,
    what: string,
    at: WorldTime,
    ids: IdAllocator,
  ): CareMistake {
    this.requireRelationship(childId, caregiverId, "recordMistake");
    this.scope.assertOwner("parenting");
    const mistake: CareMistake = {
      id: `ms-${ids.next("activity")}`,
      childId,
      caregiverId,
      at,
      what,
    };
    this.state = { ...this.state, mistakes: [...this.state.mistakes, mistake] };
    return mistake;
  }

  /**
   * Notices a mistake and records what, if anything, was done about it. The
   * repair is the caller's to judge; the engine only insists the mistake is
   * attributed to somebody.
   */
  discoverMistake(mistakeId: string, at: WorldTime, repair?: number): CareMistake {
    const mistake = this.state.mistakes.find((entry) => entry.id === mistakeId);
    if (mistake === undefined) {
      throw new Error(`ParentingEngine.discoverMistake: unknown mistake ${mistakeId}`);
    }
    if (mistake.discoveredAt !== undefined) return mistake;
    this.scope.assertOwner("parenting");
    const found: CareMistake = {
      ...mistake,
      discoveredAt: at,
      ...(repair === undefined
        ? {}
        : { repair: requireRatio(repair, "repair", "discoverMistake") }),
    };
    this.state = {
      ...this.state,
      mistakes: this.state.mistakes.map((entry) => (entry.id === mistakeId ? found : entry)),
    };
    return found;
  }

  /**
   * Records how capable a child is in one dimension, on one date. Appended
   * rather than replaced, so development is a *trajectory* — which is what
   * makes "changed autonomy" answerable at all.
   */
  recordIndependence(
    childId: string,
    dimension: IndependenceDimension,
    level: number,
    at: WorldTime,
  ): IndependenceRecord {
    this.scope.assertOwner("parenting");
    const record: IndependenceRecord = {
      childId,
      dimension,
      level: requireRatio(level, "level", "recordIndependence"),
      at,
    };
    this.state = { ...this.state, independence: [...this.state.independence, record] };
    return record;
  }

  /**
   * Records something that happened in a child's care.
   *
   * `caregiverIds` may be empty, and that is not a gap in the record: "nobody was
   * there" is the single most important fact about some events.
   */
  recordEvent(
    childId: string,
    kind: CareEventKind,
    summary: string,
    at: WorldTime,
    ids: IdAllocator,
    caregiverIds: readonly string[] = [],
    response?: string,
  ): CareEvent {
    this.scope.assertOwner("parenting");
    const event: CareEvent = {
      id: `ce-${ids.next("activity")}`,
      childId,
      at,
      kind,
      summary,
      caregiverIds: [...caregiverIds],
      ...(response === undefined ? {} : { response }),
    };
    this.state = { ...this.state, events: [...this.state.events, event] };
    return event;
  }

  serialize(): ParentingSystemState {
    return this.state;
  }
}

function requireRatio(value: number, field: string, caller: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`ParentingEngine.${caller}: ${field} must be 0..1, received ${value}`);
  }
  return value;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
