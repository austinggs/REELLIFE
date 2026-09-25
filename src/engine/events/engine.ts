/**
 * ReelLife event engine (System 04).
 *
 * Responsibilities, and deliberately nothing more:
 *  - assign event identity, timestamp and a monotonic sequence,
 *  - keep events in a deterministic order (timestamp, priority, sequence),
 *  - revalidate preconditions at execution time,
 *  - route consequences to the system that owns the state being changed,
 *  - convert delayed effects into future scheduled events,
 *  - maintain causal chains (parent/child) for explanation and replay,
 *  - guard against event storms, duplicate consequences and runaway recursion.
 *
 * Non-responsibilities: domain semantics. The engine never interprets what a
 * health, finance, relationship or legal consequence means.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import { atTime, durationOf } from "../primitives/time.ts";
import type { SystemId } from "../core/ownership.ts";
import {
  compareEvents,
  DEFAULT_EVENT_PRIORITY,
  type ConsequenceDescriptor,
  type DelayedEffect,
  type EventCause,
  type EventDraft,
  type WorldEvent,
} from "./types.ts";

export interface EventEngineLimits {
  /** Maximum causal-chain length before the chain is considered a storm. */
  readonly maxChainDepth: number;
  /** Maximum events resolved in a single resolution pass. */
  readonly maxEventsPerResolution: number;
  /** Maximum delayed effects a single event may declare. */
  readonly maxDelayedEffectsPerEvent: number;
  /** How many recent events are remembered for dedupe/idempotency. */
  readonly dedupeMemory: number;
}

export const DEFAULT_EVENT_LIMITS: EventEngineLimits = {
  maxChainDepth: 32,
  maxEventsPerResolution: 2_000,
  maxDelayedEffectsPerEvent: 64,
  dedupeMemory: 4_096,
};

export class EventStormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventStormError";
  }
}

export interface CausalChain {
  readonly id: string;
  readonly rootEventId: EntityId<"event">;
  readonly eventIds: readonly EntityId<"event">[];
}

export interface EventEngineState {
  readonly sequence: number;
  readonly chainCounter: number;
  readonly queue: readonly WorldEvent[];
  readonly chainIndex: Readonly<Record<string, readonly string[]>>;
  readonly dedupeKeys: readonly string[];
}

export interface EventResolutionReport {
  readonly resolved: readonly WorldEvent[];
  readonly consequences: readonly ConsequenceDescriptor[];
  readonly scheduled: readonly WorldEvent[];
  readonly limitReached: boolean;
}

export interface ConsequenceRng {
  stream(path: string): { nextFloat(): number; nextInt(min: number, max: number): number };
}

export interface ConsequenceContext {
  readonly time: WorldTime;
  readonly rng: ConsequenceRng;
  /** Emitter used by consequence appliers that must record follow-up events. */
  readonly emit: (draft: EventDraft) => WorldEvent;
  readonly log: (message: string, data?: Readonly<Record<string, unknown>>) => void;
}

export type ConsequenceApplier = (
  payload: Readonly<Record<string, unknown>>,
  event: WorldEvent,
  context: ConsequenceContext,
) => void;

export interface EventHandler {
  readonly eventType: string;
  readonly systemId: SystemId;
  /** Revalidates the event at execution time; returning false cancels it. */
  precondition?(event: WorldEvent, context: ConsequenceContext): boolean;
  /** Produces the consequences that the owning systems will apply. */
  handle(event: WorldEvent, context: ConsequenceContext): readonly ConsequenceDescriptor[];
}

export function causeOf(
  kind: EventCause["kind"],
  description: string,
  extra?: Partial<EventCause>,
): EventCause {
  return { kind, description, ...extra };
}

export class EventEngine {
  private nextSequence: number;
  private chainCounter: number;
  private readonly queue: WorldEvent[] = [];
  private readonly recent: WorldEvent[] = [];
  private readonly chains = new Map<string, string[]>();
  private readonly chainRoots = new Map<string, string>();
  private readonly dedupe: string[] = [];
  private readonly dedupeSet = new Set<string>();
  private readonly limits: EventEngineLimits;

