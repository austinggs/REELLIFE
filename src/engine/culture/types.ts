/**
 * Culture, religion, community & tradition (System 44).
 *
 * "Culture is a distributed social environment, not a personality preset"
 * (System 44 core principle). The module is shaped to make that sentence hard to
 * accidentally violate:
 *
 *   1. **Groups, not personalities.** The unit of state is a cultural group and
 *      the traditions it carries. What any *individual* believes is System 13's
 *      business and is explicitly not owned here; participation is recorded
 *      because it is observable social membership, and even then it is stored as
 *      a *level* ("weak", "situational", "mixed"), never as a trait value that
 *      could quietly leak into personality.
 *   2. **Strength is derived, and sampled.** A tradition's strength is computed
 *      from the participation on record, and the reading reports its own
 *      `sampleSize` and `confidence` — because a community with three
 *      materialized members is a measurement, not a census. Storing a strength
 *      number would let it drift away from the people who are actually there.
 *   3. **Culture leans, it does not steer.** `influence()` returns a bounded
 *      weight with its basis attached, never a decision. Who acts on it is
 *      System 16's call.
 *   4. **Conflict and mixing are read off the graph, not authored.** A norm
 *      conflict is two co-located traditions that govern the same situation; a
 *      tradition is inherited, weakened or abandoned over generations because
 *      transmission is *probabilistic*, and each attempt is kept with the
 *      factors that produced it.
 */

import type { WorldTime } from "../primitives/time.ts";

/**
 * Groups can be rooted in place, in faith, in work, in a pastime, online, in
 * identity, or in an organization (System 44 model/state).
 */
export const CULTURAL_GROUP_KINDS = [
  "geographic",
  "religious",
  "professional",
  "hobby",
  "online",
  "identity",
  "organizational",
] as const;
export type CulturalGroupKind = (typeof CULTURAL_GROUP_KINDS)[number];

/** Traditions/norms/values/rituals/symbols/languages (System 44 OWNS). */
export const TRADITION_KINDS = [
  "norm",
  "value",
  "ritual",
  "symbol",
  "language",
  "practice",
] as const;
export type TraditionKind = (typeof TRADITION_KINDS)[number];

/**
 * Traditions change, mix, weaken, spread and get contested (System 44 rules).
 * `retired` is a real end state: a tradition can be abandoned, and the record
 * that it was once held is not erased by its passing.
 */
export const TRADITION_STATES = [
  "emerging",
  "established",
  "contested",
  "weakening",
  "retired",
] as const;
export type TraditionState = (typeof TRADITION_STATES)[number];

/**
 * Participation can be strong, moderate, weak, mixed, changing or situational
 * (System 44 model/state). "mixed" and "changing" are load-bearing: they are how
 * a person who identifies with a tradition but does not follow it gets recorded
 * without being forced to one side or the other.
 */
export const PARTICIPATION_LEVELS = [
  "strong",
  "moderate",
  "weak",
  "mixed",
  "changing",
  "situational",
  "none",
] as const;
export type ParticipationLevel = (typeof PARTICIPATION_LEVELS)[number];

/**
 * Transmission pathways (System 44 rules): family, education, community,
 * religion, media, migration, friends, work, institutions, imitation.
 */
export const TRANSMISSION_PATHWAYS = [
  "family",
  "education",
  "community",
  "religion",
  "media",
  "migration",
  "friends",
  "work",
  "institutions",
  "imitation",
] as const;
export type TransmissionPathway = (typeof TRANSMISSION_PATHWAYS)[number];

/**
 * How much each pathway carries. Family is the strongest because it is the one
 * that meets a person earliest and most often; media is the weakest here because
 * exposure is a matter of degree and is supplied per attempt rather than
 * assumed. Provisional — see docs/CONTENT_GAPS.md.
 */
export const PATHWAY_STRENGTH: Record<TransmissionPathway, number> = {
  family: 0.9,
  education: 0.6,
  community: 0.7,
  religion: 0.75,
  media: 0.35,
  migration: 0.45,
  friends: 0.6,
  work: 0.4,
  institutions: 0.65,
  imitation: 0.5,
};

/**
 * Participation weight, used to derive how strongly a group holds a tradition
 * and how firmly a holder transmits it. `changing` is provisionally weighted as
 * moderate: an unsettled practice is neither uptake nor rejection. Provisional —
 * see docs/CONTENT_GAPS.md.
 */
export const PARTICIPATION_WEIGHTS: Record<ParticipationLevel, number> = {
  strong: 1,
  moderate: 0.6,
  weak: 0.2,
  mixed: 0.5,
  changing: 0.5,
  situational: 0.25,
  none: 0,
};

export interface CulturalGroup {
  readonly id: string;
  readonly name: string;
  readonly kind: CulturalGroupKind;
  /**
   * Where the group is rooted. Migration changes the *menu* of traditions
   * available at a place, never the person: arriving somewhere does not make
   * anyone a participant.
   */
  readonly locationId?: string;
  /** System 44 separates identity, belief, practice, community, institutions. */
  readonly religionId?: string;
  /** System 32 organization link, when the community is an organized body. */
  readonly organizationId?: string;
  readonly foundedAt: WorldTime;
  readonly note?: string;
}

