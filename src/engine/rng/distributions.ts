/**
 * Deterministic probability distributions (System 03).
 *
 * Every function takes an explicit RandomSource (a named seeded stream) and is
 * otherwise pure. Nothing here reads ambient state, which is what makes
 * distributions testable and replayable.
 *
 * Guidance from the specification: randomness models uncertainty around rules;
 * it never replaces the rules. Callers decide eligibility first.
 */

import { selectByWeight, type ResolutionCandidate } from "../primitives/resolution.ts";

/** Structural interface satisfied by Prng and RngStream. */
export interface RandomSource {
  nextUint32(): number;
  nextFloat(): number;
  nextInt(minInclusive: number, maxInclusive: number): number;
}

export interface WeightedEntry {
  readonly id: string;
  readonly weight: number;
}

/** Uniform real in [min, max). */
export function uniform(source: RandomSource, min: number, max: number): number {
  if (max < min) throw new RangeError(`uniform: max (${max}) below min (${min})`);
  return min + source.nextFloat() * (max - min);
}

/** Uniform integer in [min, max] inclusive. */
export function uniformInt(source: RandomSource, min: number, max: number): number {
  return source.nextInt(min, max);
}

/** True with probability `p`. */
export function bernoulli(source: RandomSource, p: number): boolean {
  if (p <= 0) return false;
  if (p >= 1) return true;
  return source.nextFloat() < p;
}

/**
 * Standard normal deviate via Box-Muller. The second variate is discarded so
 * that exactly one draw produces exactly one outcome, keeping the draw count
 * predictable for replay.
 */
export function standardNormal(source: RandomSource): number {
  let u = source.nextFloat();
  if (u < Number.EPSILON) u = Number.EPSILON;
  const v = source.nextFloat();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function normal(source: RandomSource, mean: number, standardDeviation: number): number {
  if (standardDeviation < 0) {
    throw new RangeError("normal: standard deviation must be non-negative");
  }
  return mean + standardNormal(source) * standardDeviation;
}

/**
 * Log-normal deviate. Used for quantities with a natural floor and a long upper
 * tail (income, waiting times, city sizes).
 */
export function logNormal(source: RandomSource, mu: number, sigma: number): number {
  return Math.exp(normal(source, mu, sigma));
}

export function exponential(source: RandomSource, rate: number): number {
  if (rate <= 0) throw new RangeError("exponential: rate must be positive");
  let u = source.nextFloat();
  if (u < Number.EPSILON) u = Number.EPSILON;
  return -Math.log(u) / rate;
}

/**
 * Poisson count. Knuth's product method for small means; a normal
 * approximation for large means, which keeps the cost bounded for aggregate
 * population simulation where lambda can be in the thousands.
 */
export function poisson(source: RandomSource, lambda: number): number {
  if (lambda < 0) throw new RangeError("poisson: lambda must be non-negative");
  if (lambda === 0) return 0;

  if (lambda < 30) {
    const limit = Math.exp(-lambda);
    let product = source.nextFloat();
    let count = 0;
    while (product >= limit) {
      count += 1;
      product *= source.nextFloat();
    }
    return count;
  }

  const approximate = Math.round(normal(source, lambda, Math.sqrt(lambda)));
  return approximate < 0 ? 0 : approximate;
}

/** Binomial count of successes in `trials` independent attempts. */
export function binomial(source: RandomSource, trials: number, p: number): number {
  if (trials < 0 || !Number.isInteger(trials)) {
    throw new RangeError("binomial: trials must be a non-negative integer");
  }
  if (p <= 0) return 0;
  if (p >= 1) return trials;
  if (trials === 0) return 0;

  // For small trial counts, direct sampling is exact and cheap.
  if (trials <= 64) {
    let successes = 0;
    for (let index = 0; index < trials; index += 1) {
      if (source.nextFloat() < p) successes += 1;
    }
    return successes;
  }

  const approximate = Math.round(normal(source, trials * p, Math.sqrt(trials * p * (1 - p))));
  return Math.max(0, Math.min(trials, approximate));
}

/** Weighted pick over plain entries; returns null when nothing is pickable. */
export function weightedPick(source: RandomSource, entries: readonly WeightedEntry[]): string | null {
  const candidates: ResolutionCandidate[] = entries.map((entry) => ({
    id: entry.id,
    weight: entry.weight,
    eligible: entry.weight > 0,
  }));
  const chosen = selectByWeight(candidates, source.nextFloat());
  return chosen?.id ?? null;
}

/** One element, or null for an empty list. Never throws on empty input. */
export function pickOne<T>(source: RandomSource, items: readonly T[]): T | null {
  if (items.length === 0) return null;
  return items[source.nextInt(0, items.length - 1)] ?? null;
}

/** Fisher-Yates shuffle on a copy; deterministic for a given stream. */
export function shuffle<T>(source: RandomSource, items: readonly T[]): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = source.nextInt(0, index);
    const a = out[index] as T;
    const b = out[swap] as T;
    out[index] = b;
    out[swap] = a;
  }
  return out;
}

/** Integer percentage roll in [0, 99]. */
export function rollPercent(source: RandomSource): number {
  return source.nextInt(0, 99);
}

/** Clamps a value into [min, max]; helper for derived aggregates. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
