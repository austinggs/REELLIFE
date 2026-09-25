import type { IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import { clamp } from "../rng/distributions.ts";
import type { FoodItemRecord, FoodSystemState } from "./types.ts";

export class FoodEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.food) {
      this.scope.assertOwner("food");
      this.world.systems.food = { foods: [] } satisfies FoodSystemState;
    }
  }

  private get state(): FoodSystemState {
    return this.world.systems.food as FoodSystemState;
  }

  private set state(value: FoodSystemState) {
    this.world.systems.food = value;
  }

  createFood(
    ids: IdAllocator,
    name: string,
    calories: number,
    hydration: number,
    now: WorldTime,
    shelfLifeMinutes: number = 2880, // 2 days
  ): FoodItemRecord {
    this.scope.assertOwner("food");
    const id = `food-${ids.next("activity")}`;
    const expiresAt = ((now as number) + shelfLifeMinutes) as WorldTime;

    const record: FoodItemRecord = {
      id,
      name,
      calories,
      hydration: clamp(hydration, 0, 1),
      freshness: 1.0,
      preparedAt: now,
      expiresAt,
    };

    this.state = {
      ...this.state,
      foods: [...this.state.foods, record],
    };
    return record;
  }

  getFood(id: string): FoodItemRecord | undefined {
    return this.state.foods.find((f) => f.id === id);
  }

  consume(foodId: string): FoodItemRecord | undefined {
    this.scope.assertOwner("food");
    const food = this.getFood(foodId);
    if (!food) return undefined;

    this.state = {
      ...this.state,
      foods: this.state.foods.filter((f) => f.id !== foodId),
    };
    return food;
  }
}
