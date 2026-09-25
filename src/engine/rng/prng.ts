/**
 * ReelLife pseudo-random number generator (System 03).
 *
 * Algorithm: xoshiro128** with a SplitMix64 seeding step.
 *
 * Why this choice:
 *  - all state is 4 x uint32, so it serializes losslessly as plain JSON numbers,
 *  - it is fast, small and has no hidden state or platform dependence,
 *  - seeding from SplitMix64 avoids the poor low-bit behaviour of weak seeds,
 *  - the algorithm is well specified, so replay across sessions is exact.
 *
 * This is the ONLY source of randomness in authoritative simulation logic.
 * Uncontrolled Math.random() is banned by lint (see eslint.config.js) because it
 * would silently break save/load continuity and deterministic replay.
 */

import { fnv1a64 } from "./hash.ts";

export interface Xoshiro128StarStarState {
  readonly s0: number;
  readonly s1: number;
  readonly s2: number;
  readonly s3: number;
}

const MASK64 = 0xffffffffffffffffn;
const SPLITMIX_GOLDEN = 0x9e3779b97f4a7c15n;

/** SplitMix64; yields successive 32-bit words from a 64-bit seed. */
export function splitmix64Words(seed: bigint): { next(): number; nextState(): bigint } {
  let state = seed & MASK64;
  return {
    next(): number {
      state = (state + SPLITMIX_GOLDEN) & MASK64;
      let z = state;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
      z = z ^ (z >> 31n);
      return Number(z & 0xffffffffn) >>> 0;
    },
    nextState(): bigint {
      return state;
    },
  };
}

export function seedStateFromBigInt(seed: bigint): Xoshiro128StarStarState {
  const words = splitmix64Words(seed);
  return { s0: words.next(), s1: words.next(), s2: words.next(), s3: words.next() };
}

/** Derives a stream seed from a master seed and a stream path. */
export function deriveStreamSeed(masterSeed: string, path: string): bigint {
  return fnv1a64(`${masterSeed}::${path}`);
}

export function seedStateFromPath(masterSeed: string, path: string): Xoshiro128StarStarState {
  return seedStateFromBigInt(deriveStreamSeed(masterSeed, path));
}

function rotateLeft32(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

/**
 * xoshiro128** generator. State advances in place; `serialize()` captures the
 * exact continuation point so save/load cannot silently change future outcomes.
 */
export class Prng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(state: Xoshiro128StarStarState) {
    const normalised = normaliseState(state);
    this.s0 = normalised.s0;
    this.s1 = normalised.s1;
    this.s2 = normalised.s2;
    this.s3 = normalised.s3;
  }

  static fromSeed(seed: bigint): Prng {
    return new Prng(seedStateFromBigInt(seed));
  }

  static fromPath(masterSeed: string, path: string): Prng {
    return new Prng(seedStateFromPath(masterSeed, path));
  }

  nextUint32(): number {
    const result = Math.imul(rotateLeft32(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;

    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotateLeft32(this.s3, 11);

    return result;
  }

  /** Uniform float in [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform integer in [minInclusive, maxInclusive]. */
  nextInt(minInclusive: number, maxInclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive)) {
      throw new RangeError("Prng.nextInt requires integer bounds");
    }
    if (maxInclusive < minInclusive) {
      throw new RangeError(`Prng.nextInt invalid range: ${minInclusive}..${maxInclusive}`);
    }
    const span = maxInclusive - minInclusive + 1;
    if (span <= 0) throw new RangeError("Prng.nextInt range overflows");
    // Rejection sampling keeps the distribution exactly uniform.
    const limit = Math.floor(4294967296 / span) * span;
    let value = this.nextUint32();
    while (value >= limit) value = this.nextUint32();
    return minInclusive + (value % span);
  }

  serialize(): Xoshiro128StarStarState {
    return { s0: this.s0, s1: this.s1, s2: this.s2, s3: this.s3 };
  }
}

function normaliseState(state: Xoshiro128StarStarState): Xoshiro128StarStarState {
  const parts = [state.s0, state.s1, state.s2, state.s3];
  for (const part of parts) {
    if (!Number.isInteger(part) || part < 0 || part > 0xffffffff) {
      throw new RangeError(`Invalid xoshiro128** state word: ${String(part)}`);
    }
  }
  if (parts.every((part) => part === 0)) {
    throw new RangeError("Invalid xoshiro128** state: all words are zero");
  }
  return { s0: state.s0, s1: state.s1, s2: state.s2, s3: state.s3 };
}

export function isZeroState(state: Xoshiro128StarStarState): boolean {
  return state.s0 === 0 && state.s1 === 0 && state.s2 === 0 && state.s3 === 0;
}
