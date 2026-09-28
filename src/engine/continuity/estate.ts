/**
 * Estate settlement (System 53b).
 *
 * System 53 does not own asset-ownership semantics, so this module holds no
 * title and invents none: it gathers *references* to records owned elsewhere
 * (System 25 accounts, System 29 items, System 28 vehicles) and asks each owning
 * engine to perform the transfer. Every application names the system that
 * wrote it and, for money, the ledger entry that carried it — so a settlement
 * can be walked back to concrete fields, never to a `legacyBonus`-style scalar
 * (architectural law 12).
 *
 * Beneficiaries come from the declared will when one applies, and from
 * intestacy otherwise: descendants, then household, then parents, then
 * siblings, stopping at the first tier that has a surviving member.
 *
 * What this module deliberately does not settle: residences, leases,
 * employment and policies. A tenancy is an agreement with a landlord, a job is
 * an obligation of work, a policy is a contract with an insurer — none of them
 * is an asset the estate can hand on. They stay with their owners on the record
 * rather than being silently reassigned.
 */

import type { Simulation } from "../core/simulation.ts";
import type { SystemId } from "../core/ownership.ts";
import type { EntityId } from "../primitives/ids.ts";
import type { CurrencyId, Money } from "../primitives/money.ts";
import { isNegativeMoney, money, sumMoney } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";
import { FinanceEngine } from "../finance/engine.ts";
import { InventoryEngine } from "../inventory/engine.ts";
import { TransportEngine } from "../transport/engine.ts";
import { LifeContinuityEngine } from "./engine.ts";
import type {
  BequestApplication,
  Beneficiary,
  BeneficiaryBasis,
  EstateCase,
  EstateItem,
  SuccessionKind,
} from "./types.ts";

/**
 * Which system owns each kind of record, and which field on it changes when a
 * bequest is applied. An estate can only name a combination that exists here, so
 * a legacy effect always resolves to a concrete field on a concrete owner.
 *
 * `settable: false` records an honest limit rather than a missing feature: a
 * tenancy is an agreement with a landlord, a job is an obligation of work, a
 * policy is a contract with an insurer. None is an asset, and an estate does not
 * reassign them.
 */
export const SUCCESSION_TARGETS: Readonly<
  Record<SuccessionKind, { readonly system: SystemId; readonly field: string; readonly settable: boolean }>
> = {
  money: { system: "finance", field: "AccountRecord.balance", settable: true },
  item: { system: "inventory", field: "ItemInstance.ownerId", settable: true },
  vehicle: { system: "transport", field: "Vehicle.ownerId", settable: true },
  residence: { system: "housing", field: "ResidenceRecord.residentIds", settable: false },
  lease: { system: "housing", field: "LeaseRecord.tenantId", settable: false },
  employment: { system: "employment", field: "EmploymentRecord.employeeId", settable: false },
  policy: { system: "insurance", field: "PolicyRecord.holderId", settable: false },
};

/** A claim against the estate held by a system other than System 25. */
export interface ExternalClaim {
  readonly id: string;
  /**
   * Named as a `SystemId` rather than free text: a claim has to point at a
   * system that exists, or the estate would be carrying a reference nothing can
   * resolve.
   */
  readonly ref: { readonly system: SystemId; readonly recordId: string; readonly field: string };
  readonly amount: Money;
  readonly note?: string;
}

export interface GatheredEstate {
  readonly items: readonly EstateItem[];
  /** Debts, by reference. An estate does not cancel an obligation by ignoring it. */
  readonly obligations: readonly EstateItem[];
  /** Currency-by-currency totals, so a mixed-currency estate is visible. */
  readonly moneyByCurrency: Readonly<Record<string, Money>>;
}

export interface GatherOptions {
  /** Debts owed *by* the deceased, named by the caller (no debt system exists). */
  readonly claims?: readonly ExternalClaim[];
}

/**
 * A person is only a beneficiary while alive; a deceased heir inherits nothing
 * further. Eligibility is evaluated here, separately from having been named
 * (System 03: eligibility is never a probability).
 */
function survives(sim: Simulation, personId: EntityId<"person">): boolean {
  return LifeContinuityEngine.peek(sim.scope, sim.world).statusOf(personId) === "active";
}

interface FamilyBag {
  readonly lineages?: readonly {
    readonly personId: EntityId<"person">;
    readonly parentIds: readonly EntityId<"person">[];
    readonly childIds: readonly EntityId<"person">[];
  }[];
  readonly households?: readonly {
    readonly members: readonly {
      readonly personId: EntityId<"person">;
      readonly joinedAt?: WorldTime;
      readonly leftAt?: WorldTime;
    }[];
  }[];
}

