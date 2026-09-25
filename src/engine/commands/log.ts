/**
 * ReelLife command log (System 06 / System 54 / System 59).
 *
 * The command log is persisted because deterministic replay is defined as:
 *   initial state + content version + simulation version + RNG state + commands
 *
 * It is also the audit trail that makes "why did this happen?" answerable: every
 * state change traces back through a consequence to an event to the command that
 * caused it.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { SystemScope } from "../core/access.ts";
import type { Command, CommandLogEntry, CommandLogState, CommandResult } from "./types.ts";

export interface CommandLogLimits {
  readonly maxEntries: number;
}

export const DEFAULT_COMMAND_LOG_LIMITS: CommandLogLimits = { maxEntries: 50_000 };

export class CommandLog {
  private readonly scope: SystemScope;
  private readonly entries: CommandLogEntry[] = [];
  private nextSequence: number;
  private readonly limits: CommandLogLimits;

  constructor(
    scope: SystemScope,
    state?: CommandLogState,
    limits: CommandLogLimits = DEFAULT_COMMAND_LOG_LIMITS,
  ) {
    this.scope = scope;
    this.limits = limits;
    for (const entry of state?.entries ?? []) this.entries.push(entry);
    this.nextSequence = state?.sequence ?? this.entries.length;
  }

  get size(): number {
    return this.entries.length;
  }

  all(): readonly CommandLogEntry[] {
    return this.entries;
  }

  /** Next command ID without consuming it; used to build a command before dispatch. */
  peekNextId(): EntityId<"command"> {
    return `CMD-${String(this.nextSequence + 1).padStart(6, "0")}` as EntityId<"command">;
  }

  /** Mints a command ID. The core owns command identity, so callers cannot forge it. */
  mintId(): EntityId<"command"> {
    this.scope.assertOwner("core");
    this.nextSequence += 1;
    return `CMD-${String(this.nextSequence).padStart(6, "0")}` as EntityId<"command">;
  }

  append(command: Command<never> | Command, result: CommandResult): CommandLogEntry {
    this.scope.assertOwner("core");
    const entry: CommandLogEntry = {
      id: command.id,
      type: command.type,
      actor: command.actor,
      origin: command.origin,
      issuedAt: command.issuedAt,
      status: result.status,
      reasons: result.reasons,
      eventIds: result.events.map((event) => event.id),
      params: command.params as Readonly<Record<string, unknown>>,
      ...(command.targets === undefined ? {} : { targets: command.targets }),
    };
    this.entries.push(entry);
    while (this.entries.length > this.limits.maxEntries) this.entries.shift();
    return entry;
  }

  /** Command replay source: the exact sequence needed to reproduce a run. */
  replaySequence(): readonly CommandLogEntry[] {
    return this.entries;
  }

  serialize(): CommandLogState {
    return { entries: [...this.entries], sequence: this.nextSequence };
  }

  static deserialize(
    scope: SystemScope,
    state: CommandLogState,
    limits?: CommandLogLimits,
  ): CommandLog {
    return new CommandLog(scope, state, limits ?? DEFAULT_COMMAND_LOG_LIMITS);
  }
}