export interface Tradition {
  readonly id: string;
  readonly groupId: string;
  readonly name: string;
  readonly kind: TraditionKind;
  /**
   * The situation this tradition governs ("diet", "workday", "greeting",
   * "ritual_schedule", "dress"). Two co-located traditions of the same kind that
   * claim the same domain cannot both be complied with — which is the whole of
   * "norm conflict", derived rather than authored.
   */
  readonly domain: string;
  readonly state: TraditionState;
  readonly originAt: WorldTime;
}

export interface Participation {
  readonly personId: string;
  readonly groupId: string;
  readonly level: ParticipationLevel;
  readonly since: WorldTime;
  /** Situational participation records the occasion, not a standing identity. */
  readonly context?: string;
}


/** One transmission attempt, kept with the factors that produced it. */
export interface TransmissionRecord {
  readonly id: string;
  readonly at: WorldTime;
  /** Absent when exposure happened without a specific holder (e.g. a noticeboard). */
  readonly fromPersonId?: string;
  readonly toPersonId: string;
  readonly traditionId: string;
  readonly pathway: TransmissionPathway;
  readonly probability: number;
  readonly accepted: boolean;
  /** The sampled uniform, kept so a contested outcome can be re-examined. */
  readonly roll: number;
  readonly viaGroupId?: string;
}

export interface CommunityHistoryEntry {
  readonly id: string;
  readonly at: WorldTime;
  readonly groupId: string;
  readonly summary: string;
}

export interface CultureSystemState {
  readonly groups: readonly CulturalGroup[];
  readonly traditions: readonly Tradition[];
  readonly participation: readonly Participation[];
  readonly transmissions: readonly TransmissionRecord[];
  readonly communityHistory: readonly CommunityHistoryEntry[];
}

export function emptyCultureState(): CultureSystemState {
  return { groups: [], traditions: [], participation: [], transmissions: [], communityHistory: [] };
}

/** How well a group holds a tradition, and how much of that reading is sample. */
export interface TraditionReading {
  readonly traditionId: string;
  /** Mean participation weight of the holders on record, 0..1. */
  readonly strength: number;
  /** How many people the reading is based on. */
  readonly sampleSize: number;
  /** 0..1; thin samples are reported as thin rather than smoothed over. */
  readonly confidence: number;
  readonly contested: boolean;
  readonly byLevel: Readonly<Record<ParticipationLevel, number>>;
}

/** A community's shape, including how lopsided it is. */
export interface GroupProfile {
  readonly groupId: string;
  readonly participants: number;
  readonly byLevel: Readonly<Record<ParticipationLevel, number>>;
  readonly dominant: ParticipationLevel | undefined;
  readonly traditionCount: number;
  /**
   * 0..1 how evenly participation is spread. A low value means a committed core
   * with a fringe around it, which is a real community and not a failed
   * measurement — so it is reported rather than corrected.
   */
  readonly evenness: number;
}

/** Two traditions that cannot both be complied with in the same place. */
export interface NormConflict {
  readonly locationId: string;
  readonly kind: TraditionKind;
  readonly domain: string;
  readonly traditions: readonly {
    readonly traditionId: string;
    readonly groupId: string;
    readonly groupName: string;
  }[];
}

/** What one person carries from more than one group. */
export interface MixingProfile {
  readonly personId: string;
  readonly groupIds: readonly string[];
  readonly traditionIds: readonly string[];
  readonly multiGroup: boolean;
}

export interface MixingIndex {
  readonly locationId: string;
  readonly participants: number;
  readonly multiGroupCount: number;
  /** 0..1 share of participants holding traditions from more than one group. */
  readonly index: number;
}

/** How much of one generation's tradition the next kept. */
export interface GenerationalChange {
  readonly olderPersonId: string;
  readonly youngerPersonId: string;
  /** Carried by both, at whatever weight each holds it. */
  readonly retained: readonly string[];
  /** Carried by the older, not at all by the younger. */
  readonly dropped: readonly string[];
  /** Carried by the younger, not at all by the older. */
  readonly adopted: readonly string[];
  /**
   * Mean share of the older holder's carrying the younger keeps, 0..1. A
   * tradition that weakens without being lost scores between 0 and 1; only an
   * outright absence scores 0.
   */
  readonly persistence: number;
  /** The holding weight on each side, so a decline can be read rather than guessed. */
  readonly weights: Readonly<Record<string, { readonly older: number; readonly younger: number }>>;
}

/** A bounded weight, plus the evidence behind it. Never a decision. */
export interface CulturalInfluence {
  readonly traditionId: string;
  readonly influence: number;
  readonly sampleSize: number;
  readonly confidence: number;
  readonly contested: boolean;
}

/** What a place makes available to someone who arrives there. */
export interface Availability {
  readonly locationId: string;
  readonly groupIds: readonly string[];
  readonly traditionIds: readonly string[];
}

/** The factors behind a transmission probability, in the order applied. */
export interface TransmissionDrivers {
  readonly probability: number;
  readonly drivers: readonly string[];
}

