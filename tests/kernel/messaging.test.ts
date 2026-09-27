/**
 * System 50 — messaging: delivery that is not comprehension, the spec's
 * unhappy outcomes, privacy boundaries, and claims carried unjudged.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { MessagingEngine } from "../../src/engine/messaging/engine.ts";
import type { MessageChannel } from "../../src/engine/messaging/types.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { currencyId, money } from "../../src/engine/primitives/money.ts";
import { addTime, days, minutes, type WorldTime } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-messaging-seed";
const AUR = currencyId("AUR");
const SENDER = "PER-MSG-A";
const FRIEND = "PER-MSG-B";
const STRANGER = "PER-MSG-C";
const TALK = "CH-MSG-TALK";
const LETTER = "CH-MSG-LETTER";

let T0: WorldTime;

function newWorld(): Simulation {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
  T0 = sim.clock.time;
  return sim;
}

function withMessaging<T>(sim: Simulation, fn: (engine: MessagingEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("messaging", () => {
    result = fn(new MessagingEngine(sim.scope, sim.world));
  });
  return result;
}

/** Two channels with deliberately opposite trade-offs. */
function scenario(sim: Simulation, fn: (engine: MessagingEngine, ids: IdAllocator) => void): void {
  withMessaging(sim, (engine) => {
    const ids = new IdAllocator();
    const talking: MessageChannel = {
      id: TALK,
      kind: "in_person",
      name: "Talking",
      deliveryMinutes: 0,
      privacy: 0.9,
      reach: 0.1,
      permanence: 0,
      reliability: 0.95,
      cost: money(AUR, 0),
    };
    const letter: MessageChannel = {
      id: LETTER,
      kind: "letter",
      name: "Letter",
      deliveryMinutes: days(2),
      privacy: 0.7,
      reach: 0.05,
      permanence: 0.9,
      reliability: 0.6,
      cost: money(AUR, 20),
    };
    engine.defineChannel(talking);
    engine.defineChannel(letter);
    fn(engine, ids);
  });
}

