/**
 * Culture engine (System 44).
 *
 * Owns `systems.culture`: cultural groups, the traditions they carry, who
 * participates in them, and the transmission attempts that carry a tradition
 * from one person or place to the next. Every write asserts ownership on that
 * slot; reads are scope-free.
 *
 * Three decisions in here are the reason this is not a personality system:
 *
 *   - **Strength is never stored.** `traditionStrength()` derives it from the
 *     participation on record and reports its own `sampleSize`/`confidence`, so
 *     a thinly materialized community says so instead of looking unanimous.
 *   - **Exposure is not adoption.** `transmit()` records whether a tradition
 *     reached someone; becoming a participant is something the person does (or
 *     something a caller observes), not something culture decides for them.
 *   - **Conflict is structural.** Two traditions of the same kind claiming the
 *     same domain in the same place is a norm conflict, and it is found by
 *     looking, not by authoring a table of enemies.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { RandomSource } from "../rng/distributions.ts";
import {
  PARTICIPATION_LEVELS,
  PARTICIPATION_WEIGHTS,
  PATHWAY_STRENGTH,
  type Availability,
  type CulturalGroup,
  type CulturalGroupKind,
  type CulturalInfluence,
  type CultureSystemState,
  type CommunityHistoryEntry,
  type GenerationalChange,
  type GroupProfile,
  type MixingIndex,
  type MixingProfile,
  type NormConflict,
  type Participation,
  type ParticipationLevel,
  type Tradition,
  type TraditionKind,
  type TraditionReading,
  type TraditionState,
  type TransmissionDrivers,
  type TransmissionPathway,
  type TransmissionRecord,
  emptyCultureState,
} from "./types.ts";

/**
 * Sample size at which a tradition reading stops being noticeably sample-limited.
 * Provisional — see docs/CONTENT_GAPS.md.
 */
const CONFIDENCE_SATURATION = 12;

/** A contested tradition is half as likely to be taken up as a settled one. */
const CONTESTED_TRANSMISSION_FACTOR = 0.5;

export interface RegisterGroupRequest {
  readonly id: string;
  readonly name: string;
  readonly kind: CulturalGroupKind;
  readonly locationId?: string;
  readonly religionId?: string;
  readonly organizationId?: string;
  readonly note?: string;
}

export interface RegisterTraditionRequest {
  readonly id: string;
  readonly groupId: string;
  readonly name: string;
  readonly kind: TraditionKind;
  /** The situation this tradition governs; drives norm-conflict detection. */
  readonly domain: string;
  readonly state?: TraditionState;
}

export interface SetParticipationRequest {
  readonly personId: string;
  readonly groupId: string;
  readonly level: ParticipationLevel;
  /** Required for `situational`: participation in an occasion, not a standing identity. */
  readonly context?: string;
}

export interface TransmitRequest {
  readonly toPersonId: string;
  readonly traditionId: string;
  readonly pathway: TransmissionPathway;
  /** How much contact the pathway actually had, 0..1, supplied by the caller. */
  readonly exposure: number;
  /** The holder transmitting, when there is a specific one. */
  readonly fromPersonId?: string;
  /** The group through which the exposure happened. */
  readonly viaGroupId?: string;
  /**
   * Explicit holder strength, 0..1. Required when there is no `fromPersonId` —
   * a noticeboard transmits without a holder, and the engine will not invent
   * how persuasive it was.
   */
  readonly intensity?: number;
}