type FamilyHousehold = NonNullable<FamilyBag["households"]>[number];

/**
 * The household a person last belonged to, by their most recent stint.
 *
 * Stints are never deleted (System 19), so "where they lived when they died"
 * stays answerable after their membership has ended. When they belong to more
 * than one household's history, the latest join wins, and ties are broken by the
 * order the households were recorded in — deterministic by construction.
 */
function lastHouseholdOf(family: FamilyBag, personId: EntityId<"person">): readonly FamilyHousehold[] {
  let best: { household: FamilyHousehold; joinedAt: number } | undefined;
  for (const household of family.households ?? []) {
    let latest: number | undefined;
    for (const member of household.members) {
      if (member.personId !== personId) continue;
      const joined = member.joinedAt === undefined ? 0 : (member.joinedAt as number);
      if (latest === undefined || joined > latest) latest = joined;
    }
    if (latest === undefined) continue;
    if (best === undefined || latest > best.joinedAt) best = { household, joinedAt: latest };
  }
  return best === undefined ? [] : [best.household];
}

function familyBagOf(sim: Simulation): FamilyBag | undefined {
  return sim.world.systems.family as FamilyBag | undefined;
}


/**
 * Lists what the deceased held, by reference, without taking any of it.
 *
 * A valuation is copied from the owner that stated it (`AccountRecord.balance`)
 * and never estimated here — an estate that guessed what a cart was worth would
 * be inventing a fact.
 */
export function gatherEstate(
  sim: Simulation,
  deceasedId: EntityId<"person">,
  options?: GatherOptions,
): GatheredEstate {
  const accounts =
    (
      sim.world.systems.finance as
        | {
            readonly accounts?: readonly {
              readonly id: string;
              readonly ownerId: string;
              readonly currency: CurrencyId;
              readonly balance: Money;
            }[];
          }
        | undefined
    )?.accounts ?? [];
  const items =
    (
      sim.world.systems.inventory as
        | { readonly items?: readonly { readonly id: string; readonly ownerId: string }[] }
        | undefined
    )?.items ?? [];
  const vehicles =
    (
      sim.world.systems.transport as
        | { readonly vehicles?: readonly { readonly id: string; readonly ownerId: string }[] }
        | undefined
    )?.vehicles ?? [];

  const estateItems: EstateItem[] = [];
  const perCurrency = new Map<string, Money>();

  for (const account of accounts) {
    if (account.ownerId !== String(deceasedId)) continue;
    estateItems.push({
      id: account.id,
      ref: { system: "finance", recordId: account.id, field: "AccountRecord.balance", kind: "money" },
      valuation: account.balance,
    });
    const existing = perCurrency.get(account.currency);
    perCurrency.set(
      account.currency,
      existing === undefined ? account.balance : sumMoney(account.currency, [existing, account.balance]),
    );
  }

  for (const item of items) {
    if (item.ownerId !== String(deceasedId)) continue;
    estateItems.push({
      id: item.id,
      ref: { system: "inventory", recordId: item.id, field: "ItemInstance.ownerId", kind: "item" },
    });
  }

  for (const vehicle of vehicles) {
    if (vehicle.ownerId !== String(deceasedId)) continue;
    estateItems.push({
      id: vehicle.id,
      ref: { system: "transport", recordId: vehicle.id, field: "Vehicle.ownerId", kind: "vehicle" },
    });
  }

  const obligations: EstateItem[] = (options?.claims ?? []).map((claim) => ({
    id: claim.id,
    ref: {
      system: claim.ref.system,
      recordId: claim.ref.recordId,
      field: claim.ref.field,
      kind: "money",
      ...(claim.note === undefined ? {} : { note: claim.note }),
    },
    valuation: claim.amount,
  }));

  const moneyByCurrency: Record<string, Money> = {};
  for (const [code, total] of perCurrency) moneyByCurrency[code] = total;

  return { items: estateItems, obligations, moneyByCurrency };
}

