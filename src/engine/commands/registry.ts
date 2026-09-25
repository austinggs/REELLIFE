/**
 * ReelLife command registry (System 01 / System 57).
 *
 * Every player action, NPC decision and console mutation must be expressible as
 * a registered command. There is deliberately no "mutate state directly" entry
 * point, because such an entry point is exactly how a UI becomes a hidden rules
 * engine (UI/UX 24 section 9).
 */

import type { SystemId } from "../core/ownership.ts";
import type { CommandDefinition } from "./types.ts";

export class UnknownCommandError extends Error {
  constructor(type: string) {
    super(`No command definition registered for "${type}"`);
    this.name = "UnknownCommandError";
  }
}

export class CommandRegistry {
  private readonly definitions = new Map<string, CommandDefinition<never>>();

  register<TParams extends object>(definition: CommandDefinition<TParams>): void {
    if (this.definitions.has(definition.type)) {
      throw new Error(`Duplicate command definition for "${definition.type}"`);
    }
    this.definitions.set(definition.type, definition as unknown as CommandDefinition<never>);
  }

  has(type: string): boolean {
    return this.definitions.has(type);
  }

  get(type: string): CommandDefinition<never> {
    const definition = this.definitions.get(type);
    if (!definition) throw new UnknownCommandError(type);
    return definition;
  }

  /** Command types in stable alphabetical order, for console listing and docs. */
  list(): string[] {
    return [...this.definitions.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /** Commands grouped by the system that owns their effects (used by tests/docs). */
  byOwner(): Record<string, string[]> {
    const grouped: Record<string, string[]> = {};
    for (const type of this.list()) {
      const definition = this.definitions.get(type);
      if (!definition) continue;
      const owner: SystemId = definition.owner;
      const bucket = grouped[owner] ?? [];
      bucket.push(type);
      grouped[owner] = bucket;
    }
    return grouped;
  }
}
