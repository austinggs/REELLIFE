/**
 * ReelLife command model (System 01 / UI/UX 07).
 *
 *   Intent -> Command -> Validation -> Action Resolution -> Event
 *          -> Consequences -> New State
 *
 * Commands express intent. They are not events and they are not state changes.
 * A command may be rejected (it was malformed or its preconditions failed) or
 * blocked (authority denied it) without any occurrence taking place at all.
 *
 * The command log is persisted because deterministic replay is defined as:
 * initial state + content version + RNG state + the command sequence.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { EntityRef } from "../primitives/entity.ts";
import type { Visibility } from "../primitives/information.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { ResolutionObject } from "../primitives/resolution.ts";
import type { AuthorityOutcome, AuthorityReason, PermissionRequirement } from "../primitives/authority.ts";
import type { SystemId } from "../core/ownership.ts";
import type { EventCause, EventDraft, WorldEvent } from "../events/types.ts";

export const COMMAND_ORIGINS = ["player", "npc", "system", "console", "test"] as const;
export type CommandOrigin = (typeof COMMAND_ORIGINS)[number];

export const COMMAND_STATUSES = ["applied", "rejected", "blocked", "deferred"] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];

export interface Command<TParams extends object = Record<string, unknown>> {
  readonly id: EntityId<"command">;
  readonly type: string;
  readonly actor: EntityId<"person">;
  readonly origin: CommandOrigin;
  readonly issuedAt: WorldTime;
  readonly params: TParams;
  /** Entities the actor intends to affect; used for authority and tracing. */
  readonly targets?: readonly EntityRef[];
}

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly severity: "error" | "warning";
  readonly path?: string;
}

export interface AuthorityReport {
  readonly outcome: AuthorityOutcome;
  readonly reasons: readonly AuthorityReason[];
  readonly conditions?: readonly string[];
  readonly ruleId?: string;
}

export interface CommandResult {
  readonly commandId: EntityId<"command">;
  readonly type: string;
  readonly status: CommandStatus;
  readonly issues: readonly ValidationIssue[];
  readonly authority?: AuthorityReport;
  readonly events: readonly WorldEvent[];
  readonly resolution?: ResolutionObject;
  /** Human-readable explanations for the player-facing decision surface. */
  readonly reasons: readonly string[];
  readonly error?: string;
}

/** Everything a command definition may rely on while validating/resolving. */
export interface CommandContext {
  readonly time: WorldTime;
  readonly origin: CommandOrigin;
  readonly correlationId: string;
  /** Deterministic RNG access, addressed by stream path. */
  readonly rng: { stream(path: string): { nextFloat(): number; nextInt(min: number, max: number): number } };
  /** Read-only lookup used by validators to check preconditions. */
  readonly log: (message: string, data?: Readonly<Record<string, unknown>>) => void;
}

export interface CommandResolution {
  /** The primary occurrence produced by resolving the command. */
  readonly event: EventDraft;
  /** Present when the outcome was uncertain. */
  readonly resolution?: ResolutionObject;
  /** Additional occurrences, e.g. a notification to a counterparty. */
  readonly followUpEvents?: readonly EventDraft[];
}

export interface CommandDefinition<TParams extends object = Record<string, unknown>> {
  readonly type: string;
  /** The system that performs the resulting state change. */
  readonly owner: SystemId;
  /** Description used by the console and debug UI. */
  readonly description: string;
  /** Default visibility for the occurrence this command produces. */
  readonly eventVisibility?: Visibility;
  validate(command: Command<TParams>, context: CommandContext): readonly ValidationIssue[];
  /** When present, the dispatcher runs the shared AuthorityCheck. */
  authorityRequirement?(command: Command<TParams>): PermissionRequirement;
  resolve(command: Command<TParams>, context: CommandContext): CommandResolution;
}

export interface CommandLogEntry {
  readonly id: EntityId<"command">;
  readonly type: string;
  readonly actor: EntityId<"person">;
  readonly origin: CommandOrigin;
  readonly issuedAt: WorldTime;
  readonly status: CommandStatus;
  readonly reasons: readonly string[];
  readonly eventIds: readonly EntityId<"event">[];
  readonly params: Readonly<Record<string, unknown>>;
  readonly targets?: readonly EntityRef[];
}

export interface CommandLogState {
  readonly entries: readonly CommandLogEntry[];
  readonly sequence: number;
}

export function errorIssue(code: string, message: string, path?: string): ValidationIssue {
  return path === undefined
    ? { code, message, severity: "error" }
    : { code, message, severity: "error", path };
}

export function warningIssue(code: string, message: string, path?: string): ValidationIssue {
  return path === undefined
    ? { code, message, severity: "warning" }
    : { code, message, severity: "warning", path };
}

/**
 * Maps a command origin to the matching event cause kind.
 *
 * Exists so an event never attributes itself to a different author than the
 * command that produced it, and so no domain command has to guess at the
 * EventCause union. `console` and `test` are tooling, not world actors, so they
 * attribute to the system.
 */
export function causeKindOf(origin: CommandOrigin): EventCause["kind"] {
  if (origin === "player") return "player";
  if (origin === "npc") return "npc";
  return "system";
}

/** The `Activity.createdBy` value implied by a command origin. */
export function createdByOf(origin: CommandOrigin): "player" | "npc" | "system" | "console" {
  if (origin === "player" || origin === "npc" || origin === "console") return origin;
  return "system";
}
