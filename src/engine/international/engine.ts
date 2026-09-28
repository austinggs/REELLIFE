import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import {
  RELATION_DOMAINS,
  SHOCK_CHANNELS,
  emptyInternationalState,
  type BilateralStanding,
  type GlobalShock,
  type InternationalHistoryEntry,
  type InternationalOrganization,
  type InternationalSystemState,
  type MigrationPressure,
  type RelationDomain,
  type Sanction,
  type SanctionScope,
  type ShockChannel,
  type ShockKind,
  type StandingReading,
  type TradeConditions,
  type Treaty,
  type TreatyKind,
  type TreatyStatus,
} from "./types.ts";

export interface RecordStandingRequest {
  readonly countryA: string;
  readonly countryB: string;
  readonly domain: RelationDomain;
  readonly standing: number;
  readonly note?: string;
}

export interface SignTreatyRequest {
  readonly id: string;
  readonly kind: TreatyKind;
  readonly partyIds: readonly string[];
  readonly terms: readonly string[];
}

export interface ImposeSanctionRequest {
  readonly imposedBy: string;
  readonly on: string;
  readonly scope: SanctionScope;
  readonly reason: string;
}

export interface DeclareShockRequest {
  readonly id: string;
  readonly kind: ShockKind;
  readonly summary: string;
  readonly affectedCountryIds: readonly string[];
  readonly magnitude: number;
  /** The declared route per country. Defaults to the full cascade. */
  readonly channels: Readonly<Record<string, readonly ShockChannel[]>>;
  readonly originCountryId?: string;
}

