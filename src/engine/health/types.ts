import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";

export type ConditionStatus =
  | "active"
  | "recovering"
  | "resolved"
  | "chronic"
  | "terminal";

export type ConditionType = "acute" | "chronic" | "injury";

export type HealthConditionSeverity = "mild" | "moderate" | "severe" | "critical";

export interface HealthCondition {
  readonly id: string;
  readonly name: string;
  readonly type: ConditionType;
  readonly status: ConditionStatus;
  readonly severity: HealthConditionSeverity;
  readonly onsetAt: WorldTime;
  readonly cause?: string;
  readonly symptoms: readonly string[];
  readonly functionalImpairment: number; // 0.0 = none, 1.0 = fully incapacitated
  readonly progressionRate: number; // negative = improving, positive = worsening per hour
  readonly resolvedAt?: WorldTime;
}

export interface Treatment {
  readonly id: string;
  readonly name: string;
  readonly startedAt: WorldTime;
  readonly conditionId: string;
  readonly adherence: number; // 0.0–1.0
  readonly effectivenessModifier: number;
  readonly endedAt?: WorldTime;
}

export interface Medication {
  readonly id: string;
  readonly name: string;
  readonly startedAt: WorldTime;
  readonly dosagePerDay: number;
  readonly adherence: number;
  readonly contraindications: readonly string[];
  readonly endedAt?: WorldTime;
}

export interface RiskFactor {
  readonly id: string;
  readonly name: string;
  readonly magnitude: number; // 0.0–1.0
}

/** 0.0 = fully incapacitated, 1.0 = no impairment. */
export interface FunctionalCapacity {
  readonly physical: number;
  readonly cognitive: number;
  readonly social: number;
}

export type VitalState = "stable" | "deteriorating" | "critical" | "deceased";

export interface HealthState {
  readonly personId: EntityId<"person">;
  readonly overallCondition: HealthConditionSeverity | "healthy";
  readonly vitalState: VitalState;
  readonly conditions: readonly HealthCondition[];
  readonly treatments: readonly Treatment[];
  readonly medications: readonly Medication[];
  readonly allergies: readonly string[];
  readonly riskFactors: readonly RiskFactor[];
  readonly functionalCapacity: FunctionalCapacity;
  readonly history: readonly { timestamp: WorldTime; note: string }[];
}

export interface HealthSystemState {
  readonly persons: readonly HealthState[];
}
