/**
 * ReelLife simulation (System 01, coordination layer).
 *
 * The Core is the operating system of the simulation, not the decision-maker for
 * every domain. This class:
 *  - owns the authoritative clock, RNG, event queue, activity schedule, history
 *    and command log instances,
 *  - registers systems and steps them in deterministic dependency order,
 *  - routes commands through the dispatcher,
 *  - assembles and restores `.reel` saves,
 *  - runs invariants and records metrics.
 *
 * It does not own domain decisions: affordability, forgiveness, promotion,
 * medical judgement and legal permission belong to the systems that own those
 * facts.
 */

import { OwnershipGuard, type SystemScope } from "./access.ts";
import { SYSTEM_IDS, type SystemId } from "./ownership.ts";
import {
  createWorldState,
  guardWorldState,
  isSerializedWorld,
  type SerializedWorld,
  type WorldState,
} from "./worldState.ts";
import type { StepContext, SystemDefinition, SystemInitContext } from "./system.ts";
import { AuthorityEvaluator, type AuthorityContext } from "../primitives/authority.ts";
import type { EntityRef } from "../primitives/entity.ts";
import { IdAllocator } from "../primitives/ids.ts";
import type { Duration, WorldTime } from "../primitives/time.ts";
import { atTime } from "../primitives/time.ts";
import { Calendar } from "../time/calendar.ts";
import { WorldClock } from "../time/clock.ts";
import { RNG_VERSION, RngRegistry } from "../rng/streams.ts";
import { canonicalJson, checksum32Hex } from "../rng/hash.ts";
import { EventEngine, type EventHandler } from "../events/engine.ts";
import type { EventDraft, WorldEvent } from "../events/types.ts";
import { ActivitiesEngine } from "../activities/engine.ts";
import { HistoryStore } from "../history/store.ts";
import { CommandRegistry } from "../commands/registry.ts";
import type { CommandDefinition } from "../commands/types.ts";
import { CommandLog } from "../commands/log.ts";
import { CommandDispatcher, type ConsequenceDescriptorApplier } from "../commands/dispatcher.ts";
import { TraceLog } from "../observability/trace.ts";
import { MetricsCollector, countingHostClock, type HostClock } from "../observability/metrics.ts";
import { InvariantRegistry, type InvariantContext, type InvariantReport } from "../observability/invariants.ts";
import {
  CONTENT_VERSION,
  SCHEMA_VERSION,
  SIMULATION_VERSION,
  ContentRegistry,
  createDefaultConfigState,
} from "../config/defaults.ts";
import type { ConfigState, GameConfig } from "../config/types.ts";
import { MemorySaveStore, type SaveStore } from "../persistence/store.ts";
import {
  FORMAT_VERSION,
  REEL_FORMAT,
  type ReelFile,
  type ReelHeader,
  type ReelSlotInfo,
} from "../persistence/format.ts";
import { MigrationRegistry } from "../persistence/migrations.ts";
import { assertValidReelFile, checksumOf } from "../persistence/validate.ts";

export interface CreateSimulationOptions {
  /** Deterministic master seed. Required: continuity depends on it. */
  readonly masterSeed: string;
  readonly worldId?: string;
  readonly worldName?: string;
  readonly createdAtLabel?: string;
  readonly config?: Partial<GameConfig>;
  readonly hostClock?: HostClock;
  readonly checkInvariants?: boolean;
  /** Systems to register immediately after creation or load. */
  readonly systems?: readonly SystemDefinition[];
  /**
   * Where saves are written. Defaults to an in-memory store, which is right for
   * tests and headless runs; hosts (browser, desktop) supply their own so
   * `world.save` reaches real storage. Saving never touches simulation state.
   */
  readonly saveStore?: SaveStore;
}

export interface LoadSimulationOptions extends CreateSimulationOptions {
  readonly saveStore: SaveStore;
  readonly slotName: string;
}

interface RegisteredSystem {
  readonly definition: SystemDefinition<object>;
  state: object;
}

/**
 * Save migrations are registered here rather than per instance, because a
 * migration path describes the engine, not a particular world.
 */
export const SAVE_MIGRATIONS = new MigrationRegistry();

const EMPTY_AUTHORITY_CONTEXT: AuthorityContext = {
  roles: [],
  credentials: [],
  permissions: [],
  ownedRefs: [],
  memberOf: [],
  legalStatus: "unknown",
  secrecyClearance: 0,
};

