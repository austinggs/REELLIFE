/**
 * Kernel time commands (System 02 / System 41 build-order requirement).
 *
 * These commands exist so that simulation pacing is itself a command rather than
 * a UI-side mutation: the player changes speed the same way they do anything
 * else, through Validation -> Authority -> Resolution -> Event -> Consequence.
 *
 * The clock is mutated only by the consequence appliers below, which run inside
 * the "time" ownership scope.
 */

import { SIMULATION_SPEEDS, type SimulationSpeed } from "../../time/clock.ts";
import type { CommandDefinition } from "../types.ts";
import { errorIssue } from "../types.ts";
import type { EventDraft } from "../../events/types.ts";

export interface SetSpeedParams {
  readonly speed: number;
}

export type EmptyParams = Record<string, never>;

export const TIME_COMMAND_TYPES = {
  setSpeed: "time.set_speed",
  pause: "time.pause",
  resume: "time.resume",
} as const;

export const TIME_CONSEQUENCE_TYPES = {
  setSpeed: "time.apply_speed",
  setPaused: "time.apply_paused",
} as const;

function isSupportedSpeed(value: number): value is SimulationSpeed {
  return (SIMULATION_SPEEDS as readonly number[]).includes(value);
}

export const TIME_COMMANDS: readonly CommandDefinition<never>[] = [
  {
    type: TIME_COMMAND_TYPES.setSpeed,
    owner: "time",
    description: "Set simulation speed (1x, 10x, 100x, 1000x). Changes cadence, not temporal truth.",
    validate: (command) => {
      const params = command.params as Partial<SetSpeedParams>;
      if (typeof params.speed !== "number") {
        return [errorIssue("invalid_speed", "speed must be a number", "params.speed")];
      }
      if (!isSupportedSpeed(params.speed)) {
        return [
          errorIssue(
            "unsupported_speed",
            `speed must be one of ${SIMULATION_SPEEDS.join(", ")}`,
            "params.speed",
          ),
        ];
      }
      return [];
    },
    resolve: (command) => {
      const speed = (command.params as Partial<SetSpeedParams>).speed as SimulationSpeed;
      const event: EventDraft = {
        type: "time.speed_changed",
        cause: { kind: "player", description: "player changed simulation speed" },
        visibleFacts: [`Simulation speed set to ${speed}x`],
        tags: ["system"],
        consequences: [
          {
            type: TIME_CONSEQUENCE_TYPES.setSpeed,
            owner: "time",
            payload: { speed },
          },
        ],
      };
      return { event };
    },
  } as CommandDefinition<never>,
  {
    type: TIME_COMMAND_TYPES.pause,
    owner: "time",
    description: "Pause the authoritative simulation clock.",
    validate: () => [],
    resolve: () => ({
      event: {
        type: "time.paused",
        cause: { kind: "player", description: "player paused the simulation" },
        visibleFacts: ["Simulation paused"],
        tags: ["system"],
        consequences: [
          {
            type: TIME_CONSEQUENCE_TYPES.setPaused,
            owner: "time",
            payload: { paused: true },
          },
        ],
      },
    }),
  } as CommandDefinition<never>,
  {
    type: TIME_COMMAND_TYPES.resume,
    owner: "time",
    description: "Resume the authoritative simulation clock.",
    validate: () => [],
    resolve: () => ({
      event: {
        type: "time.resumed",
        cause: { kind: "player", description: "player resumed the simulation" },
        visibleFacts: ["Simulation resumed"],
        tags: ["system"],
        consequences: [
          {
            type: TIME_CONSEQUENCE_TYPES.setPaused,
            owner: "time",
            payload: { paused: false },
          },
        ],
      },
    }),
  } as CommandDefinition<never>,
];
