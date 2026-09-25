import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";

/**
 * ReelLife System 29 — Inventory / Items & Object State.
 */

export interface ItemInstance {
  readonly id: string;
  readonly itemDefinitionId: string;
  readonly ownerId: EntityId<"person"> | string;
  readonly possessorId: EntityId<"person"> | string;
  readonly quantity: number;
  readonly condition: number; // 0..1
  readonly acquiredAt: WorldTime;
}

export interface InventorySystemState {
  readonly items: readonly ItemInstance[];
}
