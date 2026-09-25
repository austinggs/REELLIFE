import type { EntityId } from "../../primitives/ids.ts";
import type { Money } from "../../primitives/money.ts";
import type { TenancyType } from "../../housing/types.ts";
import type { CommandDefinition } from "../types.ts";
import { errorIssue } from "../types.ts";

export const ASSET_COMMAND_TYPES = {
  housingSignLease: "housing.sign_lease",
  housingMoveIn: "housing.move_in",
  financeTransfer: "finance.transfer",
  inventoryTransfer: "inventory.transfer",
} as const;

export const ASSET_CONSEQUENCE_TYPES = {
  createLease: "housing.create_lease",
  moveResident: "housing.move_resident",
  postLedgerTransfer: "finance.transfer",
  transferItemPossession: "inventory.transfer_possession",
} as const;

export interface SignLeaseParams {
  readonly propertyId: string;
  readonly landlordId: string;
  readonly rentPerCycle: Money;
}

export interface MoveInParams {
  readonly propertyId: string;
  readonly occupancyType?: TenancyType;
}

export interface TransferMoneyParams {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amount: Money;
  /** Ledger category; defaults to "transfer" when omitted. */
  readonly category?: string;
  readonly description: string;
}

export interface TransferInventoryParams {
  readonly itemId: string;
  readonly toHolderId: EntityId<"person">;
}

export const ASSET_COMMANDS: readonly CommandDefinition<never>[] = [
  {
    type: ASSET_COMMAND_TYPES.housingSignLease,
    owner: "housing",
    description: "Signs a lease agreement for property.",
    validate: (cmd) => {
      const p = cmd.params as Partial<SignLeaseParams>;
      if (!p.propertyId || !p.landlordId || !p.rentPerCycle) {
        return [errorIssue("invalid_params", "Missing lease details", "params")];
      }
      return [];
    },
    resolve: (cmd) => {
      const p = cmd.params as SignLeaseParams;
      return {
        event: {
          type: "housing.lease_signed",
          cause: { kind: "player", description: "Signed housing lease" },
          visibleFacts: [`Lease signed for property ${p.propertyId}`],
          tags: ["housing"],
          consequences: [
            {
              type: ASSET_CONSEQUENCE_TYPES.createLease,
              owner: "housing",
              payload: {
                propertyId: p.propertyId,
                landlordId: p.landlordId,
                tenantId: cmd.actor as EntityId<"person">,
                rentPerCycle: p.rentPerCycle,
              },
            },
          ],
        },
      };
    },
  } as CommandDefinition<never>,
  {
    type: ASSET_COMMAND_TYPES.housingMoveIn,
    owner: "housing",
    description: "Moves into a residence property.",
    validate: (cmd) => {
      const p = cmd.params as Partial<MoveInParams>;
      if (!p.propertyId) return [errorIssue("missing_param", "Missing propertyId", "params.propertyId")];
      return [];
    },
    resolve: (cmd) => {
      const p = cmd.params as MoveInParams;
      return {
        event: {
          type: "housing.moved_in",
          cause: { kind: "player", description: "Moved into property" },
          visibleFacts: [`Person ${cmd.actor} moved into property ${p.propertyId}`],
          tags: ["housing"],
          consequences: [
            {
              type: ASSET_CONSEQUENCE_TYPES.moveResident,
              owner: "housing",
              payload: {
                personId: cmd.actor as EntityId<"person">,
                propertyId: p.propertyId,
                occupancyType: p.occupancyType ?? "tenant",
              },
            },
          ],
        },
      };
    },
  } as CommandDefinition<never>,
  {
    type: ASSET_COMMAND_TYPES.financeTransfer,
    owner: "finance",
    description: "Transfers money between ledger accounts.",
    validate: (cmd) => {
      const p = cmd.params as Partial<TransferMoneyParams>;
      if (!p.fromAccountId || !p.toAccountId || !p.amount) {
        return [errorIssue("invalid_params", "Missing transfer parameters", "params")];
      }
      return [];
    },
    resolve: (cmd) => {
      const p = cmd.params as TransferMoneyParams;
      return {
        event: {
          type: "finance.transfer_executed",
          cause: { kind: "player", description: "Money transfer initiated" },
          visibleFacts: [`Transfer from ${p.fromAccountId} to ${p.toAccountId}`],
          tags: ["finance"],
          consequences: [
            {
              type: ASSET_CONSEQUENCE_TYPES.postLedgerTransfer,
              owner: "finance",
              payload: {
                fromAccountId: p.fromAccountId,
                toAccountId: p.toAccountId,
                amount: p.amount,
                category: p.category ?? "transfer",
                description: p.description,
              },
            },
          ],
        },
      };
    },
  } as CommandDefinition<never>,
  {
    type: ASSET_COMMAND_TYPES.inventoryTransfer,
    owner: "inventory",
    description: "Transfers possession of an item.",
    validate: (cmd) => {
      const p = cmd.params as Partial<TransferInventoryParams>;
      if (!p.itemId || !p.toHolderId) {
        return [errorIssue("invalid_params", "Missing itemId or toHolderId", "params")];
      }
      return [];
    },
    resolve: (cmd) => {
      const p = cmd.params as TransferInventoryParams;
      return {
        event: {
          type: "inventory.possession_transferred",
          cause: { kind: "player", description: "Item possession transferred" },
          visibleFacts: [`Item ${p.itemId} transferred to ${p.toHolderId}`],
          tags: ["inventory"],
          consequences: [
            {
              type: ASSET_CONSEQUENCE_TYPES.transferItemPossession,
              owner: "inventory",
              payload: { itemId: p.itemId, toHolderId: p.toHolderId },
            },
          ],
        },
      };
    },
  } as CommandDefinition<never>,
];
