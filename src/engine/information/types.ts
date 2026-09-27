/**
 * System 49 â€” Information / Communication / Media.
 *
 * "The world contains more truth than any person can know, and information
 * travels imperfectly" (System 49 core principle).
 *
 * The whole system turns on one distinction it is *forbidden* to collapse:
 *
 *   1. **A claim is not a fact.** A `CirculatingClaim` records what someone
 *      said, about what, and how it spread. Its `status` is set only by an
 *      explicit, dated `verifyClaim` that names a method and an evidence
 *      reference â€” never by the claim's own confidence, its audience size,
 *      or how true it feels. A claim with ten thousand readers and a claim
 *      with one are the same kind of object.
 *   2. **Exposure is not belief.** An `Exposure` records that a node was
 *      *reached*. What that node concludes is System 15's cognition, and two
 *      nodes being reached while believing opposite things is exactly the
 *      divergence this milestone's DoD asserts.
 *   3. **Truth belongs to the world.** A claim points at a `subjectRef` â€” the
 *      event, person or organization it is about â€” and this system never
 *      evaluates that subject. Whether the bakery really was shut down is
 *      System 33/34's record; that a *claim* about it is circulating is this
 *      system's.
 *   4. **Transport is System 50's.** A channel here is an audience and a
 *      reach, not a message queue: the mechanism of delivering a message and
 *      whether it is understood belong to messaging and cognition.
 *
 * Propagation is therefore *derived* from named factors and the social graph
 * and consults no hidden randomness: a claim's spread is a function of source
 * credibility, novelty, emotional charge, channel reach and who is actually
 * connected. That makes a rumor reproducible, which a rumor in the real
 * world is not, and is the price of being testable.
 */

import type { WorldTime } from "../primitives/time.ts";

/** The spec's claim states. `unverified` is where every claim starts. */
export const VERACITY_STATUSES = [
  "unverified",
  "verified_true",
  "verified_false",
  "partial",
  "misleading",
  "outdated",
  "disputed",
] as const;
export type VeracityStatus = (typeof VERACITY_STATUSES)[number];

/** How a claim came into the world. Provenance, not credibility. */
export const ORIGIN_KINDS = ["observed", "reported", "rumor", "official"] as const;
export type OriginKind = (typeof ORIGIN_KINDS)[number];

/** Who a claim is about â€” the world's own record, never restated here. */
export interface ClaimSubject {
  /** e.g. "organization", "event", "person", "good". */
  readonly kind: string;
  readonly id: string;
}

export interface ClaimEvent {
  readonly at: WorldTime;
  readonly kind: string;
  readonly note: string;
}

/**
 * The system's own record of a claim as it circulates.
 *
 * Named `CirculatingClaim` rather than `InformationClaim` on purpose: the
 * kernel primitive of that name (`primitives/information.ts`) is the
 * *observer-facing* claim a projection hands to the UI — what one person is
 * told, with `knownBy`, visibility and actuality attached. This record is the
 * authoritative world-side one: what was said, by whom, how it spread, and
 * what anyone has since verified about it. The two are related, they are not
 * the same thing, and renaming was cheaper than pretending the primitive did
 * not exist.
 */
export interface CirculatingClaim {
  readonly id: string;
  readonly subject: ClaimSubject;
  /** The claim as stated, in the words it was told in. */
  readonly text: string;
  /** The node that first put it into the world. */
  readonly createdBy: string;
  readonly createdAt: WorldTime;
  readonly origin: OriginKind;
  /** Provenance: the claim this one was copied from. */
  readonly derivedFromClaimId?: string;
  readonly status: VeracityStatus;
  /** 0..1 credibility of the *source*, not of the claim. */
  readonly sourceCredibility: number;
  /** 0..1 how new or unusual this is. */
  readonly novelty: number;
  /** 0..1 how charged the telling of it is. */
  readonly emotionalCharge: number;
  /** `private` reaches one named audience; `public` anyone connected. */
  readonly audience: "public" | "private" | "closed";
  /** A correction: the claim this one replaces. */
  readonly supersedesClaimId?: string;
  /** Claims that contradict this one. */
  readonly contradictedByClaimIds: readonly string[];
  /** Set when a verification named a method and evidence. */
  readonly verifiedBy?: {
    readonly at: WorldTime;
    readonly method: string;
    readonly evidenceRef: string;
  };
  readonly history: readonly ClaimEvent[];
}

