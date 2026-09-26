/**
 * ReelLife M3 session layer (System 55 boundary; UI/UX 24).
 *
 * This is the *only* presentation module that holds a `Simulation`. Screens
 * receive plain, knowledge-filtered projections and call functions that either
 * read (query layer) or dispatch (command pipeline). Nothing here lets a
 * component reach `world.systems`, mutate a system, or advance state outside
 * the pipeline — which is what makes the UI a *client* of the simulation
 * rather than a second simulation (UI/UX 24 section 3).
 *
 * Time advance is the one non-command action: `advance()` runs the simulation's
 * own step loop, exactly as the headless harness does. It moves authoritative
 * time and lets due events resolve; it never edits domain state directly.
 */

import type { SaveStore } from "@/engine/index.ts";
import {
  createKernelSimulation,
  loadKernelSimulation,
  seedPlayableSlice,
  sliceUnderControl,
} from "@/engine/kernel/index.ts";
import type { CommandStatus } from "@/engine/commands/index.ts";
import type { EntityId } from "@/engine/primitives/index.ts";
import {
  getClockView,
  getCommandLogView,
  getEntityInspectorView,
  getEventFeedView,
  getLifeSituation,
  getNotificationFeedView,
  getPersonView,
  getSimulationHealthView,
  getTimelineView,
  getWorldSummaryView,
  getWorldView,
  parseConsoleInput,
  searchKnownEntities,
  type ClockView,
  type CommandLogViewItem,
  type EntityInspectorView,
  type EventFeedItem,
  type LifeSituationView,
  type NotificationFeedView,
  type PersonView,
  type SearchResultView,
  type SimulationHealthView,
  type TimelineViewItem,
  type WorldSummaryView,
  type WorldView,
} from "@/engine/query/index.ts";
import type {
  ConsoleAuthority,
  ConsoleLine,
} from "@/engine/primitives/index.ts";
import { executeConsoleInstruction } from "@/engine/commands/index.ts";
import type { Simulation } from "@/engine/core/simulation.ts";

/** Derived from the clock projection, so the app never imports the time module. */
export type SimulationSpeed = ClockView["speeds"][number];

/** A command outcome flattened into presentation data (no engine objects). */
export interface SessionCommandOutcome {
  readonly commandId: string;
  readonly type: string;
  readonly status: CommandStatus;
  readonly applied: boolean;
  readonly reasons: readonly string[];
  readonly error?: string;
  readonly eventTypes: readonly string[];
}

export interface SessionConsoleResult {
  readonly status: "ok" | "denied" | "error";
  readonly lines: readonly ConsoleLine[];
  readonly outcome?: SessionCommandOutcome;
}

export interface SessionSnapshot {
  readonly revision: number;
  readonly authority: ConsoleAuthority;
  readonly playerId: string | null;
  readonly clock: ClockView;
  readonly world: WorldSummaryView;
  readonly worldView: WorldView;
  readonly situation: LifeSituationView | null;
  readonly events: readonly EventFeedItem[];
  readonly notifications: NotificationFeedView;
  readonly timeline: readonly TimelineViewItem[];
  readonly commandLog: readonly CommandLogViewItem[];
  readonly health: SimulationHealthView;
}

export interface SimulationSessionOptions {
  readonly masterSeed: string;
  readonly saveStore?: SaveStore;
  readonly checkInvariants?: boolean;
  /** Materialized residents in the playable slice. */
  readonly residentCount?: number;
  readonly authority?: ConsoleAuthority;
}

/** The default world the shell opens when nothing is loaded. */
export const DEFAULT_MASTER_SEED = "reellife-m3-shell-world";

/** A save slot as the Settings screen shows it (presentation data only). */
export interface SaveSlotView {
  readonly slotName: string;
  readonly savedAtLabel: string;
  readonly worldName: string;
  readonly worldDateLabel: string;
  /** Format/schema version of the stored document, for compatibility display. */
  readonly formatVersion: number;
  readonly contentVersion: string;
  readonly generation: number;
  /** Whether the engine's own validation accepts the stored bytes (System 06). */
  readonly integrity: SaveIntegrity;
  /** The engine's explanation when a slot is not loadable, if it gave one. */
  readonly issue?: string;
  readonly sizeBytes: number;
}

/**
 * Integrity of a stored slot as established by reading it back through the
 * store's validating `read` — never by inspecting the header alone.
 */
export type SaveIntegrity = "verified" | "corrupt";

/**
 * The save slots a store holds, plus whether the store could be enumerated at
 * all. Both halves matter: an unreadable store must be *reported*, because an
 * empty list would silently claim the player has no saves (UI/UX 24 section 8
 * asks for explicit states rather than silent ones).
 */