/** Parses the configured start date label into canonical world time. */
export function parseStartDateLabel(calendar: Calendar, label: string): WorldTime {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label.trim());
  if (!match) {
    throw new Error(`Start date label must look like "2042-01-01", received "${label}"`);
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  return calendar.timeFromDate(year, monthIndex, day);
}

export class Simulation {
  readonly guard: OwnershipGuard;
  readonly scope: SystemScope;
  readonly world: WorldState;
  readonly clock: WorldClock;
  readonly calendar: Calendar;
  readonly rng: RngRegistry;
  readonly events: EventEngine;
  readonly activities: ActivitiesEngine;
  readonly history: HistoryStore;
  readonly commandLog: CommandLog;
  readonly ids: IdAllocator;
  readonly content: ContentRegistry;
  readonly config: ConfigState;
  readonly registry: CommandRegistry;
  readonly dispatcher: CommandDispatcher;
  readonly trace: TraceLog;
  readonly metrics: MetricsCollector;
  readonly invariants: InvariantRegistry;
  readonly authority: AuthorityEvaluator;
  readonly checkInvariants: boolean;
  readonly saveStore: SaveStore;
  /**
   * In-flight asynchronous save writes queued by consequence appliers
   * (e.g. `world.save`). Saving is intentionally out-of-band: it must never
   * block or influence the synchronous dispatch pipeline, and its store
   * writes are promises. Tests and hosts await `awaitPendingSaves()` before
   * asserting storage contents.
   */
  readonly pendingSaves: Promise<void>[] = [];

  private readonly systems = new Map<SystemId, RegisteredSystem>();
  private readonly eventHandlers = new Map<string, EventHandler>();
  private readonly consequenceAppliers = new Map<string, ConsequenceDescriptorApplier>();

  private constructor(init: {
    guard: OwnershipGuard;
    world: WorldState;
    clock: WorldClock;
    calendar: Calendar;
    rng: RngRegistry;
    events: EventEngine;
    activities: ActivitiesEngine;
    history: HistoryStore;
    commandLog: CommandLog;
    ids: IdAllocator;
    content: ContentRegistry;
    config: ConfigState;
    trace: TraceLog;
    metrics: MetricsCollector;
    checkInvariants: boolean;
    saveStore: SaveStore;
  }) {
    this.guard = init.guard;
    this.scope = init.guard;
    this.world = init.world;
    this.clock = init.clock;
    this.calendar = init.calendar;
    this.rng = init.rng;
    this.events = init.events;
    this.activities = init.activities;
    this.history = init.history;
    this.commandLog = init.commandLog;
    this.ids = init.ids;
    this.content = init.content;
    this.config = init.config;
    this.trace = init.trace;
    this.metrics = init.metrics;
    this.invariants = new InvariantRegistry();
    this.authority = new AuthorityEvaluator();
    this.registry = new CommandRegistry();
    this.checkInvariants = init.checkInvariants;
    this.saveStore = init.saveStore;

    this.dispatcher = new CommandDispatcher({
      scope: init.guard,
      registry: this.registry,
      log: this.commandLog,
      events: this.events,
      rng: this.rng,
      authority: this.authority,
      trace: this.trace,
      metrics: this.metrics,
      history: this.history,
      currentTime: () => this.clock.time,
      stepIndex: () => this.clock.stepIndex,
      authorityContext: () => EMPTY_AUTHORITY_CONTEXT,
      handlers: this.eventHandlers,
      appliers: this.consequenceAppliers,
      strictConsequences: this.config.game.strictConsequences,
    });
  }

  // ------------------------------------------------------------- creation

  static create(options: CreateSimulationOptions): Simulation {
    const config = createDefaultConfigState(options.config);
    const calendar = new Calendar(config.calendar);
    const startTime = parseStartDateLabel(calendar, config.game.startDateLabel);
    const guard = new OwnershipGuard();
    const ids = new IdAllocator();

    const world = guardWorldState(
      createWorldState({
        worldId: options.worldId ?? "WORLD-AURELIA",
        worldName: options.worldName ?? "Aurelia",
        createdAtLabel: options.createdAtLabel ?? "unrecorded",
        startTime,
        masterSeed: options.masterSeed,
        mode: config.game.mode,
        difficulty: config.game.difficulty,
        schemaVersion: SCHEMA_VERSION,
        simulationVersion: SIMULATION_VERSION,
        contentVersion: CONTENT_VERSION,
        rngVersion: RNG_VERSION,
        config,
        idAllocator: ids.serialize(),
      }),
      guard,
    );

    const simulation = new Simulation({
      guard,
      world,
      clock: new WorldClock({
        startTime,
        speed: config.game.defaultSpeed,
        paused: true,
        quantumMinutes: config.game.quantumMinutes,
      }),
      calendar,
      rng: new RngRegistry(options.masterSeed),
      events: new EventEngine(),
      activities: new ActivitiesEngine(guard),
      history: new HistoryStore(guard),
      commandLog: new CommandLog(guard),
      ids,
      content: new ContentRegistry(config.calendar, config.currencies),
      config,
      trace: new TraceLog(),
      metrics: new MetricsCollector(options.hostClock ?? countingHostClock()),
      checkInvariants: options.checkInvariants ?? true,
      saveStore: options.saveStore ?? new MemorySaveStore(),
    });

    if (options.systems) simulation.mountSystems(options.systems);
    return simulation;
  }

