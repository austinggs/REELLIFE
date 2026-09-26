/**
 * Geography engine (System 37).
 *
 * Owns the spatial hierarchy: world -> continent -> country -> region ->
 * settlement -> district -> neighborhood -> property -> building -> unit ->
 * room. Not every layer has to be instantiated (System 37), and parents must
 * be registered before children so the hierarchy is a forest rooted at the
 * world, never a cycle.
 *
 * Space is causal: LocationRefs produced here feed housing, organizations,
 * scale/materialization and travel, and they must survive save/load intact.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import {
  LOCATION_LEVELS,
  type LocationLevel,
  type LocationRef,
} from "../primitives/location.ts";
import type { GeographySystemState } from "./types.ts";

const LEVEL_INDEX: Readonly<Record<LocationLevel, number>> = (() => {
  const entries = LOCATION_LEVELS.map((level, index) => [level, index] as const);
  return Object.fromEntries(entries) as Record<LocationLevel, number>;
})();

export class GeographyEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.geography) {
      this.scope.assertOwner("geography");
      this.world.systems.geography = { places: [] } satisfies GeographySystemState;
    }
  }

  private get state(): GeographySystemState {
    return this.world.systems.geography as GeographySystemState;
  }

  private set state(value: GeographySystemState) {
    this.world.systems.geography = value;
  }

  all(): readonly LocationRef[] {
    return this.state.places;
  }

  get(id: string): LocationRef | undefined {
    return this.state.places.find((place) => place.id === id);
  }

  findByName(name: string): LocationRef | undefined {
    return this.state.places.find((place) => place.name.toLowerCase() === name.toLowerCase());
  }

  /** Finds a place by one of its former/historical names (UI/UX 19 section 6). */
  findByHistoricalName(historicalName: string): LocationRef | undefined {
    const target = historicalName.toLowerCase();
    return this.state.places.find(
      (place) => place.historicalNames?.some((h) => h.toLowerCase() === target),
    );
  }

  historicalNamesOf(id: string): readonly string[] {
    const place = this.get(id);
    return place?.historicalNames ?? [];
  }

  /**
   * Registers a place. Validates the invariants that make LocationRefs stable
   * and the hierarchy usable: unique IDs, known levels, and a parent that
   * exists at a strictly shallower level (which also rules out cycles).
   */
  register(place: LocationRef): LocationRef {
    this.scope.assertOwner("geography");
    if (!place.id || place.id.length === 0) {
      throw new Error("GeographyEngine.register: place id is required");
    }
    if (this.get(place.id)) {
      throw new Error(`GeographyEngine.register: duplicate place id ${place.id}`);
    }
    if (LEVEL_INDEX[place.level] === undefined) {
      throw new Error(`GeographyEngine.register: unknown location level ${place.level}`);
    }
    if (place.parentId !== undefined) {
      const parent = this.get(place.parentId);
      if (!parent) {
        throw new Error(
          `GeographyEngine.register: parent ${place.parentId} of ${place.id} is not registered`,
        );
      }
      if (LEVEL_INDEX[parent.level] >= LEVEL_INDEX[place.level]) {
        throw new Error(
          `GeographyEngine.register: parent ${parent.id} (${parent.level}) must be shallower than ${place.id} (${place.level})`,
        );
      }
    }
    this.state = { ...this.state, places: [...this.state.places, place] };
    return place;
  }

  /** Direct children of a place, in registration order. */
  children(parentId: string): readonly LocationRef[] {
    return this.state.places.filter((place) => place.parentId === parentId);
  }

  /** Ancestors root-first: world, continent, ..., parent. Empty when unknown. */
  ancestors(id: string): readonly LocationRef[] {
    const chain: LocationRef[] = [];
    let current = this.get(id);
    let depth = 0;
    while (current?.parentId && depth <= LOCATION_LEVELS.length) {
      const parent = this.get(current.parentId);
      if (!parent) break;
      chain.push(parent);
      current = parent;
      depth += 1;
    }
    return chain.reverse();
  }

  /** True when `ancestorId` is on the parent chain of `id` (inclusive). */
  isWithin(id: string, ancestorId: string): boolean {
    if (id === ancestorId) return true;
    return this.ancestors(id).some((place) => place.id === ancestorId);
  }

  /** The settlement containing `id`, walking up the hierarchy. */
  settlementOf(id: string): LocationRef | undefined {
    const place = this.get(id);
    if (place?.level === "settlement") return place;
    return this.ancestors(id).find((ancestor) => ancestor.level === "settlement");
  }
}
