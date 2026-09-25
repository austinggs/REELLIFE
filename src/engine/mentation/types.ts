import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";

/**
 * ReelLife System 12 — Mental & Emotional State.
 *
 * Emotion, mood and stress are DISTINCT layers (spec §Model). This system owns
 * the internal experience only: it does not own personality, memories/beliefs,
 * goals, decisions, relationship structure or world facts. Those influence the
 * appraisal that produces an emotion, but the resulting mental state lives here.
 */

/**
 * Discrete emotion kinds. Mixed and contradictory emotions are valid: a person
 * may carry several of these at once (spec §Rules).
 */
export type EmotionKind =
  | "joy"
  | "sadness"
  | "anger"
  | "fear"
  | "disgust"
  | "surprise"
  | "grief"
  | "love"
  | "guilt"
  | "shame"
  | "pride"
  | "anxiety"
  | "hope"
  | "relief"
  | "loneliness"
  | "gratitude";

export interface Emotion {
  readonly id: string;
  readonly kind: EmotionKind;
  /** Internal intensity: 0.0 = faint, 1.0 = overwhelming. */
  readonly intensity: number;
  readonly startedAt: WorldTime;
  /** Natural lifetime in minutes; intensity eases toward `residue` across it. */
  readonly durationMinutes: number;
  /** Lingering floor the intensity decays to before fading out (spec: residue). */
  readonly residue: number;
  /** Ids of what this emotion is about (people, places, events). */
  readonly associations: readonly string[];
  /** Originating event, kept for explainability (System 59 causal chain). */
  readonly sourceEventId?: string;
  /** Internal state and outward expression differ; concealment is separate. */
  readonly concealed: boolean;
  /** Expressed intensity when not concealed: 0.0 .. intensity. */
  readonly expressedIntensity: number;
}

export type MoodLabel =
  | "despondent"
  | "down"
  | "neutral"
  | "content"
  | "uplifted";

/** Mood is the slow-moving baseline that emotions and stress push around. */
export interface MoodState {
  /** -1.0 (aversive) .. +1.0 (pleasant). */
  readonly valence: number;
  readonly label: MoodLabel;
  readonly since: WorldTime;
}

export interface StressState {
  /** Acute stress / arousal: 0.0 .. 1.0. */
  readonly level: number;
  /** Load that accumulates and does not vanish with acute recovery. */
  readonly accumulated: number;
  /** External psychological pressure currently applied: 0.0 .. 1.0. */
  readonly pressure: number;
  /** Capacity to absorb stress: 0.0 .. 1.0 (higher recovers faster). */
  readonly resilience: number;
  /** Acute-stress recovery per hour when unpressured: 0.0 .. 1.0. */
  readonly recoveryPerHour: number;
}

/** Grief is modeled as a staged process, never a single switch (spec §Rules). */
export type GriefStage =
  | "shock"
  | "yearning"
  | "disorganization"
  | "reorganization"
  | "integration";

export interface GriefProcess {
  readonly id: string;
  readonly startedAt: WorldTime;
  readonly stage: GriefStage;
  readonly intensity: number;
  readonly relatedPersonId?: EntityId<"person">;
}

export type CopingKind =
  | "effective"
  | "ineffective"
  | "adaptive"
  | "avoidant"
  | "habitual";

export interface CopingMechanism {
  readonly id: string;
  readonly kind: CopingKind;
  /** Acute stress removed by a successful use: 0.0 .. 1.0. */
  readonly stressRelief: number;
  /** Resilience eroded per use (avoidant/ineffective coping costs more). */
  readonly resilienceCost: number;
  readonly useCount: number;
}

export interface MentalStateEntry {
  readonly timestamp: WorldTime;
  readonly note: string;
}

export interface MentalState {
  readonly personId: EntityId<"person">;
  readonly mood: MoodState;
  readonly stress: StressState;
  readonly emotions: readonly Emotion[];
  readonly grief: readonly GriefProcess[];
  readonly coping: readonly CopingMechanism[];
  readonly history: readonly MentalStateEntry[];
}

export interface MentationSystemState {
  readonly persons: readonly MentalState[];
}