  static async load(options: LoadSimulationOptions): Promise<Simulation> {
    const file = await options.saveStore.read(options.slotName);
    if (!file) throw new Error(`No save exists in slot "${options.slotName}"`);
    return Simulation.fromSaveFile(file, { ...options, saveStore: options.saveStore });
  }

  /**
   * Rebuilds a simulation from a `.reel` document.
   *
   * Order matters: integrity is verified before anything is trusted, then the
   * save is migrated to the running simulation version, then the RNG version is
   * checked, and only then is state reconstructed.
   */
  static fromSaveFile(file: ReelFile, options: CreateSimulationOptions & { saveStore?: SaveStore }): Simulation {
    assertValidReelFile(file);

    const migrated = SAVE_MIGRATIONS.migrate(file, SIMULATION_VERSION);
    if (migrated.header.rngVersion !== RNG_VERSION) {
      throw new Error(
        `Save RNG version ${migrated.header.rngVersion} does not match engine RNG version ${RNG_VERSION}`,
      );
    }

    const serialized = migrated.body.world;
    if (!isSerializedWorld(serialized)) {
      throw new Error("Save body does not contain a complete serialized world");
    }

    const config = serialized.config;
    const calendar = new Calendar(config.calendar);
    const guard = new OwnershipGuard();
    const ids = IdAllocator.deserialize(serialized.shared.idAllocator);

    const world = guardWorldState(
      {
        meta: serialized.meta,
        shared: serialized.shared,
        config,
        systems: { ...serialized.systems },
      },
      guard,
    );

    const simulation = new Simulation({
      guard,
      world,
      clock: WorldClock.deserialize(serialized.clock),
      calendar,
      rng: RngRegistry.deserialize(serialized.meta.masterSeed, serialized.rng),
      events: EventEngine.deserialize(serialized.events),
      activities: ActivitiesEngine.deserialize(guard, serialized.activities),
      history: HistoryStore.deserialize(guard, serialized.history),
      commandLog: CommandLog.deserialize(guard, serialized.commands),
      ids,
      content: new ContentRegistry(config.calendar, config.currencies),
      config,
      trace: new TraceLog(),
      metrics: new MetricsCollector(options.hostClock ?? countingHostClock()),
      checkInvariants: options.checkInvariants ?? true,
      saveStore: options.saveStore ?? new MemorySaveStore(),
    });

    if (options.systems) simulation.mountSystems(options.systems);
    return simulation;
  }

  // ---------------------------------------------------- registration APIs

  mountSystems(definitions: readonly SystemDefinition[]): void {
    for (const definition of definitions) this.registerSystem(definition);
  }

  registerSystem<S extends object>(definition: SystemDefinition<S>): void {
    if (this.systems.has(definition.id)) {
      throw new Error(`System "${definition.id}" is already registered`);
    }
    for (const path of definition.additionalWrites ?? []) {
      this.guard.allowAdditionalWrite(definition.id, path);
    }

    const saved = this.world.systems[definition.id];
    const state: S =
      saved === undefined
        ? definition.createState(this.initContextFor(definition.id))
        : definition.deserialize(saved);

    this.guard.mutate(definition.id, () => {
      this.world.systems[definition.id] = state;
    });
    this.systems.set(definition.id, {
      definition: definition as unknown as SystemDefinition<object>,
      state: state as object,
    });

    if (definition.initialize) {
      const context = this.contextFor(definition, state);
      this.guard.mutate(definition.id, () => definition.initialize?.(context));
      const registered = this.systems.get(definition.id);
      if (registered) registered.state = context.state as object;
    }
  }