function dedupe(ids: readonly EntityId<"person">[]): EntityId<"person">[] {
  const seen = new Set<string>();
  const out: EntityId<"person">[] = [];
  for (const id of ids) {
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

function evenShares(
  ids: readonly EntityId<"person">[],
  basis: BeneficiaryBasis,
): readonly Beneficiary[] {
  return ids.map((personId) => ({ personId, basis, share: 1 / ids.length }));
}

/**
 * Who inherits, and on what basis.
 *
 * A declared will wins outright: the testator chose, and System 53 does not
 * second-guess them. Without one, intestacy walks the tiers in the order the
 * spec gives — descendants, then household, then parents, then siblings — and
 * stops at the first tier with a surviving member, because that is the tier the
 * law would give it to. The share is even across that tier and the basis names
 * the relationship, so "why did they get it" stays readable.
 */
export function determineBeneficiaries(
  sim: Simulation,
  deceasedId: EntityId<"person">,
): readonly Beneficiary[] {
  const continuity = LifeContinuityEngine.peek(sim.scope, sim.world);
  const will = continuity.testamentFor(deceasedId);
  if (will !== undefined) {
    return will.beneficiaries
      .filter((entry) => survives(sim, entry.personId))
      .map((entry) => ({ ...entry, basis: "will" as const }));
  }

  const family = familyBagOf(sim);
  if (family === undefined) return [];
  const lineageOf = (id: EntityId<"person">) => family.lineages?.find((link) => link.personId === id);
  const deceasedLine = lineageOf(deceasedId);

  const tiers: readonly { basis: BeneficiaryBasis; candidates: readonly EntityId<"person">[] }[] = [
    { basis: "intestacy_descendant", candidates: deceasedLine?.childIds ?? [] },
    {
      // The household the deceased belonged to. Read from their *last* stint,
      // not from live membership: the death pipeline has already stamped
      // `leftAt` on the stint they ended, so a filter demanding an open stint
      // would find nobody and silently skip this tier. The remaining members are
      // then taken from stints that are still open.
      basis: "intestacy_household",
      candidates: lastHouseholdOf(family, deceasedId)
        .flatMap((household) =>
          household.members
            .filter((member) => member.personId !== deceasedId && member.leftAt === undefined)
            .map((member) => member.personId),
        ),
    },
    { basis: "intestacy_parent", candidates: deceasedLine?.parentIds ?? [] },
  ];

  for (const tier of tiers) {
    const alive = dedupe(tier.candidates.filter((id) => survives(sim, id)));
    if (alive.length > 0) return evenShares(alive, tier.basis);
  }

  // Siblings come after every closer tier is empty, and are read through
  // parentage rather than households (System 19: living together is not kinship).
  const siblings: EntityId<"person">[] = [];
  for (const parentId of deceasedLine?.parentIds ?? []) {
    for (const childId of lineageOf(parentId)?.childIds ?? []) {
      if (childId === deceasedId) continue;
      if (!siblings.includes(childId)) siblings.push(childId);
    }
  }
  const survivingSiblings = dedupe(siblings.filter((id) => survives(sim, id)));
  if (survivingSiblings.length > 0) return evenShares(survivingSiblings, "intestacy_sibling");
  return [];
}

export interface OpenEstateRequest {
  readonly deceasedId: EntityId<"person">;
  readonly openedAt: WorldTime;
  /** Supplied by the caller; allocated deterministically when omitted. */
  readonly estateId?: string;
  readonly claims?: readonly ExternalClaim[];
  readonly note?: string;
}

/**
 * Opens an estate: gathers the references, fixes the beneficiaries, leaves the
 * case `open` with nothing applied. Gathering and applying are separate because
 * probate is a decision the world takes, not a side effect of dying.
 */
export function openEstate(sim: Simulation, request: OpenEstateRequest): EstateCase {
  const peek = LifeContinuityEngine.peek(sim.scope, sim.world);
  if (peek.statusOf(request.deceasedId) === "active") {
    throw new Error(`openEstate: ${request.deceasedId} has not died`);
  }
  const id = request.estateId ?? `est-${String(sim.ids.next("record"))}`;
  const gathered = gatherEstate(sim, request.deceasedId, {
    ...(request.claims === undefined ? {} : { claims: request.claims }),
  });

  const estate: EstateCase = {
    id,
    deceasedId: request.deceasedId,
    openedAt: request.openedAt,
    status: "open",
    items: gathered.items,
    obligations: gathered.obligations,
    beneficiaries: determineBeneficiaries(sim, request.deceasedId),
    applications: [],
    ...(request.note === undefined ? {} : { note: request.note }),
  };

  sim.guard.mutate("continuity", () => {
    new LifeContinuityEngine(sim.scope, sim.world).addEstate(estate);
  });
  return estate;
}

export interface SettleResult {
  readonly estate: EstateCase;
  readonly applications: readonly BequestApplication[];
  /** Records the estate did not hand on; each says why on the case itself. */
  readonly retained: readonly EstateItem[];
}


/**
 * Applies an estate: money moves through System 25, ownership through Systems 29
 * and 28, and the case records which system performed each write and — for
 * money — which ledger entry carried it.
 *
 * Money is split by share per currency, because an estate holding two currencies
 * has two balances and dividing one does not divide the other. Integer minor
 * units cannot always divide evenly, so the remainder goes to the first named
 * beneficiary and is named in the application note rather than discarded.
 *
 * Non-money assets are not split: one bicycle is not half a bicycle, so a single
 * item or vehicle goes whole to the first beneficiary, and the record says so.
 */
export function settleEstate(sim: Simulation, estateId: string, at: WorldTime): SettleResult {
  const peek = LifeContinuityEngine.peek(sim.scope, sim.world);
  const existing = peek.estate(estateId);
  if (existing === undefined) throw new Error(`settleEstate: unknown estate ${estateId}`);
  if (existing.status === "settled") {
    // Re-settling is a no-op and reports *no new* applications, so a caller that
    // counts what it just applied cannot pay the estate twice by retrying. The
    // case itself still carries the full application history.
    return { estate: existing, applications: [], retained: [] };
  }

  const beneficiaries = existing.beneficiaries.filter((entry) => survives(sim, entry.personId));
  if (beneficiaries.length === 0) {
    // Nobody eligible. That is a real state — "unclaimed" — not a failure, and
    // crucially not a silent default to whoever happens to be nearest.
    const unclaimed: EstateCase = {
      ...existing,
      status: "unclaimed",
      note: "no eligible beneficiary survived; the estate waits rather than defaulting",
    };
    sim.guard.mutate("continuity", () => {
      new LifeContinuityEngine(sim.scope, sim.world).replaceEstate(unclaimed);
    });
    return {
      estate: unclaimed,
      applications: [],
      retained: [...existing.items, ...existing.obligations],
    };
  }

  const applications: BequestApplication[] = [];
  const retained: EstateItem[] = [];

  sim.guard.mutate("continuity", () => {
    new LifeContinuityEngine(sim.scope, sim.world).setEstateStatus(estateId, "settling");
  });

  // --- money ---------------------------------------------------------------
  const moneyItems = existing.items.filter(
    (item) => item.ref.kind === "money" && item.valuation !== undefined,
  );
  const byCurrency = new Map<string, EstateItem[]>();
  for (const item of moneyItems) {
    const code = (item.valuation as Money).currency;
    byCurrency.set(code, [...(byCurrency.get(code) ?? []), item]);
  }

  for (const [, items] of byCurrency) {
    const currency = (items[0]?.valuation as Money | undefined)?.currency as
      | CurrencyId
      | undefined;
    if (currency === undefined) continue;
    const total = sumMoney(currency, items.map((item) => item.valuation as Money));
    // Floor every share first, so nobody is credited with money that was never
    // there; only the indivisible remainder is added, and only to the first
    // beneficiary. Computing the floor sum up front is what stops the first
    // beneficiary from being handed the whole balance twice over.
    const floors = beneficiaries.map((beneficiary) =>
      Math.floor(total.minorUnits * beneficiary.share),
    );
    const floorSum = floors.reduce((sum, value) => sum + value, 0);
    const remainder = total.minorUnits - floorSum;

    for (let index = 0; index < beneficiaries.length; index += 1) {
      const beneficiary = beneficiaries[index];
      if (beneficiary === undefined) continue;
      const exact = floors[index] ?? 0;
      const amount = index === 0 ? exact + remainder : exact;
      if (amount <= 0) continue;
      for (const item of items) {
        const applied = transferEstateMoney(
          sim,
          item,
          beneficiary.personId,
          money(currency, amount),
          estateId,
          at,
          index === 0 && remainder !== 0
            ? { note: "includes the indivisible remainder of an uneven division" }
            : {},
        );
        if (applied !== undefined) applications.push(applied);
      }
    }
  }


  // A negative balance is a debt, not an estate asset: it is retained as an
  // obligation rather than paid out to an heir as if it were a gift.
  for (const item of existing.items) {
    if (item.ref.kind !== "money" || item.valuation === undefined) continue;
    if (isNegativeMoney(item.valuation)) retained.push(item);
  }

  // --- items and vehicles --------------------------------------------------
  const heir = beneficiaries[0];
  const appliedIds = new Set<string>();
  for (const item of existing.items) {
    if (heir === undefined) break;
    if (item.ref.kind !== "item" && item.ref.kind !== "vehicle") continue;
    if (retained.includes(item)) continue;
    if (item.ref.kind === "item") {
      sim.guard.mutate("inventory", () => {
        new InventoryEngine(sim.scope, sim.world).transferOwnership(item.ref.recordId, heir.personId);
      });
      applications.push({
        itemId: item.id,
        kind: "bequest",
        beneficiaryId: heir.personId,
        appliedAt: at,
        appliedBy: "inventory",
        note: "a single item is not divided between heirs; it went whole to the first beneficiary",
      });
    } else {
      sim.guard.mutate("transport", () => {
        new TransportEngine(sim.scope, sim.world).transferOwnership(
          item.ref.recordId,
          String(heir.personId),
          at,
          `inherited from estate ${estateId}`,
        );
      });
      applications.push({
        itemId: item.id,
        kind: "bequest",
        beneficiaryId: heir.personId,
        appliedAt: at,
        appliedBy: "transport",
        note: "registrations keep the previous owner, so the inheritance stays traceable",
      });
    }
    appliedIds.add(item.id);
  }

  // --- what the estate did not settle --------------------------------------
  for (const item of existing.items) {
    if (appliedIds.has(item.id)) continue;
    if (retained.includes(item)) continue;
    retained.push(item);
  }
  for (const obligation of existing.obligations) retained.push(obligation);

  const retainedIds = new Set(retained.map((item) => item.id));
  const current = peek.estate(estateId);
  if (current === undefined) {
    throw new Error(`settleEstate: estate ${estateId} disappeared mid-settlement`);
  }

  const withReasons: EstateCase = {
    ...current,
    items: current.items.map((item) =>
      retainedIds.has(item.id) && item.retainedReason === undefined
        ? { ...item, retainedReason: retainedReasonFor(item) }
        : item,
    ),
    obligations: current.obligations.map((obligation) =>
      obligation.retainedReason === undefined
        ? { ...obligation, retainedReason: "an obligation stays owed; an estate does not cancel it" }
        : obligation,
    ),
  };

  const settled: EstateCase = {
    ...withReasons,
    status: "settled",
    applications: [...withReasons.applications, ...applications],
    settledAt: at,
    note:
      retained.length > 0
        ? `settled with ${String(retained.length)} record(s) not handed on; each says why`
        : withReasons.note,
  };

  sim.guard.mutate("continuity", () => {
    new LifeContinuityEngine(sim.scope, sim.world).replaceEstate(settled);
  });

  sim.guard.mutate("history", () => {
    sim.history.record({
      at,
      kind: "finance",
      summary: `estate ${estateId} settled for ${String(settled.deceasedId)}`,
      detail: `${String(applications.length)} transfer(s) applied across ${String(
        new Set(applications.map((applied) => applied.appliedBy)).size,
      )} system(s); ${String(retained.length)} record(s) retained with a stated reason`,
      personId: settled.deceasedId,
      eventType: "estate.settled",
      causeKind: "system",
      importance: 4,
      visibility: "public",
      tags: ["continuity", "estate"],
    });
  });

  return { estate: settled, applications, retained };
}

function retainedReasonFor(item: EstateItem): string {
  const target = SUCCESSION_TARGETS[item.ref.kind];
  if (target.settable) {
    return "no eligible beneficiary remained; the estate did not default it to anyone";
  }
  return `${item.ref.kind} is held by ${target.system}, which does not transfer it on death; it stays on the record with its owner`;
}

function transferEstateMoney(
  sim: Simulation,
  item: EstateItem,
  beneficiaryId: EntityId<"person">,
  amount: Money,
  estateId: string,
  at: WorldTime,
  options: { readonly note?: string } = {},
): BequestApplication | undefined {
  const entry = sim.guard.mutate("finance", () => {
    const finance = new FinanceEngine(sim.scope, sim.world);
    const source = finance.getAccount(item.ref.recordId);
    if (source === undefined) return undefined;
    let destination = finance
      .accountsForOwner(beneficiaryId)
      .find((account) => account.currency === amount.currency);
    if (destination === undefined) {
      destination = finance.openAccount(sim.ids, beneficiaryId, "savings", amount.currency, at);
    }
    return finance.transfer(
      sim.ids,
      item.ref.recordId,
      destination.id,
      amount,
      "inheritance",
      `estate ${estateId}`,
      at,
    );
  });
  if (entry === undefined) return undefined;
  return {
    itemId: item.id,
    kind: "bequest",
    beneficiaryId,
    appliedAt: at,
    appliedBy: "finance",
    ledgerEntryId: entry.id,
    ...(options.note === undefined ? {} : { note: options.note }),
  };
}

