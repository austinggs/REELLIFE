/**
 * ReelLife invariants (System 59).
 *
 * "If the simulation cannot explain why something happened, the simulation is
 * not finished." The same spirit applies to correctness: an invariant that only
 * exists in a document is a wish, so each one here is executable and returns an
 * explanation rather than a bare boolean.
 *
 * Invariants are cheap enough to run after every step in the headless harness.
 */

import type { EntityRef } from "../primitives/entity.ts";
import type { RngStreamSnapshot } from "../rng/streams.ts";
import { isZeroState } from "../rng/prng.ts";
import type { WorldEvent } from "../events/types.ts";
import { compareEvents } from "../events/types.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { CommandLogEntry } from "../commands/types.ts";
import type { OwnershipViolation } from "../core/access.ts";

export interface InvariantContext {
  readonly time: WorldTime;
  readonly clockQuantum: number;
  readonly queuedEvents: readonly WorldEvent[];
  readonly commandLog: readonly CommandLogEntry[];
  readonly rngSnapshots: readonly RngStreamSnapshot[];
  readonly ownershipViolations: readonly OwnershipViolation[];
  /** All IDs currently registered anywhere in the world. */
  readonly knownEntityIds: () => readonly string[];
  /** All cross-entity references, labelled with who holds them. */
  readonly knownReferences: () => readonly { readonly from: string; readonly ref: EntityRef }[];
  /** Monetary values that must be integer minor units, labelled. */
  readonly monetaryValues: () => readonly { readonly label: string; readonly value: number }[];
}

export interface InvariantResult {
  readonly id: string;
  readonly passed: boolean;
  readonly details: readonly string[];
}

export interface Invariant {
  readonly id: string;
  readonly description: string;
  check(context: InvariantContext): InvariantResult;
}

export interface InvariantReport {
  readonly results: readonly InvariantResult[];
  readonly passed: boolean;
}

function pass(id: string): InvariantResult {
  return { id, passed: true, details: [] };
}

function fail(id: string, details: readonly string[]): InvariantResult {
  return { id, passed: false, details };
}

export const CLOCK_ADVANCES_IN_QUANTA: Invariant = {
  id: "clock-advances-in-quanta",
  description: "Authoritative time must always be a whole number of clock quanta.",
  check(context) {
    const quantum = context.clockQuantum;
    if (quantum <= 0 || !Number.isInteger(quantum)) {
      return fail(this.id, [`Invalid clock quantum: ${quantum}`]);
    }
    return Number.isInteger(context.time as number)
      ? pass(this.id)
      : fail(this.id, [`Time ${String(context.time)} is not an integer number of minutes`]);
  },
};

export const EVENT_QUEUE_ORDERED: Invariant = {
  id: "event-queue-deterministically-ordered",
  description: "Queued events must be ordered by (time, priority, sequence).",
  check(context) {
    const problems: string[] = [];
    for (let index = 1; index < context.queuedEvents.length; index += 1) {
      const previous = context.queuedEvents[index - 1];
      const current = context.queuedEvents[index];
      if (!previous || !current) continue;
      if (compareEvents(previous, current) > 0) {
        problems.push(`Out of order at index ${index}: ${previous.id} before ${current.id}`);
      }
    }
    return problems.length === 0 ? pass(this.id) : fail(this.id, problems);
  },
};

export const NO_EVENTS_IN_THE_PAST: Invariant = {
  id: "no-events-in-the-past",
  description: "The event queue must not hold events dated before the current time.",
  check(context) {
    const problems = context.queuedEvents
      .filter((event) => (event.at as number) < (context.time as number))
      .map((event) => `${event.id} at ${String(event.at)} while clock is ${String(context.time)}`);
    return problems.length === 0 ? pass(this.id) : fail(this.id, problems);
  },
};

