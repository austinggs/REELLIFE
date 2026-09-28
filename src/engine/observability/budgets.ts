/**
 * ReelLife performance budgets (M8, System 59 telemetry).
 *
 * A budget is a *claim about cost*, written down so it can be checked, rather
 * than a hope. Two things make this useful rather than decorative:
 *
 *  1. **Budgets are per resolution level.** System 07's whole point is that the
 *     world has a coarse truth and a fine one, and the cost of a step must be
 *     judged against how much of the world is at that resolution. One global
 *     number would be either trivially met at city scope or unachievable at
 *     street scope, and would say nothing about which.
 *  2. **Budgets are structural, not clock-based.** Wall-clock assertions are
 *     flaky on shared CI and say more about the machine than about the code. The
 *     unit here is therefore *work units* — resolved persons, processed events,
 *     persistence writes — which are deterministic and reproducible.
 *
 * Nothing here is simulation truth. A budget is engineering telemetry: a world
 * that blows one is slow, not incorrect, and a breach must never roll back or
 * refuse a state transition.
 */

/** Resolution levels, coarsest first. Mirrors System 07's scale ladder. */
export const RESOLUTION_LEVELS = [
  "abstract",
  "regional",
  "settlement",
  "street",
  "household",
] as const;
export type ResolutionLevel = (typeof RESOLUTION_LEVELS)[number];

export const RESOLUTION_ORDER: Readonly<Record<ResolutionLevel, number>> = {
  abstract: 0,
  regional: 1,
  settlement: 2,
  street: 3,
  household: 4,
};

/**
 * Budget per level, in work units per step.
 *
 * `maxResolvedPersonsPerStep` is the one that bites: the engine may simulate as
 * many people at `abstract` as it likes, because the aggregate is a small fact,
 * but at `household` each resolved person carries needs, activity, decisions and
 * relationships, so per-step cost is linear in the resolved population and has
 * to be capped by the caller narrowing the radius rather than by silently
 * dropping people.
 *
 * These are a starting calibration, not a measurement — deliberately round, and
 * recorded as provisional in `docs/CONTENT_GAPS.md`. Tightening them is a
 * decision made against real profiling.
 */
export interface ResolutionBudget {
  readonly level: ResolutionLevel;
  /** Resolved persons a single step may process. */
  readonly maxResolvedPersonsPerStep: number;
  /** Events a single step may drain. */
  readonly maxEventsPerStep: number;
  /** Work units a single step may cost. */
  readonly maxWorkUnitsPerStep: number;
  /** Post-save canonical-JSON ceiling, in bytes. */
  readonly maxSaveBytes: number;
}

export const RESOLUTION_BUDGETS: Readonly<Record<ResolutionLevel, ResolutionBudget>> = {
  abstract: {
    level: "abstract",
    maxResolvedPersonsPerStep: 0,
    maxEventsPerStep: 512,
    maxWorkUnitsPerStep: 2_048,
    maxSaveBytes: 8_388_608,
  },
  regional: {
    level: "regional",
    maxResolvedPersonsPerStep: 64,
    maxEventsPerStep: 512,
    maxWorkUnitsPerStep: 16_384,
    maxSaveBytes: 16_777_216,
  },
  settlement: {
    level: "settlement",
    maxResolvedPersonsPerStep: 512,
    maxEventsPerStep: 1_024,
    maxWorkUnitsPerStep: 65_536,
    maxSaveBytes: 33_554_432,
  },
  street: {
    level: "street",
    maxResolvedPersonsPerStep: 2_048,
    maxEventsPerStep: 2_048,
    maxWorkUnitsPerStep: 262_144,
    maxSaveBytes: 67_108_864,
  },
  household: {
    level: "household",
    maxResolvedPersonsPerStep: 8_192,
    maxEventsPerStep: 4_096,
    maxWorkUnitsPerStep: 1_048_576,
    maxSaveBytes: 134_217_728,
  },
};

/** What a caller measured about one step at one resolution level. */
export interface StepMeasurement {
  readonly level: ResolutionLevel;
  readonly resolvedPersons: number;
  readonly eventsProcessed: number;
  /** Structured work units; defaults to the two obvious contributors. */
  readonly workUnits?: number;
  /** Canonical JSON size of the serialized world, when measured. */
  readonly saveBytes?: number;
}

export interface BudgetBreach {
  readonly level: ResolutionLevel;
  readonly unit: "resolvedPersons" | "events" | "workUnits" | "saveBytes";
  readonly measured: number;
  readonly budget: number;
  /** Plain-language explanation, safe to show on a debug surface. */
  readonly message: string;
}

export interface BudgetVerdict {
  readonly level: ResolutionLevel;
  readonly ok: boolean;
  readonly breaches: readonly BudgetBreach[];
  /** Work units used, resolved from the measurement. */
  readonly workUnits: number;
}

function breach(
  level: ResolutionLevel,
  unit: BudgetBreach["unit"],
  measured: number,
  budget: number,
  message: string,
): BudgetBreach {
  return { level, unit, measured, budget, message };
}

/**
 * Judges one step against the budget for its resolution level.
 *
 * Work units default to `resolvedPersons + eventsProcessed`, so a caller that
 * measures nothing beyond the obvious still gets a meaningful number. Every
 * breach is reported, not just the first: knowing a step blew *both* the person
 * and the event ceiling is more useful than being told which it hit first.
 */