export interface SaveSlotListing {
  readonly slots: readonly SaveSlotView[];
  /** The engine's own explanation when the store could not be listed. */
  readonly issue?: string;
}

/** Flattens a command result into presentation data. */
function outcomeOf(result: {
  readonly commandId: string;
  readonly type: string;
  readonly status: CommandStatus;
  readonly reasons: readonly string[];
  readonly error?: string;
  readonly events: readonly { readonly type: string }[];
}): SessionCommandOutcome {
  const applied = result.status === "applied" || result.status === "deferred";
  return {
    commandId: result.commandId,
    type: result.type,
    status: result.status,
    applied,
    reasons: result.reasons,
    ...(result.error === undefined ? {} : { error: result.error }),
    eventTypes: result.events.map((event) => event.type),
  };
}

/**
 * Establishes a slot's integrity by reading it back through the store's own
 * validating `read` (adapters validate on read, System 06). Header inspection is
 * not enough — a slot can parse as JSON and still fail the format's own rules.
 *
 * Kept at module scope on purpose: `SimulationSession`'s public surface is pinned
 * by a test, and an integrity check is not part of that boundary.
 */
async function verifySlot(
  store: SaveStore,
  slotName: string,
): Promise<{ readonly integrity: SaveIntegrity; readonly issue?: string }> {
  try {
    const file = await store.read(slotName);
    return file === null
      ? { integrity: "corrupt", issue: `Slot "${slotName}" is no longer in the store.` }
      : { integrity: "verified" };
  } catch (error) {
    return { integrity: "corrupt", issue: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Wraps one authoritative simulation for the presentation layer.
 *
 * Deliberate omissions: no accessor returns the `Simulation`, the world bag or
 * any mutable engine object, so a screen cannot mutate state even by accident.
 */
export class SimulationSession {
  private readonly sim: Simulation;
  private readonly saveStore: SaveStore | undefined;
  private readonly playerId: EntityId<"person"> | undefined;
  private authority: ConsoleAuthority;
  private revision = 0;

  constructor(
    sim: Simulation,
    options: SimulationSessionOptions,
    playerId: EntityId<"person"> | undefined,
  ) {
    this.sim = sim;
    this.saveStore = options.saveStore;
    this.authority = options.authority ?? "player";
    this.playerId = playerId;
  }

  /** Creates a fresh, lived-in world: the slice is seeded exactly once here. */
  static create(options: SimulationSessionOptions): SimulationSession {
    const sim = createKernelSimulation({
      masterSeed: options.masterSeed,
      ...(options.saveStore === undefined ? {} : { saveStore: options.saveStore }),
      checkInvariants: options.checkInvariants ?? true,
    });
    const seeded = seedPlayableSlice(sim, {
      ...(options.residentCount === undefined ? {} : { residentCount: options.residentCount }),
    });
    return new SimulationSession(sim, options, seeded.playerId);
  }

  /**
   * Loads a slot without re-seeding: a restored world is a restored world, and
   * only the designated person is re-derived from the restored state.
   */
  static async load(
    options: SimulationSessionOptions & { readonly slotName: string },
  ): Promise<SimulationSession> {
    if (options.saveStore === undefined) {
      throw new Error("Loading a world requires a save store");
    }
    const sim = await loadKernelSimulation({
      masterSeed: options.masterSeed,
      saveStore: options.saveStore,
      slotName: options.slotName,
      checkInvariants: options.checkInvariants ?? true,
    });
    return new SimulationSession(sim, options, sliceUnderControl(sim));
  }

  /** The person the shell controls, or null when the world has no residents. */
  get controlledPersonId(): EntityId<"person"> | null {
    return this.playerId ?? null;
  }


  // ---------------------------------------------------------------- reads ---

  /** Everything a screen renders, in one knowledge-filtered snapshot. */
  snapshot(): SessionSnapshot {
    const viewer = this.playerId ?? null;
    return {
      revision: this.revision,
      authority: this.authority,
      playerId: viewer,
      clock: getClockView(this.sim),
      world: getWorldSummaryView(this.sim),
      worldView: getWorldView(this.sim, viewer),
      situation: viewer === null ? null : getLifeSituation(this.sim, viewer),
      events: getEventFeedView(this.sim, viewer, { limit: 10 }),
      notifications: getNotificationFeedView(this.sim, viewer, { limit: 40 }),
      timeline: getTimelineView(this.sim, viewer, { limit: 60 }),
      commandLog: getCommandLogView(this.sim, { limit: 25 }),
      health: getSimulationHealthView(this.sim),
    };
  }

  personView(subjectId: string): PersonView | null {
    const viewer = this.playerId;
    return viewer === undefined ? null : getPersonView(this.sim, viewer, subjectId);
  }

  search(query: string): readonly SearchResultView[] {
    return searchKnownEntities(this.sim, this.playerId ?? null, query, { limit: 25 });
  }

  /** Authoritative inspector: a debug-only surface, never wired to player views. */
  inspect(id: string): EntityInspectorView {
    return getEntityInspectorView(this.sim, id);
  }

  /** Diagnostic state hash (System 59); read-only and non-authoritative. */
  stateHash(): string {
    return this.sim.stateHash();
  }

  // ------------------------------------------------------------ commands ---

  /**
   * Player intent goes through the pipeline with origin `player`. The session
   * never pre-validates: refusals must come from the authoritative validators,
   * so the UI can report the real reason instead of its own guess.
   */
  act(type: string, params: Record<string, unknown> = {}): SessionCommandOutcome {
    const viewer = this.playerId;
    if (viewer === undefined) {
      return {
        commandId: "",
        type,
        status: "rejected",
        applied: false,
        reasons: ["There is no one to act as yet."],
        error: "no_controlled_person",
        eventTypes: [],
      };
    }
    const command = this.sim.dispatcher.createCommand(type, viewer, params, "player");
    const outcome = outcomeOf(this.sim.dispatcher.dispatch(command));
    this.revision += 1;
    return outcome;
  }

  /** Pacing is a command like any other, so it is recorded in the audit trail. */
  setSpeed(speed: SimulationSpeed): SessionCommandOutcome {
    return this.act("time.set_speed", { speed });
  }

  setPaused(paused: boolean): SessionCommandOutcome {
    return this.act(paused ? "time.pause" : "time.resume", {});
  }

  /**
   * Advances authoritative time by whole quanta. This is the simulation's own
   * step loop (clock -> due events -> systems -> history), used by the UI's
   * pacing loop; it changes no domain field by itself.
   */
  advance(quanta = 1): number {
    const steps = this.sim.runSteps(Math.max(1, Math.floor(quanta)));
    this.revision += 1;
    return steps;
  }

  // ------------------------------------------------------------- console ---

  setAuthority(authority: ConsoleAuthority): void {
    this.authority = authority;
    this.revision += 1;
  }

  get currentAuthority(): ConsoleAuthority {
    return this.authority;
  }

  /**
   * Runs one console line. Reads are answered from the query layer; mutations
   * are dispatched with origin `console` and are refused outright for a player
   * authority, so the console cannot become a privilege escalation.
   */
  console(line: string): SessionConsoleResult {
    const instruction = parseConsoleInput(line, this.sim.registry);
    const result = executeConsoleInstruction(this.sim, instruction, {
      actorId: this.playerId ?? null,
      authority: this.authority,
    });
    this.revision += 1;
    return {
      status: result.status,
      lines: result.lines,
      ...(result.commandResult === undefined
        ? {}
        : { outcome: outcomeOf(result.commandResult) }),
    };
  }

  // --------------------------------------------------------- persistence ---

  /**
   * Save-slot metadata for the Settings screen (UI/UX 20 section 4: world
   * date/time, context, version, integrity state). Integrity is *checked* by
   * reading each slot back through the store's own validator rather than assumed
   * from its header, so a corrupt save is shown as corrupt and not as loadable.
   */
  async listSlots(): Promise<SaveSlotListing> {
    const store: SaveStore | undefined = this.saveStore ?? this.sim.saveStore;
    if (store === undefined) return { slots: [] };
    try {
      const infos = await store.listSlots();
      return {
        slots: await Promise.all(
          infos.map(async (slot) => ({
            slotName: slot.slotName,
            savedAtLabel: slot.savedAtLabel,
            worldName: slot.worldName,
            worldDateLabel: slot.worldDateLabel,
            formatVersion: slot.formatVersion,
            contentVersion: slot.contentVersion,
            generation: slot.generation,
            sizeBytes: slot.sizeBytes,
            ...(await verifySlot(store, slot.slotName)),
          })),
        ),
      };
    } catch (error) {
      // The store's index itself is unreadable; say so instead of showing none.
      return { slots: [], issue: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Requests a save through the pipeline, then waits for the store write. */
  async save(slotName: string): Promise<SessionCommandOutcome> {
    const outcome = this.act("world.save", { slotName });
    await this.sim.awaitPendingSaves();
    return outcome;
  }
}
