import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";

/**
 * ReelLife System 16 — Goals, Aspirations & Motivation.
 *
 * Models what people want, why they want it, how strongly they pursue it,
 * and how goals adapt.
 */

export type GoalTimeHorizon = "immediate" | "short_term" | "long_term" | "life_scale";

export type MotivationSource =
  | "need"
  | "security"
  | "affection"
  | "belonging"
  | "achievement"
  | "curiosity"
  | "autonomy"
  | "status"
  | "reward"
  | "responsibility"
  | "values"
  | "fear"
  | "opportunity"
  | "social_expectation"
  | "identity"
  | "habit"
  | "obligation";

export type GoalStatus =
  | "active"
  | "paused"
  | "completed"
  | "failed"
  | "abandoned"
  | "expired"
  | "replaced"
  | "impossible";

export interface GoalRecord {
  readonly id: string;
  readonly title: string;
  readonly domain: string;
  readonly horizon: GoalTimeHorizon;
  readonly motivation: MotivationSource;
  /** 0.0 .. 1.0 importance/value to the person */
  readonly priority: number;
  /** 0.0 .. 1.0 time-pressure / deadline sensitivity */
  readonly urgency: number;
  /** 0.0 .. 1.0 determination / resistance to abandonment */
  readonly commitment: number;
  /** 0.0 .. 1.0 current completion progress */
  readonly progress: number;
  readonly status: GoalStatus;
  readonly createdAt: WorldTime;
  readonly updatedAt: WorldTime;
  readonly deadline?: WorldTime;
  readonly parentGoalId?: string;
  readonly subGoalIds: readonly string[];
}

export interface GoalHistoryEntry {
  readonly timestamp: WorldTime;
  readonly goalId: string;
  readonly previousStatus: GoalStatus;
  readonly newStatus: GoalStatus;
  readonly reason: string;
}

export interface PersonGoalsState {
  readonly personId: EntityId<"person">;
  readonly goals: readonly GoalRecord[];
  readonly history: readonly GoalHistoryEntry[];
}

export interface GoalsSystemState {
  readonly persons: readonly PersonGoalsState[];
}
