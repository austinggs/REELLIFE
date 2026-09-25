/**
 * ReelLife named RNG streams (System 03).
 *
 * Authoritative randomness is organised into independent named streams so that
 * one system's consumption pattern cannot shift another system's outcomes.
 * Stream seeds are derived from the master seed plus the stream path, which
 * means stream creation order does not matter; only the number of draws taken
 * from each stream matters, and that is what save/load preserves.
 *
 * Serialization note: only streams that have actually been used are persisted.
 * An unused stream is re-derivable from the master seed, so persisting it would
 * add noise without adding continuity.
 */

import { Prng, seedStateFromPath, type Xoshiro128StarStarState } from "./prng.ts";

/** Version of the RNG algorithm/serialization contract (System 06). */
export const RNG_VERSION = 1;

export const RNG_STREAM_ROOTS = {
  world: "world",
  population: "population",
  events: "events",
  markets: "markets",
  scenario: "scenario",
  decisions: "decisions",
  health: "health",
  social: "social",
  debug: "debug",
} as const;

export type RngStreamRoot = (typeof RNG_STREAM_ROOTS)[keyof typeof RNG_STREAM_ROOTS];

export function streamPath(...segments: string[]): string {
  return segments.join(":");
}

export interface RngStreamSnapshot {
  readonly path: string;
  readonly state: Xoshiro128StarStarState;
}

export class RngStream {
  readonly path: string;
  private readonly prng: Prng;

  constructor(path: string, state: Xoshiro128StarStarState) {
    this.path = path;
    this.prng = new Prng(state);
  }

  nextUint32(): number {
    return this.prng.nextUint32();
  }

  nextFloat(): number {
    return this.prng.nextFloat();
  }

  nextInt(minInclusive: number, maxInclusive: number): number {
    return this.prng.nextInt(minInclusive, maxInclusive);
  }

  serialize(): RngStreamSnapshot {
    return { path: this.path, state: this.prng.serialize() };
  }
}

export class RngRegistry {
  private readonly masterSeed: string;
  private readonly streams = new Map<string, RngStream>();

  constructor(masterSeed: string, restore?: readonly RngStreamSnapshot[]) {
    if (masterSeed.length < 8) {
      throw new Error("Master seed must be at least 8 characters so streams are not degenerate");
    }
    this.masterSeed = masterSeed;
    for (const snapshot of restore ?? []) {
      if (this.streams.has(snapshot.path)) {
        throw new Error(`Duplicate RNG stream in save data: ${snapshot.path}`);
      }
      this.streams.set(snapshot.path, new RngStream(snapshot.path, snapshot.state));
    }
  }

  get seed(): string {
    return this.masterSeed;
  }

  /** Returns the named stream, deriving its initial state on first use. */
  stream(path: string): RngStream {
    const existing = this.streams.get(path);
    if (existing) return existing;
    const created = new RngStream(path, seedStateFromPath(this.masterSeed, path));
    this.streams.set(path, created);
    return created;
  }

  /** Convenience: registry.stream(streamPath("person", id)). */
  forEntity(root: string, entityId: string): RngStream {
    return this.stream(streamPath(root, entityId));
  }

  paths(): string[] {
    return [...this.streams.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  has(path: string): boolean {
    return this.streams.has(path);
  }

  serialize(): RngStreamSnapshot[] {
    const snapshots: RngStreamSnapshot[] = [];
    for (const path of this.paths()) {
      const stream = this.streams.get(path);
      if (stream) snapshots.push(stream.serialize());
    }
    return snapshots;
  }

  static deserialize(masterSeed: string, snapshots: readonly RngStreamSnapshot[]): RngRegistry {
    return new RngRegistry(masterSeed, snapshots);
  }
}
