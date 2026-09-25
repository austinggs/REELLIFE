import type { EntityId, IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { Money } from "../primitives/money.ts";
import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { EmploymentRecord, EmploymentSystemState } from "./types.ts";

export class EmploymentEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.employment) {
      this.scope.assertOwner("employment");
      this.world.systems.employment = { employments: [] } satisfies EmploymentSystemState;
    }
  }

  private get state(): EmploymentSystemState {
    return this.world.systems.employment as EmploymentSystemState;
  }

  private set state(value: EmploymentSystemState) {
    this.world.systems.employment = value;
  }

  hire(
    ids: IdAllocator,
    employeeId: EntityId<"person">,
    employerOrgId: string,
    title: string,
    occupationId: string,
    wage: Money,
    hoursPerWeek: number,
    now: WorldTime,
  ): EmploymentRecord {
    this.scope.assertOwner("employment");
    const id = `emp-${ids.next("activity")}`;
    const record: EmploymentRecord = {
      id,
      employeeId,
      employerOrgId,
      title,
      occupationId,
      wage,
      hoursPerWeek,
      status: "active",
      startedAt: now,
    };

    this.state = {
      ...this.state,
      employments: [...this.state.employments, record],
    };
    return record;
  }

  terminate(employmentId: string, reason: "terminated" | "resigned", now: WorldTime): EmploymentRecord | undefined {
    this.scope.assertOwner("employment");
    const emp = this.state.employments.find((e) => e.id === employmentId);
    if (!emp || emp.status !== "active") return undefined;

    const updated: EmploymentRecord = {
      ...emp,
      status: reason,
      endedAt: now,
    };

    this.state = {
      ...this.state,
      employments: this.state.employments.map((e) => (e.id === employmentId ? updated : e)),
    };
    return updated;
  }

  activeEmployments(personId: EntityId<"person">): readonly EmploymentRecord[] {
    return this.state.employments.filter((e) => e.employeeId === personId && e.status === "active");
  }

  all(): readonly EmploymentRecord[] {
    return this.state.employments;
  }
}