export class CultureEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;
  /**
   * Injected rather than reached for, so a transmission roll is reproducible
   * from the world's serialized RNG state rather than from ambient randomness.
   * Absent means this engine can answer questions but cannot record a
   * transmission: inventing a probability source would quietly break
   * determinism, so `transmit()` refuses instead.
   */
  private readonly random?: RandomSource;

  constructor(scope: SystemScope, world: WorldState, random?: RandomSource) {
    this.scope = scope;
    this.world = world;
    this.random = random;
    if (!this.world.systems.culture) {
      this.scope.assertOwner("culture");
      this.world.systems.culture = emptyCultureState();
    }
  }

  private get state(): CultureSystemState {
    return this.world.systems.culture as CultureSystemState;
  }

  private set state(value: CultureSystemState) {
    this.world.systems.culture = value;
  }

  // ---------------------------------------------------------------- reads ---

  groups(): readonly CulturalGroup[] {
    return this.state.groups;
  }

  group(id: string): CulturalGroup | undefined {
    return this.state.groups.find((entry) => entry.id === id);
  }

  requireGroup(id: string, caller: string): CulturalGroup {
    const found = this.group(id);
    if (found === undefined) {
      throw new Error(`CultureEngine.${caller}: unknown cultural group ${id}`);
    }
    return found;
  }

  traditions(): readonly Tradition[] {
    return this.state.traditions;
  }

  tradition(id: string): Tradition | undefined {
    return this.state.traditions.find((entry) => entry.id === id);
  }

  requireTradition(id: string, caller: string): Tradition {
    const found = this.tradition(id);
    if (found === undefined) {
      throw new Error(`CultureEngine.${caller}: unknown tradition ${id}`);
    }
    return found;
  }

  traditionsOf(groupId: string): readonly Tradition[] {
    return this.state.traditions.filter((entry) => entry.groupId === groupId);
  }

  /** Every participation record a person holds, groups included. */
  participationOf(personId: string): readonly Participation[] {
    return this.state.participation.filter((entry) => entry.personId === personId);
  }

  participationIn(personId: string, groupId: string): Participation | undefined {
    return this.state.participation.find(
      (entry) => entry.personId === personId && entry.groupId === groupId,
    );
  }

  participantsOf(groupId: string): readonly string[] {
    return this.state.participation
      .filter((entry) => entry.groupId === groupId)
      .map((entry) => entry.personId);
  }

  transmissions(): readonly TransmissionRecord[] {
    return this.state.transmissions;
  }

  transmissionsOf(traditionId: string): readonly TransmissionRecord[] {
    return this.state.transmissions.filter((entry) => entry.traditionId === traditionId);
  }

  communityHistory(groupId?: string): readonly CommunityHistoryEntry[] {
    return groupId === undefined
      ? this.state.communityHistory
      : this.state.communityHistory.filter((entry) => entry.groupId === groupId);
  }

  // -------------------------------------------------------------- derived ---

  /**
   * How likely a transmission is, and why.
   *
   * Pathway strength, exposure and holder intensity multiply; a contested
   * tradition is damped. The factors come back in the order they were applied,
   * so a number can always be explained rather than trusted.
   *
   * This is pure: it asks what *would* happen and answers without drawing
   * anything, which is what makes the factors inspectable in a test.
   */
  resolveTransmission(request: TransmitRequest): TransmissionDrivers {
    const tradition = this.requireTradition(request.traditionId, "resolveTransmission");
    const pathway = PATHWAY_STRENGTH[request.pathway];
    const exposure = requireRatio(request.exposure, "exposure", "resolveTransmission");
    const holder = this.holderIntensity(request, tradition);
    const contested = tradition.state === "contested";
    const product = contested
      ? pathway * exposure * holder * CONTESTED_TRANSMISSION_FACTOR
      : pathway * exposure * holder;
    return {
      probability: round4(clamp01(product)),
      drivers: [
        `pathway:${request.pathway}=${pathway.toFixed(2)}`,
        `exposure=${exposure.toFixed(2)}`,
        `holder=${holder.toFixed(2)}`,
        ...(contested ? [`contested:x${CONTESTED_TRANSMISSION_FACTOR}`] : []),
      ],
    };
  }

  /**
   * A holder transmits in proportion to how they actually hold the tradition.
   *
   * Someone who is not a participant in the tradition's group transmits nothing
   * — the answer is 0 rather than an error, because "they are not a carrier of
   * this" is a fact, not a mistake. A transmission with no holder at all (a
   * noticeboard, a broadcast) must say how persuasive it was, so the engine
   * refuses to guess.
   */
  private holderIntensity(request: TransmitRequest, tradition: Tradition): number {
    if (request.fromPersonId !== undefined) {
      const record = this.participationIn(request.fromPersonId, tradition.groupId);
      return record === undefined ? 0 : PARTICIPATION_WEIGHTS[record.level];
    }
    if (request.intensity === undefined) {
      throw new Error(
        `CultureEngine.resolveTransmission: ${request.traditionId} was exposed via ` +
          `${request.pathway} with neither a holder nor an explicit intensity; ` +
          "a transmission with no holder must state how strong it was",
      );
    }
    return requireRatio(request.intensity, "intensity", "resolveTransmission");
  }

  /**
   * How firmly a group's members hold a tradition.
   *
   * The mean participation weight across *every* record on the group, `none`
   * included: one enthusiast among nine non-participants is a weak tradition,
   * and averaging only the enthusiasts would make it look unanimous.
   */
  traditionStrength(traditionId: string): TraditionReading {
    const tradition = this.requireTradition(traditionId, "traditionStrength");
    const byLevel = emptyLevels();
    let sampleSize = 0;
    let weighted = 0;
    for (const record of this.state.participation) {
      if (record.groupId !== tradition.groupId) continue;
      byLevel[record.level] += 1;
      sampleSize += 1;
      weighted += PARTICIPATION_WEIGHTS[record.level];
    }
    return {
      traditionId,
      strength: sampleSize === 0 ? 0 : round4(weighted / sampleSize),
      sampleSize,
      confidence: round4(clamp01(sampleSize / CONFIDENCE_SATURATION)),
      contested: tradition.state === "contested",
      byLevel,
    };
  }

  /**
   * How much a tradition leans on a decision — a weight, never a verdict.
   *
   * The spec is explicit that culture "influences decisions and expression
   * without determining behavior", so this returns a bounded number with its
   * evidence attached and no way to act on it. Deciding what to do is System 16's
   * job, and a contested tradition leans more gently than a settled one.
   */
  influence(traditionId: string): CulturalInfluence {
    const reading = this.traditionStrength(traditionId);
    return {
      traditionId,
      influence: round4(
        clamp01(
          reading.contested ? reading.strength * CONTESTED_TRANSMISSION_FACTOR : reading.strength,
        ),
      ),
      sampleSize: reading.sampleSize,
      confidence: reading.confidence,
      contested: reading.contested,
    };
  }

  /** A community's shape, including how lopsided its participation is. */
  groupProfile(groupId: string): GroupProfile {
    this.requireGroup(groupId, "groupProfile");
    const byLevel = emptyLevels();
    for (const record of this.state.participation) {
      if (record.groupId !== groupId) continue;
      byLevel[record.level] += 1;
    }
    let dominant: ParticipationLevel | undefined;
    for (const level of PARTICIPATION_LEVELS) {
      if (byLevel[level] === 0) continue;
      if (dominant === undefined || byLevel[level] > byLevel[dominant]) dominant = level;
    }
    return {
      groupId,
      participants: PARTICIPATION_LEVELS.reduce((sum, level) => sum + byLevel[level], 0),
      byLevel,
      dominant,
      traditionCount: this.traditionsOf(groupId).length,
      evenness: evennessOf(byLevel),
    };
  }

  /**
   * What one person carries, and whether it comes from more than one group.
   *
   * Mixing is a property of a *person*, not of two groups: a community is mixed
   * when its members hold traditions from more than one source, and no amount of
   * overlap between two group definitions would tell you that. Records at level
   * `none` are excluded — a person who has said they do not take part is not
   * carrying the tradition.
   */
  mixingFor(personId: string): MixingProfile {
    const records = this.participationOf(personId).filter((entry) => entry.level !== "none");
    const groupIds = [...new Set(records.map((entry) => entry.groupId))];
    return {
      personId,
      groupIds,
      traditionIds: groupIds.flatMap((groupId) => this.traditionsOf(groupId).map((t) => t.id)),
      multiGroup: groupIds.length > 1,
    };
  }

  /** How mixed a place is, from the participation actually on record there. */
  mixingIndex(locationId: string): MixingIndex {
    const personIds = new Set<string>();
    for (const group of this.state.groups) {
      if (group.locationId !== locationId) continue;
      for (const personId of this.participantsOf(group.id)) personIds.add(personId);
    }
    let multiGroupCount = 0;
    for (const personId of personIds) {
      if (this.mixingFor(personId).multiGroup) multiGroupCount += 1;
    }
    return {
      locationId,
      participants: personIds.size,
      multiGroupCount,
      index: personIds.size === 0 ? 0 : round4(multiGroupCount / personIds.size),
    };
  }

  /**
   * What a person carries, and how firmly, tradition by tradition.
   *
   * Belonging to a group carries that group's traditions at the weight of the
   * person's participation level, so a member who has gone from strong to mixed
   * has not lost the tradition — they hold it more weakly. Without this,
   * membership would be all-or-nothing and every generation would either keep a
   * tradition whole or drop it outright, with nothing in between to explain.
   */
  carryingFor(personId: string): Readonly<Record<string, number>> {
    const carried: Record<string, number> = {};
    for (const record of this.participationOf(personId)) {
      const weight = PARTICIPATION_WEIGHTS[record.level];
      if (weight <= 0) continue;
      for (const tradition of this.traditionsOf(record.groupId)) {
        carried[tradition.id] = weight;
      }
    }
    return carried;
  }

  /**
   * How much of one generation's tradition the next kept.
   *
   * Persistence is not a quality worn away across generations by a hidden
   * modifier (architectural law 12): it is the mean share of the older holder's
   * *carrying* that the younger keeps. A tradition held more weakly scores
   * between 0 and 1, an outright absence scores 0, and both weights are reported
   * so a decline can be read off the record rather than inferred.
   */
  generationalChange(olderPersonId: string, youngerPersonId: string): GenerationalChange {
    const older = this.carryingFor(olderPersonId);
    const younger = this.carryingFor(youngerPersonId);
    const weights: Record<string, { older: number; younger: number }> = {};
    let kept = 0;
    for (const [traditionId, olderWeight] of Object.entries(older)) {
      const youngerWeight = younger[traditionId] ?? 0;
      weights[traditionId] = { older: olderWeight, younger: youngerWeight };
      kept += youngerWeight;
    }
    const olderIds = Object.keys(older).sort();
    const youngerIds = Object.keys(younger).sort();
    return {
      olderPersonId,
      youngerPersonId,
      retained: olderIds.filter((id) => (younger[id] ?? 0) > 0),
      dropped: olderIds.filter((id) => (younger[id] ?? 0) === 0),
      adopted: youngerIds.filter((id) => (older[id] ?? 0) === 0),
      persistence: olderIds.length === 0 ? 0 : round4(kept / olderIds.length),
      weights,
    };
  }

  /**
   * Traditions that cannot both be complied with here.
   *
   * A conflict is not a list of enemies: it is two live traditions of the same
   * kind claiming the same situation in the same place, which is why it is found
   * by looking rather than authored. Retired traditions are excluded — nobody is
   * being asked to follow them any more — and two traditions from the *same*
   * group are not a conflict, since one community can hold both.
   */
  normConflicts(locationId: string): readonly NormConflict[] {
    interface Bucket {
      readonly kind: TraditionKind;
      readonly domain: string;
      readonly items: { traditionId: string; groupId: string; groupName: string }[];
    }
    const buckets = new Map<string, Bucket>();
    for (const group of this.state.groups) {
      if (group.locationId !== locationId) continue;
      for (const tradition of this.traditionsOf(group.id)) {
        if (tradition.state === "retired") continue;
        const key = `${tradition.kind}|${tradition.domain}`;
        const bucket = buckets.get(key) ?? { kind: tradition.kind, domain: tradition.domain, items: [] };
        bucket.items.push({ traditionId: tradition.id, groupId: group.id, groupName: group.name });
        buckets.set(key, bucket);
      }
    }
    return [...buckets.values()]
      .filter((bucket) => new Set(bucket.items.map((item) => item.groupId)).size > 1)
      .map((bucket) => ({
        locationId,
        kind: bucket.kind,
        domain: bucket.domain,
        traditions: bucket.items,
      }))
      .sort((a, b) =>
        a.kind === b.kind ? a.domain.localeCompare(b.domain) : a.kind.localeCompare(b.kind),
      );
  }

  /**
   * What a place makes available to someone arriving there.
   *
   * Availability is a menu, not an assignment: migration changes which traditions
   * are on offer at a place, and it takes participation — a choice, or something
   * observed — before a newcomer holds one.
   */
  availableAt(locationId: string): Availability {
    const groupIds = this.state.groups
      .filter((group) => group.locationId === locationId)
      .map((group) => group.id);
    return {
      locationId,
      groupIds,
      traditionIds: groupIds.flatMap((groupId) =>
        this.traditionsOf(groupId)
          .filter((tradition) => tradition.state !== "retired")
          .map((tradition) => tradition.id),
      ),
    };
  }

  // --------------------------------------------------------------- writes ---

  /**
   * Registers a cultural group, or returns the existing one untouched.
   *
   * Idempotent by id rather than replace-by-id: re-seeding must not rewrite
   * history, and a group that already exists is the same group.
   */
  registerGroup(request: RegisterGroupRequest, at: WorldTime): CulturalGroup {
    const existing = this.group(request.id);
    if (existing !== undefined) return existing;
    this.scope.assertOwner("culture");
    const group: CulturalGroup = {
      id: request.id,
      name: request.name,
      kind: request.kind,
      foundedAt: at,
      ...(request.locationId === undefined ? {} : { locationId: request.locationId }),
      ...(request.religionId === undefined ? {} : { religionId: request.religionId }),
      ...(request.organizationId === undefined ? {} : { organizationId: request.organizationId }),
      ...(request.note === undefined ? {} : { note: request.note }),
    };
    this.state = { ...this.state, groups: [...this.state.groups, group] };
    return group;
  }

  /** Registers a tradition, or returns the existing one untouched. */
  registerTradition(request: RegisterTraditionRequest, at: WorldTime): Tradition {
    const existing = this.tradition(request.id);
    if (existing !== undefined) return existing;
    this.requireGroup(request.groupId, "registerTradition");
    this.scope.assertOwner("culture");
    const tradition: Tradition = {
      id: request.id,
      groupId: request.groupId,
      name: request.name,
      kind: request.kind,
      domain: request.domain,
      state: request.state ?? "established",
      originAt: at,
    };
    this.state = { ...this.state, traditions: [...this.state.traditions, tradition] };
    return tradition;
  }

  /**
   * Records how strongly someone takes part, upserted per person+group.
   *
   * The original `since` is kept when the level changes, because a person who
   * took part weakly for ten years and then strongly has been here ten years —
   * tenure should not reset just because the intensity moved. A `situational`
   * record must name its occasion, or a single attendance would quietly become a
   * standing identity.
   */
  setParticipation(request: SetParticipationRequest, at: WorldTime): Participation {
    this.requireGroup(request.groupId, "setParticipation");
    if (request.level === "situational" && request.context === undefined) {
      throw new Error(
        `CultureEngine.setParticipation: ${request.personId} takes part in ` +
          `${request.groupId} "situational" with no occasion given`,
      );
    }
    const previous = this.participationIn(request.personId, request.groupId);
    this.scope.assertOwner("culture");
    const record: Participation = {
      personId: request.personId,
      groupId: request.groupId,
      level: request.level,
      since: previous?.since ?? at,
      ...(request.context === undefined ? {} : { context: request.context }),
    };
    this.state = {
      ...this.state,
      participation: [
        ...this.state.participation.filter(
          (entry) => !(entry.personId === request.personId && entry.groupId === request.groupId),
        ),
        record,
      ],
    };
    return record;
  }

  /**
   * Removes a participation record entirely.
   *
   * The transmission history stays: someone who walked away from a community
   * still carried it for a while, and that is part of what happened.
   */
  withdraw(personId: string, groupId: string): boolean {
    if (this.participationIn(personId, groupId) === undefined) return false;
    this.scope.assertOwner("culture");
    this.state = {
      ...this.state,
      participation: this.state.participation.filter(
        (entry) => !(entry.personId === personId && entry.groupId === groupId),
      ),
    };
    return true;
  }

  /**
   * Moves a tradition through its lifecycle.
   *
   * Retiring one does not delete it: the record that it was once held, and every
   * transmission of it, stay on file, because a tradition's passing is itself
   * part of what happened to the people who kept it.
   */
  setTraditionState(traditionId: string, state: TraditionState): Tradition {
    const current = this.requireTradition(traditionId, "setTraditionState");
    if (current.state === state) return current;
    this.scope.assertOwner("culture");
    const next: Tradition = { ...current, state };
    this.state = {
      ...this.state,
      traditions: this.state.traditions.map((entry) => (entry.id === traditionId ? next : entry)),
    };
    return next;
  }

  /**
   * Records one exposure of a tradition to one person, and whether it took.
   *
   * Acceptance means the tradition *reached* them, not that they now hold it:
   * uptake is the person's own business, so whoever observes adherence sets
   * participation separately. Refuses to roll without an injected source rather
   * than reaching for ambient randomness, which would break reproducibility.
   */
  transmit(request: TransmitRequest, ids: IdAllocator, at: WorldTime): TransmissionRecord {
    if (this.random === undefined) {
      throw new Error(
        "CultureEngine.transmit: no RandomSource was injected. Pass the world's " +
          "RNG stream, or use resolveTransmission() to ask what would happen.",
      );
    }
    this.requireTradition(request.traditionId, "transmit");
    const { probability } = this.resolveTransmission(request);
    const roll = this.random.nextFloat();
    const record: TransmissionRecord = {
      id: `tx-${ids.next("activity")}`,
      at,
      toPersonId: request.toPersonId,
      traditionId: request.traditionId,
      pathway: request.pathway,
      probability,
      accepted: roll < probability,
      roll,
      ...(request.fromPersonId === undefined ? {} : { fromPersonId: request.fromPersonId }),
      ...(request.viaGroupId === undefined ? {} : { viaGroupId: request.viaGroupId }),
    };
    this.scope.assertOwner("culture");
    this.state = { ...this.state, transmissions: [...this.state.transmissions, record] };
    return record;
  }

  /** Appends a note to a community's own history. */
  noteHistory(
    groupId: string,
    summary: string,
    ids: IdAllocator,
    at: WorldTime,
  ): CommunityHistoryEntry {
    this.requireGroup(groupId, "noteHistory");
    this.scope.assertOwner("culture");
    const entry: CommunityHistoryEntry = { id: `ch-${ids.next("activity")}`, at, groupId, summary };
    this.state = {
      ...this.state,
      communityHistory: [...this.state.communityHistory, entry],
    };
    return entry;
  }

  serialize(): CultureSystemState {
    return this.state;
  }
}

function emptyLevels(): Record<ParticipationLevel, number> {
  const levels = {} as Record<ParticipationLevel, number>;
  for (const level of PARTICIPATION_LEVELS) levels[level] = 0;
  return levels;
}

function requireRatio(value: number, field: string, caller: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`CultureEngine.${caller}: ${field} must be 0..1, received ${value}`);
  }
  return value;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Pielou's evenness: 0 when participation sits in one level, 1 when spread evenly. */
function evennessOf(byLevel: Readonly<Record<ParticipationLevel, number>>): number {
  const total = PARTICIPATION_LEVELS.reduce((sum, level) => sum + byLevel[level], 0);
  if (total === 0) return 0;
  let entropy = 0;
  for (const level of PARTICIPATION_LEVELS) {
    const share = byLevel[level] / total;
    if (share > 0) entropy -= share * Math.log(share);
  }
  return round4(entropy / Math.log(PARTICIPATION_LEVELS.length));
}

