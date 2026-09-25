import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";

/**
 * ReelLife System 17 — NPC Decision-Making & Autonomy.
 *
 * Selects NPC actions from their perceived world, internal state,
 * goals, constraints, habits, and opportunities.
 */

export type AutonomyMode = "full" | "semi" | "directed" | "player_controlled";

export type DecisionMode =
  | "reactive"
  | "utility"
  | "rule_based"
  | "goal_directed"
  | "habitual"
  | "social"
  | "emergency";

export interface CandidateAction {
  readonly id: string;
  readonly type: string;
  readonly label: string;
  readonly domain: string;
  readonly baseScore: number;
  readonly estimatedCost?: number;
  readonly estimatedRisk?: number;
  readonly estimatedReward?: number;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface EvaluatedAction extends CandidateAction {
  readonly eligible: boolean;
  readonly ineligibilityReason?: string;
  readonly finalScore: number;
}

export interface Intention {
  readonly actionId: string;
  readonly actionType: string;
  readonly score: number;
  readonly formedAt: WorldTime;
  readonly mode: DecisionMode;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface DecisionRecord {
  readonly id: string;
  readonly timestamp: WorldTime;
  readonly mode: DecisionMode;
  readonly selectedAction: CandidateAction;
  readonly consideredCount: number;
  readonly justification: string;
}

export interface PersonDecisionsState {
  readonly personId: EntityId<"person">;
  readonly autonomyMode: AutonomyMode;
  readonly activeIntention?: Intention;
  readonly history: readonly DecisionRecord[];
}

export interface DecisionsSystemState {
  readonly persons: readonly PersonDecisionsState[];
}
