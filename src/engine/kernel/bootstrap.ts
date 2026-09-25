/**
 * Kernel bootstrap (System 01 / System 02 / System 58).
 *
 * Wires the pieces every ReelLife world needs regardless of which domain systems
 * are present: the time control commands, the consequence appliers that actually
 * mutate the clock, and the calendar heartbeat annotation.
 *
 * Domain milestones (needs, employment, housing, finance, inventory) register
 * their own commands and consequence appliers through the same API via
 * `bootstrapDomain`, which the create/load helpers below call after the kernel,
 * so a world is playable without reaching for direct state mutation.
 */

import type { SimulationSpeed } from "../time/clock.ts";
import type { Simulation } from "../core/simulation.ts";
import { Simulation as SimulationClass, type CreateSimulationOptions } from "../core/simulation.ts";
import {
  TIME_COMMANDS,
  TIME_CONSEQUENCE_TYPES,
  TIME_COMMAND_TYPES,
} from "../commands/builtin/timeCommands.ts";
import { bootstrapDomain } from "../commands/domain/index.ts";
import { createCalendarHeartbeatSystem } from "./heartbeatSystem.ts";

export interface KernelBootstrapOptions extends CreateSimulationOptions {
  /** The heartbeat annotation is on by default; tests may disable it. */
  readonly withHeartbeat?: boolean;
}

/** Registers kernel commands and their consequence appliers on a simulation. */
export function bootstrapKernel(sim: Simulation): Simulation {
  for (const command of TIME_COMMANDS) {
    sim.registry.register(command);
  }

  sim.registerConsequenceApplier(TIME_CONSEQUENCE_TYPES.setSpeed, (payload) => {
    const speed = payload.speed;
    if (typeof speed !== "number") return;
    sim.clock.setSpeed(speed as SimulationSpeed);
  });

  sim.registerConsequenceApplier(TIME_CONSEQUENCE_TYPES.setPaused, (payload) => {
    if (payload.paused === true) sim.clock.pause();
    else sim.clock.resume();
  });

  return sim;
}

/** Creates a fully wired kernel simulation: core + time control + domain commands + heartbeat. */
export function createKernelSimulation(options: KernelBootstrapOptions): Simulation {
  const sim = SimulationClass.create(options);
  bootstrapKernel(sim);
  bootstrapDomain(sim);
  if (options.withHeartbeat !== false) {
    sim.registerSystem(createCalendarHeartbeatSystem());
  }
  return sim;
}

/** Loads a save into a fully wired kernel simulation. */
export async function loadKernelSimulation(
  options: KernelBootstrapOptions & {
    readonly saveStore: Parameters<typeof SimulationClass.load>[0]["saveStore"];
    readonly slotName: string;
  },
): Promise<Simulation> {
  const sim = await SimulationClass.load(options);
  return bootstrapLoadedSimulation(sim, options);
}

/**
 * Completes a loaded simulation with the kernel systems.
 *
 * Systems must be registered after a load for the same reason they are
 * registered after creation: their saved state is restored through
 * `SystemDefinition.deserialize`, and until that happens the serialized world
 * would be missing those system slots.
 */
export function bootstrapLoadedSimulation(
  sim: Simulation,
  options?: { readonly withHeartbeat?: boolean },
): Simulation {
  bootstrapKernel(sim);
  bootstrapDomain(sim);
  if (options?.withHeartbeat !== false && !sim.registeredSystems().includes("time")) {
    sim.registerSystem(createCalendarHeartbeatSystem());
  }
  return sim;
}

export { TIME_COMMAND_TYPES };
