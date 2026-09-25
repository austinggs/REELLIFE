import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";

/** The core need categories that all persons carry. */
export type NeedKind =
  | "hunger"
  | "thirst"
  | "sleep"
  | "rest"
  | "temperature"
  | "hygiene"
  | "toilet"
  | "social_contact"
  | "personal_space"
  | "routine"
  | "recreation";

export type NeedUrgency = "satisfied" | "low" | "moderate" | "high" | "critical";

export interface NeedLevelHistoryEntry {
  readonly timestamp: WorldTime;
  readonly level: number; // 0.0 = empty → 1.0 = fully satisfied
  readonly urgency: NeedUrgency;
}

export interface NeedModifier {
  readonly id: string;
  readonly sourceSystem: string;
  readonly deltaPerHour: number; // positive = satisfies, negative = depletes
  readonly expiresAt?: WorldTime;
}

export interface NeedState {
  readonly kind: NeedKind;
  /** 0.0 = fully depleted, 1.0 = fully satisfied */
  readonly level: number;
  readonly urgency: NeedUrgency;
  readonly lastSatisfied?: WorldTime;
  readonly lastChange: WorldTime;
  readonly modifiers: readonly NeedModifier[];
  readonly history: readonly NeedLevelHistoryEntry[];
  /** Whether the need is currently suppressed (e.g. sedation) */
  readonly suppressed: boolean;
}

export interface PersonNeedsState {
  readonly personId: EntityId<"person">;
  readonly needs: readonly NeedState[];
}

export interface NeedsState {
  readonly persons: readonly PersonNeedsState[];
}
