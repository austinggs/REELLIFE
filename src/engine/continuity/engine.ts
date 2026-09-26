/**
 * Life continuity engine (System 53, M2 partial).
 *
 * Owns the death lifecycle registry: ACTIVE -> DECEASED -> HISTORICAL.
 * The engine records lifecycle truth; identity keeps the person's record
 * (including its death field), and `pronounceDeath` below coordinates the
 * two through sequential ownership scopes — one owner per write.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import { IdentityEngine } from "../identity/engine.ts";
import type { ContinuitySystemState, LifeStatus } from "./types.ts";

export class LifeContinuityEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.continuity) {
      this.scope.assertOwner("continuity");
      this.world.systems.continuity = { statuses: {}, deaths: [] } satisfies ContinuitySystemState;
    }
  }

  private get state(): ContinuitySystemState {
    return this.world.systems.continuity as ContinuitySystemState;
  }

  private set state(value: ContinuitySystemState) {
    this.world.systems.continuity = value;
  }

  statusOf(personId: EntityId<"person">): LifeStatus {
    return this.state.statuses[String(personId)] ?? "active";
  }

  deathOf(personId: EntityId<"person">): ContinuitySystemState["deaths"][number] | undefined {
    return this.state.deaths.find((entry) => entry.personId === personId);
  }

  all(): readonly ContinuitySystemState["deaths"][number][] {
    return this.state.deaths;
  }

  registerDeath(personId: EntityId<"person">, declaredAt: WorldTime, cause?: string): void {
    this.scope.assertOwner("continuity");
    if (this.statusOf(personId) !== "active") {
      throw new Error(
        `LifeContinuityEngine.registerDeath: ${personId} is ${this.statusOf(personId)}, not active`,
      );
    }
    this.state = {
      statuses: { ...this.state.statuses, [String(personId)]: "deceased" },
      deaths: [
        ...this.state.deaths,
        { personId, declaredAt, ...(cause ? { cause } : {}) },
      ],
    };
  }

  /** Deceased lives become historical once no active matter remains (M7 timing). */
  markHistorical(personId: EntityId<"person">): void {
    this.scope.assertOwner("continuity");
    if (this.statusOf(personId) !== "deceased") {
      throw new Error(
        `LifeContinuityEngine.markHistorical: ${personId} is not deceased`,
      );
    }
    this.state = {
      ...this.state,
      statuses: { ...this.state.statuses, [String(personId)]: "historical" },
    };
  }
}

/**
 * Pronounces a death: identity records it on the person, continuity advances
 * the lifecycle. PersonId survives both writes unchanged (System 53).
 */
export function pronounceDeath(
  sim: {
    guard: { mutate<T>(owner: string, fn: () => T): T };
    scope: SystemScope;
    world: WorldState;
  },
  personId: EntityId<"person">,
  declaredAt: WorldTime,
  cause?: string,
): void {
  sim.guard.mutate("identity", () => {
    new IdentityEngine(sim.scope, sim.world).recordDeath(personId, declaredAt, cause);
  });
  sim.guard.mutate("continuity", () => {
    new LifeContinuityEngine(sim.scope, sim.world).registerDeath(personId, declaredAt, cause);
  });
}
