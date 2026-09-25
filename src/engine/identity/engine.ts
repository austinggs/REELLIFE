/**
 * ReelLife System 08 — Character Identity & Origin engine.
 *
 * Stores authoritative PersonIdentity records inside WorldState.systems.identity.
 * PersonId is stable across name changes, migration, death, and control transfer.
 */

import type { EntityId, IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type {
  IdentityState,
  PersonIdentity,
  PersonName,
  ParentageLink,
  OriginContext,
  BirthMetadata,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export interface CreatePersonRequest {
  readonly name: PersonName;
  readonly birth: BirthMetadata;
  readonly parentage?: readonly ParentageLink[];
  readonly origin?: OriginContext;
  readonly generation?: number;
  readonly appearanceFoundationSeed: string;
}

export class IdentityEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.identity) {
      this.scope.assertOwner("identity");
      this.world.systems.identity = { persons: [] } satisfies IdentityState;
    }
  }

  private get state(): IdentityState {
    return this.world.systems.identity as IdentityState;
  }

  private set state(value: IdentityState) {
    this.world.systems.identity = value;
  }

  get(id: EntityId<"person">): PersonIdentity | undefined {
    return this.state.persons.find((p) => p.id === id);
  }

  all(): readonly PersonIdentity[] {
    return this.state.persons;
  }

  create(ids: IdAllocator, request: CreatePersonRequest): PersonIdentity {
    this.scope.assertOwner("identity");
    const person: PersonIdentity = {
      id: ids.next("person"),
      name: request.name,
      birth: request.birth,
      parentage: request.parentage ?? [],
      origin: request.origin ?? {},
      generation: request.generation ?? 1,
      appearanceFoundationSeed: request.appearanceFoundationSeed,
      history: [],
    };
    this.state = {
      ...this.state,
      persons: [...this.state.persons, person],
    };
    return person;
  }

  recordDeath(id: EntityId<"person">, date: WorldTime, cause?: string): void {
    this.scope.assertOwner("identity");
    const person = this.get(id);
    if (!person) throw new Error(`Unknown person: ${id}`);
    if (person.death) throw new Error(`Person ${id} is already dead`);

    const updated: PersonIdentity = {
      ...person,
      death: { date, ...(cause ? { cause } : {}) },
    };
    this.state = {
      ...this.state,
      persons: this.state.persons.map((p) => (p.id === id ? updated : p)),
    };
  }

  changeName(
    id: EntityId<"person">,
    newName: PersonName,
    at: WorldTime,
    reason?: string,
  ): void {
    this.scope.assertOwner("identity");
    const person = this.get(id);
    if (!person) throw new Error(`Unknown person: ${id}`);

    const updated: PersonIdentity = {
      ...person,
      name: newName,
      history: [
        ...person.history,
        {
          timestamp: at,
          type: "nameChange",
          previous: person.name,
          current: newName,
          ...(reason ? { reason } : {}),
        },
      ],
    };
    this.state = {
      ...this.state,
      persons: this.state.persons.map((p) => (p.id === id ? updated : p)),
    };
  }
}

