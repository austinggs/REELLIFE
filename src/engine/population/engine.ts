/**
 * Population engine (System 47).
 *
 * Owns aggregate demographic records per continent / country / region /
 * settlement. Writes go through the owning system's scope exactly like every
 * other state-owning engine; reads are scope-free. Registration is idempotent:
 * a location's aggregate is defined once and re-definition is a no-op.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { PopulationAggregate, PopulationSystemState } from "./types.ts";

export class PopulationEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.population) {
      this.scope.assertOwner("population");
      this.world.systems.population = { aggregates: [] } satisfies PopulationSystemState;
    }
  }

  private get state(): PopulationSystemState {
    return this.world.systems.population as PopulationSystemState;
  }

  private set state(value: PopulationSystemState) {
    this.world.systems.population = value;
  }

  aggregates(): readonly PopulationAggregate[] {
    return this.state.aggregates;
  }

  aggregateFor(locationId: string): PopulationAggregate | undefined {
    return this.state.aggregates.find((aggregate) => aggregate.locationId === locationId);
  }

  /** Direct children of `parentId`, in definition order. */
  aggregatesUnder(parentId: string): readonly PopulationAggregate[] {
    return this.state.aggregates.filter((aggregate) => aggregate.parentId === parentId);
  }

  /** Sum of the direct children of `parentId` (additive levels only). */
  totalUnder(parentId: string): number {
    return this.aggregatesUnder(parentId).reduce((sum, aggregate) => sum + aggregate.totalPopulation, 0);
  }

  /** Defines an aggregate. Idempotent: an existing location keeps its first definition. */
  define(aggregate: PopulationAggregate): PopulationAggregate {
    this.scope.assertOwner("population");
    if (!aggregate.locationId || aggregate.locationId.length === 0) {
      throw new Error("PopulationEngine.define: locationId is required");
    }
    if (!Number.isFinite(aggregate.totalPopulation) || aggregate.totalPopulation < 0) {
      throw new Error("PopulationEngine.define: totalPopulation must be a non-negative number");
    }
    if (aggregate.urbanizationRate < 0 || aggregate.urbanizationRate > 1) {
      throw new Error("PopulationEngine.define: urbanizationRate must be in [0, 1]");
    }
    const existing = this.aggregateFor(aggregate.locationId);
    if (existing) return existing;
    this.state = { ...this.state, aggregates: [...this.state.aggregates, aggregate] };
    return aggregate;
  }
}
