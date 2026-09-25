import type { EntityId, IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import {
  clampRelationship,
  neutralEvaluation,
  type Relationship,
  type RelationshipContext,
  type RelationshipEvaluation,
  type RelationshipTurningPoint,
} from "../primitives/relationship.ts";
import type { RelationshipsSystemState } from "./types.ts";

export class RelationshipsEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.relationships) {
      this.scope.assertOwner("relationships");
      this.world.systems.relationships = { relationships: [] } satisfies RelationshipsSystemState;
    }
  }

  private get state(): RelationshipsSystemState {
    return this.world.systems.relationships as RelationshipsSystemState;
  }

  private set state(value: RelationshipsSystemState) {
    this.world.systems.relationships = value;
  }

  get(from: EntityId<"person">, to: EntityId<"person">): Relationship | undefined {
    return this.state.relationships.find((r) => r.from === from && r.to === to);
  }

  forPerson(personId: EntityId<"person">): readonly Relationship[] {
    return this.state.relationships.filter((r) => r.from === personId);
  }

  all(): readonly Relationship[] {
    return this.state.relationships;
  }

  establish(
    ids: IdAllocator,
    from: EntityId<"person">,
    to: EntityId<"person">,
    contexts: readonly RelationshipContext[],
    origin: string,
    now: WorldTime,
    initialEvaluation?: Partial<RelationshipEvaluation>,
  ): Relationship {
    this.scope.assertOwner("relationships");
    const existing = this.get(from, to);
    if (existing) {
      // Add contexts if not already present
      const combinedContexts = Array.from(new Set([...existing.contexts, ...contexts]));
      const updated: Relationship = { ...existing, contexts: combinedContexts };
      this.state = {
        ...this.state,
        relationships: this.state.relationships.map((r) => (r.id === existing.id ? updated : r)),
      };
      return updated;
    }

    const relId = ids.next("relationship");
    const baseEval = neutralEvaluation(now);
    const evaluation: RelationshipEvaluation = {
      closeness: clampRelationship(initialEvaluation?.closeness ?? baseEval.closeness),
      trust: clampRelationship(initialEvaluation?.trust ?? baseEval.trust),
      affection: clampRelationship(initialEvaluation?.affection ?? baseEval.affection),
      respect: clampRelationship(initialEvaluation?.respect ?? baseEval.respect),
      loyalty: clampRelationship(initialEvaluation?.loyalty ?? baseEval.loyalty),
      familiarity: clampRelationship(initialEvaluation?.familiarity ?? baseEval.familiarity),
      perceivedReciprocity: clampRelationship(initialEvaluation?.perceivedReciprocity ?? baseEval.perceivedReciprocity),
      conflict: clampRelationship(initialEvaluation?.conflict ?? baseEval.conflict),
      updatedAt: now,
    };

    const relationship: Relationship = {
      id: relId,
      from,
      to,
      contexts,
      evaluation,
      boundaries: [],
      expectations: [],
      origin,
      beganAt: now,
      turningPoints: [
        {
          at: now,
          kind: "met",
          summary: origin,
        },
      ],
    };

    this.state = {
      ...this.state,
      relationships: [...this.state.relationships, relationship],
    };

    return relationship;
  }

  recordInteraction(
    from: EntityId<"person">,
    to: EntityId<"person">,
    deltas: {
      readonly closeness?: number;
      readonly trust?: number;
      readonly affection?: number;
      readonly respect?: number;
      readonly loyalty?: number;
      readonly familiarity?: number;
      readonly conflict?: number;
    },
    now: WorldTime,
    turningPoint?: { readonly kind: RelationshipTurningPoint["kind"]; readonly summary: string },
  ): Relationship | undefined {
    this.scope.assertOwner("relationships");
    const rel = this.get(from, to);
    if (!rel) return undefined;

    const evaluation: RelationshipEvaluation = {
      closeness: clampRelationship(rel.evaluation.closeness + (deltas.closeness ?? 0)),
      trust: clampRelationship(rel.evaluation.trust + (deltas.trust ?? 0)),
      affection: clampRelationship(rel.evaluation.affection + (deltas.affection ?? 0)),
      respect: clampRelationship(rel.evaluation.respect + (deltas.respect ?? 0)),
      loyalty: clampRelationship(rel.evaluation.loyalty + (deltas.loyalty ?? 0)),
      familiarity: clampRelationship(rel.evaluation.familiarity + (deltas.familiarity ?? 0)),
      perceivedReciprocity: rel.evaluation.perceivedReciprocity,
      conflict: clampRelationship(rel.evaluation.conflict + (deltas.conflict ?? 0)),
      updatedAt: now,
    };

    const turningPoints = turningPoint
      ? [...rel.turningPoints, { at: now, kind: turningPoint.kind, summary: turningPoint.summary }]
      : rel.turningPoints;

    const updated: Relationship = {
      ...rel,
      evaluation,
      turningPoints,
    };

    this.state = {
      ...this.state,
      relationships: this.state.relationships.map((r) => (r.id === rel.id ? updated : r)),
    };

    return updated;
  }
}
