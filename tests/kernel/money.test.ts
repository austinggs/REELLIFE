import { describe, expect, it } from "vitest";
import {
  MoneyError,
  addMoney,
  applyBasisPoints,
  compareMoney,
  currencyId,
  equalsMoney,
  formatMoney,
  isNegativeMoney,
  isPositiveMoney,
  isZeroMoney,
  money,
  negateMoney,
  scaleMoney,
  subtractMoney,
  sumMoney,
  zeroMoney,
  type CurrencyDefinition,
} from "../../src/engine/primitives/money.ts";

const ACR = currencyId("ACR");
const OTHER = currencyId("OTH");

const definition: CurrencyDefinition = {
  id: ACR,
  code: "ACR",
  name: "Aurelian Credit",
  symbol: "₳",
  minorUnitsPerMajor: 100,
  decimalPlaces: 2,
};

describe("money primitive (System 25, law 12)", () => {
  it("stores integer minor units only", () => {
    expect(money(ACR, 1_250).minorUnits).toBe(1_250);
    expect(() => money(ACR, 12.5)).toThrow(MoneyError);
    expect(() => money(ACR, Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });

  it("refuses amounts beyond the safe integer range", () => {
    expect(() => money(ACR, Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe integer/);
    expect(() => addMoney(money(ACR, Number.MAX_SAFE_INTEGER), money(ACR, 1))).toThrow(/overflow/);
  });

  it("never mixes currencies silently", () => {
    expect(() => addMoney(money(ACR, 100), money(OTHER, 100))).toThrow(/Currency mismatch/);
    expect(() => subtractMoney(money(ACR, 100), money(OTHER, 5))).toThrow(/Currency mismatch/);
    expect(() => compareMoney(money(ACR, 100), money(OTHER, 100))).toThrow(/Currency mismatch/);
    expect(() => sumMoney(ACR, [money(OTHER, 10)])).toThrow(/Currency mismatch/);
  });

  it("adds, subtracts and negates exactly", () => {
    expect(addMoney(money(ACR, 1_999), money(ACR, 1)).minorUnits).toBe(2_000);
    expect(subtractMoney(money(ACR, 1), money(ACR, 1_999)).minorUnits).toBe(-1_998);
    expect(negateMoney(money(ACR, 250)).minorUnits).toBe(-250);
    expect(sumMoney(ACR, [money(ACR, 5), money(ACR, 10), money(ACR, 15)]).minorUnits).toBe(30);
    expect(zeroMoney(ACR).minorUnits).toBe(0);
  });

  it("rounds scaled amounts half away from zero, deterministically", () => {
    expect(scaleMoney(money(ACR, 101), 0.5).minorUnits).toBe(51);
    expect(scaleMoney(money(ACR, 100), 0.5).minorUnits).toBe(50);
    expect(scaleMoney(money(ACR, -101), 0.5).minorUnits).toBe(-51);
    expect(() => scaleMoney(money(ACR, 100), Number.NaN)).toThrow(MoneyError);
  });

  it("applies interest and fees from integer basis points", () => {
    // 5% of 10 000 minor units is 500.
    expect(applyBasisPoints(money(ACR, 10_000), 500).minorUnits).toBe(500);
    expect(applyBasisPoints(money(ACR, 33), 1_000).minorUnits).toBe(3);
    expect(() => applyBasisPoints(money(ACR, 100), 1.5)).toThrow(/integer/);
  });

  it("compares and classifies amounts", () => {
    expect(compareMoney(money(ACR, 100), money(ACR, 100))).toBe(0);
    expect(compareMoney(money(ACR, 99), money(ACR, 100))).toBe(-1);
    expect(compareMoney(money(ACR, 101), money(ACR, 100))).toBe(1);
    expect(isZeroMoney(money(ACR, 0))).toBe(true);
    expect(isNegativeMoney(money(ACR, -1))).toBe(true);
    expect(isPositiveMoney(money(ACR, 1))).toBe(true);
    expect(equalsMoney(money(ACR, 7), money(ACR, 7))).toBe(true);
    expect(equalsMoney(money(ACR, 7), money(ACR, 8))).toBe(false);
  });

  it("formats for presentation without changing the stored value", () => {
    const amount = money(ACR, 123_456);
    expect(formatMoney(amount, definition)).toBe("₳1,234.56");
    expect(formatMoney(money(ACR, -50), definition)).toBe("-₳0.50");
    expect(amount.minorUnits).toBe(123_456);
  });

  it("formats a zero-decimal currency without a decimal point", () => {
    const whole: CurrencyDefinition = { ...definition, decimalPlaces: 0, minorUnitsPerMajor: 1 };
    expect(formatMoney(money(ACR, 42), whole)).toBe("₳42");
  });
});