describe("messaging (System 50)", () => {
  it("sends a message that has been sent but not received", () => {
    const sim = newWorld();
    scenario(sim, (engine, ids) => {
      const message = engine.sendMessage(
        ids,
        {
          senderId: SENDER,
          recipientIds: [FRIEND, STRANGER],
          channelId: TALK,
          content: "the quay shift moved to first light",
        },
        T0,
      );
      // A message is sent, not received: nobody has done anything yet.
      expect(message.recipients.every((entry) => entry.outcome === undefined)).toBe(true);
      expect(engine.engagementOf(message.id).rate).toBeUndefined();
      expect(engine.undeliveredFor(FRIEND)).toHaveLength(1);

      // One reads it, one ignores it — and both arrived.
      engine.recordDelivery(message.id, FRIEND, "read", addTime(T0, minutes(5)));
      engine.recordDelivery(message.id, STRANGER, "ignored", addTime(T0, minutes(5)));
      const engagement = engine.engagementOf(message.id);
      expect(engagement.delivered).toBe(2);
      expect(engagement.engaged).toBe(1);
      expect(engagement.ignored).toBe(1);
      expect(engagement.rate).toBe(0.5);
      // Delivery is recorded once per recipient, never re-decided.
      expect(() => engine.recordDelivery(message.id, FRIEND, "read", T0)).toThrow(/already reached/);
      expect(() => engine.recordDelivery(message.id, SENDER, "read", T0)).toThrow(/not a recipient/);
    });
  });

  it("keeps the spec's unhappy outcomes representable", () => {
    const sim = newWorld();
    scenario(sim, (engine, ids) => {
      // Understood, half-understood, misunderstood, distrusted, delayed: all
      // are recorded outcomes, and none is a failure of the engine.
      const message = engine.sendMessage(
        ids,
        { senderId: SENDER, recipientIds: [FRIEND], channelId: TALK, content: "the flour is short" },
        T0,
      );
      engine.recordDelivery(message.id, FRIEND, "misunderstood", T0, "thought it was an order");
      const stored = engine.requireMessage(message.id, "test");
      expect(stored.recipients[0]?.outcome).toBe("misunderstood");
      expect(stored.recipients[0]?.note).toMatch(/thought it was an order/);
      // A misunderstood message is not engagement, and the record says so.
      expect(engine.engagementOf(message.id).engaged).toBe(0);
      expect(engine.engagementOf(message.id).delivered).toBe(1);
      expect(() =>
        engine.recordDelivery(message.id, FRIEND, "teleported" as never, T0),
      ).toThrow(/unknown outcome/);
    });
  });

  it("refuses a message its channel cannot carry", () => {
    const sim = newWorld();
    scenario(sim, (engine, ids) => {
      expect(() =>
        engine.sendMessage(
          ids,
          { senderId: SENDER, recipientIds: [FRIEND], channelId: TALK, content: "  " },
          T0,
        ),
      ).toThrow(/needs content/);
      expect(() =>
        engine.sendMessage(ids, { senderId: SENDER, recipientIds: [], channelId: TALK, content: "x" }, T0),
      ).toThrow(/at least one recipient/);
      expect(() =>
        engine.sendMessage(
          ids,
          { senderId: SENDER, recipientIds: [SENDER], channelId: TALK, content: "x" },
          T0,
        ),
      ).toThrow(/cannot be their own recipient/);
      expect(() =>
        engine.sendMessage(
          ids,
          { senderId: SENDER, recipientIds: [FRIEND], channelId: "CH-MSG-NOT-REAL", content: "x" },
          T0,
        ),
      ).toThrow(/unknown channel CH-MSG-NOT-REAL/);
      // A private message to two people on an open channel is a contradiction.
      engine.defineChannel({
        id: "CH-MSG-OPEN",
        kind: "rumour",
        name: "Open",
        deliveryMinutes: 0,
        privacy: 0.1,
        reach: 0.9,
        permanence: 0.1,
        reliability: 0.5,
        cost: money(AUR, 0),
      });
      expect(() =>
        engine.sendMessage(
          ids,
          {
            senderId: SENDER,
            recipientIds: [FRIEND, STRANGER],
            channelId: "CH-MSG-OPEN",
            content: "x",
            visibility: "private",
          },
          T0,
        ),
      ).toThrow(/too public/);
    });
  });

  it("threads replies and carries claims without judging them", () => {
    const sim = newWorld();
    scenario(sim, (engine, ids) => {
      const first = engine.sendMessage(
        ids,
        { senderId: SENDER, recipientIds: [FRIEND], channelId: LETTER, content: "the mill is shut" },
        T0,
      );
      // A claim can travel with a message; the message does not evaluate it.
      engine.linkClaim(first.id, "CLM-TEST-1");
      const reply = engine.sendMessage(
        ids,
        {
          senderId: FRIEND,
          recipientIds: [SENDER],
          channelId: LETTER,
          content: "one oven only",
          replyToId: first.id,
        },
        addTime(T0, days(3)),
      );
      expect(engine.threadOf(reply.id).map((message) => message.id)).toEqual([first.id, reply.id]);
      expect(engine.requireMessage(first.id, "test").linkedClaimIds).toEqual(["CLM-TEST-1"]);
      expect(() => engine.linkClaim(first.id, "CLM-TEST-1")).toThrow(/already carries/);
      // The letter cost what the channel costs; the money is System 25's.
      expect(engine.requireMessage(first.id, "test").cost.minorUnits).toBe(20);
      expect(engine.messagesOf(SENDER)).toHaveLength(2);
    });
  });

  it("keeps messaging state under single ownership and in the save format", () => {
    const sim = newWorld();
    scenario(sim, (engine, ids) => {
      engine.sendMessage(
        ids,
        { senderId: SENDER, recipientIds: [FRIEND], channelId: TALK, content: "x" },
        T0,
      );
    });

    const reader = new MessagingEngine(sim.scope, sim.world);
    expect(() => reader.recordDelivery("msg-NOT-REAL", FRIEND, "read", T0)).toThrow(
      MissingWriterContextError,
    );
    expect(() =>
      sim.guard.mutate("markets", () => {
        new MessagingEngine(sim.scope, sim.world).recordDelivery("msg-NOT-REAL", FRIEND, "read", T0);
      }),
    ).toThrow(OwnershipViolationError);

    const bag = (sim.serializedWorld() as { readonly systems?: Record<string, unknown> }).systems;
    const state = bag?.["messaging"] as {
      readonly channels: readonly unknown[];
      readonly messages: readonly unknown[];
    };
    expect(state.channels).toHaveLength(2);
    expect(state.messages).toHaveLength(1);
  });
});

