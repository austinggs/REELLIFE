import type { EntityId, IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import { clamp } from "../rng/distributions.ts";
import type { InventorySystemState, ItemInstance } from "./types.ts";

export class InventoryEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.inventory) {
      this.scope.assertOwner("inventory");
      this.world.systems.inventory = { items: [] } satisfies InventorySystemState;
    }
  }

  private get state(): InventorySystemState {
    return this.world.systems.inventory as InventorySystemState;
  }

  private set state(value: InventorySystemState) {
    this.world.systems.inventory = value;
  }

  addItem(
    ids: IdAllocator,
    itemDefinitionId: string,
    ownerId: EntityId<"person"> | string,
    possessorId: EntityId<"person"> | string,
    quantity: number,
    condition: number,
    now: WorldTime,
  ): ItemInstance {
    this.scope.assertOwner("inventory");
    const id = `item-${ids.next("activity")}`;
    const item: ItemInstance = {
      id,
      itemDefinitionId,
      ownerId,
      possessorId,
      quantity: Math.max(1, quantity),
      condition: clamp(condition, 0, 1),
      acquiredAt: now,
    };

    this.state = {
      ...this.state,
      items: [...this.state.items, item],
    };
    return item;
  }

  removeItem(itemId: string, quantityToRemove: number = 1): void {
    this.scope.assertOwner("inventory");
    const existing = this.getItem(itemId);
    if (!existing) return;

    if (existing.quantity <= quantityToRemove) {
      this.state = {
        ...this.state,
        items: this.state.items.filter((i) => i.id !== itemId),
      };
    } else {
      const updated: ItemInstance = {
        ...existing,
        quantity: existing.quantity - quantityToRemove,
      };
      this.state = {
        ...this.state,
        items: this.state.items.map((i) => (i.id === itemId ? updated : i)),
      };
    }
  }

  /**
   * Changes *ownership* (distinct from possession, which stays where it is).
   * Used when an item is handed on rather than merely carried — an inheritance,
   * a sale, a repossession. Callers name the reason; the engine does not judge it.
   */
  transferOwnership(itemId: string, newOwnerId: EntityId<"person"> | string): ItemInstance {
    this.scope.assertOwner("inventory");
    const existing = this.getItem(itemId);
    if (!existing) {
      throw new Error(`InventoryEngine.transferOwnership: unknown item ${itemId}`);
    }
    const updated: ItemInstance = { ...existing, ownerId: newOwnerId };
    this.state = {
      ...this.state,
      items: this.state.items.map((i) => (i.id === itemId ? updated : i)),
    };
    return updated;
  }

  transferPossession(itemId: string, newPossessorId: EntityId<"person"> | string): void {
    this.scope.assertOwner("inventory");
    this.state = {
      ...this.state,
      items: this.state.items.map((i) => (i.id === itemId ? { ...i, possessorId: newPossessorId } : i)),
    };
  }

  getItem(itemId: string): ItemInstance | undefined {
    return this.state.items.find((i) => i.id === itemId);
  }

  itemsHeldBy(possessorId: EntityId<"person"> | string): readonly ItemInstance[] {
    return this.state.items.filter((i) => i.possessorId === possessorId);
  }

  all(): readonly ItemInstance[] {
    return this.state.items;
  }
}