  private initContextFor(systemId: SystemId): SystemInitContext {
    return {
      systemId,
      time: this.clock.time,
      calendar: this.calendar,
      config: this.config,
      ids: this.ids,
      rng: this.rng,
      log: (message, data) => {
        this.trace.record({
          at: this.clock.time,
          step: this.clock.stepIndex,
          kind: "system",
          systemId,
          message,
          ...(data === undefined ? {} : { data }),
        });
      },
    };
  }

  registerCommand<TParams extends object>(definition: CommandDefinition<TParams>): void {
    this.registry.register(definition);
  }

  registerEventHandler(handler: EventHandler): void {
    if (this.eventHandlers.has(handler.eventType)) {
      throw new Error(`An event handler for "${handler.eventType}" is already registered`);
    }
    this.eventHandlers.set(handler.eventType, handler);
  }

  registerConsequenceApplier(type: string, applier: ConsequenceDescriptorApplier): void {
    if (this.consequenceAppliers.has(type)) {
      throw new Error(`A consequence applier for "${type}" is already registered`);
    }
    this.consequenceAppliers.set(type, applier);
  }

  registeredSystems(): readonly SystemId[] {
    return this.orderedSystems().map((entry) => entry.definition.id);
  }

  systemState<S extends object>(systemId: SystemId): S | undefined {
    return this.systems.get(systemId)?.state as S | undefined;
  }

