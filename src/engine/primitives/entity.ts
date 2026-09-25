/**
 * ReelLife entity primitives (System 01).
 *
 * The Core stores registries and references, not duplicated domain state.
 * Entity lifecycle supports CREATED -> ACTIVE -> INACTIVE -> HISTORICAL, with
 * hard deletion avoided by default because identity and causal history must
 * survive (System 01 / System 53).
 */

import type { EntityId, EntityKind } from "./ids.ts";
import type { WorldTime } from "./time.ts";

export const ENTITY_LIFECYCLES = [
  "created",
  "active",
  "inactive",
  "historical",
] as const;

export type EntityLifecycle = (typeof ENTITY_LIFECYCLES)[number];

/**
 * A stable reference to an entity. Reference integrity is validated on load;
 * a reference that cannot be resolved is a persistence error, not a silent
 * omission (System 06 / System 59).
 */
export interface EntityRef<K extends EntityKind = EntityKind> {
  readonly kind: K;
  readonly id: EntityId<K>;
}

export function entityRef<K extends EntityKind>(kind: K, id: EntityId<K>): EntityRef<K> {
  return { kind, id };
}

export function sameRef(a: EntityRef, b: EntityRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** Base of every registered persistent entity. */
export interface EntityBase<K extends EntityKind = EntityKind> {
  readonly id: EntityId<K>;
  readonly kind: K;
  readonly createdAt: WorldTime;
  updatedAt: WorldTime;
  lifecycle: EntityLifecycle;
  /** Set when the entity stops being active (death, closure, dissolution...). */
  endedAt?: WorldTime;
}

type RegistryEntry<T> = { readonly value: T };

/**
 * Ordered, deterministic entity registry.
 *
 * Iteration order is insertion order, which is itself deterministic because IDs
 * are allocated by a deterministic counter. Systems must still iterate in ID
 * order when order could affect outcomes; `sortedIds()` exists for that.
 */
export class EntityRegistry<T extends { readonly id: string }> {
  private readonly entries = new Map<string, RegistryEntry<T>>();

  add(entity: T): T {
    if (this.entries.has(entity.id)) {
      throw new Error(`Duplicate entity id in registry: ${entity.id}`);
    }
    this.entries.set(entity.id, { value: entity });
    return entity;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Returns the entity or undefined; callers must handle absence explicitly. */
  get(id: string): T | undefined {
    return this.entries.get(id)?.value;
  }

  /** Returns the entity or throws; used where absence indicates a broken invariant. */
  require(id: string): T {
    const found = this.entries.get(id)?.value;
    if (found === undefined) throw new Error(`Entity not found: ${id}`);
    return found;
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  size(): number {
    return this.entries.size;
  }

  values(): T[] {
    const out: T[] = [];
    for (const entry of this.entries.values()) out.push(entry.value);
    return out;
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  sortedIds(): string[] {
    return this.ids().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  sortedValues(): T[] {
    return this.sortedIds().map((id) => this.require(id));
  }

  filter(predicate: (entity: T) => boolean): T[] {
    const out: T[] = [];
    for (const entry of this.entries.values()) {
      if (predicate(entry.value)) out.push(entry.value);
    }
    return out;
  }

  serialize(): T[] {
    return this.values();
  }

  static deserialize<T extends { readonly id: string }>(items: readonly T[]): EntityRegistry<T> {
    const registry = new EntityRegistry<T>();
    for (const item of items) registry.add(item);
    return registry;
  }
}
