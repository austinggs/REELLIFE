/**
 * Kernel world commands (System 06 persistence surface, M2 command list).
 *
 *   world.save  — validates and captures a `.reel` snapshot through the
 *                 consequence applier registered in `bootstrapKernel`. The
 *                 write is asynchronous (stores are promise-based), so the
 *                 applier queues it on `Simulation.pendingSaves`; callers
 *                 await `Simulation.awaitPendingSaves()` before asserting
 *                 storage.
 *
 *   world.load  — records the *intent* to load a slot as a normal command
 *                 event. It deliberately applies no consequence: a running
 *                 Simulation instance cannot replace itself mid-dispatch.
 *                 The platform layer observes `world.load_requested` and
 *                 performs the swap through `loadKernelSimulation`, which
 *                 builds a new instance from the store (the pattern already
 *                 proven by the determinism and persistence suites).
 *
 * Both commands exist so that saving and loading are intents routed through
 * Validation -> Resolution -> Event, not silent side channels (UI/UX 24).
 */

import type { CommandDefinition } from "../types.ts";
import { errorIssue } from "../types.ts";

export interface WorldSaveParams {
  readonly slotName: string;
  readonly savedAtLabel?: string;
}

export interface WorldLoadParams {
  readonly slotName: string;
}

export const WORLD_COMMAND_TYPES = {
  save: "world.save",
  load: "world.load",
} as const;

export const WORLD_CONSEQUENCE_TYPES = {
  requestSave: "persistence.request_save",
} as const;

function validateSlot(params: Partial<WorldSaveParams | WorldLoadParams>) {
  if (typeof params.slotName !== "string" || params.slotName.trim().length === 0) {
    return [errorIssue("invalid_slot", "slotName must be a non-empty string", "params.slotName")];
  }
  return [];
}

export const WORLD_COMMANDS: readonly CommandDefinition<never>[] = [
  {
    type: WORLD_COMMAND_TYPES.save,
    owner: "persistence",
    description: "Save the world to a `.reel` slot. The snapshot and write are queued on the simulation.",
    validate: (command) => validateSlot(command.params as Partial<WorldSaveParams>),
    resolve: (command) => {
      const p = command.params as WorldSaveParams;
      return {
        event: {
          type: "persistence.save_requested",
          cause: { kind: "player", description: "player requested a world save" },
          visibleFacts: [`World save requested for slot "${p.slotName}"`],
          tags: ["system", "persistence"],
          consequences: [
            {
              type: WORLD_CONSEQUENCE_TYPES.requestSave,
              owner: "persistence",
              payload: {
                slotName: p.slotName,
                ...(p.savedAtLabel === undefined ? {} : { savedAtLabel: p.savedAtLabel }),
              },
            },
          ],
        },
      };
    },
  } as CommandDefinition<never>,
  {
    type: WORLD_COMMAND_TYPES.load,
    owner: "persistence",
    description:
      "Request loading a `.reel` slot. The platform observes world.load_requested and swaps in the loaded simulation; the running instance never replaces itself mid-dispatch.",
    validate: (command) => validateSlot(command.params as Partial<WorldLoadParams>),
    resolve: (command) => {
      const p = command.params as WorldLoadParams;
      return {
        event: {
          type: "world.load_requested",
          cause: { kind: "player", description: "player requested a world load" },
          visibleFacts: [`World load requested for slot "${p.slotName}"`],
          tags: ["system", "persistence"],
        },
      };
    },
  } as CommandDefinition<never>,
];
