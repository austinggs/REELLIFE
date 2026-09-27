/**
 * M5 DoD — ledger conservation as a property, over 10 000 transactions.
 *
 * Law 12: every monetary change is a balanced double entry with a causal
 * trace. This test does not check a few hand-picked transfers: it runs ten
 * thousand of them through System 25's finance engine and then re-derives
 * every balance from the ledger independently, so the engine's own numbers
 * are never the witness. Balances may go negative (rent arrears are
 * load-bearing elsewhere in ReelLife) — what may never happen is money
 * appearing or vanishing.
 *
 * The transfer sequence is driven by a local LCG rather than `Math.random`,
 * so the property is checked against a fixed, reproducible workload.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { FinanceEngine } from "../../src/engine/finance/engine.ts";
import type { AccountRecord } from "../../src/engine/finance/types.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import { currencyId, money } from "../../src/engine/primitives/money.ts";
import { atTime } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-ledger-conservation-seed";
const AUR = currencyId("AUR");
const ACCOUNTS = 12;
const DEPOSIT = 1_000_000;
const TRANSFERS = 10_000;
/** Deterministic pseudo-random source; fixed workload, no Math.random. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: false });
}

describe("ledger conservation (M5 DoD / law 12)", () => {
  it("conserves every minor unit across 10 000 transfers", () => {
    const sim = newWorld();
    const ids = new IdAllocator();
    const now = atTime(0);
    const opening = new Map<string, number>();
    const rand = lcg(0x5eed);

    sim.guard.mutate("finance", () => {
      const finance = new FinanceEngine(sim.scope, sim.world);
      const accounts: AccountRecord[] = [];
      for (let index = 0; index < ACCOUNTS; index += 1) {
        const account = finance.openAccount(ids, `PER-${index}`, "checking", AUR, now, money(AUR, DEPOSIT));
        accounts.push(account);
        opening.set(account.id, DEPOSIT);
      }

      // Ten thousand transfers between random pairs, amounts bounded so
      // no account can drift toward a float-unsafe magnitude. A draw that
      // picks the same account twice is not a transfer, so it is not
      // counted: the loop runs until TRANSFERS real entries exist.
      let performed = 0;
      while (performed < TRANSFERS) {
        const from = accounts[Math.floor(rand() * ACCOUNTS)] as AccountRecord;
        const to = accounts[Math.floor(rand() * ACCOUNTS)] as AccountRecord;
        if (from.id === to.id) continue;
        const amountMinor = 1 + Math.floor(rand() * 10_000);
        finance.transfer(ids, from.id, to.id, money(AUR, amountMinor), "churn", `step ${performed}`, now);
        performed += 1;
      }
      expect(finance.allLedger()).toHaveLength(TRANSFERS);
    });

    const financeState = sim.world.systems.finance as {
      readonly accounts: readonly AccountRecord[];
      readonly ledger: readonly {
        readonly id: string;
        readonly fromAccountId: string;
        readonly toAccountId: string;
        readonly amount: { readonly currency: string; readonly minorUnits: number };
      }[];
    };
    const { accounts, ledger } = financeState;

    // Property 1: the total is untouched. Money moved; it did not change.
    const total = accounts.reduce((sum, account) => sum + account.balance.minorUnits, 0);
    expect(total).toBe(ACCOUNTS * DEPOSIT);

    // Property 2: every entry references real accounts, carries the one
    // currency, and moves a positive amount.
    const ids_seen = new Set(accounts.map((account) => account.id));
    for (const entry of ledger) {
      expect(ids_seen.has(entry.fromAccountId)).toBe(true);
      expect(ids_seen.has(entry.toAccountId)).toBe(true);
      expect(entry.fromAccountId).not.toBe(entry.toAccountId);
      expect(entry.amount.currency).toBe(AUR);
      expect(entry.amount.minorUnits).toBeGreaterThan(0);
    }

    // Property 3: the decisive check — each balance is re-derived from
    // the opening deposit and the ledger, independently of the engine.
    const expected = new Map<string, number>(opening);
    for (const entry of ledger) {
      expected.set(
        entry.fromAccountId,
        (expected.get(entry.fromAccountId) as number) - entry.amount.minorUnits,
      );
      expected.set(
        entry.toAccountId,
        (expected.get(entry.toAccountId) as number) + entry.amount.minorUnits,
      );
    }
    for (const account of accounts) {
      expect(account.balance.minorUnits).toBe(expected.get(account.id));
      // The workload never pushes a balance anywhere near a float-unsafe
      // magnitude, so the money invariants stay exact integers.
      expect(Number.isSafeInteger(account.balance.minorUnits)).toBe(true);
    }
  });
});
