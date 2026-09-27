/**
 * System 50 â€” Communication / Messaging.
 *
 * "Communication transmits signals; it does not guarantee understanding"
 * (System 50 core principle).
 *
 * The system owns the *mechanism* and is disciplined about what the
 * mechanism does not decide:
 *
 *   1. **Delivery is not comprehension.** A message records that it arrived
 *      and how the recipient treated it â€” ignored, delayed, misunderstood,
 *      partially read, distrusted. Which of those happened is supplied by
 *      the caller (cognition decides; this system records), because an engine
 *      that rolled reception itself would be simulating minds it does not
 *      own.
 *   2. **Information is System 49's.** A message may *reference* claims by
 *      id; it never restates or evaluates them, and it never judges whether
 *      a claim it carries is true.
 *   3. **Relationships are System 18's.** A message can change how two
 *      people feel about each other, but the feeling itself is stored
 *      there. This system records that a reply was sent.
 *   4. **A MessageChannel is a set of trade-offs.** Speed, privacy, reach,
 *      permanence, cost, reliability and social expectation differ per
 *      MessageChannel, and the difference is why the same sentence sent two ways
 *      is two different acts.
 */

import type { Money } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";

/** The MessageChannel kinds the spec's rules contrast. */
export const MessageChannel_KINDS = [
  "in_person",
  "letter",
  "telephone",
  "message",
  "email",
  "broadcast",
  "meeting",
  "rumour",
] as const;
export type ChannelKind = (typeof MessageChannel_KINDS)[number];

/** How a recipient treated a delivered message (System 50's rule list). */
export const DELIVERY_OUTCOMES = [
  "delivered_unread",
  "read",
  "ignored",
  "delayed",
  "misunderstood",
  "partially_read",
  "distrusted",
] as const;
export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number];

/** Whether others can see the message exist. */
export type MessageVisibility = "private" | "group" | "public";

/**
 * A transport channel: how a message actually gets there, and what it costs
 * to say it this way.
 *
 * Named `MessageChannel` rather than `Channel` because System 49 already
 * has one under that name and the two are different objects: an
 * *information* channel is an audience and a reach (a notice board), while a
 * *message* channel is a delivery mechanism with its own trade-offs. The
 * same word for both would make "the channel" ambiguous in every sentence
 * that mentioned the two together.
 */
export interface MessageChannel {
  readonly id: string;
  readonly kind: ChannelKind;
  readonly name: string;
  /** Minutes to deliver, 0 for in person. */
  readonly deliveryMinutes: number;
  /** 0..1: who beyond the recipients can see this at all. */
  readonly privacy: number;
  /** 0..1 how far it travels if forwarded or overheard. */
  readonly reach: number;
  /** 0..1 how permanent a record remains. */
  readonly permanence: number;
  /** 0..1 likelihood of arriving at all, before circumstances. */
  readonly reliability: number;
  /** Money to send, in the caller's currency. */
  readonly cost: Money;
  /**
   * What sending it costs socially, 0..1 (an angry letter is noticed).
   * Optional because the default is ordinary: most messages are not
   * social events, and making every caller state that would be noise.
   */
  readonly socialExpectation?: number;
}

export interface RecipientState {
  readonly recipientId: string;
  readonly deliveredAt?: WorldTime;
  readonly outcome?: DeliveryOutcome;
  /** When they acted on it, if they did. */
  readonly respondedAt?: WorldTime;
  readonly note?: string;
}

export interface Message {
  readonly id: string;
  readonly senderId: string;
  readonly recipientIds: readonly string[];
  readonly channelId: string;
  readonly sentAt: WorldTime;
  readonly content: string;
  readonly visibility: MessageVisibility;
  readonly cost: Money;
  /** System 49 claims this message carries. Never evaluated here. */
  readonly linkedClaimIds: readonly string[];
  readonly attachmentNames: readonly string[];
  readonly replyToId?: string;
  readonly recipients: readonly RecipientState[];
  readonly history: readonly { readonly at: WorldTime; readonly kind: string; readonly note: string }[];
}

export interface MessagingSystemState {
  readonly channels: readonly MessageChannel[];
  readonly messages: readonly Message[];
}

/** The delivery outcome's effect on whether the message landed at all. */
export const DELIVERY_EFFECT = {
  /** Outcomes that mean the recipient engaged with the content. */
  engaged: ["read", "partially_read"] as const,
  /** Outcomes that mean it arrived but was not taken on. */
  notEngaged: ["delivered_unread", "ignored", "distrusted", "misunderstood", "delayed"] as const,
} as const;
