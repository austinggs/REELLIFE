/**
 * Price formation (System 35).
 *
 * A price is not a number the market keeps in a drawer: it is formed from
 * inputs, and System 35 lists them — "supply, demand, inventory, cost,
 * competition, scarcity, expectations, transport, taxes, regulation, and market
 * structure". This module applies exactly those, in a fixed order, and returns
 * the *drivers* alongside the result so a price can be explained (System 59)
 * and tested input by input.
 *
 * Everything here is pure and deterministic: same inputs, same price, no RNG.
 * None of it decides what anyone buys — that is NPC Decision (System 17).
 */

import { money, type Money } from "../primitives/money.ts";
import {
  PRICE_FORMATION,
  STRUCTURE_PRICE_FACTOR,
  type MarketStructure,
  type PriceDriver,
  type PriceQuote,
} from "./types.ts";

export interface PriceFormationInputs {
  readonly goodId: string;
  /** Production cost of the good plus what it cost to get it here. */
  readonly landedCost: Money;
  readonly transportCostPerUnit: Money;
  readonly inventoryUnits: number;
  readonly supplyUnits: number;
  readonly demandUnits: number;
  readonly structure: MarketStructure;
  readonly taxBasisPoints: number;
  readonly expectedPrice?: Money;
  readonly priceCeiling?: Money;
}

/** Units actually available to buyers: on the shelf plus what can still arrive. */
export function availableUnits(inputs: {
  readonly inventoryUnits: number;
  readonly supplyUnits: number;
}): number {
  return Math.max(0, inputs.inventoryUnits) + Math.max(0, inputs.supplyUnits);
}

/**
 * Demand over availability, clamped. Above 1 means the market is short; below 1
 * means goods are sitting on the shelf.
 */
export function scarcityRatio(inputs: {
  readonly inventoryUnits: number;
  readonly supplyUnits: number;
  readonly demandUnits: number;
}): number {
  const available = Math.max(availableUnits(inputs), 1);
  const raw = Math.max(0, inputs.demandUnits) / available;
  return Math.min(Math.max(raw, PRICE_FORMATION.minScarcity), PRICE_FORMATION.maxScarcity);
}

function requireSameCurrency(values: readonly (Money | undefined)[], label: string): void {
  const first = values.find((value) => value !== undefined);
  if (first === undefined) return;
  for (const value of values) {
    if (value === undefined) continue;
    if (value.currency !== first.currency) {
      throw new Error(
        `formPrice: ${label} mixes currencies (${first.currency} vs ${value.currency})`,
      );
    }
  }
}

/**
 * Forms the price the market would quote, with the contribution of every input
 * recorded in minor units. Order: landed cost + transport (the floor) ->
 * scarcity -> structure -> tax -> expectation pull -> floor -> regulated
 * ceiling.
 */
export function formPrice(inputs: PriceFormationInputs): PriceQuote {
  requireSameCurrency(
    [inputs.landedCost, inputs.transportCostPerUnit, inputs.expectedPrice, inputs.priceCeiling],
    "inputs",
  );
  requireBasisPoints(inputs.taxBasisPoints);
  requireUnits(inputs.inventoryUnits, "inventoryUnits");
  requireUnits(inputs.supplyUnits, "supplyUnits");
  requireUnits(inputs.demandUnits, "demandUnits");

  const currency = inputs.landedCost.currency;
  const base = inputs.landedCost.minorUnits + inputs.transportCostPerUnit.minorUnits;
  const scarcity = scarcityRatio(inputs);
  const scarcityFactor = 1 + PRICE_FORMATION.scarcitySensitivity * (scarcity - 1);
  const structureFactor = STRUCTURE_PRICE_FACTOR[inputs.structure];

  const afterScarcity = Math.round(base * scarcityFactor);
  const afterStructure = Math.round(afterScarcity * structureFactor);
  const taxMinor = Math.round((afterStructure * inputs.taxBasisPoints) / 10_000);
  const afterTax = afterStructure + taxMinor;
  const expectationMinor =
    inputs.expectedPrice === undefined
      ? 0
      : Math.round((inputs.expectedPrice.minorUnits - afterTax) * PRICE_FORMATION.expectationWeight);
  const raw = afterTax + expectationMinor;

  // A market cannot price below what the good cost to get there; a regulated
  // ceiling, when one exists, wins over everything above it.
  const floored = raw < base ? base : raw;
  const ceilingApplied = inputs.priceCeiling !== undefined && floored > inputs.priceCeiling.minorUnits;
  const finalMinor = ceilingApplied ? (inputs.priceCeiling as Money).minorUnits : floored;

  const drivers: PriceDriver[] = [
    {
      driver: "landed_cost",
      detail: `${inputs.landedCost.minorUnits} minor units of production cost`,
      minorUnits: inputs.landedCost.minorUnits,
    },
    {
      driver: "transport",
      detail: `${inputs.transportCostPerUnit.minorUnits} minor units to bring it here`,
      minorUnits: inputs.transportCostPerUnit.minorUnits,
    },
    {
      driver: "scarcity",
      detail: `demand ${inputs.demandUnits} against availability ${availableUnits(inputs)} (ratio ${scarcity.toFixed(2)})`,
      minorUnits: afterScarcity - base,
    },
    {
      driver: "structure",
      detail: `${inputs.structure} market factor ${structureFactor.toFixed(2)}`,
      minorUnits: afterStructure - afterScarcity,
    },
    {
      driver: "tax",
      detail: `${inputs.taxBasisPoints} basis points`,
      minorUnits: taxMinor,
    },
  ];
  if (expectationMinor !== 0) {
    drivers.push({
      driver: "expectation",
      detail: `traders expected ${inputs.expectedPrice?.minorUnits ?? 0}`,
      minorUnits: expectationMinor,
    });
  }
  if (floored === base && raw < base) {
    drivers.push({
      driver: "landed_cost",
      detail: "price held at cost: nothing sells below what the good cost to get here",
      minorUnits: base - raw,
    });
  }
  if (ceilingApplied) {
    drivers.push({
      driver: "ceiling",
      detail: `regulated ceiling ${(inputs.priceCeiling as Money).minorUnits}`,
      minorUnits: finalMinor - floored,
    });
  }

  const held = ceilingApplied
    ? ", held at the regulated ceiling"
    : raw < base
      ? ", held at the cost floor"
      : "";
  return {
    goodId: inputs.goodId,
    price: money(currency, finalMinor),
    basePrice: money(currency, base),
    scarcity,
    reason: `Price formed from cost, scarcity (${scarcity.toFixed(2)}), ${inputs.structure} structure and ${inputs.taxBasisPoints} bp tax${held}`,
    drivers,
  };
}

// --------------------------------------------------------------- guards ---

function requireBasisPoints(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 10_000) {
    throw new Error(`formPrice: taxBasisPoints must be in [0, 10000], received ${String(value)}`);
  }
}

function requireUnits(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`formPrice: ${field} must be a non-negative number, received ${String(value)}`);
  }
}
