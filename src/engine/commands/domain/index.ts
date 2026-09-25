/**
 * Domain command bootstrap (M2/M3 vertical slice).
 *
 * One call registers every domain command with the simulation's command
 * registry and wires each consequence type to the engine that owns the state
 * it changes. Commands and appliers are runtime wiring, not saved state, so
 * this runs after both creation and load, exactly like `bootstrapKernel`.
 */

import type { CommandRegistry } from "../registry.ts";
import { NEEDS_COMMANDS } from "./needsCommands.ts";
import { EMPLOYMENT_COMMANDS } from "./employmentCommands.ts";
import { ASSET_COMMANDS } from "./assetCommands.ts";
import { ACTIVITY_COMMANDS } from "./activityCommands.ts";
import { SOCIAL_COMMANDS } from "./socialCommands.ts";
import { registerDomainConsequenceAppliers, type DomainApplierHost } from "./appliers.ts";

export interface DomainBootstrapHost extends DomainApplierHost {
  readonly registry: CommandRegistry;
}

/** Registers the domain commands (needs, employment, housing, finance,
 *  inventory, activities, relationships) and their consequence appliers. */
export function bootstrapDomain(host: DomainBootstrapHost): void {
  for (const definition of [
    ...NEEDS_COMMANDS,
    ...EMPLOYMENT_COMMANDS,
    ...ASSET_COMMANDS,
    ...ACTIVITY_COMMANDS,
    ...SOCIAL_COMMANDS,
  ]) {
    host.registry.register(definition);
  }
  registerDomainConsequenceAppliers(host);
}

export {
  NEEDS_COMMANDS,
  NEEDS_COMMAND_TYPES,
  NEEDS_CONSEQUENCE_TYPES,
} from "./needsCommands.ts";
export {
  EMPLOYMENT_COMMANDS,
  EMPLOYMENT_COMMAND_TYPES,
  EMPLOYMENT_CONSEQUENCE_TYPES,
  EMPLOYMENT_EVENT_TYPES,
  DEFAULT_SHIFT_MINUTES,
} from "./employmentCommands.ts";
export {
  ASSET_COMMANDS,
  ASSET_COMMAND_TYPES,
  ASSET_CONSEQUENCE_TYPES,
} from "./assetCommands.ts";
export {
  ACTIVITY_COMMANDS,
  ACTIVITY_COMMAND_TYPES,
  ACTIVITY_CONSEQUENCE_TYPES,
} from "./activityCommands.ts";
export {
  SOCIAL_COMMANDS,
  SOCIAL_COMMAND_TYPES,
  SOCIAL_CONSEQUENCE_TYPES,
  SOCIAL_PROFILES,
  type InteractionDeltas,
  type SocialInteraction,
} from "./socialCommands.ts";