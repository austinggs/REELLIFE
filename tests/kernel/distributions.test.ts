import { describe, expect, it } from "vitest";
import { Prng } from "../../src/engine/rng/prng.ts";
import {
  bernoulli,
  binomial,
  clamp,
  exponential,
  logNormal,
  normal,
  pickOne,
  poisson,
  rollPercent,
  shuffle,
  uniform,
  uniformInt,
  weightedPick,
} from "../../src/engine/rng/distributions.ts";

const source = (path: string) => Prng.fromPath("master-seed-0001", path);

describe("probability distributions (System 03)", () => {
  it("keeps bernoulli probabilities at the extremes exact", () => {
    const stream = source("bernoulli");
    for (let index = 0; index < 100; index += 1) {
      expect(bernoulli(stream, 0)).toBe(false);
      expect(bernoulli(stream, 1)).toBe(true);
    }
  });

  it("centres normal samples near the requested mean", () => {
    const stream = source("normal");
    let total = 0;
    const samples = 20_000;
    for (let index = 0; index < samples; index += 1) total += normal(stream, 50, 5);
    expect(total / samples).toBeGreaterThan(49);
    expect(total / samples).toBeLessThan(51);
  });

  it("keeps log-normal and poisson samples valid", () => {
    const stream = source("tails");
    for (let index = 0; index < 2_000; index += 1) {
      expect(logNormal(stream, 0, 0.5)).toBeGreaterThan(0);
      expect(poisson(stream, 3)).toBeGreaterThanOrEqual(0);
      expect(poisson(stream, 500)).toBeGreaterThanOrEqual(0);
    }
  });

  it("bounds binomial counts by the trial count", () => {
    const stream = source("binomial");
    for (let index = 0; index < 2_000; index += 1) {
      const value = binomial(stream, 200, 0.2);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(200);
    }
  });

  it("validates inputs instead of coercing them", () => {
    const stream = source("validation");
    expect(() => uniform(stream, 5, 1)).toThrow(/max/);
    expect(() => normal(stream, 0, -1)).toThrow(/non-negative/);
    expect(() => exponential(stream, 0)).toThrow(/positive/);
    expect(() => poisson(stream, -1)).toThrow(/non-negative/);
    expect(() => binomial(stream, -1, 0.5)).toThrow(/non-negative integer/);
  });

  it("produces uniform reals inside the requested interval", () => {
    const stream = source("uniform");
    for (let index = 0; index < 1_000; index += 1) {
      const value = uniform(stream, -5, 5);
      expect(value).toBeGreaterThanOrEqual(-5);
      expect(value).toBeLessThan(5);
    }
  });

  it("returns integer percentages in [0, 99]", () => {
    const stream = source("percent");
    for (let index = 0; index < 1_000; index += 1) {
      const value = rollPercent(stream);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(99);
    }
  });

  it("shuffles deterministically without losing items", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    expect(shuffle(source("shuffle"), items)).toEqual(shuffle(source("shuffle"), items));
    expect([...shuffle(source("shuffle"), items)].sort()).toEqual([...items].sort());
  });

  it("clamps values and handles degenerate picks", () => {
    const stream = source("pick");
    expect(clamp(5, 1, 3)).toBe(3);
    expect(clamp(-5, 1, 3)).toBe(1);
    expect(pickOne(stream, [])).toBeNull();
    expect(pickOne(stream, ["only"])).toBe("only");
    expect(uniformInt(stream, 4, 4)).toBe(4);
  });

  it("never invents an outcome from an all-zero weight set", () => {
    const stream = source("weights");
    expect(weightedPick(stream, [{ id: "a", weight: 0 }])).toBeNull();
    expect(weightedPick(stream, [{ id: "a", weight: 0 }, { id: "b", weight: 5 }])).toBe("b");
  });
});
