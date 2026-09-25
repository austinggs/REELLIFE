import type { EntityId, IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { Money } from "../primitives/money.ts";
import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { HousingSystemState, LeaseContract, ResidenceRecord, TenancyType } from "./types.ts";

export class HousingEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.housing) {
      this.scope.assertOwner("housing");
      this.world.systems.housing = { residences: [], leases: [] } satisfies HousingSystemState;
    }
  }

  private get state(): HousingSystemState {
    return this.world.systems.housing as HousingSystemState;
  }

  private set state(value: HousingSystemState) {
    this.world.systems.housing = value;
  }

  moveIn(
    ids: IdAllocator,
    residentId: EntityId<"person">,
    propertyId: string,
    type: TenancyType,
    now: WorldTime,
  ): ResidenceRecord {
    this.scope.assertOwner("housing");
    // End current active residence if moving
    const current = this.currentResidence(residentId);
    if (current) {
      this.moveOut(residentId, now);
    }

    const id = `res-${ids.next("activity")}`;
    const record: ResidenceRecord = {
      id,
      propertyId,
      residentId,
      type,
      startedAt: now,
    };

    this.state = {
      ...this.state,
      residences: [...this.state.residences, record],
    };
    return record;
  }

  moveOut(residentId: EntityId<"person">, now: WorldTime): void {
    this.scope.assertOwner("housing");
    this.state = {
      ...this.state,
      residences: this.state.residences.map((r) =>
        r.residentId === residentId && !r.endedAt ? { ...r, endedAt: now } : r,
      ),
    };
  }

  signLease(
    ids: IdAllocator,
    propertyId: string,
    landlordId: string,
    tenantPersonId: EntityId<"person">,
    rentPerMonth: Money,
    now: WorldTime,
  ): LeaseContract {
    this.scope.assertOwner("housing");
    const id = `lease-${ids.next("activity")}`;
    const lease: LeaseContract = {
      id,
      propertyId,
      landlordId,
      tenantPersonId,
      rentPerMonth,
      startedAt: now,
      active: true,
    };

    this.state = {
      ...this.state,
      leases: [...this.state.leases, lease],
    };
    return lease;
  }

  currentResidence(residentId: EntityId<"person">): ResidenceRecord | undefined {
    return this.state.residences.find((r) => r.residentId === residentId && !r.endedAt);
  }

  all(): readonly ResidenceRecord[] {
    return this.state.residences;
  }
}