  constructor(state?: EventEngineState, limits: EventEngineLimits = DEFAULT_EVENT_LIMITS) {
    this.limits = limits;
    this.nextSequence = state?.sequence ?? 0;
    this.chainCounter = state?.chainCounter ?? 0;
    for (const event of state?.queue ?? []) this.queue.push(event);
    for (const [chainId, eventIds] of Object.entries(state?.chainIndex ?? {})) {
      this.chains.set(chainId, [...eventIds]);
      const root = eventIds[0];
      if (root !== undefined) this.chainRoots.set(chainId, root);
    }
    for (const key of state?.dedupeKeys ?? []) {
      this.dedupe.push(key);
      this.dedupeSet.add(key);
    }
    this.sortQueue();
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  /**
   * Creates and enqueues an event.
   *
   * A duplicate `dedupeKey` returns the previously emitted event instead of
   * creating a second one, which is how idempotency is guaranteed for recurring
   * consequences such as monthly charges. Dedupe memory is bounded, so an
   * extremely old duplicate may legitimately re-emit; that bound is explicit
   * rather than accidental.
   */
  emit(draft: EventDraft, now: WorldTime): WorldEvent {
    if (draft.dedupeKey !== undefined) {
      const prior = this.findRememberedEvent(draft.dedupeKey);
      if (prior) return prior;
    }

    const delayed = draft.delayedEffects ?? [];
    if (delayed.length > this.limits.maxDelayedEffectsPerEvent) {
      throw new EventStormError(
        `Event ${draft.type} declared ${delayed.length} delayed effects, limit is ${this.limits.maxDelayedEffectsPerEvent}`,
      );
    }

    const at = atTime(draft.at ?? now);
    if ((at as number) < 0) {
      throw new RangeError("Event timestamp cannot be negative");
    }

    const chainId = draft.parentEventId
      ? (this.chainIdOf(draft.parentEventId) ?? this.newChainId())
      : this.newChainId();

    const event: WorldEvent = {
      id: `EVT-${String(this.nextSequence + 1).padStart(8, "0")}` as EntityId<"event">,
      type: draft.type,
      at,
      sequence: this.nextSequence,
      priority: draft.priority ?? DEFAULT_EVENT_PRIORITY,
      cause: draft.cause,
      actors: draft.actors ?? [],
      targets: draft.targets ?? [],
      locationId: draft.locationId,
      visibility: draft.visibility ?? "public",
      knownBy: draft.knownBy ?? [],
      visibleFacts: draft.visibleFacts ?? [],
      hiddenFacts: draft.hiddenFacts ?? [],
      consequences: draft.consequences ?? [],
      delayedEffects: delayed,
      parentEventId: draft.parentEventId,
      causalChainId: chainId,
      tags: draft.tags ?? [],
      dedupeKey: draft.dedupeKey,
      metadata: draft.metadata,
    };

    this.nextSequence += 1;
    this.registerInChain(chainId, event);
    this.enqueue(event);
    this.remember(event);

    if (draft.dedupeKey !== undefined) this.rememberDedupeKey(draft.dedupeKey);

    return event;
  }

  /** Converts an event's declared delayed effects into future scheduled events. */
  scheduleDelayedEffects(source: WorldEvent, emit: (draft: EventDraft) => WorldEvent): WorldEvent[] {
    const created: WorldEvent[] = [];
    for (const effect of source.delayedEffects) {
      created.push(this.scheduleOne(source, effect, emit));
    }
    return created;
  }

  /** Delayed consequence = a future scheduled event, not a hidden timer. */
  scheduleOne(
    source: WorldEvent,
    effect: DelayedEffect,
    emit: (draft: EventDraft) => WorldEvent,
  ): WorldEvent {
    return emit({
      type: effect.eventType,
      cause: { kind: "chain", description: effect.description, parentEventId: source.id },
      actors: source.actors,
      targets: source.targets,
      locationId: source.locationId,
      visibility: effect.visibility ?? source.visibility,
      parentEventId: source.id,
      at: atTime((source.at as number) + durationOf(effect.delayMinutes)),
      consequences: effect.consequences ?? [],
      tags: [...source.tags, "delayed"],
    });
  }

  private findRememberedEvent(dedupeKey: string): WorldEvent | undefined {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const candidate = this.queue[index];
      if (candidate && candidate.dedupeKey === dedupeKey) return candidate;
    }
    for (let index = this.recent.length - 1; index >= 0; index -= 1) {
      const candidate = this.recent[index];
      if (candidate && candidate.dedupeKey === dedupeKey) return candidate;
    }
    return undefined;
  }

  private remember(event: WorldEvent): void {
    this.recent.push(event);
    while (this.recent.length > this.limits.dedupeMemory) this.recent.shift();
  }

  private rememberDedupeKey(key: string): void {
    this.dedupe.push(key);
    this.dedupeSet.add(key);
    while (this.dedupe.length > this.limits.dedupeMemory) {
      const evicted = this.dedupe.shift();
      if (evicted !== undefined) this.dedupeSet.delete(evicted);
    }
  }

