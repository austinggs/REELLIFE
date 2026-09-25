/**
 * ReelLife System 13 — Personality, Traits & Aptitudes.
 *
 * Stores the relatively persistent trait state per person and resolves how it
 * is expressed and how it changes. Personality moves only gradually, through
 * caller-supplied meaningful experiences; the engine clamps per-change deltas
 * so no single event can teleport a dimension. Aptitudes are per-domain and
 * never a universal stat.
 *
 * Generation (parental contribution + variation + development + environment)
 * is exposed as pure functions so materialization (System 07) can build a
 * deterministic profile from a seeded stream before registering it here.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { RandomSource } from "../rng/distributions.ts";
import { clamp, normal, uniform } from "../rng/distributions.ts";
import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import {
  TRAIT_DIMENSIONS,
  type Aptitude,
  type PersonTraitsState,
  type PersonalityDimensions,
  type TemperamentKind,
  type TraitDimension,
  type TraitExpressionModifier,
  type TraitsSystemState,
} from "./types.ts";

/** Newborns start in a mid band; extremes emerge through variation + life. */
const BIRTH_MIN = 0.2;
const BIRTH_MAX = 0.8;
/** Inheritance noise: children regress toward the mean with this deviation. */
const INHERITANCE_VARIATION = 0.12;
/** A single experience may move a dimension by at most this much. */
const MAX_CHANGE_PER_EXPERIENCE = 0.1;
/** Changes at or above this magnitude are recorded in the trait history. */
const HISTORY_RECORD_THRESHOLD = 0.05;

export function clampTrait(value: number): number {
  return clamp(value, 0, 1);
}

/** Deterministic temperament summary derived from a personality profile. */
export function deriveTemperament(p: PersonalityDimensions): TemperamentKind {
  if (p.emotionalReactivity >= 0.6) {
    return p.sociability >= 0.5 ? "sanguine" : "choleric";
  }
  return p.sociability >= 0.5 ? "phlegmatic" : "melancholic";
}

/**
 * Generate a personality deterministically from a seeded stream. With two
 * parents each dimension blends the parental midpoint with regression-to-mean
 * variation; without parents it is drawn from the birth band. The same stream
 * state always yields the same profile (law 8).
 */
export function generatePersonality(
  source: RandomSource,
  parents?: readonly (PersonalityDimensions | undefined)[],
): PersonalityDimensions {
  const dims = {} as Record<TraitDimension, number>;
  for (const dimension of TRAIT_DIMENSIONS) {
    const [a, b] = parents ?? [];
    let value: number;
    if (a !== undefined && b !== undefined) {
      const midpoint = (a[dimension] + b[dimension]) / 2;
      value = midpoint + normal(source, 0, INHERITANCE_VARIATION);
    } else if (a !== undefined) {
      value = a[dimension] + normal(source, 0, INHERITANCE_VARIATION);
    } else {
      value = uniform(source, BIRTH_MIN, BIRTH_MAX);
    }
    dims[dimension] = clampTrait(value);
  }
  return dims;
}

/** Deterministically generate a set of domain aptitudes for a person. */
export function generateAptitudes(
  source: RandomSource,
  domains: readonly string[],
  personality?: PersonalityDimensions,
): Aptitude[] {
  return domains.map((domain) => {
    // A light pull from related dimensions keeps aptitudes plausible but the
    // draw stays the dominant factor, so aptitude is never destiny.
    let level = uniform(source, 0.1, 0.9);
    if (personality) {
      if (domain === "reasoning" || domain === "craft") {
        level = level * 0.7 + personality.conscientiousness * 0.3;
      } else if (domain === "social") {
        level = level * 0.7 + personality.sociability * 0.3;
      }
    }
    return { domain, level: clampTrait(level) };
  });
}

function emptyDimensions(): PersonalityDimensions {
  const dims = {} as Record<TraitDimension, number>;
  for (const dimension of TRAIT_DIMENSIONS) dims[dimension] = 0.5;
  return dims;
}

