/**
 * ReelLife information primitives (Systems 15/22/49, World Build 13 section 14,
 * UI/UX 02 section 3 and UI/UX 19 section 4).
 *
 * The simulation keeps several distinct concepts apart, and this module names
 * them so they cannot be collapsed into one another by accident:
 *
 *   world truth        what actually happened and is
 *   InformationClaim   a claim about the world, with provenance and confidence
 *   knowledge state    how a specific observer relates to a claim
 *   visibility         who is entitled to see something at all
 *   reputation         observer-relative social perception
 *
 * A widely believed claim is not automatically true. A rumor is not truth. A
 * notification is not an event resolution.
 */

import type { EntityId, EntityKind } from "./ids.ts";
import type { EntityRef } from "./entity.ts";
import type { WorldTime } from "./time.ts";

/** Access classification for events, records and data (World Build 13). */
export const VISIBILITY_LEVELS = ["public", "restricted", "private", "secret", "unknown"] as const;
export type Visibility = (typeof VISIBILITY_LEVELS)[number];

/** How an observer relates to a piece of information (UI/UX 02 section 3). */
export const KNOWLEDGE_STATES = [
  "known",
  "estimate",
  "rumor",
  "inference",
  "unknown",
  "hidden",
] as const;
export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];

/** Whether the claim matches underlying world truth, where the engine knows it. */
export const CLAIM_ACTUALITY = ["true", "false", "partly-true", "unresolved", "unknown-truth"] as const;
export type ClaimActuality = (typeof CLAIM_ACTUALITY)[number];

export const CLAIM_SOURCE_KINDS = [
  "observation",
  "document",
  "institution",
  "organization",
  "media",
  "person",
  "rumor",
  "inference",
  "self",
] as const;
export type ClaimSourceKind = (typeof CLAIM_SOURCE_KINDS)[number];

export interface ClaimSource {
  readonly kind: ClaimSourceKind;
  /** The specific source entity when one exists (a person, outlet, record...). */
  readonly ref?: EntityRef<EntityKind>;
  readonly description: string;
}

/**
 * A claim about the world with provenance, confidence, visibility and
 * propagation state. Claims never overwrite truth; they accumulate, spread and
 * are believed or disbelieved by observers.
 */
export interface InformationClaim {
  readonly id: EntityId<"claim">;
  /** Short machine-readable subject, e.g. "person:PER-000012:employment". */
  readonly subject: string;
  /** The claim itself, in human-readable form. */
  readonly statement: string;
  readonly source: ClaimSource;
  readonly assertedAt: WorldTime;
  /** 0..1 confidence held by the source at the time of assertion. */
  readonly sourceConfidence: number;
  /** Underlying truth as known to the simulation, never to the player by default. */
  readonly actuality: ClaimActuality;
  readonly visibility: Visibility;
  /** Observers who currently hold this claim. */
  readonly knownBy: readonly EntityId<"person">[];
  /** Observers entitled to see this claim even if they never received it. */
  readonly accessList: readonly EntityRef<EntityKind>[];
  /** Number of times the claim has been retold; propagation evidence. */
  readonly transmissionCount: number;
  readonly retracted?: boolean;
}

export interface ObserverKnowledge<T> {
  readonly value: T;
  readonly state: KnowledgeState;
  /** Present for estimate/inference: how sure the observer is, 0..1. */
  readonly confidence?: number;
  /** Present for rumor/inference: where the observer got it. */
  readonly viaClaimId?: EntityId<"claim">;
}

export function known<T>(value: T): ObserverKnowledge<T> {
  return { value, state: "known" };
}

export function unknown<T>(): ObserverKnowledge<T> {
  return { value: undefined as unknown as T, state: "unknown" };
}

export function hidden<T>(value: T): ObserverKnowledge<T> {
  return { value, state: "hidden" };
}

/**
 * Visibility-aware access check. `worldTruth` is never exposed merely because
 * the engine holds it in memory (UI/UX 24 section 9, System 55).
 */
export function isVisibleTo(
  visibility: Visibility,
  viewer: EntityId<"person">,
  knownBy: readonly EntityId<"person">[],
): boolean {
  if (visibility === "public") return true;
  if (visibility === "unknown") return false;
  return knownBy.includes(viewer);
}