export class InternationalEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  /** False for read-only handles, which must not claim the state slot. */
  private readonly claimsState: boolean;

  constructor(
    scope: SystemScope,
    world: WorldState,
    options?: { readonly readOnly?: boolean },
  ) {
    this.scope = scope;
    this.world = world;
    this.claimsState = options?.readOnly !== true;
    if (this.claimsState && !this.world.systems.international) {
      this.scope.assertOwner("international");
      this.world.systems.international = emptyInternationalState();
    }
  }

  /**
   * A handle for reading international state without the right to claim it.
   *
   * Constructing the engine normally initializes `systems.international`, which
   * is a *write*. Read paths ("is there pressure on this country?", "what
   * sanctions are in force?") must not need a mutation scope, and must not fail
   * loudly on a world where nothing has ever been signed.
   */
  static peek(scope: SystemScope, world: WorldState): InternationalEngine {
    return new InternationalEngine(scope, world, { readOnly: true });
  }

  private get state(): InternationalSystemState {
    const raw = this.world.systems.international as Partial<InternationalSystemState> | undefined;
    if (raw === undefined) return emptyInternationalState();
    return {
      standings: raw.standings ?? [],
      treaties: raw.treaties ?? [],
      sanctions: raw.sanctions ?? [],
      shocks: raw.shocks ?? [],
      migration: raw.migration ?? [],
      organizations: raw.organizations ?? [],
      history: raw.history ?? [],
    };
  }

  private set state(value: InternationalSystemState) {
    if (!this.claimsState) {
      throw new Error(
        "InternationalEngine: this is a read-only handle (InternationalEngine.peek); " +
          "open an international mutation scope and construct the engine normally to write.",
      );
    }
    this.world.systems.international = value;
  }

  // ---------------------------------------------------------------- reads ---

  standings(): readonly BilateralStanding[] {
    return this.state.standings;
  }

  treaties(): readonly Treaty[] {
    return this.state.treaties;
  }

  treaty(id: string): Treaty | undefined {
    return this.state.treaties.find((entry) => entry.id === id);
  }

  requireTreaty(id: string, caller: string): Treaty {
    const found = this.treaty(id);
    if (found === undefined) {
      throw new Error(`InternationalEngine.${caller}: unknown treaty ${id}`);
    }
    return found;
  }

  activeTreaties(): readonly Treaty[] {
    return this.state.treaties.filter((entry) => entry.status === "active");
  }

  sanctions(): readonly Sanction[] {
    return this.state.sanctions;
  }

  shocks(): readonly GlobalShock[] {
    return this.state.shocks;
  }

  shock(id: string): GlobalShock | undefined {
    return this.state.shocks.find((entry) => entry.id === id);
  }

  migration(): readonly MigrationPressure[] {
    return this.state.migration;
  }

  organizations(): readonly InternationalOrganization[] {
    return this.state.organizations;
  }

  history(): readonly InternationalHistoryEntry[] {
    return this.state.history;
  }

  /**
   * The stable key for a country pair, sorted so A|B and B|A are the same pair.
   * Without this, the same two countries could acquire two opposing records and
   * "what is their standing" would have two correct answers.
   */
  static pairId(countryA: string, countryB: string): string {
    return [countryA, countryB].sort().join("|");
  }

  // -------------------------------------------------------------- derived ---

  /**
   * One pair's standing, domain by domain.
   *
   * The mean is over the domains *actually recorded*, and a domain nobody has
   * assessed reads `undefined` rather than 0 — an unmeasured relationship is not
   * a neutral one, and averaging it in as zero would quietly make an unknown
   * pair look hostile.
   */
  standingBetween(countryA: string, countryB: string): StandingReading {
    const pairId = InternationalEngine.pairId(countryA, countryB);
    const [first = countryA, second = countryB] = [countryA, countryB].sort();
    const byDomain = {} as Record<RelationDomain, number | undefined>;
    let total = 0;
    let measured = 0;
    for (const domain of RELATION_DOMAINS) {
      const record = this.state.standings.find(
        (entry) => entry.pairId === pairId && entry.domain === domain,
      );
      byDomain[domain] = record?.standing;
      if (record !== undefined) {
        total += record.standing;
        measured += 1;
      }
    }
    return {
      pairId,
      countryA: first,
      countryB: second,
      byDomain,
      overall: measured === 0 ? undefined : round4(total / measured),
      measuredDomains: measured,
    };
  }

  /**
   * Whether trade between two countries can happen, and what is in the way.
   *
   * Reports the *condition* and names the instrument, then stops. It never
   * adjusts a volume or a price: System 35 forms those from its own inputs, and
   * this system's contribution is to make the reason available to it. An active
   * trade or energy sanction in either direction blocks, and a trade agreement
   * in force names itself as support — so a reader can see *both* the obstacle
   * and the standing treaty at the same time, which is often the whole story.
   */
  tradeConditions(countryA: string, countryB: string, at: WorldTime): TradeConditions {
    const reasons: string[] = [];
    for (const sanction of this.state.sanctions) {
      if (!sanction.active || sanction.liftedAt !== undefined) continue;
      if (sanction.scope !== "trade" && sanction.scope !== "energy") continue;
      const applies =
        (sanction.imposedBy === countryA && sanction.on === countryB) ||
        (sanction.imposedBy === countryB && sanction.on === countryA);
      if (applies) {
        reasons.push(`${sanction.scope} sanction ${sanction.id} (${sanction.reason})`);
      }
    }
    const treaty = this.activeTreaties().find(
      (entry) =>
        entry.kind === "trade_agreement" &&
        entry.partyIds.includes(countryA) &&
        entry.partyIds.includes(countryB),
    );
    // A suspended treaty still lists the countries, so `activeTreaties` is the
    // filter that decides, and a withdrawn one contributes nothing at all.
    return {
      countryA,
      countryB,
      at,
      blocked: reasons.length > 0,
      reasons,
      ...(treaty === undefined ? {} : { supportedByTreatyId: treaty.id }),
    };
  }

  /**
   * What a declared shock is expected to do to one country, and by which route.
   *
   * The cascade is *declared*, per country, and this method only reads it. It
   * deliberately does not walk into markets, businesses, supply chains,
   * employment or households: those are five other systems, and a "helpful"
   * shock engine that applied them all would be an unowned second copy of each.
   */
  shockExposure(
    shockId: string,
    countryId: string,
  ): { readonly exposed: boolean; readonly channels: readonly ShockChannel[]; readonly magnitude: number } {
    const shock = this.shock(shockId);
    if (shock === undefined) {
      throw new Error(`InternationalEngine.shockExposure: unknown shock ${shockId}`);
    }
    const exposed = shock.affectedCountryIds.includes(countryId);
    const channels = shock.channels[countryId] ?? [];
    const declared: ShockChannel[] = [];
    for (const channel of channels) {
      if (SHOCK_CHANNELS.includes(channel)) declared.push(channel);
    }
    return { exposed, channels: declared, magnitude: exposed ? shock.magnitude : 0 };
  }

  // --------------------------------------------------------------- writes ---

  /**
   * Records how two countries stand, in one domain.
   *
   * A pair gets one record per domain, and the pair key is sorted so the same
   * two countries cannot end up with two opposing records for the same domain.
   * Being close allies and savage competitors is a normal, interesting state —
   * not a contradiction to be resolved into a single number.
   */
  recordStanding(request: RecordStandingRequest, at: WorldTime, ids: IdAllocator): BilateralStanding {
    if (request.countryA === request.countryB) {
      throw new Error("InternationalEngine.recordStanding: a country cannot stand with itself");
    }
    this.scope.assertOwner("international");
    const pairId = InternationalEngine.pairId(request.countryA, request.countryB);
    const [first = request.countryA, second = request.countryB] = [request.countryA, request.countryB].sort();
    const record: BilateralStanding = {
      pairId,
      countryA: first,
      countryB: second,
      domain: request.domain,
      standing: requireSigned(request.standing, "standing", "recordStanding"),
      at,
      ...(request.note === undefined ? {} : { note: request.note }),
    };
    this.state = {
      ...this.state,
      standings: [
        ...this.state.standings.filter(
          (entry) => !(entry.pairId === pairId && entry.domain === request.domain),
        ),
        record,
      ],
    };
    this.appendHistory("standing", `${request.domain} standing recorded`, at, ids, [first, second]);
    return record;
  }

  /**
   * Signs a treaty. Two parties minimum — a treaty that cannot exist is refused
   * rather than stored as a curiosity.
   */
  signTreaty(request: SignTreatyRequest, at: WorldTime, ids: IdAllocator): Treaty {
    const existing = this.treaty(request.id);
    if (existing !== undefined) return existing;
    if (request.partyIds.length < 2) {
      throw new Error(
        `InternationalEngine.signTreaty: ${request.id} has ${request.partyIds.length} party; ` +
          "a treaty needs at least two",
      );
    }
    this.scope.assertOwner("international");
    const treaty: Treaty = {
      id: request.id,
      kind: request.kind,
      partyIds: [...new Set(request.partyIds)],
      signedAt: at,
      terms: [...request.terms],
      status: "active",
    };
    this.state = { ...this.state, treaties: [...this.state.treaties, treaty] };
    this.appendHistory(
      "treaty_signed",
      `${request.kind} ${request.id} signed`,
      at,
      ids,
      treaty.partyIds,
    );
    return treaty;
  }

  /**
   * Suspends or withdraws a treaty, with a reason.
   *
   * The record survives with its terms and its end date, because "we were party
   * to this until we were not" is a fact about the past. A suspended treaty still
   * lists its parties; what it no longer has is force, and `activeTreaties` is
   * the single place that decides.
   */
  endTreaty(
    treatyId: string,
    status: Exclude<TreatyStatus, "active">,
    reason: string,
    at: WorldTime,
    ids: IdAllocator,
  ): Treaty {
    const current = this.requireTreaty(treatyId, "endTreaty");
    if (current.status !== "active") return current;
    if (reason.trim().length === 0) {
      throw new Error(`InternationalEngine.endTreaty: ending ${treatyId} must say why`);
    }
    this.scope.assertOwner("international");
    const ended: Treaty = { ...current, status, endedReason: reason, endedAt: at };
    this.state = {
      ...this.state,
      treaties: this.state.treaties.map((entry) => (entry.id === treatyId ? ended : entry)),
    };
    this.appendHistory(
      "treaty_ended",
      `${treatyId} ${status}: ${reason}`,
      at,
      ids,
      current.partyIds,
    );
    return ended;
  }

  /**
   * Imposes a sanction, or lifts one. A sanction is a *condition* on cross-border
   * activity; the engine records it and never adjusts a price or a volume.
   */
  imposeSanction(request: ImposeSanctionRequest, at: WorldTime, ids: IdAllocator): Sanction {
    if (request.imposedBy === request.on) {
      throw new Error("InternationalEngine.imposeSanction: a country cannot sanction itself");
    }
    this.scope.assertOwner("international");
    const sanction: Sanction = {
      id: `sanc-${ids.next("activity")}`,
      imposedBy: request.imposedBy,
      on: request.on,
      at,
      scope: request.scope,
      reason: request.reason,
      active: true,
    };
    this.state = { ...this.state, sanctions: [...this.state.sanctions, sanction] };
    this.appendHistory(
      "sanction",
      `${request.scope} sanction on ${request.on}: ${request.reason}`,
      at,
      ids,
      [request.imposedBy, request.on],
    );
    return sanction;
  }

  liftSanction(sanctionId: string, at: WorldTime, ids: IdAllocator): Sanction {
    const sanction = this.state.sanctions.find((entry) => entry.id === sanctionId);
    if (sanction === undefined) {
      throw new Error(`InternationalEngine.liftSanction: unknown sanction ${sanctionId}`);
    }
    if (!sanction.active) return sanction;
    this.scope.assertOwner("international");
    const lifted: Sanction = { ...sanction, active: false, liftedAt: at };
    this.state = {
      ...this.state,
      sanctions: this.state.sanctions.map((entry) => (entry.id === sanctionId ? lifted : entry)),
    };
    this.appendHistory("sanction_lifted", `${sanctionId} lifted`, at, ids, [
      sanction.imposedBy,
      sanction.on,
    ]);
    return lifted;
  }

  /**
   * Declares a global shock and the route it is expected to take per country.
   *
   * Every affected country must have a declared channel list, and an empty one is
   * refused: a shock said to affect a country but given no way to reach it is a
   * claim nobody can act on or check.
   */
  declareShock(request: DeclareShockRequest, at: WorldTime, ids: IdAllocator): GlobalShock {
    const existing = this.shock(request.id);
    if (existing !== undefined) return existing;
    if (request.affectedCountryIds.length === 0) {
      throw new Error(
        `InternationalEngine.declareShock: ${request.id} affects nobody, so it is not a shock`,
      );
    }
    for (const countryId of request.affectedCountryIds) {
      if ((request.channels[countryId] ?? []).length === 0) {
        throw new Error(
          `InternationalEngine.declareShock: ${request.id} affects ${countryId} but ` +
            "declares no route into it",
        );
      }
    }
    this.scope.assertOwner("international");
    const shock: GlobalShock = {
      id: request.id,
      at,
      kind: request.kind,
      summary: request.summary,
      affectedCountryIds: [...request.affectedCountryIds],
      magnitude: requireRatio(request.magnitude, "magnitude", "declareShock"),
      channels: Object.fromEntries(
        Object.entries(request.channels).map(([countryId, channels]) => [countryId, [...channels]]),
      ),
      ...(request.originCountryId === undefined
        ? {}
        : { originCountryId: request.originCountryId }),
    };
    this.state = { ...this.state, shocks: [...this.state.shocks, shock] };
    this.appendHistory(
      "shock",
      `${request.kind}: ${request.summary}`,
      at,
      ids,
      request.affectedCountryIds,
    );
    return shock;
  }

  /**
   * Records pressure to migrate toward a country — a tendency with a direction
   * and named causes. Nobody has crossed anything; System 45 owns the crossing,
   * and this engine never records a person as having moved.
   */
  recordMigrationPressure(
    pressure: Omit<MigrationPressure, "at">,
    at: WorldTime,
  ): MigrationPressure {
    if (pressure.fromCountryIds.includes(pressure.countryId)) {
      throw new Error(
        `InternationalEngine.recordMigrationPressure: ${pressure.countryId} cannot be ` +
          "pressured from itself",
      );
    }
    this.scope.assertOwner("international");
    const record: MigrationPressure = {
      countryId: pressure.countryId,
      at,
      fromCountryIds: [...pressure.fromCountryIds],
      pressure: requireRatio(pressure.pressure, "pressure", "recordMigrationPressure"),
      causes: [...pressure.causes],
    };
    this.state = { ...this.state, migration: [...this.state.migration, record] };
    return record;
  }

  /**
   * Records an international organization as a membership list over a System 32
   * organization — a reference, never a second structure with its own members,
   * lifecycle or roles.
   */
  registerOrganization(
    organization: Omit<InternationalOrganization, "foundedAt">,
    at: WorldTime,
  ): InternationalOrganization {
    const existing = this.state.organizations.find((entry) => entry.id === organization.id);
    if (existing !== undefined) return existing;
    this.scope.assertOwner("international");
    const record: InternationalOrganization = { ...organization, foundedAt: at };
    this.state = { ...this.state, organizations: [...this.state.organizations, record] };
    return record;
  }

  private appendHistory(
    kind: string,
    summary: string,
    at: WorldTime,
    ids: IdAllocator,
    countryIds: readonly string[],
  ): void {
    const entry: InternationalHistoryEntry = {
      id: `ih-${ids.next("activity")}`,
      at,
      kind,
      summary,
      countryIds: [...countryIds],
    };
    this.state = { ...this.state, history: [...this.state.history, entry] };
  }

  serialize(): InternationalSystemState {
    return this.state;
  }
}

function requireRatio(value: number, field: string, caller: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`InternationalEngine.${caller}: ${field} must be 0..1, received ${value}`);
  }
  return value;
}

function requireSigned(value: number, field: string, caller: string): number {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new Error(`InternationalEngine.${caller}: ${field} must be in [-1, 1], received ${value}`);
  }
  return value;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

