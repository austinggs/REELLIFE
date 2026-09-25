import type { WorldTime } from "../primitives/time.ts";

/**
 * ReelLife System 30 — Food / Nutrition & Consumption.
 */

export interface FoodItemRecord {
  readonly id: string;
  readonly name: string;
  readonly calories: number;
  readonly hydration: number; // 0..1
  readonly freshness: number; // 0..1
  readonly preparedAt: WorldTime;
  readonly expiresAt: WorldTime;
}

export interface FoodSystemState {
  readonly foods: readonly FoodItemRecord[];
}
