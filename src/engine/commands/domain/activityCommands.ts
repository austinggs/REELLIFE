/**
 * Activity commands (System 05, M2 command list: activity.start|stop).
 *
 * Commands express intent; the activities engine owns the lifecycle truth.
 * `activity.start` creates a planned activity and immediately transitions it
 * to "started" in the same consequence (one event, one authoritative owner).
 * `activity.stop` transitions an open activity to a terminal state —
 * "completed" when it had begun, "cancelled" when it had not.
 *
 * Validation is shape-only (the dispatcher's CommandContext carries no world
 * read path); unknown activity IDs surface as an applier rejection recorded
 * on the dispatch result rather than a throw, because stop is caller-facing.
 */

import type { EntityId } from "../../primitives/ids.ts";
import type { ActivityKind } from "../../primitives/activity.ts";
import { ACTIVITY_KINDS } from "../../primitives/activity.ts";
import type { CommandDefinition } from "../types.ts";
import { causeKindOf, createdByOf, errorIssue } from "../types.ts";

export const ACTIVITY_COMMAND_TYPES = {
  start: "activity.start",
  stop: "activity.stop",
} as const;

export const ACTIVITY_CONSEQUENCE_TYPES = {
  /** Creates the activity and marks it started (single-owner, single event). */
  started: "activity.apply_started",
  /** Stops an open activity: completed if running, cancelled if planned. */
  stop: "activity.apply_stop",
} as const;

export interface StartActivityParams {
  readonly kind: ActivityKind;
  readonly durationMinutes: number;
  readonly participants?: readonly EntityId<"person">[];
  readonly locationId?: string;
  /** Free-form provenance note kept on the activity (e.g. the employment a shift serves). */
  readonly notes?: string;
}

export interface StopActivityParams {
  readonly activityId: string;
  /** Why it stopped; recorded on the activity when terminal. */
  readonly reason?: string;
}

function isActivityKind(value: unknown): value is ActivityKind {
  return typeof value === "string" && (ACTIVITY_KINDS as readonly string[]).includes(value);
}

export const ACTIVITY_COMMANDS: readonly CommandDefinition<never>[] = [
  {
    type: ACTIVITY_COMMAND_TYPES.start,
    owner: "activities",
    description: "Start an activity now: creates it and transitions it to started.",
    validate: (cmd) => {
      const p = cmd.params as Partial<StartActivityParams>;
      if (!isActivityKind(p.kind)) {
        return [
          errorIssue(
            "invalid_kind",
            `kind must be one of: ${ACTIVITY_KINDS.join(", ")}`,
            "params.kind",
          ),
        ];
      }
      if (typeof p.durationMinutes !== "number" || !Number.isFinite(p.durationMinutes) || p.durationMinutes <= 0) {
        return [errorIssue("invalid_duration", "durationMinutes must be a positive number", "params.durationMinutes")];
      }
      return [];
    },
    resolve: (cmd) => {
      const p = cmd.params as StartActivityParams;
      const minutes = Math.round(p.durationMinutes);
      return {
        event: {
          type: "activity.started",
          cause: { kind: causeKindOf(cmd.origin), description: `started ${p.kind}` },
          actors: [{ kind: "person", id: cmd.actor }],
          visibleFacts: [`Started ${p.kind}`],
          tags: ["activity"],
          metadata: { durationMinutes: minutes },
          consequences: [
            {
              type: ACTIVITY_CONSEQUENCE_TYPES.started,
              owner: "activities",
              payload: {
                actor: cmd.actor,
                kind: p.kind,
                durationMinutes: minutes,
                createdBy: createdByOf(cmd.origin),
                ...(p.locationId === undefined ? {} : { locationId: p.locationId }),
                ...(p.participants === undefined ? {} : { participants: [...p.participants] }),
                ...(p.notes === undefined ? {} : { notes: p.notes }),
              },
            },
          ],
        },
      };
    },
  } as CommandDefinition<never>,
  {
    type: ACTIVITY_COMMAND_TYPES.stop,
    owner: "activities",
    description: "Stop an open activity: completed when running, cancelled when still planned.",
    validate: (cmd) => {
      const p = cmd.params as Partial<StopActivityParams>;
      if (typeof p.activityId !== "string" || p.activityId.length === 0) {
        return [errorIssue("missing_activity", "activityId is required", "params.activityId")];
      }
      return [];
    },
    resolve: (cmd) => {
      const p = cmd.params as StopActivityParams;
      return {
        event: {
          type: "activity.stopped",
          cause: { kind: causeKindOf(cmd.origin), description: "player stopped an activity" },
          visibleFacts: [`Stopped activity ${p.activityId}`],
          tags: ["activity"],
          consequences: [
            {
              type: ACTIVITY_CONSEQUENCE_TYPES.stop,
              owner: "activities",
              payload: {
                activityId: p.activityId,
                ...(p.reason === undefined ? {} : { reason: p.reason }),
              },
            },
          ],
        },
      };
    },
  } as CommandDefinition<never>,
] as readonly CommandDefinition<never>[];
