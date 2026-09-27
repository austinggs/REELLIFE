/**
 * Macroeconomic layer engine (System 36).
 *
 * Owns `systems.macro`: the observation samples (price index, labour,
 * output, aggregates), the credit environment and its history, and the
 * explicitly-raised macro shocks. Every write asserts ownership on that
 * slot; reads are scope-free.
 *
 * The engine never invents an aggregate. Callers (scenario wiring, other
 * systems' projections, tests) feed observations derived from lower-level
 * truth, and the indicator reads answer from those samples with a stated
 * window — `undefined` when the samples do not span it. Shocks are raised
 * and lifted as explicit conditions; they never edit an observation.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import { days, type Duration } from "../primitives/time.ts";
import {
  MACRO_WINDOWS,
  type AggregateSample,
  type CreditEnvironment,
  type DownturnSignal,
  type LaborSample,
  type MacroShock,
  type MacroSystemState,
  type OutputSample,
  type PriceIndexSample,
} from "./types.ts";

export interface ObserveLaborMarketRequest {
  readonly laborForce: number;
  readonly employed: number;
}

export interface ObserveOutputRequest {
  readonly outputIndex: number;
  readonly hoursWorked?: number;
}

export interface ObserveAggregatesRequest {
  readonly demandIndex: number;
  readonly supplyIndex: number;
}

export interface SetCreditEnvironmentRequest {
  readonly policyRateBasisPoints: number;
  readonly lendingSpreadBasisPoints: number;
  readonly creditAvailability: number;
  readonly note?: string;
}

export interface RaiseShockRequest {
  readonly kind: string;
  readonly severity: number;
  readonly note?: string;
}

export class MacroEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.macro) {
      this.scope.assertOwner("macro");
      this.world.systems.macro = {
        priceIndex: [],
        labor: [],
        output: [],
        aggregates: [],
        creditHistory: [],
        shocks: [],
      } satisfies MacroSystemState;
    }
  }

  private get state(): MacroSystemState {
    return this.world.systems.macro as MacroSystemState;
  }

  private set state(value: MacroSystemState) {
    this.world.systems.macro = value;
  }

  // --------------------------------------------------------------- writes ---

  /**
   * Records a price-index level. Re-observing at the same timestamp replaces
   * the sample, so re-seeding is a no-op instead of a duplicate.
   */
  observePriceIndex(index: number, at: WorldTime): PriceIndexSample {
    this.scope.assertOwner("macro");
    requirePositiveFinite(index, "index", "observePriceIndex");
    const sample: PriceIndexSample = { at, index };
    this.state = {
      ...this.state,
      priceIndex: upsertSorted(this.state.priceIndex, sample),
    };
    return sample;
  }

  /** Who is in the labour force and how many of them are working. */
  observeLaborMarket(request: ObserveLaborMarketRequest, at: WorldTime): LaborSample {
    this.scope.assertOwner("macro");
    requireNonNegativeInteger(request.laborForce, "laborForce", "observeLaborMarket");
    requireNonNegativeInteger(request.employed, "employed", "observeLaborMarket");
    if (request.employed > request.laborForce) {
      throw new Error(
        `MacroEngine.observeLaborMarket: employed (${request.employed}) exceeds the labour force (${request.laborForce})`,
      );
    }
    const sample: LaborSample = { at, laborForce: request.laborForce, employed: request.employed };
    this.state = { ...this.state, labor: upsertSorted(this.state.labor, sample) };
    return sample;
  }

  /** An output level, optionally with hours so productivity is measurable. */
  observeOutput(request: ObserveOutputRequest, at: WorldTime): OutputSample {
    this.scope.assertOwner("macro");
    requirePositiveFinite(request.outputIndex, "outputIndex", "observeOutput");
    if (request.hoursWorked !== undefined) {
      requirePositiveFinite(request.hoursWorked, "hoursWorked", "observeOutput");
    }
    const sample: OutputSample = {
      at,
      outputIndex: request.outputIndex,
      ...(request.hoursWorked === undefined ? {} : { hoursWorked: request.hoursWorked }),
    };
    this.state = { ...this.state, output: upsertSorted(this.state.output, sample) };
    return sample;
  }

  /** Aggregate demand against aggregate supply, as index levels. */
  observeAggregates(request: ObserveAggregatesRequest, at: WorldTime): AggregateSample {
    this.scope.assertOwner("macro");
    requirePositiveFinite(request.demandIndex, "demandIndex", "observeAggregates");
    requirePositiveFinite(request.supplyIndex, "supplyIndex", "observeAggregates");
    const sample: AggregateSample = {
      at,
      demandIndex: request.demandIndex,
      supplyIndex: request.supplyIndex,
    };
    this.state = { ...this.state, aggregates: upsertSorted(this.state.aggregates, sample) };
    return sample;
  }

  /**
   * Publishes the interest/credit environment. The *mechanics* of setting
   * policy belong to government (System 40); this records the context and
   * its history so a policy change is observable like any other event.
   */
  setCreditEnvironment(request: SetCreditEnvironmentRequest, at: WorldTime): CreditEnvironment {
    this.scope.assertOwner("macro");
    requireBasisPoints(request.policyRateBasisPoints, "policyRateBasisPoints");
    requireBasisPoints(request.lendingSpreadBasisPoints, "lendingSpreadBasisPoints");
    requireRatio(request.creditAvailability, "creditAvailability");
    const environment: CreditEnvironment = {
      at,
      policyRateBasisPoints: request.policyRateBasisPoints,
      lendingSpreadBasisPoints: request.lendingSpreadBasisPoints,
      creditAvailability: request.creditAvailability,
      ...(request.note === undefined ? {} : { note: request.note }),
    };
    this.state = {
      ...this.state,
      creditEnvironment: environment,
      // Upsert by instant: re-publishing the same moment updates it, so
      // re-seeding cannot grow the history.
      creditHistory: upsertSorted(this.state.creditHistory, environment),
    };
    return environment;
  }

  /**
   * Raises an explicit macro shock. Shocks are conditions other systems may
   * read; they never edit an observation (System 36 rules: they "influence
   * lower-level conditions but do not magically rewrite them").
   */
  raiseShock(ids: IdAllocator, request: RaiseShockRequest, at: WorldTime): MacroShock {
    this.scope.assertOwner("macro");
    if (request.kind.trim().length === 0) {
      throw new Error("MacroEngine.raiseShock: kind must not be empty");
    }
    requireRatio(request.severity, "severity");
    const shock: MacroShock = {
      id: `shock-${ids.next("activity")}`,
      kind: request.kind,
      severity: request.severity,
      raisedAt: at,
      ...(request.note === undefined ? {} : { note: request.note }),
    };
    this.state = { ...this.state, shocks: [...this.state.shocks, shock] };
    return shock;
  }

  /** Lifts a shock; the record stays with its window of effect visible. */
  liftShock(id: string, at: WorldTime): MacroShock {
    this.scope.assertOwner("macro");
    const shock = this.state.shocks.find((candidate) => candidate.id === id);
    if (shock === undefined) {
      throw new Error(`MacroEngine.liftShock: unknown shock ${id}`);
    }
    if (shock.liftedAt !== undefined) {
      throw new Error(`MacroEngine.liftShock: ${id} was already lifted`);
    }
    const lifted: MacroShock = { ...shock, liftedAt: at };
    this.state = {
      ...this.state,
      shocks: this.state.shocks.map((candidate) => (candidate.id === id ? lifted : candidate)),
    };
    return lifted;
  }

  // -------------------------------------------------------------- derived ---

  /**
   * Inflation over the window: the latest price index against the sample at
   * or before `window` ago. No reading exists when the window is not
   * spanned — an unobserved economy has no number, not a default one.
   */
  inflation(window: Duration = days(MACRO_WINDOWS.annualDays)): number | undefined {
    const samples = this.state.priceIndex;
    const latest = samples[samples.length - 1];
    if (latest === undefined) return undefined;
    const base = atOrBefore(samples, subtract(latest.at, window));
    if (base === undefined) return undefined;
    return latest.index / base.index - 1;
  }

  /** Unemployment rate from the latest labour sample (undefined if none). */
  unemployment(): number | undefined {
    const latest = this.state.labor[this.state.labor.length - 1];
    if (latest === undefined || latest.laborForce === 0) return undefined;
    return 1 - latest.employed / latest.laborForce;
  }

  /** Output growth over the window; negative means contraction. */
  outputGrowth(window: Duration = days(MACRO_WINDOWS.annualDays)): number | undefined {
    const samples = this.state.output;
    const latest = samples[samples.length - 1];
    if (latest === undefined) return undefined;
    const base = atOrBefore(samples, subtract(latest.at, window));
    if (base === undefined) return undefined;
    return latest.outputIndex / base.outputIndex - 1;
  }

  /**
   * Productivity of the latest sample that carries hours: output per hour
   * as an index. Hours are required — output alone cannot say anything
   * about productivity.
   */
  productivity(): number | undefined {
    const withHours = this.state.output.filter(
      (sample) => sample.hoursWorked !== undefined,
    );
    const latest = withHours[withHours.length - 1];
    if (latest === undefined) return undefined;
    return latest.outputIndex / (latest.hoursWorked as number);
  }

  /** Productivity growth over the window, from hours-bearing samples. */
  productivityGrowth(window: Duration = days(MACRO_WINDOWS.productivityDays)): number | undefined {
    const withHours = this.state.output.filter((sample) => sample.hoursWorked !== undefined);
    const latest = withHours[withHours.length - 1];
    if (latest === undefined) return undefined;
    const base = atOrBefore(withHours, subtract(latest.at, window));
    if (base === undefined) return undefined;
    const latestRatio = latest.outputIndex / (latest.hoursWorked as number);
    const baseRatio = base.outputIndex / (base.hoursWorked as number);
    return latestRatio / baseRatio - 1;
  }

  /** Demand minus supply from the latest aggregate sample. */
  aggregateGap(): number | undefined {
    const latest = this.state.aggregates[this.state.aggregates.length - 1];
    if (latest === undefined) return undefined;
    return latest.demandIndex - latest.supplyIndex;
  }

  /**
   * The currency's context: what a unit of purchasing power is worth now
   * against the window's start. Under inflation this is negative.
   */
  purchasingPowerChange(window: Duration = days(MACRO_WINDOWS.annualDays)): number | undefined {
    const inflation = this.inflation(window);
    if (inflation === undefined) return undefined;
    return 1 / (1 + inflation) - 1;
  }

  /** Shocks currently in force, in the order they were raised. */
  activeShocks(): readonly MacroShock[] {
    return this.state.shocks.filter((shock) => shock.liftedAt === undefined);
  }

  shocks(): readonly MacroShock[] {
    return this.state.shocks;
  }

  creditEnvironment(): CreditEnvironment | undefined {
    return this.state.creditEnvironment;
  }

  creditHistory(): readonly CreditEnvironment[] {
    return this.state.creditHistory;
  }

  /**
   * Named downturn *facts*, in a fixed order: active shocks first (they are
   * conditions someone raised), then contracting output, rising
   * unemployment, and weak aggregate demand. The list is deliberately not
   * collapsed into a "recession" verdict — that definition belongs to
   * content/law, not to arithmetic.
   */
  downturnSignals(): readonly DownturnSignal[] {
    const signals: DownturnSignal[] = [];
    for (const shock of this.activeShocks()) {
      signals.push({
        signal: `shock_active:${shock.kind}`,
        detail: `severity ${shock.severity} raised at ${String(shock.raisedAt)}`,
      });
    }
    const growth = this.outputGrowth();
    if (growth !== undefined && growth < 0) {
      signals.push({
        signal: "output_contracting",
        detail: `output growth ${growth.toFixed(4)} over the window`,
      });
    }
    const labor = this.state.labor;
    if (labor.length >= 2) {
      const latest = labor[labor.length - 1];
      const previous = labor[labor.length - 2];
      if (latest !== undefined && previous !== undefined) {
        const rateNow = latest.laborForce === 0 ? 0 : 1 - latest.employed / latest.laborForce;
        const rateBefore =
          previous.laborForce === 0 ? 0 : 1 - previous.employed / previous.laborForce;
        if (rateNow > rateBefore) {
          signals.push({
            signal: "unemployment_rising",
            detail: `${rateBefore.toFixed(4)} -> ${rateNow.toFixed(4)}`,
          });
        }
      }
    }
    const gap = this.aggregateGap();
    if (gap !== undefined && gap < 0) {
      signals.push({
        signal: "weak_aggregate_demand",
        detail: `demand minus supply ${gap.toFixed(4)}`,
      });
    }
    return signals;
  }
}

