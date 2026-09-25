/**
 * ReelLife world state (System 01).
 *
 * Two shapes exist and the difference matters:
 *
 *  In-memory `WorldState` holds only what the core genuinely owns: metadata, the
 *  shared registries, configuration, and one opaque state slot per domain system.
 *  The clock, RNG, event queue, activity schedule, history and command log live
 *  inside their owning engine objects, so the core never holds a stale copy of
 *  another system's truth.
 *
 *  `SerializedWorld` is the persisted layout. It contains the same sections plus
 *  the engine-owned ones, because a save must capture them. It is assembled at
 *  save time and consumed at load time, and exists nowhere else.
 *
 * The optional Proxy installed by `guardWorldState` enforces section ownership at
 * runtime; see docs/ARCHITECTURE.md for the two-layer enforcement model.
 */

import type { RngStreamSnapshot } from "../rng/streams.ts";
import type { CommandLogState } from "../commands/types.ts";
import type { EventEngineState } from "../events/engine.ts";
import type { ActivitiesState } from "../activities/engine.ts";
import type { HistoryState } from "../history/types.ts";
import type { WorldClockSnapshot } from "../time/clock.ts";
import type { ConfigState, DifficultyId, GameMode } from "../config/types.ts";
import type { IdAllocatorState } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { OwnershipGuard } from "./access.ts";

export interface WorldMeta {
  readonly worldId: string;
  readonly worldName: string;
  /** Incompatible serialization changes bump this. */
  readonly schemaVersion: number;
  /** Save-visible simulation semantics version. */
  readonly simulationVersion: number;
  readonly contentVersion: string;
  readonly rngVersion: number;
  /** Host-supplied creation label; metadata, never authoritative time. */
  readonly createdAtLabel: string;
  /** Canonical world start (1 January 2042 for Aurelia). */
  readonly startTime: WorldTime;
  /** 1 for the founding generation; increments on control transfer. */
  readonly generation: number;
  readonly mode: GameMode;
  readonly difficulty: DifficultyId;
  readonly masterSeed: string;
}

/**
 * Core-owned shared structures. Indexes in here are performance structures, not
 * alternate authoritative databases (System 01): they can always be rebuilt from
 * the systems that own the underlying records.
 */
export interface SharedState {
  readonly idAllocator: IdAllocatorState;
  readonly notes: readonly string[];
}

/** In-memory authoritative world state: core-owned truth only. */
export interface WorldState {
  readonly meta: WorldMeta;
  readonly shared: SharedState;
  readonly config: ConfigState;
  /** Per-system opaque state, owned exclusively by the system it belongs to. */
  readonly systems: Record<string, unknown>;
}

/** Persisted layout: core sections plus engine-owned sections. */
export interface SerializedWorld {
  readonly meta: WorldMeta;
  readonly shared: SharedState;
  readonly clock: WorldClockSnapshot;
  readonly rng: readonly RngStreamSnapshot[];
  readonly events: EventEngineState;
  readonly activities: ActivitiesState;
  readonly history: HistoryState;
  readonly commands: CommandLogState;
  readonly config: ConfigState;
  readonly systems: Record<string, unknown>;
}

export interface CreateWorldStateInput {
  readonly worldId: string;
  readonly worldName: string;
  readonly createdAtLabel: string;
  readonly startTime: WorldTime;
  readonly masterSeed: string;
  readonly mode: GameMode;
  readonly difficulty: DifficultyId;
  readonly schemaVersion: number;
  readonly simulationVersion: number;
  readonly contentVersion: string;
  readonly rngVersion: number;
  readonly config: ConfigState;
  readonly idAllocator: IdAllocatorState;
}

export function createWorldState(input: CreateWorldStateInput): WorldState {
  return {
    meta: {
      worldId: input.worldId,
      worldName: input.worldName,
      schemaVersion: input.schemaVersion,
      simulationVersion: input.simulationVersion,
      contentVersion: input.contentVersion,
      rngVersion: input.rngVersion,
      createdAtLabel: input.createdAtLabel,
      startTime: input.startTime,
      generation: 1,
      mode: input.mode,
      difficulty: input.difficulty,
      masterSeed: input.masterSeed,
    },
    shared: { idAllocator: input.idAllocator, notes: [] },
    config: input.config,
    systems: {},
  };
}

/**
 * Wraps the world state so writes are policed by the ownership guard.
 *
 * Covered: writes to top-level sections and to `systems.<id>` slots.
 * Not covered, by design and documented in docs/ARCHITECTURE.md: mutation of
 * nested fields inside a system's own state slot, and state held inside live
 * engine objects. Those are protected by `SystemScope.assertOwner` at the
 * engine mutating entry points.
 */
export function guardWorldState(state: WorldState, guard: OwnershipGuard): WorldState {
  const systemsHandler: ProxyHandler<Record<string, unknown>> = {
    set(target, property, value) {
      if (typeof property === "string") guard.checkWrite(`systems.${property}`);
      return Reflect.set(target, property, value);
    },
    deleteProperty(target, property) {
      if (typeof property === "string") guard.checkWrite(`systems.${property}`);
      return Reflect.deleteProperty(target, property);
    },
  };

  let systemsProxy: Record<string, unknown> | null = null;

  const handler: ProxyHandler<WorldState> = {
    get(target, property, receiver) {
      if (property === "systems") {
        if (systemsProxy === null) systemsProxy = new Proxy(target.systems, systemsHandler);
        return systemsProxy;
      }
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      if (typeof property === "string") guard.checkWrite(property);
      return Reflect.set(target, property, value, receiver);
    },
    deleteProperty(target, property) {
      if (typeof property === "string") guard.checkWrite(property);
      return Reflect.deleteProperty(target, property);
    },
  };

  return new Proxy(state, handler);
}

/**
 * True when the serialized layout is complete. Used by load-time validation so a
 * partial or hand-edited save fails with an explanation instead of undefined
 * behaviour later.
 */
export function isSerializedWorld(value: unknown): value is SerializedWorld {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const required = [
    "meta",
    "shared",
    "clock",
    "rng",
    "events",
    "activities",
    "history",
    "commands",
    "config",
    "systems",
  ];
  return required.every((key) => key in record);
}