export const UNIQUE_ENTITY_IDS: Invariant = {
  id: "unique-entity-ids",
  description: "No entity ID may appear twice in the world.",
  check(context) {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const id of context.knownEntityIds()) {
      if (seen.has(id)) duplicates.push(id);
      seen.add(id);
    }
    return duplicates.length === 0 ? pass(this.id) : fail(this.id, duplicates);
  },
};

export const REFERENCES_RESOLVE: Invariant = {
  id: "references-resolve",
  description: "Every EntityRef must resolve to an entity that exists.",
  check(context) {
    const known = new Set(context.knownEntityIds());
    const dangling = context
      .knownReferences()
      .filter((entry) => !known.has(entry.ref.id))
      .map((entry) => `${entry.from} -> ${entry.ref.kind}:${entry.ref.id}`);
    return dangling.length === 0 ? pass(this.id) : fail(this.id, dangling);
  },
};

export const MONEY_IS_INTEGER: Invariant = {
  id: "money-is-integer-minor-units",
  description: "Authoritative money must be safe integers in minor units.",
  check(context) {
    const problems = context
      .monetaryValues()
      .filter((entry) => !Number.isSafeInteger(entry.value))
      .map((entry) => `${entry.label} = ${String(entry.value)}`);
    return problems.length === 0 ? pass(this.id) : fail(this.id, problems);
  },
};

export const RNG_STATE_VALID: Invariant = {
  id: "rng-state-valid",
  description: "Every persisted RNG stream must hold a valid, non-degenerate state.",
  check(context) {
    const problems: string[] = [];
    for (const snapshot of context.rngSnapshots) {
      if (isZeroState(snapshot.state)) problems.push(`Stream ${snapshot.path} has a zero state`);
      for (const word of [snapshot.state.s0, snapshot.state.s1, snapshot.state.s2, snapshot.state.s3]) {
        if (!Number.isInteger(word) || word < 0 || word > 0xffffffff) {
          problems.push(`Stream ${snapshot.path} has an invalid word: ${String(word)}`);
        }
      }
    }
    return problems.length === 0 ? pass(this.id) : fail(this.id, problems);
  },
};

export const OWNERSHIP_RESPECTED: Invariant = {
  id: "ownership-respected",
  description: "No system may write state it does not own.",
  check(context) {
    return context.ownershipViolations.length === 0
      ? pass(this.id)
      : fail(
          this.id,
          context.ownershipViolations.map((violation) => violation.message),
        );
  },
};

export const COMMAND_LOG_CONSISTENT: Invariant = {
  id: "command-log-consistent",
  description: "Command log IDs must be gap-free and increasing.",
  check(context) {
    const problems: string[] = [];
    for (let index = 0; index < context.commandLog.length; index += 1) {
      const entry = context.commandLog[index];
      if (!entry) continue;
      const expected = `CMD-${String(index + 1).padStart(6, "0")}`;
      if (entry.id !== expected) {
        problems.push(`Entry ${index} has id ${entry.id}, expected ${expected}`);
      }
    }
    return problems.length === 0 ? pass(this.id) : fail(this.id, problems);
  },
};

export const DEFAULT_INVARIANTS: readonly Invariant[] = [
  CLOCK_ADVANCES_IN_QUANTA,
  EVENT_QUEUE_ORDERED,
  NO_EVENTS_IN_THE_PAST,
  UNIQUE_ENTITY_IDS,
  REFERENCES_RESOLVE,
  MONEY_IS_INTEGER,
  RNG_STATE_VALID,
  OWNERSHIP_RESPECTED,
  COMMAND_LOG_CONSISTENT,
];

export class InvariantRegistry {
  private readonly invariants: Invariant[] = [...DEFAULT_INVARIANTS];

  register(invariant: Invariant): void {
    this.invariants.push(invariant);
  }

  list(): readonly Invariant[] {
    return this.invariants;
  }

  run(context: InvariantContext): InvariantReport {
    const results = this.invariants.map((invariant) => invariant.check(context));
    return { results, passed: results.every((result) => result.passed) };
  }
}

