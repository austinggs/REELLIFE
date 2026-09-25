import type { EntityId } from "../primitives/ids.ts";
import type { Relationship } from "../primitives/relationship.ts";

/**
 * ReelLife System 18 — Relationship & Social Interaction Core.
 */

export interface RelationshipsSystemState {
  readonly relationships: readonly Relationship[];
}

export interface SocialInteractionSummary {
  readonly personA: EntityId<"person">;
  readonly personB: EntityId<"person">;
  readonly type: string;
  readonly deltaAffection: number;
  readonly deltaTrust: number;
  readonly deltaConflict: number;
}
