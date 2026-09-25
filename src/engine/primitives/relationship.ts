/**
 * ReelLife relationship primitive (System 18).
 *
 * Relationships are persistent social states; interactions are the events that
 * can change them. One universal relationship architecture covers friendship,
 * romance, family, household, workplace, business, professional, community and
 * institutional contexts. Relationships may be symmetric or asymmetric and
 * multiple relationship types may coexist between the same two people.
 *
 * Status is NOT the same as relationship quality.
 */

import type { EntityId } from "./ids.ts";
import type { WorldTime } from "./time.ts";

/**
 * Relationship contexts. A single pair can hold several of these at once
 * (for example: coworker + friend + neighbour).
 */
export const RELATIONSHIP_CONTEXTS = [
  "acquaintance",
  "neighbour",
  "friend",
  "closeFriend",
  "rival",
  "enemy",
  "romance",
  "dating",
  "partner",
  "spouse",
  "exPartner",
  "family",
  "parent",
  "child",
  "sibling",
  "grandparent",
  "grandchild",
  "extendedFamily",
  "guardian",
  "ward",
  "coworker",
  "manager",
  "employee",
  "mentor",
  "mentee",
  "client",
  "businessPartner",
  "teammate",
  "communityMember",
  "institutionalRole",
] as const;
export type RelationshipContext = (typeof RELATIONSHIP_CONTEXTS)[number];

/** Contexts that legally/socially imply a household or family structure. */
export const FAMILY_CONTEXTS: readonly RelationshipContext[] = [
  "family",
  "parent",
  "child",
  "sibling",
  "grandparent",
  "grandchild",
  "extendedFamily",
  "guardian",
  "ward",
];

export const ROMANTIC_CONTEXTS: readonly RelationshipContext[] = [
  "romance",
  "dating",
  "partner",
  "spouse",
  "exPartner",
];

/**
 * One directional evaluation of a tie, owned by the person it describes.
 * Asymmetry is represented by two of these, not by averaging.
 */
export interface RelationshipEvaluation {
  readonly closeness: number;
  readonly trust: number;
  readonly affection: number;
  readonly respect: number;
  readonly loyalty: number;
  readonly familiarity: number;
  /** Perceived reciprocity: does this person believe the tie is mutual? */
  readonly perceivedReciprocity: number;
  readonly conflict: number;
  readonly updatedAt: WorldTime;
}

export const RELATIONSHIP_BOUND = { min: 0, max: 100 } as const;

export function clampRelationship(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(RELATIONSHIP_BOUND.min, Math.min(RELATIONSHIP_BOUND.max, value));
}

export function neutralEvaluation(at: WorldTime): RelationshipEvaluation {
  return {
    closeness: 0,
    trust: 0,
    affection: 0,
    respect: 0,
    loyalty: 0,
    familiarity: 0,
    perceivedReciprocity: 0,
    conflict: 0,
    updatedAt: at,
  };
}

/** A significant interaction that shaped the relationship; not every chat. */
export interface RelationshipTurningPoint {
  readonly at: WorldTime;
  readonly kind:
    | "met"
    | "sharedExperience"
    | "conflict"
    | "betrayal"
    | "apology"
    | "forgiveness"
    | "reconciliation"
    | "boundarySet"
    | "commitment"
    | "separation"
    | "milestone";
  readonly summary: string;
  readonly eventId?: string;
}

export interface Relationship {
  readonly id: EntityId<"relationship">;
  readonly from: EntityId<"person">;
  readonly to: EntityId<"person">;
  readonly contexts: readonly RelationshipContext[];
  readonly evaluation: RelationshipEvaluation;
  readonly boundaries: readonly string[];
  readonly expectations: readonly string[];
  /** Relationship origin, so the tie can explain itself (System 18/22). */
  readonly origin: string;
  readonly beganAt: WorldTime;
  readonly turningPoints: readonly RelationshipTurningPoint[];
}

export function hasContext(relationship: Relationship, context: RelationshipContext): boolean {
  return relationship.contexts.includes(context);
}

export function isFamilyRelationship(relationship: Relationship): boolean {
  return relationship.contexts.some((context) => FAMILY_CONTEXTS.includes(context));
}

export function isRomanticRelationship(relationship: Relationship): boolean {
  return relationship.contexts.some((context) => ROMANTIC_CONTEXTS.includes(context));
}

/** Deterministic pair key used to index relationships without a hashing dependency. */
export function relationshipPairKey(a: EntityId<"person">, b: EntityId<"person">): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
