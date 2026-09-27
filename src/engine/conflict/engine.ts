import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import {
  STAGE_TRANSITIONS,
  emptyConflictState,
  type Agreement,
  type Apology,
  type BalanceReading,
  type ClaimState,
  type ConflictClaim,
  type ConflictHistoryEntry,
  type ConflictParty,
  type ConflictRecord,
  type ConflictStage,
  type ConflictSystemState,
  type Concession,
  type Offer,
  type OfferKind,
  type Reconciliation,
  type SettlementReading,
} from "./types.ts";

export interface OpenConflictRequest {
  readonly id: string;
  readonly title: string;
  /** Two or more. Group ids are as valid as person ids. */
  readonly partyIds: readonly string[];
  readonly note?: string;
}

export interface AddPartyRequest {
  readonly conflictId: string;
  readonly partyId: string;
  readonly position: string;
  readonly underlyingInterest?: string;
  readonly power: number;
  readonly informedness: number;
  readonly beliefs?: Readonly<Record<string, string>>;
}

export interface FileConflictClaimRequest {
  readonly conflictId: string;
  readonly byPartyId: string;
  readonly againstPartyId?: string;
  readonly text: string;
  /** The world's answer, with the party that has grounds to give it. */
  readonly state: ClaimState;
  readonly settledBy?: string;
}
export interface MakeOfferRequest {
  readonly conflictId: string;
  readonly byPartyId: string;
  readonly kind: OfferKind;
  readonly terms: string;
  readonly concedes?: string;
}

export interface ReachAgreementRequest {
  readonly conflictId: string;
  readonly partyIds: readonly string[];
  readonly terms: readonly string[];
  readonly formal: boolean;
  /** Whether the agreement actually covers what each party wanted. */
  readonly coversInterests: boolean;
}