// --------------------------------------------------------------- helpers ---

/**
 * Inserts a sample in timestamp order, replacing any sample taken at the
 * same instant. Deterministic, and re-observing a value at a known time is
 * an update rather than a duplicate.
 */
function upsertSorted<T extends { readonly at: WorldTime }>(
  samples: readonly T[],
  sample: T,
): readonly T[] {
  const rest = samples.filter((existing) => (existing.at as number) !== (sample.at as number));
  return [...rest, sample].sort((a, b) => (a.at as number) - (b.at as number));
}

/** The newest sample at or before `at`, given the array is time-sorted. */
function atOrBefore<T extends { readonly at: WorldTime }>(
  samples: readonly T[],
  at: WorldTime,
): T | undefined {
  let found: T | undefined;
  for (const sample of samples) {
    if ((sample.at as number) > (at as number)) break;
    found = sample;
  }
  return found;
}

function subtract(at: WorldTime, window: Duration): WorldTime {
  return (at as number) - (window as number) as WorldTime;
}

// --------------------------------------------------------------- guards ---

function requirePositiveFinite(value: number, field: string, caller: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `MacroEngine.${caller}: ${field} must be a positive number, received ${String(value)}`,
    );
  }
}

function requireNonNegativeInteger(value: number, field: string, caller: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `MacroEngine.${caller}: ${field} must be a non-negative integer, received ${String(value)}`,
    );
  }
}

function requireRatio(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`MacroEngine: ${field} must be in [0, 1], received ${String(value)}`);
  }
}

function requireBasisPoints(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error(
      `MacroEngine.setCreditEnvironment: ${field} must be an integer in [0, 10000], received ${String(value)}`,
    );
  }
}

