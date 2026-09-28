/**
 * ReelLife System 09 — Aging, Development & Life Stages.
 *
 * Chronological age is DERIVED from Time, never independently ticked.
 * This engine computes age from the world clock on demand and stores
 * development-milestone state that does not change every tick.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import {
  timeBetween,
  durationToMinutes,
  MINUTES_PER_DAY,
} from "../primitives/time.ts";
import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type {
  AgingState,
  DevelopmentState,
  LifeStage,
  Milestone,
  StageHistoryEntry,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Life stage thresholds in whole years (data-driven, System 09 spec §32).
// These are world defaults; content files may override for specific cultures.
// ---------------------------------------------------------------------------
export interface LifeStageConfig {
  readonly stage: LifeStage;
  readonly minAgeYears: number;
}

export const DEFAULT_LIFE_STAGES: readonly LifeStageConfig[] = [
  { stage: "infancy", minAgeYears: 0 },
  { stage: "toddlerhood", minAgeYears: 2 },
  { stage: "childhood", minAgeYears: 5 },
  { stage: "adolescence", minAgeYears: 12 },
  { stage: "young_adulthood", minAgeYears: 18 },
  { stage: "adulthood", minAgeYears: 26 },
  { stage: "middle_age", minAgeYears: 45 },
  { stage: "later_life", minAgeYears: 65 },
] as const;

/** Minutes in a mean Gregorian year; the basis `computeAgeYears` divides by. */
const MINUTES_PER_YEAR = 365.2425 * MINUTES_PER_DAY;

export function computeAgeYears(birthTimestamp: WorldTime, now: WorldTime): number {
  const elapsedMinutes = durationToMinutes(timeBetween(now, birthTimestamp));
  return elapsedMinutes / MINUTES_PER_YEAR;
}

export function resolveLifeStage(
  ageYears: number,
  stages: readonly LifeStageConfig[] = DEFAULT_LIFE_STAGES,
): LifeStage {
  let current: LifeStage = stages[0]!.stage;
  for (const cfg of stages) {
    if (ageYears >= cfg.minAgeYears) current = cfg.stage;
    else break;
  }
  return current;
}

export function resolveDependencyState(
  stage: LifeStage,
): DevelopmentState["dependencyState"] {
  switch (stage) {
    case "infancy": return "total";
    case "toddlerhood": return "high";
    case "childhood": return "moderate";
    case "adolescence": return "low";
    default: return "independent";
  }
}

export function resolvePhysicalGrowthFactor(ageYears: number): number {
  if (ageYears < 2) return 0.3 + (ageYears / 2) * 0.1;
  if (ageYears < 12) return 0.4 + ((ageYears - 2) / 10) * 0.35;
  if (ageYears < 18) return 0.75 + ((ageYears - 12) / 6) * 0.25;
  return 1.0;
}

// ---------------------------------------------------------------------------
// Engine class — state lives in WorldState.systems.aging
// ---------------------------------------------------------------------------
export class AgingEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;
  /** False for read-only handles, which must not claim the state slot. */
  private readonly claimsState: boolean;

  constructor(scope: SystemScope, world: WorldState, options?: { readonly readOnly?: boolean }) {
    this.scope = scope;
    this.world = world;
    this.claimsState = options?.readOnly !== true;
    if (this.claimsState && !this.world.systems.aging) {
      this.scope.assertOwner("aging");
      this.world.systems.aging = { development: [] } satisfies AgingState;
    }
  }

  /**
   * A handle for reading development state without the right to claim it.
   *
   * Constructing the engine normally initializes `systems.aging` on first use,
   * which is a *write*. Read paths — "how old is this person?", "does System 09
   * know them at all?" — must not need a mutation scope, and must not fail
   * loudly on a world where nobody has been born yet. The state getter already
   * tolerates a missing slot.
   */
  static peek(scope: SystemScope, world: WorldState): AgingEngine {
    return new AgingEngine(scope, world, { readOnly: true });
  }

  /**
   * The authoritative state, with any absent slot read as its empty value, so a
   * read on a world where nobody has been born yet answers "no record" rather
   * than throwing.
   */
  private get state(): AgingState {
    const raw = this.world.systems.aging as Partial<AgingState> | undefined;
    return { development: raw?.development ?? [] };
  }

  private set state(value: AgingState) {
    if (!this.claimsState) {
      throw new Error(
        "AgingEngine: this is a read-only handle (AgingEngine.peek); " +
          "open an aging mutation scope and construct the engine normally to write.",
      );
    }
    this.world.systems.aging = value;
  }

  /** Register a new person's birth. Call this from the birth event handler. */
  registerBirth(personId: EntityId<"person">, birthTimestamp: WorldTime): DevelopmentState {
    this.scope.assertOwner("aging");

    const initial = DEFAULT_LIFE_STAGES[0]!.stage;
    const dev: DevelopmentState = {
      personId,
      birthTimestamp,
      currentLifeStage: initial,
      stageStart: birthTimestamp,
      stageHistory: [{ stage: initial, startedAt: birthTimestamp }],
      milestones: [],
      physicalGrowthFactor: resolvePhysicalGrowthFactor(0),
      dependencyState: "total",
    };
    this.state = { ...this.state, development: [...this.state.development, dev] };
    return dev;
  }

  /**
   * Recalculate development state for a single person against the current world
   * clock. Call this during the simulation tick for active persons.
   *
   * Returns the updated record (or undefined if person not found).
   */
  update(
    personId: EntityId<"person">,
    now: WorldTime,
    stages?: readonly LifeStageConfig[],
  ): DevelopmentState | undefined {
    this.scope.assertOwner("aging");
    const current = this.get(personId);
    if (!current) return undefined;

    const ageYears = computeAgeYears(current.birthTimestamp, now);
    const newStage = resolveLifeStage(ageYears, stages);
    const stageChanged = newStage !== current.currentLifeStage;

    const updated: DevelopmentState = {
      ...current,
      currentLifeStage: newStage,
      stageStart: stageChanged ? now : current.stageStart,
      stageHistory: stageChanged
        ? [
            ...current.stageHistory,
            { stage: newStage, startedAt: now } satisfies StageHistoryEntry,
          ]
        : current.stageHistory,
      physicalGrowthFactor: resolvePhysicalGrowthFactor(ageYears),
      dependencyState: resolveDependencyState(newStage),
    };

    this.state = {
      ...this.state,
      development: this.state.development.map((d) =>
        d.personId === personId ? updated : d,
      ),
    };

    return updated;
  }

  /** Record an arbitrary development milestone (e.g. "first_words"). */
  recordMilestone(
    personId: EntityId<"person">,
    milestoneId: string,
    at: WorldTime,
  ): void {
    this.scope.assertOwner("aging");
    const current = this.get(personId);
    if (!current) throw new Error(`Unknown person for aging: ${personId}`);
    if (current.milestones.some((m) => m.id === milestoneId)) return; // idempotent

    const milestone: Milestone = { id: milestoneId, achievedAt: at };
    const updated: DevelopmentState = {
      ...current,
      milestones: [...current.milestones, milestone],
    };
    this.state = {
      ...this.state,
      development: this.state.development.map((d) =>
        d.personId === personId ? updated : d,
      ),
    };
  }

  get(personId: EntityId<"person">): DevelopmentState | undefined {
    return this.state.development.find((d) => d.personId === personId);
  }

  all(): readonly DevelopmentState[] {
    return this.state.development;
  }
}
