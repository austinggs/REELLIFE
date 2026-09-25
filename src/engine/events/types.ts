/**
 * ReelLife event structures (System 04).
 *
 *   Action      = an attempt
 *   Event       = an occurrence
 *   Consequence = a resulting change
 *
 * The event engine is causal plumbing. It orders, dispatches, links, delays and
 * deduplicates occurrences; it never decides what a health, finance or legal
 * consequence means. Domain systems own their own mutations and register the
 * consequence appliers that perform them.
 *
 * Event visibility is separate from event existence: the engine stores both
 * visible and hidden facts, and presentation filters by observer.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { EntityRef } from "../primitives/entity.ts";
import type { Visibility } from "../primitives/information.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { SystemId } from "../core/ownership.ts";

export const EVENT_ORIGINS = [
  "player",
  "npc",
  "system",
  "environment",
  "institution",
  "schedule",
  "chain",
] as const;
export type EventOrigin = (typeof EVENT_ORIGINS)[number];

/** Why an event happened. Every event must be explainable (System 59). */
export interface EventCause {
  readonly kind: EventOrigin;
  readonly description: string;
  readonly commandId?: EntityId<"command">;
  readonly parentEventId?: EntityId<"event">;
  readonly systemId?: SystemId;
}

/**
 * A declarative request to change state, addressed to the owning system. The
 * event engine routes these; it does not interpret them.
 */
export interface ConsequenceDescriptor {
  /** Consequence type registered by the owning system, e.g. "needs.satisfy". */
  readonly type: string;
  /** The system that must perform the change. */
  readonly owner: SystemId;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** An effect that happens later, represented as a future scheduled event. */
export interface DelayedEffect {
  readonly delayMinutes: number;
  readonly eventType: string;
  readonly description: string;
  readonly visibility?: Visibility;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly consequences?: readonly ConsequenceDescriptor[];
}

export interface WorldEvent {
  readonly id: EntityId<"event">;
  readonly type: string;
  readonly at: WorldTime;
  /** Monotonic sequence within the engine; makes same-time ordering total. */
  readonly sequence: number;
  /** Higher priority resolves first among events at the same timestamp. */
  readonly priority: number;
  readonly cause: EventCause;
  readonly actors: readonly EntityRef[];
  readonly targets: readonly EntityRef[];
  readonly locationId?: string;
  readonly visibility: Visibility;
  readonly knownBy: readonly EntityId<"person">[];
  /** Facts safe to show to an observer with access to the event. */
  readonly visibleFacts: readonly string[];
  /** Facts the engine knows but must not expose without access. */
  readonly hiddenFacts: readonly string[];
  readonly consequences: readonly ConsequenceDescriptor[];
  readonly delayedEffects: readonly DelayedEffect[];
  readonly parentEventId?: EntityId<"event">;
  readonly causalChainId: string;
  readonly tags: readonly string[];
  /** Suppresses accidental duplicates, e.g. the same rent charge twice. */
  readonly dedupeKey?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface EventDraft {
  readonly type: string;
  readonly cause: EventCause;
  readonly actors?: readonly EntityRef[];
  readonly targets?: readonly EntityRef[];
  readonly locationId?: string;
  readonly visibility?: Visibility;
  readonly knownBy?: readonly EntityId<"person">[];
  readonly visibleFacts?: readonly string[];
  readonly hiddenFacts?: readonly string[];
  readonly consequences?: readonly ConsequenceDescriptor[];
  readonly delayedEffects?: readonly DelayedEffect[];
  readonly parentEventId?: EntityId<"event">;
  readonly priority?: number;
  readonly tags?: readonly string[];
  readonly dedupeKey?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Overrides "now" for delayed/backdated events; must not move time backwards. */
  readonly at?: WorldTime;
}

export const DEFAULT_EVENT_PRIORITY = 0;

/** Ordered by timestamp, then priority, then sequence: fully deterministic. */
export function compareEvents(a: WorldEvent, b: WorldEvent): number {
  if ((a.at as number) !== (b.at as number)) return (a.at as number) - (b.at as number);
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.sequence - b.sequence;
}

export function describeEvent(event: WorldEvent): string {
  const facts = event.visibleFacts.length > 0 ? ` - ${event.visibleFacts.join("; ")}` : "";
  return `[${String(event.at)}] ${event.type}${facts}`;
}