  /**
   * Resolves every event due at or before `now`, in deterministic order.
   * Preconditions are revalidated; a stale event is cancelled rather than forced.
   */
  resolveDue(
    now: WorldTime,
    handlers: ReadonlyMap<string, EventHandler>,
    context: ConsequenceContext,
    onResolved?: (event: WorldEvent, consequences: readonly ConsequenceDescriptor[]) => void,
  ): EventResolutionReport {
    const due: WorldEvent[] = [];
    const remaining: WorldEvent[] = [];
    for (const event of this.queue) {
      if ((event.at as number) <= (now as number)) due.push(event);
      else remaining.push(event);
    }
    due.sort(compareEvents);

    this.queue.length = 0;
    for (const event of remaining) this.queue.push(event);
    this.sortQueue();

    const resolved: WorldEvent[] = [];
    const allConsequences: ConsequenceDescriptor[] = [];
    const scheduled: WorldEvent[] = [];
    let limitReached = false;

    for (const event of due) {
      if (resolved.length >= this.limits.maxEventsPerResolution) {
        limitReached = true;
        // The untouched remainder goes back into the queue: nothing is dropped.
        this.enqueue(event);
        continue;
      }

      const depth = this.chainDepth(event);
      if (depth > this.limits.maxChainDepth) {
        throw new EventStormError(
          `Causal chain ${event.causalChainId} exceeded depth ${this.limits.maxChainDepth} at event ${event.id}`,
        );
      }

      const handler = handlers.get(event.type);
      if (handler) {
        if (handler.precondition && !handler.precondition(event, context)) {
          continue; // Stale event: the conditions that produced it no longer hold.
        }
        // The event's own declared effects apply first, then anything the handler
        // derives from it. Order is explicit so causality reads top-down.
        allConsequences.push(...event.consequences);
        allConsequences.push(...handler.handle(event, context));
      } else {
        // No handler: the event's declared effects still apply, and the missing
        // handler is reported so the gap is visible.
        allConsequences.push(...event.consequences);
        context.log(`No handler registered for event type ${event.type}`, { eventId: event.id });
      }

      resolved.push(event);
      onResolved?.(event, event.consequences);

      if (event.delayedEffects.length > 0) {
        scheduled.push(...this.scheduleDelayedEffects(event, context.emit));
      }
    }

    return { resolved, consequences: allConsequences, scheduled, limitReached };
  }

  /** Events due at or before `now`, without resolving them (inspection only). */
  peekDue(now: WorldTime): readonly WorldEvent[] {
    return this.queue.filter((event) => (event.at as number) <= (now as number)).sort(compareEvents);
  }

  queueSnapshot(): readonly WorldEvent[] {
    return [...this.queue].sort(compareEvents);
  }

  /**
   * Recently emitted events, newest first. This is a bounded in-memory window for
   * live feeds and debugging; the durable record is the history store, which is
   * why nothing here is persisted.
   */
  recentEvents(limit = 50): readonly WorldEvent[] {
    return [...this.recent].reverse().slice(0, Math.max(0, limit));
  }

  chainOf(chainId: string): readonly string[] {
    return this.chains.get(chainId) ?? [];
  }

  chainRootOf(chainId: string): string | undefined {
    return this.chainRoots.get(chainId);
  }

  knownChainIds(): string[] {
    return [...this.chains.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  serialize(): EventEngineState {
    return {
      sequence: this.nextSequence,
      chainCounter: this.chainCounter,
      queue: this.queueSnapshot(),
      chainIndex: Object.fromEntries(
        [...this.chains.entries()].map(([id, ids]) => [id, [...ids]] as const),
      ),
      dedupeKeys: [...this.dedupeSet],
    };
  }

  static deserialize(state: EventEngineState, limits?: EventEngineLimits): EventEngine {
    return new EventEngine(state, limits ?? DEFAULT_EVENT_LIMITS);
  }

  private enqueue(event: WorldEvent): void {
    this.queue.push(event);
    this.sortQueue();
  }

  private sortQueue(): void {
    this.queue.sort(compareEvents);
  }

  private newChainId(): string {
    this.chainCounter += 1;
    return `CHN-${String(this.chainCounter).padStart(6, "0")}`;
  }

  private chainIdOf(eventId: EntityId<"event">): string | undefined {
    for (const [chainId, ids] of this.chains) {
      if (ids.includes(eventId)) return chainId;
    }
    return undefined;
  }

  private registerInChain(chainId: string, event: WorldEvent): void {
    const existing = this.chains.get(chainId);
    if (existing) {
      existing.push(event.id);
      return;
    }
    this.chains.set(chainId, [event.id]);
    this.chainRoots.set(chainId, event.id);
  }

  private chainDepth(event: WorldEvent): number {
    const ids = this.chains.get(event.causalChainId);
    return ids ? ids.length : 1;
  }
}


