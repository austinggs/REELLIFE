/**
 * Messaging engine (System 50).
 *
 * Owns `systems.messaging`: channels and the messages sent over them, with
 * per-recipient delivery outcomes. Every write asserts ownership on that
 * slot; reads are scope-free.
 *
 * The engine transmits and records. It never interprets: `recordDelivery`
 * takes the outcome cognition arrived at and stores it, because "did she
 * understand it" is not a fact this system can observe any better than a
 * letter can.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { IdAllocator } from "../primitives/ids.ts";
import type { Money } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";
import {
  MessageChannel_KINDS,
  DELIVERY_OUTCOMES,
  type MessageChannel,
  type DeliveryOutcome,
  type Message,
  type MessageVisibility,
  type MessagingSystemState,
} from "./types.ts";

export interface DefineMessageChannelRequest {
  readonly id: string;
  readonly kind: MessageChannel["kind"];
  readonly name: string;
  readonly deliveryMinutes: number;
  readonly privacy: number;
  readonly reach: number;
  readonly permanence: number;
  readonly reliability: number;
  readonly cost: Money;
  readonly socialExpectation?: number;
}

export interface SendMessageRequest {
  readonly senderId: string;
  readonly recipientIds: readonly string[];
  readonly channelId: string;
  readonly content: string;
  readonly visibility?: MessageVisibility;
  readonly linkedClaimIds?: readonly string[];
  readonly attachmentNames?: readonly string[];
  readonly replyToId?: string;
}

export class MessagingEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.messaging) {
      this.scope.assertOwner("messaging");
      this.world.systems.messaging = { channels: [], messages: [] } satisfies MessagingSystemState;
    }
  }

  private get state(): MessagingSystemState {
    return this.world.systems.messaging as MessagingSystemState;
  }

  private set state(value: MessagingSystemState) {
    this.world.systems.messaging = value;
  }

  // ---------------------------------------------------------------- reads ---

  channels(): readonly MessageChannel[] {
    return this.state.channels;
  }

  MessageChannel(id: string): MessageChannel | undefined {
    return this.state.channels.find((candidate) => candidate.id === id);
  }

  requireChannel(id: string, caller: string): MessageChannel {
    const found = this.MessageChannel(id);
    if (found === undefined) {
      throw new Error(`MessagingEngine.${caller}: unknown channel ${id}`);
    }
    return found;
  }

  messages(): readonly Message[] {
    return this.state.messages;
  }

  message(id: string): Message | undefined {
    return this.state.messages.find((candidate) => candidate.id === id);
  }

  requireMessage(id: string, caller: string): Message {
    const found = this.message(id);
    if (found === undefined) {
      throw new Error(`MessagingEngine.${caller}: unknown message ${id}`);
    }
    return found;
  }

  /** Messages a person sent or received, oldest first. */
  messagesOf(personId: string): readonly Message[] {
    return this.state.messages.filter(
      (message) => message.senderId === personId || message.recipientIds.includes(personId),
    );
  }

  /** The conversation a message belongs to, including its ancestors. */
  threadOf(messageId: string): readonly Message[] {
    const first = this.requireMessage(messageId, "threadOf");
    const chain: Message[] = [first];
    const seen = new Set([first.id]);
    let current = first;
    while (current.replyToId !== undefined && !seen.has(current.replyToId)) {
      const parent = this.message(current.replyToId);
      if (parent === undefined) break;
      chain.unshift(parent);
      seen.add(parent.id);
      current = parent;
    }
    return chain;
  }

  // -------------------------------------------------------------- derived ---

  /**
   * Whether a message landed, derived from the recorded outcomes rather than
   * stored as a second opinion. A message can be delivered and still not
   * have landed, which is the spec's whole point about signals.
   */
  engagementOf(messageId: string): {
    readonly delivered: number;
    readonly engaged: number;
    readonly ignored: number;
    readonly rate: number | undefined;
  } {
    const message = this.requireMessage(messageId, "engagementOf");
    const delivered = message.recipients.filter((entry) => entry.outcome !== undefined).length;
    const engaged = message.recipients.filter(
      (entry) => entry.outcome === "read" || entry.outcome === "partially_read",
    ).length;
    const ignored = message.recipients.filter(
      (entry) => entry.outcome === "ignored" || entry.outcome === "distrusted",
    ).length;
    return {
      delivered,
      engaged,
      ignored,
      rate: delivered === 0 ? undefined : round4(engaged / delivered),
    };
  }

  /** Messages a person has not yet been delivered. */
  undeliveredFor(personId: string): readonly Message[] {
    return this.state.messages.filter((message) =>
      message.recipients.some((entry) => entry.recipientId === personId && entry.outcome === undefined),
    );
  }

  // --------------------------------------------------------------- writes ---

  defineChannel(request: DefineMessageChannelRequest): MessageChannel {
    this.scope.assertOwner("messaging");
    if (this.MessageChannel(request.id) !== undefined) {
      throw new Error(`MessagingEngine.defineChannel: MessageChannel ${request.id} already exists`);
    }
    if (!MessageChannel_KINDS.includes(request.kind)) {
      throw new Error(`MessagingEngine.defineChannel: unknown kind ${String(request.kind)}`);
    }
    if (!Number.isInteger(request.deliveryMinutes) || request.deliveryMinutes < 0) {
      throw new Error("MessagingEngine.defineChannel: deliveryMinutes must be a non-negative integer");
    }
    requireRatio(request.privacy, "privacy", "defineChannel");
    requireRatio(request.reach, "reach", "defineChannel");
    requireRatio(request.permanence, "permanence", "defineChannel");
    requireRatio(request.reliability, "reliability", "defineChannel");
    if (request.cost.minorUnits < 0) {
      throw new Error("MessagingEngine.defineChannel: cost must not be negative");
    }
    const MessageChannel: MessageChannel = {
      id: request.id,
      kind: request.kind,
      name: request.name,
      deliveryMinutes: request.deliveryMinutes,
      privacy: request.privacy,
      reach: request.reach,
      permanence: request.permanence,
      reliability: request.reliability,
      cost: request.cost,
      socialExpectation: request.socialExpectation ?? 0.3,
    };
    this.state = { ...this.state, channels: [...this.state.channels, MessageChannel] };
    return MessageChannel;
  }

  /**
   * Sends a message. Recipients begin undelivered: a message is *sent*, not
   * *received*, and that gap is exactly where the spec's misunderstandings,
   * ignores and delays live.
   */
  sendMessage(ids: IdAllocator, request: SendMessageRequest, at: WorldTime): Message {
    this.scope.assertOwner("messaging");
    const MessageChannel = this.requireChannel(request.channelId, "sendMessage");
    if (request.recipientIds.length === 0) {
      throw new Error("MessagingEngine.sendMessage: a message needs at least one recipient");
    }
    if (request.content.trim().length === 0) {
      throw new Error("MessagingEngine.sendMessage: a message needs content");
    }
    if (request.recipientIds.includes(request.senderId)) {
      throw new Error(`MessagingEngine.sendMessage: ${request.senderId} cannot be their own recipient`);
    }
    if (request.replyToId !== undefined) {
      this.requireMessage(request.replyToId, "sendMessage");
    }
    const visibility = request.visibility ?? (request.recipientIds.length > 1 ? "group" : "private");
    // A "private" message on a wide-open MessageChannel is a contradiction worth
    // refusing: the MessageChannel is what makes it visible.
    if (visibility === "private" && MessageChannel.privacy < 0.5 && request.recipientIds.length > 1) {
      throw new Error(
        `MessagingEngine.sendMessage: ${MessageChannel.id} is too public to carry a private message to several people`,
      );
    }
    const message: Message = {
      id: `msg-${ids.next("activity")}`,
      senderId: request.senderId,
      recipientIds: [...request.recipientIds],
      channelId: request.channelId,
      sentAt: at,
      content: request.content,
      visibility,
      cost: MessageChannel.cost,
      linkedClaimIds: [...(request.linkedClaimIds ?? [])],
      attachmentNames: [...(request.attachmentNames ?? [])],
      ...(request.replyToId === undefined ? {} : { replyToId: request.replyToId }),
      recipients: request.recipientIds.map((recipientId) => ({ recipientId })),
      history: [
        { at, kind: "sent", note: `${request.senderId} -> ${request.recipientIds.join(", ")} via ${MessageChannel.kind}` },
      ],
    };
    this.state = { ...this.state, messages: [...this.state.messages, message] };
    return message;
  }

  /**
   * Records what one recipient did with a message. The outcome is supplied
   * by the caller â€” cognition decides whether someone misunderstood it, and
   * this system's job is to keep the record straight, including the parts
   * that are unflattering to the sender.
   */
  recordDelivery(
    messageId: string,
    recipientId: string,
    outcome: DeliveryOutcome,
    at: WorldTime,
    note?: string,
  ): Message {
    this.scope.assertOwner("messaging");
    if (!DELIVERY_OUTCOMES.includes(outcome)) {
      throw new Error(`MessagingEngine.recordDelivery: unknown outcome ${String(outcome)}`);
    }
    const message = this.requireMessage(messageId, "recordDelivery");
    const entry = message.recipients.find((candidate) => candidate.recipientId === recipientId);
    if (entry === undefined) {
      throw new Error(`MessagingEngine.recordDelivery: ${recipientId} is not a recipient of ${messageId}`);
    }
    if (entry.outcome !== undefined) {
      throw new Error(`MessagingEngine.recordDelivery: ${messageId} already reached ${recipientId}`);
    }
    const updated: Message = {
      ...message,
      recipients: message.recipients.map((candidate) =>
        candidate.recipientId === recipientId
          ? { ...candidate, deliveredAt: at, outcome, ...(note === undefined ? {} : { note }) }
          : candidate,
      ),
      history: [
        ...message.history,
        { at, kind: "delivered", note: `${recipientId}: ${outcome}${note === undefined ? "" : ` (${note})`}` },
      ],
    };
    return this.replaceMessage(updated);
  }

  /** Attaches a System 49 claim to a message. The claim is not evaluated. */
  linkClaim(messageId: string, claimId: string): Message {
    this.scope.assertOwner("messaging");
    const message = this.requireMessage(messageId, "linkClaim");
    if (message.linkedClaimIds.includes(claimId)) {
      throw new Error(`MessagingEngine.linkClaim: ${messageId} already carries ${claimId}`);
    }
    return this.replaceMessage({
      ...message,
      linkedClaimIds: [...message.linkedClaimIds, claimId],
      history: [...message.history, { at: message.sentAt, kind: "linked_claim", note: claimId }],
    });
  }

  private replaceMessage(updated: Message): Message {
    this.state = {
      ...this.state,
      messages: this.state.messages.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      ),
    };
    return updated;
  }
}

// --------------------------------------------------------------- helpers ---

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function requireRatio(value: number, field: string, caller: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`MessagingEngine.${caller}: ${field} must be in [0, 1], received ${String(value)}`);
  }
}

