/**
 * ReelLife money primitive (System 25, architectural law 12).
 *
 * Money is always a currency plus an integer number of minor units. Authoritative
 * balances never rely on floating-point arithmetic. Every authoritative monetary
 * change must be traceable to a ledger entry and a cause.
 */

import type { Branded } from "./ids.ts";

/** Currency identifier, e.g. the provisional "ACR" content definition. */
export type CurrencyId = Branded<string, "currency">;

export const MAX_SAFE_MINOR_UNITS = Number.MAX_SAFE_INTEGER;

export interface Money {
  readonly currency: CurrencyId;
  readonly minorUnits: number;
}

export interface CurrencyDefinition {
  readonly id: CurrencyId;
  readonly code: string;
  readonly name: string;
  readonly symbol: string;
  readonly minorUnitsPerMajor: number;
  readonly decimalPlaces: number;
  /** Provisional flag: true when the value is a placeholder pending canon decisions. */
  readonly provisional?: boolean;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function currencyId(code: string): CurrencyId {
  return code as CurrencyId;
}

export function money(currency: CurrencyId, minorUnits: number): Money {
  if (!Number.isInteger(minorUnits)) {
    throw new MoneyError(`Money must be integer minor units, received ${String(minorUnits)}`);
  }
  if (!Number.isSafeInteger(minorUnits)) {
    throw new MoneyError(`Money exceeds safe integer range: ${String(minorUnits)}`);
  }
  return { currency, minorUnits };
}

export function zeroMoney(currency: CurrencyId): Money {
  return money(currency, 0);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

function guard(value: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Money arithmetic overflowed the safe integer range: ${String(value)}`);
  }
  return value;
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.currency, guard(a.minorUnits + b.minorUnits));
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.currency, guard(a.minorUnits - b.minorUnits));
}

export function negateMoney(a: Money): Money {
  return money(a.currency, guard(-a.minorUnits));
}

export function absMoney(a: Money): Money {
  return money(a.currency, Math.abs(a.minorUnits));
}

/** Multiplies by a scalar using deterministic half-away-from-zero rounding. */
export function scaleMoney(a: Money, factor: number): Money {
  if (!Number.isFinite(factor)) throw new MoneyError(`Cannot scale money by ${String(factor)}`);
  const raw = a.minorUnits * factor;
  const rounded = raw >= 0 ? Math.floor(raw + 0.5) : Math.ceil(raw - 0.5);
  return money(a.currency, guard(rounded));
}

/** Applies a rate expressed in basis points (1 bp = 0.01%). Used for interest/fees. */
export function applyBasisPoints(a: Money, basisPoints: number): Money {
  if (!Number.isInteger(basisPoints)) {
    throw new MoneyError(`Basis points must be an integer, received ${String(basisPoints)}`);
  }
  const raw = (a.minorUnits * basisPoints) / 10_000;
  const rounded = raw >= 0 ? Math.floor(raw + 0.5) : Math.ceil(raw - 0.5);
  return money(a.currency, guard(rounded));
}

export function sumMoney(currency: CurrencyId, items: readonly Money[]): Money {
  let total = 0;
  for (const item of items) {
    if (item.currency !== currency) {
      throw new MoneyError(`Currency mismatch while summing: ${item.currency} vs ${currency}`);
    }
    total = guard(total + item.minorUnits);
  }
  return money(currency, total);
}

export function compareMoney(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.minorUnits === b.minorUnits ? 0 : a.minorUnits < b.minorUnits ? -1 : 1;
}

export function isZeroMoney(a: Money): boolean {
  return a.minorUnits === 0;
}

export function isNegativeMoney(a: Money): boolean {
  return a.minorUnits < 0;
}

export function isPositiveMoney(a: Money): boolean {
  return a.minorUnits > 0;
}

export function equalsMoney(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.minorUnits === b.minorUnits;
}

/**
 * Formats money for presentation. Rounding here is presentation-only; the
 * authoritative value stays exact and accessible (UI/UX 11 section 2).
 */
export function formatMoney(value: Money, definition: CurrencyDefinition): string {
  const negative = value.minorUnits < 0;
  const absolute = Math.abs(value.minorUnits);
  const major = Math.floor(absolute / definition.minorUnitsPerMajor);
  const minor = absolute % definition.minorUnitsPerMajor;
  const majorText = major.toLocaleString("en-US");
  const minorText =
    definition.decimalPlaces > 0 ? `.${String(minor).padStart(definition.decimalPlaces, "0")}` : "";
  return `${negative ? "-" : ""}${definition.symbol}${majorText}${minorText}`;
}