  /**
   * Deterministic dependency order: dependencies first, ties broken by the
   * approved system register so step order never depends on registration order.
   */
  private orderedSystems(): RegisteredSystem[] {
    const byId = this.systems;
    const visited = new Set<SystemId>();
    const visiting = new Set<SystemId>();
    const ordered: RegisteredSystem[] = [];

    const visit = (id: SystemId): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Circular system dependency detected at "${id}"`);
      }
      visiting.add(id);
      const registered = byId.get(id);
      if (registered) {
        for (const dependency of registered.definition.dependsOn ?? []) {
          if (byId.has(dependency)) visit(dependency);
        }
      }
      visiting.delete(id);
      if (registered) {
        visited.add(id);
        ordered.push(registered);
      }
    };

    const registeredIds = [...byId.keys()].sort(
      (a, b) => SYSTEM_IDS.indexOf(a) - SYSTEM_IDS.indexOf(b),
    );
    for (const id of registeredIds) visit(id);
    return ordered;
  }

  private contextFor<S extends object>(definition: SystemDefinition<S>, state: S): StepContext<S> {
    const systemId = definition.id;
    return {
      systemId,
      time: this.clock.time,
      stepIndex: this.clock.stepIndex,
      state,
      calendar: this.calendar,
      config: this.config,
      ids: this.ids,
      rng: this.rng,
      activities: this.activities,
      trace: this.trace,
      metrics: this.metrics,
      emit: (draft) => this.emitFrom(systemId, draft),
      schedule: (delay: Duration, draft: EventDraft) =>
        this.emitFrom(systemId, { ...draft, at: atTime((this.clock.time as number) + (delay as number)) }),
      log: (message, data) => {
        this.trace.record({
          at: this.clock.time,
          step: this.clock.stepIndex,
          kind: "system",
          systemId,
          message,
          ...(data === undefined ? {} : { data }),
        });
      },
    };
  }

  /**
   * Emits a system-authored occurrence. Emission is a shared causal service, so
   * any system may emit; the event queue itself remains owned by the event
   * system, which is why the event engine is the only writer of its own state.
   */
  private emitFrom(systemId: SystemId, draft: EventDraft): WorldEvent {
    const event = this.events.emit(draft, this.clock.time);
    this.trace.record({
      at: event.at,
      step: this.clock.stepIndex,
      kind: "event",
      systemId,
      eventId: event.id,
      causalChainId: event.causalChainId,
      message: `event ${event.type}`,
    });
    return event;
  }

  // ------------------------------------------------------- simulation loop

  /**
   * Advances the world by exactly one quantum and processes everything due.
   *
   * Order (System 01 step coordination):
   *   1. clock advances,
   *   2. systems run onTimeAdvanced in dependency order,
   *   3. due events resolve and consequences apply,
   *   4. systems run onStep,
   *   5. elapsed activity windows expire,
   *   6. newly emitted events resolve, so consequences never lag a step,
   *   7. invariants run (configuration dependent).
   */
  step(): void {
    const from = this.clock.time;
    const to = this.clock.advanceQuantum();
    this.metrics.measure("simulation.step", () => {
      this.runStep(from, to);
    });
    this.metrics.increment("steps");
    if (this.checkInvariants) this.runInvariants();
  }

  private runStep(from: WorldTime, to: WorldTime): void {
    const systems = this.orderedSystems();

    for (const registered of systems) {
      const definition = registered.definition;
      if (!definition.onTimeAdvanced) continue;
      const context = this.contextFor(definition, registered.state);
      this.guard.mutate(definition.id, () => definition.onTimeAdvanced?.(context, from, to));
      registered.state = context.state;
    }

    this.dispatcher.resolveDue(to);

    for (const registered of systems) {
      const definition = registered.definition;
      if (!definition.onStep) continue;
      const context = this.contextFor(definition, registered.state);
      this.guard.mutate(definition.id, () => definition.onStep?.(context));
      registered.state = context.state;
    }

    // Planned activities whose window elapsed without execution become missed.
    this.guard.mutate("activities", () => {
      this.activities.expireDue(to);
    });

    // Events emitted during this step resolve immediately.
    this.dispatcher.resolveDue(to);
  }

  /** Runs `quanta` steps. Returns the number of steps actually executed. */
  runSteps(quanta: number): number {
    if (!Number.isInteger(quanta) || quanta < 0) {
      throw new RangeError(`Step count must be a non-negative integer, received ${String(quanta)}`);
    }
    for (let index = 0; index < quanta; index += 1) this.step();
    return quanta;
  }

  /**
   * Advances to an absolute time (offline catch-up path).
   *
   * Each quantum is processed exactly once: the clock is advanced by the step
   * loop, never jumped and then stepped as well. If the requested span exceeds
   * `maxCatchupQuanta`, the run stops short and reports `clipped: true` rather
   * than silently pretending the world caught up.
   */
  advanceTo(target: WorldTime): { readonly steps: number; readonly clipped: boolean } {
    const deltaMinutes = (target as number) - (this.clock.time as number);
    if (deltaMinutes <= 0) return { steps: 0, clipped: false };

    const requested = Math.ceil(deltaMinutes / this.clock.quantumMinutes);
    const steps = Math.min(requested, this.config.game.maxCatchupQuanta);
    const clipped = steps < requested;

    for (let index = 0; index < steps; index += 1) {
      this.stepQuiet();
    }

    this.metrics.increment("steps", steps);
    if (this.checkInvariants) this.runInvariants();
    return { steps, clipped };
  }

  /** A step without the accounting wrapper, used inside bulk advancement. */
  private stepQuiet(): void {
    const from = this.clock.time;
    const to = this.clock.advanceQuantum();
    this.runStep(from, to);
  }

  // ---------------------------------------------------- persistence bridge

  /**
   * Assembles the persisted layout from the owning engines. The core never keeps
   * a second copy of engine-owned state, so the save is built on demand.
   */
  serializedWorld(): SerializedWorld {
    // Baseline: the raw per-system bag. Domain engines that are not mounted
    // SystemDefinitions (identity, relationships, employment, geography, ...)
    // keep their authoritative state in `world.systems`, and a save that
    // omitted them would silently lose the world. Mounted systems then
    // override their own entry with their definition's serializer, because
    // their live state may have been replaced during stepping.
    const systems: Record<string, unknown> = { ...this.world.systems };
    const ids = [...this.systems.keys()].sort(
      (a, b) => SYSTEM_IDS.indexOf(a) - SYSTEM_IDS.indexOf(b),
    );
    for (const id of ids) {
      const registered = this.systems.get(id);
      if (!registered) continue;
      systems[id] = registered.definition.serialize(registered.state);
    }

    return {
      meta: this.world.meta,
      shared: { ...this.world.shared, idAllocator: this.ids.serialize() },
      clock: this.clock.serialize(),
      rng: this.rng.serialize(),
      events: this.events.serialize(),
      activities: this.activities.serialize(),
      history: this.history.serialize(),
      commands: this.commandLog.serialize(),
      config: this.config,
      systems,
    };
  }

  toSave(slotName: string, savedAtLabel = "unrecorded"): ReelFile {
    const body = { world: this.serializedWorld() };
    const header: ReelHeader = {
      format: REEL_FORMAT,
      formatVersion: FORMAT_VERSION,
      schemaVersion: this.world.meta.schemaVersion,
      simulationVersion: SIMULATION_VERSION,
      contentVersion: this.world.meta.contentVersion,
      rngVersion: RNG_VERSION,
      checksum: checksumOf(body),
      saveId: `SAVE-${slotName}-${String(this.clock.stepIndex)}`,
      slotName,
      savedAtLabel,
      worldId: this.world.meta.worldId,
      worldName: this.world.meta.worldName,
      worldDateLabel: this.calendar.formatDate(this.clock.time),
      stepIndex: this.clock.stepIndex,
      rootTimeMinutes: this.clock.time as number,
      generation: this.world.meta.generation,
      commandCount: this.commandLog.size,
      pendingEventCount: this.events.pendingCount,
    };
    return { header, body };
  }

  /** Writes an atomic save. Saving never changes simulation outcomes. */
  async saveTo(slotName: string, savedAtLabel?: string): Promise<ReelSlotInfo> {
    const file = this.toSave(slotName, savedAtLabel ?? `step ${this.clock.stepIndex}`);
    const info = await this.saveStore.write(slotName, file);
    this.metrics.increment("saves.written");
    return info;
  }

  /**
   * Queues a save write for the world.save command pipeline. The snapshot is
   * taken synchronously at dispatch time (deterministic content); only the
   * store I/O is deferred onto `pendingSaves`.
   */
  queueSave(slotName: string, savedAtLabel?: string): void {
    this.pendingSaves.push(this.saveTo(slotName, savedAtLabel).then(() => undefined));
  }

  /** Awaits every save write queued so far, surfacing store failures. */
  async awaitPendingSaves(): Promise<void> {
    await Promise.all([...this.pendingSaves]);
  }

  /** Stable hash of the whole authoritative state, used for determinism checks. */
  stateHash(): string {
    return checksum32Hex(canonicalJson(this.serializedWorld()));
  }

  canonicalStateText(): string {
    return canonicalJson(this.serializedWorld());
  }

  // ---------------------------------------------------------- observability

  /** Runs invariant checks, recording findings in the trace. */
  runInvariants(): InvariantReport {
    const report = this.invariants.run(this.invariantContext());
    for (const result of report.results) {
      if (result.passed) continue;
      this.metrics.increment("invariants.failures");
      this.trace.record({
        at: this.clock.time,
        step: this.clock.stepIndex,
        kind: "invariant",
        message: `invariant failed: ${result.id}`,
        data: { details: [...result.details].slice(0, 20) },
      });
    }
    return report;
  }

  private invariantContext(): InvariantContext {
    return {
      time: this.clock.time,
      clockQuantum: this.clock.quantumMinutes,
      queuedEvents: this.events.queueSnapshot(),
      commandLog: this.commandLog.all(),
      rngSnapshots: this.rng.serialize(),
      ownershipViolations: this.guard.recordedViolations,
      knownEntityIds: () => this.collectEntityIds(),
      knownReferences: () => this.collectReferences(),
      monetaryValues: () => this.collectMonetaryValues(),
    };
  }

  private collectEntityIds(): string[] {
    const ids: string[] = [this.world.meta.worldId];
    for (const registered of this.systems.values()) {
      const declared = registered.definition.entityIds?.(registered.state) ?? [];
      for (const id of declared) ids.push(id);
    }
    return ids;
  }

  private collectReferences(): { from: string; ref: EntityRef }[] {
    const references: { from: string; ref: EntityRef }[] = [];
    for (const registered of this.systems.values()) {
      const declared = registered.definition.references?.(registered.state) ?? [];
      for (const entry of declared) references.push({ from: entry.from, ref: entry.ref });
    }
    return references;
  }

  private collectMonetaryValues(): { label: string; value: number }[] {
    const values: { label: string; value: number }[] = [];
    for (const registered of this.systems.values()) {
      const declared = registered.definition.monetaryValues?.(registered.state) ?? [];
      for (const entry of declared) values.push({ label: entry.label, value: entry.value });
    }
    return values;
  }

  /**
   * Causal explanation for one event chain: which events occurred, in order, and
   * what caused them. This is the mechanism behind "why did this happen?".
   */
  explainChain(causalChainId: string): {
    readonly chainId: string;
    readonly rootEventId?: string;
    readonly eventCount: number;
    readonly traceLines: readonly string[];
  } {
    const rootEventId = this.events.chainRootOf(causalChainId);
    return {
      chainId: causalChainId,
      ...(rootEventId === undefined ? {} : { rootEventId }),
      eventCount: this.events.chainOf(causalChainId).length,
      traceLines: this.trace.forChain(causalChainId).map((entry) => `[${entry.kind}] ${entry.message}`),
    };
  }
}






