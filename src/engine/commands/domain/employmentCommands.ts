import type { EntityId } from "../../primitives/ids.ts";
import type { Money } from "../../primitives/money.ts";
import type { CommandDefinition } from "../types.ts";
import { causeKindOf, createdByOf, errorIssue } from "../types.ts";
import { ACTIVITY_CONSEQUENCE_TYPES } from "./activityCommands.ts";

export const EMPLOYMENT_COMMAND_TYPES = {
  apply: "employment.apply",
  resign: "employment.resign",
  workShift: "employment.work_shift",
} as const;

export const EMPLOYMENT_CONSEQUENCE_TYPES = {
  hire: "employment.hire",
  terminate: "employment.terminate",
} as const;

/** Event emitted by `employment.work_shift`; gated by a precondition handler. */
export const EMPLOYMENT_EVENT_TYPES = {
  shiftWorked: "employment.shift_worked",
} as const;

export interface ApplyEmploymentParams {
  readonly employerOrgId: string;
  readonly roleTitle: string;
  readonly occupationCode: string;
  readonly wage: Money;
  readonly weeklyHours: number;
}

export interface ResignEmploymentParams {
  readonly employmentId: string;
}

export interface WorkShiftParams {
  readonly employmentId: string;
  /** Defaults to a standard eight-hour shift. */
  readonly durationMinutes?: number;
  readonly locationId?: string;
}

export const DEFAULT_SHIFT_MINUTES = 8 * 60;

export const EMPLOYMENT_COMMANDS: readonly CommandDefinition<never>[] = [
  {
    type: EMPLOYMENT_COMMAND_TYPES.apply,
    owner: "employment",
    description: "Applies for and accepts an employment contract.",
    validate: (cmd) => {
      const p = cmd.params as Partial<ApplyEmploymentParams>;
      if (!p.employerOrgId || !p.roleTitle || !p.occupationCode || !p.wage) {
        return [errorIssue("invalid_params", "Missing employer, roleTitle, occupationCode or wage", "params")];
      }
      if (typeof p.weeklyHours !== "number" || p.weeklyHours <= 0) {
        return [errorIssue("invalid_params", "weeklyHours must be a positive number", "params.weeklyHours")];
      }
      return [];
    },
    resolve: (cmd) => {
      const p = cmd.params as ApplyEmploymentParams;
      return {
        event: {
          type: "employment.accepted",
          cause: { kind: causeKindOf(cmd.origin), description: "Accepted job offer" },
          visibleFacts: [`Person ${cmd.actor} accepted position ${p.roleTitle} at ${p.employerOrgId}`],
          tags: ["employment", "career"],
          consequences: [
            {
              type: EMPLOYMENT_CONSEQUENCE_TYPES.hire,
              owner: "employment",
              payload: {
                personId: cmd.actor as EntityId<"person">,
                employerOrgId: p.employerOrgId,
                roleTitle: p.roleTitle,
                occupationCode: p.occupationCode,
                wage: p.wage,
                weeklyHours: p.weeklyHours,
              },
            },
          ],
        },
      };
    },
  } as CommandDefinition<never>,
  {
    type: EMPLOYMENT_COMMAND_TYPES.resign,
    owner: "employment",
    description: "Resigns from an employment position.",
    validate: (cmd) => {
      const p = cmd.params as Partial<ResignEmploymentParams>;
      if (!p.employmentId) return [errorIssue("missing_param", "Missing employmentId", "params.employmentId")];
      return [];
    },
    resolve: (cmd) => {
      const p = cmd.params as ResignEmploymentParams;
      return {
        event: {
          type: "employment.resigned",
          cause: { kind: causeKindOf(cmd.origin), description: "Resigned from job" },
          visibleFacts: [`Person ${cmd.actor} resigned from job ${p.employmentId}`],
          tags: ["employment"],
          consequences: [
            {
              type: EMPLOYMENT_CONSEQUENCE_TYPES.terminate,
              owner: "employment",
              payload: { employmentId: p.employmentId, reason: "resigned" },
            },
          ],
        },
      };
    },
  } as CommandDefinition<never>,
  {
    type: EMPLOYMENT_COMMAND_TYPES.workShift,
    owner: "employment",
    description:
      "Works a shift for an employment. The shift itself is an activity (System 05); the employment must still be active when the event resolves, or the event is discarded as stale.",
    validate: (cmd) => {
      const p = cmd.params as Partial<WorkShiftParams>;
      if (typeof p.employmentId !== "string" || p.employmentId.length === 0) {
        return [errorIssue("missing_param", "Missing employmentId", "params.employmentId")];
      }
      if (
        p.durationMinutes !== undefined &&
        (typeof p.durationMinutes !== "number" ||
          !Number.isFinite(p.durationMinutes) ||
          p.durationMinutes <= 0)
      ) {
        return [
          errorIssue(
            "invalid_duration",
            "durationMinutes must be a positive number when provided",
            "params.durationMinutes",
          ),
        ];
      }
      return [];
    },
    resolve: (cmd) => {
      const p = cmd.params as WorkShiftParams;
      const minutes = Math.round(p.durationMinutes ?? DEFAULT_SHIFT_MINUTES);
      return {
        event: {
          type: EMPLOYMENT_EVENT_TYPES.shiftWorked,
          cause: { kind: causeKindOf(cmd.origin), description: "worked a shift" },
          actors: [{ kind: "person", id: cmd.actor }],
          visibleFacts: [`${String(cmd.actor)} worked a shift for ${p.employmentId}`],
          tags: ["employment", "activity"],
          // Read by the precondition handler that verifies the employment is
          // still active at execution time (System 04 / System 24 boundary).
          metadata: { employmentId: p.employmentId, shiftMinutes: minutes },
          consequences: [
            {
              type: ACTIVITY_CONSEQUENCE_TYPES.started,
              owner: "activities",
              payload: {
                actor: cmd.actor,
                kind: "workShift",
                durationMinutes: minutes,
                createdBy: createdByOf(cmd.origin),
                ...(p.locationId === undefined ? {} : { locationId: p.locationId }),
                notes: `employment:${p.employmentId}`,
              },
            },
          ],
        },
      };
    },
  } as CommandDefinition<never>,
];
