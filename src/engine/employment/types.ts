import type { EntityId } from "../primitives/ids.ts";
import type { Money } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";

/**
 * ReelLife System 24 — Employment & Labor.
 */

export type JobStatus = "active" | "on_leave" | "terminated" | "resigned";

export interface EmploymentRecord {
  readonly id: string;
  readonly employeeId: EntityId<"person">;
  readonly employerOrgId: string;
  readonly title: string;
  readonly occupationId: string;
  readonly wage: Money; // per hour or per shift
  readonly hoursPerWeek: number;
  readonly status: JobStatus;
  readonly startedAt: WorldTime;
  readonly endedAt?: WorldTime;
}

export interface EmploymentSystemState {
  readonly employments: readonly EmploymentRecord[];
}
