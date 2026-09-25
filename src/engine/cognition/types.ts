import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { ClaimSource, KnowledgeState } from "../primitives/information.ts";

/**
 * ReelLife System 15 — Cognition & Knowledge.
 *
 * Models what a person notices, knows, remembers, believes, infers,
 * misunderstands, and treats as credible.
 *
 * Owned state:
 * - knowledge & beliefs (subject, predicate, value, confidence, source)
 * - memories (vividness, emotional salience, reconstructive traces)
 * - perceptions & assumptions
 * - attention & awareness (focus capacity, recent stimuli)
 * - source credibility ratings (observer-relative evaluation of sources)
 *
 * Architectural Law 4: Information/knowledge is distinct from world truth.
 * Systems must query Cognition to see what a person believes or knows;
 * world truth never leaks directly into decision making.
 */

/** An observer's internal belief or known fact regarding a subject. */
export interface BeliefRecord {
  readonly id: string;
  readonly subject: string;
  readonly predicate: string;
  readonly value: string;
  /** 0.0 .. 1.0 confidence/certainty held by the observer */
  readonly confidence: number;
  /** Epistemological status of this belief */
  readonly status: KnowledgeState;
  /** Where this belief originated */
  readonly source: ClaimSource;
  /** Underlying claim ID if derived from an InformationClaim */
  readonly claimId?: EntityId<"claim">;
  /** When this belief was first formed */
  readonly acquiredAt: WorldTime;
  /** When this belief was last reinforced, verified, or updated */
  readonly lastReinforcedAt: WorldTime;
  /** How many times this belief has been reinforced by new evidence */
  readonly reinforcementCount: number;
}

/**
 * An episodic or semantic memory held by an individual.
 * Memories undergo decay and reconstructive fading over time.
 */
export interface MemoryRecord {
  readonly id: string;
  readonly description: string;
  /** Event or context tag ("childhood", "trauma", "work", "family", etc.) */
  readonly domain: string;
  /** 0.0 .. 1.0 emotional weight/impact when experienced */
  readonly emotionalSalience: number;
  /** 0.0 .. 1.0 clarity and detail of recall. Decays over time without recall. */
  readonly vividness: number;
  /** When the event occurred */
  readonly occurredAt: WorldTime;
  /** When this memory was last recalled or reactivated */
  readonly lastRecalledAt: WorldTime;
  /** Associated entity references (e.g., participants or places) */
  readonly associations: readonly string[];
}

/**
 * An observer's subjective trust in a specific source or source kind.
 * Used when evaluating incoming information claims.
 */
export interface SourceTrustRating {
  readonly sourceKey: string;
  /** 0.0 .. 1.0 credibility rating */
  readonly credibility: number;
  readonly evaluationsCount: number;
}

/** Attention state: limited bandwidth and focal items. */
export interface AttentionState {
  /** Maximum number of focal subjects the individual can track concurrently */
  readonly capacity: number;
  /** Current subjects occupying active attention */
  readonly focalSubjects: readonly string[];
}

/** Complete cognitive state for an individual person. */
export interface PersonCognitionState {
  readonly personId: EntityId<"person">;
  readonly beliefs: readonly BeliefRecord[];
  readonly memories: readonly MemoryRecord[];
  readonly sourceTrust: readonly SourceTrustRating[];
  readonly attention: AttentionState;
}

/** System-level state stored under WorldState.systems.cognition. */
export interface CognitionSystemState {
  readonly persons: readonly PersonCognitionState[];
}