export function judgeStep(measurement: StepMeasurement): BudgetVerdict {
  const budget = RESOLUTION_BUDGETS[measurement.level];
  const breaches: BudgetBreach[] = [];

  if (measurement.resolvedPersons > budget.maxResolvedPersonsPerStep) {
    breaches.push(
      breach(
        measurement.level,
        "resolvedPersons",
        measurement.resolvedPersons,
        budget.maxResolvedPersonsPerStep,
        `step resolved ${measurement.resolvedPersons} people, over the ${budget.level} budget of ` +
          `${budget.maxResolvedPersonsPerStep}; narrow the simulation radius or lower the resolution level`,
      ),
    );
  }

  if (measurement.eventsProcessed > budget.maxEventsPerStep) {
    breaches.push(
      breach(
        measurement.level,
        "events",
        measurement.eventsProcessed,
        budget.maxEventsPerStep,
        `step drained ${measurement.eventsProcessed} events, over the ${budget.level} budget of ` +
          `${budget.maxEventsPerStep}`,
      ),
    );
  }

  const workUnits =
    measurement.workUnits ?? measurement.resolvedPersons + measurement.eventsProcessed;
  if (workUnits > budget.maxWorkUnitsPerStep) {
    breaches.push(
      breach(
        measurement.level,
        "workUnits",
        workUnits,
        budget.maxWorkUnitsPerStep,
        `step cost ${workUnits} work units, over the ${measurement.level} budget of ` +
          `${budget.maxWorkUnitsPerStep}`,
      ),
    );
  }

  if (measurement.saveBytes !== undefined && measurement.saveBytes > budget.maxSaveBytes) {
    breaches.push(
      breach(
        measurement.level,
        "saveBytes",
        measurement.saveBytes,
        budget.maxSaveBytes,
        `serialized world is ${measurement.saveBytes} bytes, over the ${measurement.level} budget of ` +
          `${budget.maxSaveBytes}`,
      ),
    );
  }

  return { level: measurement.level, ok: breaches.length === 0, breaches, workUnits };
}


export interface BudgetSummary {
  readonly level: ResolutionLevel;
  readonly steps: number;
  readonly averageWorkUnits: number;
  readonly worstResolvedPersons: number;
  readonly worstEvents: number;
  readonly worstWorkUnits: number;
  readonly worstSaveBytes: number;
  readonly breachCount: number;
  readonly ok: boolean;
}

/**
 * A running tally across many steps, so a caller can ask "did this run stay
 * within budget?" rather than inspecting each step.
 *
 * `worst*` is tracked because an average is the wrong statistic for a budget: a
 * simulation that is fast except for one pathological step is not fast, and an
 * average would hide exactly the case worth finding.
 */
export class BudgetLedger {
  private readonly resolutionLevel: ResolutionLevel;
  private worstResolvedPersons = 0;
  private worstEvents = 0;
  private worstWorkUnits = 0;
  private worstSaveBytes = 0;
  private stepCount = 0;
  private totalWorkUnits = 0;
  private readonly recorded: BudgetBreach[] = [];

  constructor(level: ResolutionLevel) {
    this.resolutionLevel = level;
  }

  /** Records a step and returns its verdict, so a caller can react at once. */
  record(measurement: Omit<StepMeasurement, "level">): BudgetVerdict {
    const verdict = judgeStep({ level: this.resolutionLevel, ...measurement });
    this.stepCount += 1;
    this.totalWorkUnits += verdict.workUnits;
    this.worstResolvedPersons = Math.max(this.worstResolvedPersons, measurement.resolvedPersons);
    this.worstEvents = Math.max(this.worstEvents, measurement.eventsProcessed);
    this.worstWorkUnits = Math.max(this.worstWorkUnits, verdict.workUnits);
    if (measurement.saveBytes !== undefined) {
      this.worstSaveBytes = Math.max(this.worstSaveBytes, measurement.saveBytes);
    }
    this.recorded.push(...verdict.breaches);
    return verdict;
  }

  level(): ResolutionLevel {
    return this.resolutionLevel;
  }

  steps(): number {
    return this.stepCount;
  }

  averageWorkUnits(): number {
    return this.stepCount === 0 ? 0 : this.totalWorkUnits / this.stepCount;
  }

  breaches(): readonly BudgetBreach[] {
    return this.recorded;
  }

  ok(): boolean {
    return this.recorded.length === 0;
  }

  summary(): BudgetSummary {
    return {
      level: this.resolutionLevel,
      steps: this.stepCount,
      averageWorkUnits: this.averageWorkUnits(),
      worstResolvedPersons: this.worstResolvedPersons,
      worstEvents: this.worstEvents,
      worstWorkUnits: this.worstWorkUnits,
      worstSaveBytes: this.worstSaveBytes,
      breachCount: this.recorded.length,
      ok: this.ok(),
    };
  }
}

/**
 * Which resolution level a materialized population implies.
 *
 * Derived from how many people are actually resolved rather than from a setting
 * a caller could forget to keep in sync, so the budget a step is judged against
 * always matches the work it really did. Thresholds follow the shape of the
 * scale ladder: nothing resolved is `abstract`, a handful is `settlement`, and
 * household detail is only paid for when household detail is being simulated.
 */
export function resolutionLevelFor(resolvedPersons: number): ResolutionLevel {
  if (resolvedPersons <= 0) return "abstract";
  if (resolvedPersons <= 32) return "settlement";
  if (resolvedPersons <= 256) return "street";
  return "household";
}

/** True when `level` is at least as detailed as `minimum`. */
export function isAtLeast(level: ResolutionLevel, minimum: ResolutionLevel): boolean {
  return RESOLUTION_ORDER[level] >= RESOLUTION_ORDER[minimum];
}
