import type { EntityId, IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import { addMoney, subtractMoney, zeroMoney, type CurrencyId, type Money } from "../primitives/money.ts";
import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type {
  AccountRecord,
  AccountType,
  FinanceSystemState,
  LedgerEntry,
} from "./types.ts";

export class FinanceEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.finance) {
      this.scope.assertOwner("finance");
      this.world.systems.finance = { accounts: [], ledger: [] } satisfies FinanceSystemState;
    }
  }

  private get state(): FinanceSystemState {
    return this.world.systems.finance as FinanceSystemState;
  }

  private set state(value: FinanceSystemState) {
    this.world.systems.finance = value;
  }

  openAccount(
    ids: IdAllocator,
    ownerId: EntityId<"person"> | string,
    type: AccountType,
    currency: CurrencyId,
    now: WorldTime,
    initialDeposit?: Money,
  ): AccountRecord {
    this.scope.assertOwner("finance");
    const id = `acc-${ids.next("activity")}`;
    const balance = initialDeposit ?? zeroMoney(currency);

    const account: AccountRecord = {
      id,
      ownerId,
      type,
      currency,
      balance,
      createdAt: now,
    };

    this.state = {
      ...this.state,
      accounts: [...this.state.accounts, account],
    };
    return account;
  }

  getAccount(id: string): AccountRecord | undefined {
    return this.state.accounts.find((a) => a.id === id);
  }

  accountsForOwner(ownerId: EntityId<"person"> | string): readonly AccountRecord[] {
    return this.state.accounts.filter((a) => a.ownerId === ownerId);
  }

  allAccounts(): readonly AccountRecord[] {
    return this.state.accounts;
  }

  allLedger(): readonly LedgerEntry[] {
    return this.state.ledger;
  }

  /**
   * Balanced double-entry transfer between two accounts.
   * Law 12: Every monetary change has a causal trace and balanced posting.
   */
  transfer(
    ids: IdAllocator,
    fromAccountId: string,
    toAccountId: string,
    amount: Money,
    category: string,
    description: string,
    now: WorldTime,
  ): LedgerEntry {
    this.scope.assertOwner("finance");
    const from = this.getAccount(fromAccountId);
    const to = this.getAccount(toAccountId);

    if (!from) throw new Error(`Source account not found: ${fromAccountId}`);
    if (!to) throw new Error(`Destination account not found: ${toAccountId}`);
    if (from.currency !== amount.currency || to.currency !== amount.currency) {
      throw new Error(`Currency mismatch for transfer`);
    }

    const newFromBalance = subtractMoney(from.balance, amount);
    const newToBalance = addMoney(to.balance, amount);

    const updatedFrom: AccountRecord = { ...from, balance: newFromBalance };
    const updatedTo: AccountRecord = { ...to, balance: newToBalance };

    const entryId = `tx-${ids.next("activity")}`;
    const entry: LedgerEntry = {
      id: entryId,
      fromAccountId,
      toAccountId,
      amount,
      category,
      description,
      timestamp: now,
    };

    this.state = {
      ...this.state,
      accounts: this.state.accounts.map((a) => {
        if (a.id === fromAccountId) return updatedFrom;
        if (a.id === toAccountId) return updatedTo;
        return a;
      }),
      ledger: [...this.state.ledger, entry],
    };

    return entry;
  }
}
