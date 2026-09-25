import type { EntityId } from "../primitives/ids.ts";
import type { Money, CurrencyId } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";

/**
 * ReelLife System 25 — Finance & Economy Architecture.
 *
 * Law 12: Precision, traceability, balanced ledger entries.
 */

export type AccountType =
  | "cash"
  | "checking"
  | "savings"
  | "credit"
  | "loan"
  | "investment"
  | "escrow";

export interface AccountRecord {
  readonly id: string;
  readonly ownerId: EntityId<"person"> | string; // Person or Organization
  readonly type: AccountType;
  readonly currency: CurrencyId;
  readonly balance: Money;
  readonly createdAt: WorldTime;
}

export interface LedgerEntry {
  readonly id: string;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amount: Money;
  readonly category: string;
  readonly description: string;
  readonly timestamp: WorldTime;
}

export interface FinanceSystemState {
  readonly accounts: readonly AccountRecord[];
  readonly ledger: readonly LedgerEntry[];
}