// ---------------------------------------------------------------------------
// Engine — state lives in WorldState.systems.traits
// ---------------------------------------------------------------------------
export class TraitsEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.traits) {
      this.scope.assertOwner("traits");
      this.world.systems.traits = { persons: [] } satisfies TraitsSystemState;
    }
  }

  private get state(): TraitsSystemState {
    return this.world.systems.traits as TraitsSystemState;
  }

  private set state(value: TraitsSystemState) {
    this.world.systems.traits = value;
  }

  registerPerson(
    personId: EntityId<"person">,
    personality?: PersonalityDimensions,
    aptitudes: readonly Aptitude[] = [],
  ): PersonTraitsState {
    this.scope.assertOwner("traits");
    const dims = personality ?? emptyDimensions();
    const pts: PersonTraitsState = {
      personId,
      personality: dims,
      temperament: deriveTemperament(dims),
      aptitudes,
      expressionModifiers: [],
      history: [],
    };
    this.state = { ...this.state, persons: [...this.state.persons, pts] };
    return pts;
  }

  /**
   * Apply a meaningful experience to one dimension. Personality changes
   * gradually: the delta is clamped so no single event moves a dimension by
   * more than MAX_CHANGE_PER_EXPERIENCE, and only sufficiently large changes
   * are written to history.
   */
  applyExperience(
    personId: EntityId<"person">,
    dimension: TraitDimension,
    delta: number,
    now: WorldTime,
    cause: string,
  ): void {
    this.scope.assertOwner("traits");
    this._mutatePerson(personId, (pts) => {
      const from = pts.personality[dimension];
      const to = clampTrait(from + clamp(delta, -MAX_CHANGE_PER_EXPERIENCE, MAX_CHANGE_PER_EXPERIENCE));
      if (to === from) return pts;
      const personality: PersonalityDimensions = { ...pts.personality, [dimension]: to };
      const history =
        Math.abs(to - from) >= HISTORY_RECORD_THRESHOLD
          ? [...pts.history, { timestamp: now, dimension, from, to, cause }]
          : pts.history;
      return {
        ...pts,
        personality,
        temperament: deriveTemperament(personality),
        history,
      };
    });
  }

  /** Effective (expressed) value of a dimension after live modifiers. */
  expressedDimension(personId: EntityId<"person">, dimension: TraitDimension, now: WorldTime): number {
    const pts = this.getPerson(personId);
    if (!pts) throw new Error(`Unknown person in traits: ${personId}`);
    let value = pts.personality[dimension];
    for (const mod of pts.expressionModifiers) {
      if (mod.dimension !== dimension) continue;
      if (mod.expiresAt !== undefined && (mod.expiresAt as number) < (now as number)) continue;
      value += mod.delta;
    }
    return clampTrait(value);
  }

  addExpressionModifier(personId: EntityId<"person">, mod: TraitExpressionModifier): void {
    this.scope.assertOwner("traits");
    this._mutatePerson(personId, (pts) => ({
      ...pts,
      expressionModifiers: [...pts.expressionModifiers.filter((m) => m.id !== mod.id), mod],
    }));
  }

  removeExpressionModifier(personId: EntityId<"person">, modId: string): void {
    this.scope.assertOwner("traits");
    this._mutatePerson(personId, (pts) => ({
      ...pts,
      expressionModifiers: pts.expressionModifiers.filter((m) => m.id !== modId),
    }));
  }

  /** Set an aptitude level directly (e.g. on assessment). Idempotent per domain. */
  setAptitude(personId: EntityId<"person">, domain: string, level: number): void {
    this.scope.assertOwner("traits");
    this._mutatePerson(personId, (pts) => ({
      ...pts,
      aptitudes: [
        ...pts.aptitudes.filter((a) => a.domain !== domain),
        { domain, level: clampTrait(level) },
      ],
    }));
  }

  getPerson(personId: EntityId<"person">): PersonTraitsState | undefined {
    return this.state.persons.find((p) => p.personId === personId);
  }

  all(): readonly PersonTraitsState[] {
    return this.state.persons;
  }

  private _mutatePerson(
    personId: EntityId<"person">,
    fn: (pts: PersonTraitsState) => PersonTraitsState,
  ): void {
    const pts = this.getPerson(personId);
    if (!pts) throw new Error(`Unknown person in traits: ${personId}`);
    const updated = fn(pts);
    this.state = {
      ...this.state,
      persons: this.state.persons.map((p) => (p.personId === personId ? updated : p)),
    };
  }
}
