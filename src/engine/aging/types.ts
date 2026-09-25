import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";

/**
 * Data-driven life stages (System 09 §32). Chronological age is DERIVED from
 * the world clock; a stage is a label resolved from that derived age against
 * configurable thresholds, never an independently ticked counter.
 */
export type LifeStage =
  | "infancy"
  | "toddlerhood"
  | "childhood"
  | "adolescence"
  | "young_adulthood"
  | "adulthood"
  | "middle_age"
  | "later_life";

/** Multidimensional dependency/independence collapsed to an ordinal level. */
export type DependencyState =
  | "total"
  | "high"
  | "moderate"
  | "low"
  | "independent";

export interface Milestone {
  readonly id: string;
  readonly achievedAt: WorldTime;
}

export interface StageHistoryEntry {
  readonly stage: LifeStage;
  readonly startedAt: WorldTime;
}

/**
 * Persistent development record for one person. Only milestone/threshold state
 * that does not change every tick is stored; age is recomputed on demand.
 */
export interface DevelopmentState {
  readonly personId: EntityId<"person">;
  readonly birthTimestamp: WorldTime;
  readonly currentLifeStage: LifeStage;
  /** Timestamp at which the current life stage began. */
  readonly stageStart: WorldTime;
  readonly stageHistory: readonly StageHistoryEntry[];
  readonly milestones: readonly Milestone[];
  /** 0.0 = newborn, 1.0 = fully grown. */
  readonly physicalGrowthFactor: number;
  readonly dependencyState: DependencyState;
}

export interface AgingState {
  readonly development: readonly DevelopmentState[];
}
