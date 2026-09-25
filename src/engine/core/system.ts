/**
 * ReelLife system contract (System 01).
 *
 * A system is a bounded module that owns declared state and participates in the
 * simulation step. Systems communicate through commands, events and
 * consequences; they do not reach into each other's state.
 *
 * Step discipline (documented here because order is part of the architecture):
 *   1. the clock advances one quantum,
 *   2. events due at or before the new time resolve, in deterministic order,
 *   3. systems receive onStep in dependency order,
 *   4. activities that elapsed without execution expire,
 *   5. history and metrics record what happened,
 *   6. invariants are checked (configuration dependent).
 */

import type { SystemId } from "./ownership.ts";
import type { IdAllocator } from "../primitives/ids.ts";
import type { Duration, WorldTime } from "../primitives/time.ts";
import type { EntityRef } from "../primitives/entity.ts";
import type { RngRegistry } from "../rng/streams.ts";
import type { Calendar } from "../time/calendar.ts";
import type { EventDraft, WorldEvent } from "../events/types.ts";
import type { ActivitiesEngine } from "../activities/engine.ts";
import type { TraceLog } from "../observability/trace.ts";
import type { MetricsCollector } from "../observability/metrics.ts";
import type { ConfigState } from "../config/types.ts";

export type SystemLogFn = (
  message: string,
  data?: Readonly<Record<string, unknown>>,
) => void;

/** Context handed to a system when its state is created. */
export interface SystemInitContext {
  readonly systemId: SystemId;
  readonly time: WorldTime;
  readonly calendar: Calendar;
  readonly config: ConfigState;
  readonly ids: IdAllocator;
  readonly rng: RngRegistry;
  readonly log: SystemLogFn;
}

/** Context handed to a system during a simulation step or event delivery. */
export interface StepContext<S extends object = object> {
  readonly systemId: SystemId;
  readonly time: WorldTime;
  readonly stepIndex: number;
  /** This system's own state. Systems may replace or mutate it freely. */
  state: S;
  readonly calendar: Calendar;
  readonly config: ConfigState;
  readonly ids: IdAllocator;
  readonly rng: RngRegistry;
  readonly activities: ActivitiesEngine;
  readonly trace: TraceLog;
  readonly metrics: MetricsCollector;
  /** Records an occurrence. The event engine assigns identity and ordering. */
  readonly emit: (draft: EventDraft) => WorldEvent;
  /** Schedules an occurrence for later; never a hidden timer. */
  readonly schedule: (delay: Duration, draft: EventDraft) => WorldEvent;
  readonly log: SystemLogFn;
}

export interface SerializableSystem<S extends object> {
  serialize(state: S): unknown;
  deserialize(data: unknown): S;
}

export interface SystemDefinition<S extends object = object> extends SerializableSystem<S> {
  readonly id: SystemId;
  readonly title: string;
  /** Systems that must step before this one. Used for deterministic ordering. */
  readonly dependsOn?: readonly SystemId[];
  /** Sections outside `systems.<id>` this system may also write. */
  readonly additionalWrites?: readonly string[];
  createState(ctx: SystemInitContext): S;
  initialize?(ctx: StepContext<S>): void;
  /** Called once per quantum, before events resolve. */
  onTimeAdvanced?(ctx: StepContext<S>, from: WorldTime, to: WorldTime): void;
  /** Called once per quantum, after events resolve. */
  onStep?(ctx: StepContext<S>): void;
  /**
   * NOTE: systems observe events by registering an EventHandler with the event
   * engine (`Simulation.registerEventHandler`). There is deliberately no second,
   * competing event-delivery hook: a single delivery path keeps resolution order
   * and ownership unambiguous.
   */
  /** Cross-entity references held in this system's state, for integrity checks. */
  references?(state: S): readonly { readonly from: string; readonly ref: EntityRef }[];
  /** Monetary values held in this system's state, for the money invariant. */
  monetaryValues?(state: S): readonly { readonly label: string; readonly value: number }[];
  /** IDs registered by this system, for the uniqueness invariant. */
  entityIds?(state: S): readonly string[];
}
