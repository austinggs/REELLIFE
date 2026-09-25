import { describe, expect, it } from "vitest";
import { Prng, seedStateFromPath, splitmix64Words } from "../../src/engine/rng/prng.ts";
import { RNG_VERSION, RngRegistry } from "../../src/engine/rng/streams.ts";
import { canonicalJson, checksum32Hex, fnv1a64, toHex64 } from "../../src/engine/rng/hash.ts";

describe("deterministic PRNG (System 03)", () => {
  it("reproduces the same sequence from the same seed", () => {
    const a = Prng.fromPath("master-seed-0001", "events");
    const b = Prng.fromPath("master-seed-0001", "events");
    expect(Array.from({ length: 32 }, () => a.nextUint32())).toEqual(
      Array.from({ length: 32 }, () => b.nextUint32()),
    );
  });

  it("gives independent sequences to different stream paths", () => {
    const a = Prng.fromPath("master-seed-0001", "events");
    const b = Prng.fromPath("master-seed-0001", "markets");
    expect(a.nextUint32()).not.toBe(b.nextUint32());
  });

  it("resumes exactly from serialized state (save/load continuity)", () => {
    const stream = Prng.fromPath("master-seed-0001", "world");
    for (let index = 0; index < 10; index += 1) stream.nextUint32();

    const restored = new Prng(stream.serialize());
    expect(Array.from({ length: 8 }, () => stream.nextUint32())).toEqual(
      Array.from({ length: 8 }, () => restored.nextUint32()),
    );
  });

  it("derives stream seeds from master seed and path, not from call order", () => {
    const first = new RngRegistry("master-seed-0001");
    first.stream("events").nextUint32();
    const marketsA = first.stream("markets").nextUint32();

    const second = new RngRegistry("master-seed-0001");
    const marketsB = second.stream("markets").nextUint32();
    second.stream("events").nextUint32();

    expect(marketsA).toBe(marketsB);
  });

  it("produces uniform integers inside the requested range", () => {
    const source = Prng.fromPath("master-seed-0001", "range");
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < 5_000; index += 1) {
      const value = source.nextInt(3, 7);
      min = Math.min(min, value);
      max = Math.max(max, value);
      expect(Number.isInteger(value)).toBe(true);
    }
    expect(min).toBe(3);
    expect(max).toBe(7);
  });

  it("keeps floats in [0, 1)", () => {
    const source = Prng.fromPath("master-seed-0001", "floats");
    for (let index = 0; index < 1_000; index += 1) {
      const value = source.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("serializes registry state for every used stream in stable order", () => {
    const registry = new RngRegistry("master-seed-0001");
    registry.stream("markets").nextUint32();
    registry.stream("events").nextUint32();
    const paths = registry.serialize().map((snapshot) => snapshot.path);
    expect(paths).toEqual([...paths].sort());
    expect(RNG_VERSION).toBe(1);

    const restored = RngRegistry.deserialize("master-seed-0001", registry.serialize());
    expect(restored.stream("events").nextUint32()).toBe(registry.stream("events").nextUint32());
  });

  it("rejects degenerate RNG state instead of silently continuing", () => {
    expect(() => new Prng({ s0: 0, s1: 0, s2: 0, s3: 0 })).toThrow(/all words are zero/);
    expect(() => new Prng({ s0: 1.5, s1: 1, s2: 1, s3: 1 })).toThrow(/Invalid xoshiro/);
  });

  it("seeds from SplitMix64 with non-repeating words", () => {
    const words = splitmix64Words(12345n);
    expect(new Set([words.next(), words.next(), words.next(), words.next(), words.next()]).size).toBe(5);
  });

  it("requires a master seed long enough to avoid degenerate derivation", () => {
    expect(() => new RngRegistry("short")).toThrow(/at least 8 characters/);
  });
});

describe("canonical serialization and checksums (System 06/59)", () => {
  it("sorts object keys so structurally equal values hash identically", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(checksum32Hex(canonicalJson({ b: 1, a: 2 }))).toBe(
      checksum32Hex(canonicalJson({ a: 2, b: 1 })),
    );
  });

  it("rejects values that cannot belong to authoritative state", () => {
    expect(() => canonicalJson({ fn: () => 1 })).toThrow(/cannot serialize function/);
    expect(() => canonicalJson({ x: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson([undefined])).toThrow(/undefined/);
    // Object properties that are undefined follow JSON semantics and are omitted,
    // which is what the `...(x === undefined ? {} : { x })` pattern relies on.
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it("rejects cyclic structures rather than recursing forever", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(/cyclic/);
  });

  it("hashes 64-bit values into a stable hex form", () => {
    expect(toHex64(fnv1a64("aurelia"))).toHaveLength(16);
    expect(seedStateFromPath("master-seed-0001", "world")).toEqual(
      seedStateFromPath("master-seed-0001", "world"),
    );
  });
});
