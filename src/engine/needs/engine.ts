/**
 * ReelLife System 10 — Needs & Daily Living.
 *
 * Needs are pressures, not scripts. This engine tracks levels and urgency.
 * Satisfaction is triggered by events/commands from other systems (Food, Housing, etc.).
 */

import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import { MINUTES_PER_HOUR } from "../primitives/time.ts";
import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type {
  NeedKind,
  NeedModifier,
  NeedState,
  NeedUrgency,
  NeedsState,
  PersonNeedsState,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Default depletion rates in "need level per hour" (positive = depletes)
// ---------------------------------------------------------------------------
const DEPLETION_RATE_PER_HOUR: Record<NeedKind, number> = {
  hunger: 0.05,        // ~20h to empty
  thirst: 0.10,        // ~10h to empty
  sleep: 0.04,         // ~25h to fully sleep-deprived
  rest: 0.06,          // ~16h
  temperature: 0.00,   // managed externally (weather/housing)
  hygiene: 0.02,       // ~50h
  toilet: 0.12,        // ~8h
  social_contact: 0.02,
  personal_space: 0.00, // managed by housing/environment
  routine: 0.01,
  recreation: 0.02,
};

const CORE_NEEDS: readonly NeedKind[] = [
  "hunger", "thirst", "sleep", "rest", "temperature",
  "hygiene", "toilet",
];
const ALL_NEEDS: readonly NeedKind[] = [
  ...CORE_NEEDS,
  "social_contact", "personal_space", "routine", "recreation",
];

function computeUrgency(level: number): NeedUrgency {
  if (level >= 0.7) return "satisfied";
  if (level >= 0.5) return "low";
  if (level >= 0.3) return "moderate";
  if (level >= 0.1) return "high";
  return "critical";
}

function initialNeed(kind: NeedKind, now: WorldTime): NeedState {
  return {
    kind,
    level: 0.8,
    urgency: "satisfied",
    lastChange: now,
    modifiers: [],
    history: [],
    suppressed: false,
  };
}

function tickNeed(
  need: NeedState,
  elapsedMinutes: number,
  now: WorldTime,
): NeedState {
  if (need.suppressed) return { ...need, lastChange: now };

  // Compute net delta from modifiers
  let netRatePerHour = -DEPLETION_RATE_PER_HOUR[need.kind];
  for (const mod of need.modifiers) {
    if (mod.expiresAt !== undefined && (mod.expiresAt as number) < (now as number)) continue;
    netRatePerHour += mod.deltaPerHour;
  }

  const delta = (netRatePerHour * elapsedMinutes) / MINUTES_PER_HOUR;
  const newLevel = Math.max(0, Math.min(1, need.level + delta));
  const newUrgency = computeUrgency(newLevel);

  return {
    ...need,
    level: newLevel,
    urgency: newUrgency,
    lastChange: now,
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
export class NeedsEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.needs) {
      this.scope.assertOwner("needs");
      this.world.systems.needs = { persons: [] } satisfies NeedsState;
    }
  }

  private get state(): NeedsState {
    return this.world.systems.needs as NeedsState;
  }

  private set state(value: NeedsState) {
    this.world.systems.needs = value;
  }

  /** Initialise needs for a new person. */
  registerPerson(
    personId: EntityId<"person">,
    now: WorldTime,
    kinds: readonly NeedKind[] = ALL_NEEDS,
  ): PersonNeedsState {
    this.scope.assertOwner("needs");
    const pns: PersonNeedsState = {
      personId,
      needs: kinds.map((k) => initialNeed(k, now)),
    };
    this.state = { ...this.state, persons: [...this.state.persons, pns] };
    return pns;
  }

  /**
   * Advance needs for one person by `elapsedMinutes`.
   * Called during the tick loop for active persons.
   */
  tick(
    personId: EntityId<"person">,
    elapsedMinutes: number,
    now: WorldTime,
  ): PersonNeedsState | undefined {
    this.scope.assertOwner("needs");
    const pns = this.getPerson(personId);
    if (!pns) return undefined;

    const updated: PersonNeedsState = {
      ...pns,
      needs: pns.needs.map((n) => tickNeed(n, elapsedMinutes, now)),
    };
    this.state = {
      ...this.state,
      persons: this.state.persons.map((p) =>
        p.personId === personId ? updated : p,
      ),
    };
    return updated;
  }

  /** Satisfy a need by a given amount (0–1 range). */
  satisfy(
    personId: EntityId<"person">,
    kind: NeedKind,
    amount: number,
    now: WorldTime,
  ): void {
    this.scope.assertOwner("needs");
    this._mutateNeed(personId, kind, (n) => {
      const newLevel = Math.min(1, n.level + amount);
      return {
        ...n,
        level: newLevel,
        urgency: computeUrgency(newLevel),
        lastSatisfied: now,
        lastChange: now,
      };
    });
  }

  addModifier(personId: EntityId<"person">, kind: NeedKind, mod: NeedModifier): void {
    this.scope.assertOwner("needs");
    this._mutateNeed(personId, kind, (n) => ({
      ...n,
      modifiers: [...n.modifiers.filter((m) => m.id !== mod.id), mod],
    }));
  }

  removeModifier(personId: EntityId<"person">, kind: NeedKind, modId: string): void {
    this.scope.assertOwner("needs");
    this._mutateNeed(personId, kind, (n) => ({
      ...n,
      modifiers: n.modifiers.filter((m) => m.id !== modId),
    }));
  }

  setSuppressed(
    personId: EntityId<"person">,
    kind: NeedKind,
    suppressed: boolean,
  ): void {
    this.scope.assertOwner("needs");
    this._mutateNeed(personId, kind, (n) => ({ ...n, suppressed }));
  }

  getPerson(personId: EntityId<"person">): PersonNeedsState | undefined {
    return this.state.persons.find((p) => p.personId === personId);
  }

  getNeed(personId: EntityId<"person">, kind: NeedKind): NeedState | undefined {
    return this.getPerson(personId)?.needs.find((n) => n.kind === kind);
  }

  private _mutateNeed(
    personId: EntityId<"person">,
    kind: NeedKind,
    fn: (n: NeedState) => NeedState,
  ): void {
    const pns = this.getPerson(personId);
    if (!pns) throw new Error(`Unknown person in needs: ${personId}`);
    const updated: PersonNeedsState = {
      ...pns,
      needs: pns.needs.map((n) => (n.kind === kind ? fn(n) : n)),
    };
    this.state = {
      ...this.state,
      persons: this.state.persons.map((p) =>
        p.personId === personId ? updated : p,
      ),
    };
  }
}