/** A node in the information graph. */
export interface InformationNode {
  readonly id: string;
  /** person | organization | media | place | event. */
  readonly kind: string;
  readonly name: string;
  /** 0..1 baseline credibility, for sources that have one. */
  readonly credibility?: number;
}

/** Social graph edges. Structure only â€” no feelings live here. */
export const LINK_KINDS = ["follows", "works_at", "member_of", "reports_to", "trades_with"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export interface SocialLink {
  readonly from: string;
  readonly to: string;
  readonly kind: LinkKind;
  readonly at: WorldTime;
}

/** A channel of publication: an audience, not a transport mechanism. */
export interface Channel {
  readonly id: string;
  readonly kind: "word_of_mouth" | "market" | "notice_board" | "newspaper" | "broadcast" | "social";
  readonly name: string;
  readonly operatorId: string;
  /** 0..1 how far one telling travels through this channel. */
  readonly reachBase: number;
  readonly moderated: boolean;
  /** Subscribers. Propagation only reaches nodes reachable from these. */
  readonly audienceIds: readonly string[];
}

/** A node was *reached* by a claim. Not what it believes. */
export interface Exposure {
  readonly claimId: string;
  readonly nodeId: string;
  readonly at: WorldTime;
  readonly channelId: string;
  /** The node that passed it on, when not the channel's operator. */
  readonly viaNodeId?: string;
  /** The computed exposure score that carried it. */
  readonly reach: number;
  /** Rumours can be forgotten; the record of having heard it remains. */
  readonly forgottenAt?: WorldTime;
}

export const MODERATION_ACTIONS = ["flagged", "downranked", "removed", "restored"] as const;
export type ModerationActionKind = (typeof MODERATION_ACTIONS)[number];

export interface ModerationRecord {
  readonly id: string;
  readonly channelId: string;
  readonly claimId: string;
  readonly at: WorldTime;
  readonly action: ModerationActionKind;
  readonly reason: string;
  readonly by: string;
}

export interface InformationSystemState {
  readonly nodes: readonly InformationNode[];
  readonly links: readonly SocialLink[];
  readonly claims: readonly CirculatingClaim[];
  readonly channels: readonly Channel[];
  readonly exposures: readonly Exposure[];
  readonly moderations: readonly ModerationRecord[];
}

/**
 * The declared propagation factors (provisional; see docs/CONTENT_GAPS.md).
 * Every number here is named, and the whole spread is their product â€” a
 * claim cannot be "viral" for a reason nobody wrote down.
 */
export const PROPAGATION = {
  /** Exposure below this does not reach a node at all. */
  threshold: 0.15,
  /** Weight of the source's credibility in the carried value. */
  credibilityWeight: 0.4,
  noveltyWeight: 0.3,
  emotionalWeight: 0.3,
  /** A node's openness to a claim from a linked source, 0..1. */
  opennessBase: 0.6,
  /** Decay per hop away from the channel operator, compounding. */
  hopDecay: 0.6,
  /** Each re-telling is already second-hand, so it weakens. */
  retellDecay: 0.8,
  /** A removed claim is stopped; a downranked one only weakens. */
  downrankFactor: 0.5,
} as const;

/** How far a single claim gets, and who it reaches. Derived, never stored. */
export interface SpreadResult {
  readonly claimId: string;
  readonly channelId: string;
  readonly at: WorldTime;
  /** Nodes newly reached by this propagation, in the order they were reached. */
  readonly reached: readonly string[];
  /** Nodes the calculation considered and did not carry it to. */
  readonly notReached: readonly string[];
  /** The single most valuable exposure in this wave, and who got it. */
  readonly peak: { readonly nodeId: string; readonly reach: number } | undefined;
}


