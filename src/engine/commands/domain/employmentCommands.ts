import type { EntityId } from "../../primitives/ids.ts";
import type { Money } from "../../primitives/money.ts";
import type { CommandDefinition } from "../types.ts";
import { errorIssue } from "../types.ts";

export const EMPLOYMENT_COMMAND_TYPES = {
  apply: "employment.apply",
  resign: "employment.resign",
} as const;

export const EMPLOYMENT_CONSEQUENCE_TYPES = {
  hire: "employment.hire",
  terminate: "employment.terminate",
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
          cause: { kind: "player", description: "Accepted job offer" },
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
          cause: { kind: "player", description: "Resigned from job" },
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
];