export class ConflictEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.conflict) {
      this.scope.assertOwner("conflict");
      this.world.systems.conflict = emptyConflictState();
    }
  }

  private get state(): ConflictSystemState {
    return this.world.systems.conflict as ConflictSystemState;
  }

  private set state(value: ConflictSystemState) {
    this.world.systems.conflict = value;
  }

  // ---------------------------------------------------------------- reads ---

  conflicts(): readonly ConflictRecord[] {
    return this.state.conflicts;
  }

  conflict(id: string): ConflictRecord | undefined {
    return this.state.conflicts.find((entry) => entry.id === id);
  }

  requireConflict(id: string, caller: string): ConflictRecord {
    const found = this.conflict(id);
    if (found === undefined) throw new Error(`ConflictEngine.${caller}: unknown conflict ${id}`);
    return found;
  }

  partiesOf(conflictId: string): readonly ConflictParty[] {
    return this.state.parties.filter((entry) => entry.conflictId === conflictId);
  }

  party(conflictId: string, partyId: string): ConflictParty | undefined {
    return this.state.parties.find(
      (entry) => entry.conflictId === conflictId && entry.partyId === partyId,
    );
  }

  claimsOf(conflictId: string): readonly ConflictClaim[] {
    return this.state.claims.filter((entry) => entry.conflictId === conflictId);
  }

  offersOf(conflictId: string): readonly Offer[] {
    return this.state.offers.filter((entry) => entry.conflictId === conflictId);
  }

  concessionsOf(conflictId: string): readonly Concession[] {
    return this.state.concessions.filter((entry) => entry.conflictId === conflictId);
  }

  agreementsOf(conflictId: string): readonly Agreement[] {
    return this.state.agreements.filter((entry) => entry.conflictId === conflictId);
  }

  apologiesOf(conflictId: string): readonly Apology[] {
    return this.state.apologies.filter((entry) => entry.conflictId === conflictId);
  }

  reconciliation(conflictId: string): Reconciliation | undefined {
    return this.state.reconciliations.find((entry) => entry.conflictId === conflictId);
  }

  history(): readonly ConflictHistoryEntry[] {
    return this.state.history;
  }

  // -------------------------------------------------------------- derived ---

  /**
   * The balance of the parties, read off the record.
   *
   * The widest pairwise gap is used rather than an average, because a negotiation
   * is lost by the *worst* pair in the room, not by the mean of all of them.
   */
  balance(conflictId: string): BalanceReading {
    const record = this.requireConflict(conflictId, "balance");
    const parties = this.partiesOf(conflictId);
    let powerGap = 0;
    let informationAsymmetry = 0;
    for (let i = 0; i < parties.length; i += 1) {
      for (let j = i + 1; j < parties.length; j += 1) {
        powerGap = Math.max(powerGap, Math.abs(parties[i].power - parties[j].power));
        informationAsymmetry = Math.max(
          informationAsymmetry,
          Math.abs(parties[i].informedness - parties[j].informedness),
        );
      }
    }
    // A party believing a claim is false, or misunderstanding it, is a
    // misreading â€” counted, not corrected. The world knows; the party may not.
    let misunderstoodClaims = 0;
    for (const party of parties) {
      for (const [claimId, belief] of Object.entries(party.beliefs)) {
        const claim = this.claimsOf(conflictId).find((entry) => entry.id === claimId);
        if (claim === undefined) continue;
        if (belief !== claim.state) misunderstoodClaims += 1;
      }
    }
    // How much of what the parties actually want is visible in what they say.
    // A party that has not said what it wants cannot be settled by agreeing to
    // what it has said.
    const withInterests = parties.filter((party) => party.underlyingInterest !== undefined);
    const coverage =
      parties.length === 0
        ? 0
        : withInterests.length / parties.length;
    return {
      conflictId,
      partyIds: record.partyIds,
      powerGap: round4(clamp01(powerGap)),
      informationAsymmetry: round4(clamp01(informationAsymmetry)),
      misunderstoodClaims,
      interestsAddressed: round4(coverage),
      evenHandedness: round4(1 - clamp01(powerGap)),
    };
  }

  /**
   * How a negotiation on the record is likely to end.
   *
   * Three outcomes, and the middle one is the important one: a settlement that
   * covers every party's stated terms but not what they wanted is `partial`, and
   * will come apart later. The engine reports that rather than calling it a
   * resolution, because the spec asks for "persistent unresolved tension" to be
   * a real, nameable outcome.
   */
  settlementReading(conflictId: string): SettlementReading {
    const balance = this.balance(conflictId);
    const factors = [
      `powerGap=${balance.powerGap.toFixed(2)}`,
      `informationAsymmetry=${balance.informationAsymmetry.toFixed(2)}`,
      `misunderstoodClaims=${balance.misunderstoodClaims}`,
      `interestsAddressed=${balance.interestsAddressed.toFixed(2)}`,
    ];
    // Deadlock: even-handed parties, and at least one has not said what it
    // wants. Nobody can meet a demand that has not been stated.
    if (balance.evenHandedness >= 0.9 && balance.interestsAddressed < 1) {
      return {
        conflictId,
        outcome: "deadlock",
        rationale: "power is even and at least one party's interest is unstated, " +
          "so there is nothing to meet",
        factors,
        balance,
      };
    }
    if (balance.misunderstoodClaims > 0) {
      return {
        conflictId,
        outcome: "partial",
        rationale: "a party is still working from a misreading, so any agreement " +
          "reaches only part of what is at stake",
        factors,
        balance,
      };
    }
    return {
      conflictId,
      outcome: "likely_settlement",
      rationale: "power is uneven, interests are stated, and nothing is misread",
      factors,
      balance,
    };
  }

  // --------------------------------------------------------------- writes ---

  /**
   * Opens a dispute between two or more parties.
   *
   * The record is deliberately thin: a title, the parties, and `emerging`. No
   * crime, no injury, no hatred, no legal case. A dispute is a disagreement, and
   * the spec is explicit that it does not imply any of those; if it becomes
   * one, that has to be recorded by the system that owns it.
   */
  openConflict(request: OpenConflictRequest, at: WorldTime, ids: IdAllocator): ConflictRecord {
    if (this.conflict(request.id) !== undefined) return this.conflict(request.id)!;
    if (request.partyIds.length < 2) {
      throw new Error(
        `ConflictEngine.openConflict: ${request.id} has ${request.partyIds.length} party; ` +
          "a conflict needs at least two",
      );
    }
    this.scope.assertOwner("conflict");
    const record: ConflictRecord = {
      id: request.id,
      title: request.title,
      openedAt: at,
      stage: "emerging",
      partyIds: [...new Set(request.partyIds)],
      ...(request.note === undefined ? {} : { note: request.note }),
    };
    this.state = { ...this.state, conflicts: [...this.state.conflicts, record] };
    this.appendHistory(
      "opened",
      `"${record.title}" opened between ${record.partyIds.length} parties`,
      at,
      ids,
      record.id,
    );
    return record;
  }

  /**
   * Adds or updates a party, with the position, the interest behind it, the
   * power they hold *at this moment*, and how well they understand the other
   * side. Beliefs about claims are recorded here, separately from the claims
   * themselves, so "true" and "believed to be true" never collapse.
   */
  addParty(request: AddPartyRequest, at: WorldTime, ids: IdAllocator): ConflictParty {
    const record = this.requireConflict(request.conflictId, "addParty");
    if (!record.partyIds.includes(request.partyId)) {
      throw new Error(
        `ConflictEngine.addParty: ${request.partyId} is not a party on ${record.id}`,
      );
    }
    this.scope.assertOwner("conflict");
    const party: ConflictParty = {
      conflictId: request.conflictId,
      partyId: request.partyId,
      position: request.position,
      power: requireSigned(request.power, "power", "addParty"),
      informedness: requireRatio(request.informedness, "informedness", "addParty"),
      ...(request.underlyingInterest === undefined
        ? {}
        : { underlyingInterest: request.underlyingInterest }),
      beliefs: { ...(request.beliefs ?? {}) },
    };
    const rest = this.state.parties.filter(
      (entry) => !(entry.conflictId === request.conflictId && entry.partyId === request.partyId),
    );
    this.state = { ...this.state, parties: [...rest, party] };
    if (rest.length === 0) {
      this.appendHistory(
        "party_stated",
        `${request.partyId} states: ${request.position}`,
        at,
        ids,
        record.id,
      );
    }
    return party;
  }

  /**
   * Moves a conflict along its lifecycle, refusing any move the table does not
   * allow. An `emerging` dispute cannot jump straight to `resolved`, and a
   * resolved one cannot reopen â€” which is what stops a case being quietly
   * retried until it goes the right way.
   */
  transition(
    conflictId: string,
    stage: ConflictStage,
    at: WorldTime,
    ids: IdAllocator,
  ): ConflictRecord {
    const record = this.requireConflict(conflictId, "transition");
    if (record.stage === stage) return record;
    if (!STAGE_TRANSITIONS[record.stage].includes(stage)) {
      throw new Error(
        `ConflictEngine.transition: ${conflictId} cannot go from "${record.stage}" ` +
          `to "${stage}"`,
      );
    }
    this.scope.assertOwner("conflict");
    const next: ConflictRecord = { ...record, stage };
    this.state = {
      ...this.state,
      conflicts: this.state.conflicts.map((entry) => (entry.id === conflictId ? next : entry)),
    };
    this.appendHistory("stage", `${record.stage} -> ${stage}`, at, ids, conflictId);
    return next;
  }

  /**
   * Files a claim with the world's own answer to it.
   *
   * `settledBy` names the party with grounds to say what is true. Filing a claim
   * as "false" is a thing that can happen â€” someone asserting a falsehood is a
   * real act â€” but what gets recorded is a *claim that is false*, which is a
   * different thing from a false claim existing.
   */
  fileClaim(request: FileConflictClaimRequest, at: WorldTime, ids: IdAllocator): ConflictClaim {
    const record = this.requireConflict(request.conflictId, "fileClaim");
    if (!record.partyIds.includes(request.byPartyId)) {
      throw new Error(
        `ConflictEngine.fileClaim: ${request.byPartyId} is not a party on ${record.id}`,
      );
    }
    this.scope.assertOwner("conflict");
    const claim: ConflictClaim = {
      id: `cl-${ids.next("activity")}`,
      conflictId: record.id,
      byPartyId: request.byPartyId,
      text: request.text,
      state: request.state,
      settledAt: at,
      ...(request.againstPartyId === undefined ? {} : { againstPartyId: request.againstPartyId }),
      ...(request.settledBy === undefined ? {} : { settledBy: request.settledBy }),
    };
    this.state = { ...this.state, claims: [...this.state.claims, claim] };
    this.appendHistory("claim", `claim filed (${request.state}): ${request.text}`, at, ids, record.id);
    return claim;
  }

  /**
   * Makes an offer or a demand. Either moves an `active` conflict into
   * negotiation, because that is what an offer *is* â€” the first move of a
   * conversation rather than a thing that happens beside one.
   */
  makeOffer(request: MakeOfferRequest, at: WorldTime, ids: IdAllocator): Offer {
    const record = this.requireConflict(request.conflictId, "makeOffer");
    if (!record.partyIds.includes(request.byPartyId)) {
      throw new Error(
        `ConflictEngine.makeOffer: ${request.byPartyId} is not a party on ${record.id}`,
      );
    }
    this.scope.assertOwner("conflict");
    const offer: Offer = {
      id: `of-${ids.next("activity")}`,
      conflictId: record.id,
      at,
      byPartyId: request.byPartyId,
      kind: request.kind,
      terms: request.terms,
      ...(request.concedes === undefined ? {} : { concedes: request.concedes }),
    };
    this.state = { ...this.state, offers: [...this.state.offers, offer] };
    if (record.stage === "active") this.transition(record.id, "negotiating", at, ids);
    this.appendHistory(
      "offer",
      `${request.kind} from ${request.byPartyId}: ${request.terms}`,
      at,
      ids,
      record.id,
    );
    return offer;
  }

  /**
   * Records a concession against an offer: *what was given up*, in the words of
   * the party that gave it. Conceding a position and meeting an interest are
   * different acts, and the spec's insistence that positions differ from
   * interests is only meaningful if both are on the record.
   */
  concede(
    conflictId: string,
    offerId: string,
    byPartyId: string,
    what: string,
    at: WorldTime,
    ids: IdAllocator,
  ): Concession {
    const offer = this.state.offers.find((entry) => entry.id === offerId);
    if (offer === undefined || offer.conflictId !== conflictId) {
      throw new Error(`ConflictEngine.concede: offer ${offerId} is not on ${conflictId}`);
    }
    this.scope.assertOwner("conflict");
    const concession: Concession = {
      id: `cn-${ids.next("activity")}`,
      conflictId,
      offerId,
      at,
      byPartyId,
      what,
    };
    this.state = { ...this.state, concessions: [...this.state.concessions, concession] };
    this.appendHistory("concession", `${byPartyId} conceded: ${what}`, at, ids, conflictId);
    return concession;
  }

  /** Names a mediator. A mediator is a party to neither side's case. */
  appointMediator(conflictId: string, mediatorId: string): ConflictRecord {
    const record = this.requireConflict(conflictId, "appointMediator");
    if (record.partyIds.includes(mediatorId)) {
      throw new Error(
        `ConflictEngine.appointMediator: ${mediatorId} is a party on ${record.id} and ` +
          "cannot also mediate it",
      );
    }
    this.scope.assertOwner("conflict");
    const next: ConflictRecord = { ...record, mediatorId };
    this.state = {
      ...this.state,
      conflicts: this.state.conflicts.map((entry) => (entry.id === conflictId ? next : entry)),
    };
    return next;
  }

  /**
   * Reaches an agreement, formal or not.
   *
   * `coversInterests` is the caller's judgement about whether the deal actually
   * reaches what the parties wanted, and it decides the conflict's fate: a
   * settlement that covers the stated terms but not the interests ends as
   * **unresolved**, not resolved. That is the spec's "persistent unresolved
   * tension" â€” a real, nameable terminal state rather than a resolution that
   * quietly comes apart later.
   */
  reachAgreement(
    request: ReachAgreementRequest,
    at: WorldTime,
    ids: IdAllocator,
  ): { agreement: Agreement; conflict: ConflictRecord } {
    const record = this.requireConflict(request.conflictId, "reachAgreement");
    for (const partyId of request.partyIds) {
      if (!record.partyIds.includes(partyId)) {
        throw new Error(
          `ConflictEngine.reachAgreement: ${partyId} is not a party on ${record.id}`,
        );
      }
    }
    this.scope.assertOwner("conflict");
    const agreement: Agreement = {
      id: `ag-${ids.next("activity")}`,
      conflictId: record.id,
      at,
      partyIds: [...request.partyIds],
      terms: [...request.terms],
      formal: request.formal,
      status: "kept",
      consequences: [],
    };
    this.state = { ...this.state, agreements: [...this.state.agreements, agreement] };
    const conflict =
      record.stage === "negotiating" || record.stage === "deescalating"
        ? this.transition(
            record.id,
            request.coversInterests ? "resolved" : "unresolved",
            at,
            ids,
          )
        : record;
    this.appendHistory(
      "agreement",
      `${request.formal ? "formal" : "informal"} agreement reached` +
        (request.coversInterests ? "" : ", covering terms but not interests"),
      at,
      ids,
      record.id,
    );
    return { agreement, conflict };
  }

  /**
   * Records that an agreement was broken, and what it caused.
   *
   * The consequences are required and non-empty. "It was broken" on its own is
   * a fact with no weight, and the spec asks for broken agreements to create
   * downstream consequences â€” so the engine insists on being told what those
   * were rather than leaving the next reader to guess.
   */
  breakAgreement(
    agreementId: string,
    reason: string,
    consequences: readonly string[],
    at: WorldTime,
    ids: IdAllocator,
  ): Agreement {
    const agreement = this.state.agreements.find((entry) => entry.id === agreementId);
    if (agreement === undefined) {
      throw new Error(`ConflictEngine.breakAgreement: unknown agreement ${agreementId}`);
    }
    if (agreement.status !== "kept") return agreement;
    if (consequences.length === 0) {
      throw new Error(
        `ConflictEngine.breakAgreement: breaking ${agreementId} must say what it caused`,
      );
    }
    this.scope.assertOwner("conflict");
    const broken: Agreement = {
      ...agreement,
      status: "broken",
      brokenReason: reason,
      consequences: [...consequences],
    };
    this.state = {
      ...this.state,
      agreements: this.state.agreements.map((entry) =>
        entry.id === agreementId ? broken : entry,
      ),
    };
    this.appendHistory("agreement_broken", reason, at, ids, agreement.conflictId);
    return broken;
  }

  /**
   * Offers an apology.
   *
   * An apology is *offered* first and stays that way until the other party
   * answers. `weight` is supplied because what an apology is worth depends on
   * the relationship's history, which belongs to System 18 â€” the engine records
   * the figure it is given rather than inventing one.
   */
  apologize(
    conflictId: string,
    fromPartyId: string,
    toPartyId: string,
    text: string,
    weight: number,
    at: WorldTime,
    ids: IdAllocator,
  ): Apology {
    const record = this.requireConflict(conflictId, "apologize");
    this.scope.assertOwner("conflict");
    const apology: Apology = {
      id: `ap-${ids.next("activity")}`,
      conflictId: record.id,
      at,
      fromPartyId,
      toPartyId,
      text,
      state: "offered",
      weight: requireRatio(weight, "weight", "apologize"),
    };
    this.state = { ...this.state, apologies: [...this.state.apologies, apology] };
    this.appendHistory("apology", `${fromPartyId} apologised to ${toPartyId}`, at, ids, record.id);
    return apology;
  }

  /**
   * Answers an apology.
   *
   * Acceptance is not the same as reconciliation: a party can accept an apology
   * and still not be restored, which is why `reconcile` is a separate act with
   * its own `restored` figure.
   */
  respondToApology(
    apologyId: string,
    state: "accepted" | "refused" | "unanswered",
    at: WorldTime,
    ids: IdAllocator,
  ): Apology {
    const apology = this.state.apologies.find((entry) => entry.id === apologyId);
    if (apology === undefined) {
      throw new Error(`ConflictEngine.respondToApology: unknown apology ${apologyId}`);
    }
    this.scope.assertOwner("conflict");
    const answered: Apology = { ...apology, state };
    this.state = {
      ...this.state,
      apologies: this.state.apologies.map((entry) => (entry.id === apologyId ? answered : entry)),
    };
    this.appendHistory("apology_answered", `apology ${state}`, at, ids, apology.conflictId);
    return answered;
  }

  /**
   * Records genuine repair, distinct from the mere absence of a dispute.
   * `restored` is the caller's reading of how far things actually came back, and
   * a conflict can be reconciled without ever having been resolved.
   */
  reconcile(conflictId: string, restored: number, at: WorldTime, note?: string): Reconciliation {
    const record = this.requireConflict(conflictId, "reconcile");
    this.scope.assertOwner("conflict");
    const entry: Reconciliation = {
      conflictId,
      at,
      partyIds: [...record.partyIds],
      restored: requireRatio(restored, "restored", "reconcile"),
      ...(note === undefined ? {} : { note }),
    };
    this.state = { ...this.state, reconciliations: [...this.state.reconciliations, entry] };
    return entry;
  }

  private appendHistory(
    kind: string,
    summary: string,
    at: WorldTime,
    ids: IdAllocator,
    conflictId: string,
  ): void {
    const history: ConflictHistoryEntry = {
      id: `ch-${ids.next("activity")}`,
      at,
      conflictId,
      kind,
      summary,
    };
    this.state = { ...this.state, history: [...this.state.history, history] };
  }

  serialize(): ConflictSystemState {
    return this.state;
  }
}

function requireRatio(value: number, field: string, caller: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`ConflictEngine.${caller}: ${field} must be 0..1, received ${value}`);
  }
  return value;
}

function requireSigned(value: number, field: string, caller: string): number {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new Error(`ConflictEngine.${caller}: ${field} must be in [-1, 1], received ${value}`);
  }
  return value;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
