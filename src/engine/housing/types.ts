import type { EntityId } from "../primitives/ids.ts";
import type { Money } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";

/**
 * ReelLife System 27 — Housing & Property.
 */

export type TenancyType = "owner" | "tenant" | "roommate" | "dependent";

export interface ResidenceRecord {
  readonly id: string;
  readonly propertyId: string;
  readonly residentId: EntityId<"person">;
  readonly type: TenancyType;
  readonly startedAt: WorldTime;
  readonly endedAt?: WorldTime;
}

export interface LeaseContract {
  readonly id: string;
  readonly propertyId: string;
  readonly landlordId: string; // Person or Org
  readonly tenantPersonId: EntityId<"person">;
  readonly rentPerMonth: Money;
  readonly startedAt: WorldTime;
  readonly active: boolean;
}

export interface HousingSystemState {
  readonly residences: readonly ResidenceRecord[];
  readonly leases: readonly LeaseContract[];
}
