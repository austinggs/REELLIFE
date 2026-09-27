/**
 * Information engine (System 49).
 *
 * Owns `systems.information`: the node/link graph, claims with their
 * provenance and verification state, channels, exposures and moderation
 * records. Every write asserts ownership on that slot; reads are scope-free.
 *
 * The engine's discipline, restated because it is the whole point:
 * publishing a claim records that someone said something; propagating it
 * records who was *reached*; verifying it records a dated method and an
 * evidence reference. None of those three is the others, and none of them is
 * truth â€” which lives in whatever system owns the claim's subject.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import {
  LINK_KINDS,
  MODERATION_ACTIONS,
  ORIGIN_KINDS,
  PROPAGATION,
  VERACITY_STATUSES,
  type Channel,
  type ClaimSubject,
  type Exposure,
  type CirculatingClaim,
  type InformationNode,
  type InformationSystemState,
  type LinkKind,
  type ModerationActionKind,
  type ModerationRecord,
  type OriginKind,
  type SpreadResult,
  type VeracityStatus,
} from "./types.ts";

export interface PublishClaimRequest {
  readonly id: string;
  readonly subject: ClaimSubject;
  readonly text: string;
  readonly createdBy: string;
  readonly origin: OriginKind;
  readonly sourceCredibility: number;
  readonly novelty: number;
  readonly emotionalCharge: number;
  readonly audience?: "public" | "private" | "closed";
  /** Provenance when this is a copy of another claim. */
  readonly derivedFromClaimId?: string;
}

export interface DefineChannelRequest {
  readonly id: string;
  readonly kind: Channel["kind"];
  readonly name: string;
  readonly operatorId: string;
  readonly reachBase: number;
  readonly moderated?: boolean;
  readonly audienceIds?: readonly string[];
}

export class InformationEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.information) {
      this.scope.assertOwner("information");
      this.world.systems.information = {
        nodes: [],
        links: [],
        claims: [],
        channels: [],
        exposures: [],
        moderations: [],
      } satisfies InformationSystemState;
    }
  }

  private get state(): InformationSystemState {
    return this.world.systems.information as InformationSystemState;
  }

  private set state(value: InformationSystemState) {
    this.world.systems.information = value;
  }

  // ---------------------------------------------------------------- reads ---

  nodes(): readonly InformationNode[] {
    return this.state.nodes;
  }

  node(id: string): InformationNode | undefined {
    return this.state.nodes.find((candidate) => candidate.id === id);
  }

  requireNode(id: string, caller: string): InformationNode {
    const found = this.node(id);
    if (found === undefined) {
      throw new Error(`InformationEngine.${caller}: unknown node ${id}`);
    }
    return found;
  }

  linksOf(nodeId: string): readonly { readonly to: string; readonly kind: LinkKind }[] {
    return this.state.links
      .filter((link) => link.from === nodeId)
      .map((link) => ({ to: link.to, kind: link.kind }));
  }

  /** The nodes this one is connected to, in either direction. */
  neighboursOf(nodeId: string): readonly string[] {
    return this.state.links
      .filter((link) => link.from === nodeId || link.to === nodeId)
      .map((link) => (link.from === nodeId ? link.to : link.from));
  }

  claims(): readonly CirculatingClaim[] {
    return this.state.claims;
  }

  claim(id: string): CirculatingClaim | undefined {
    return this.state.claims.find((candidate) => candidate.id === id);
  }

  requireClaim(id: string, caller: string): CirculatingClaim {
    const found = this.claim(id);
    if (found === undefined) {
      throw new Error(`InformationEngine.${caller}: unknown claim ${id}`);
    }
    return found;
  }

  /** Claims about one subject â€” the graph's edges, not a text search. */
  claimsAbout(subject: ClaimSubject): readonly CirculatingClaim[] {
    return this.state.claims.filter(
      (claim) => claim.subject.id === subject.id && claim.subject.kind === subject.kind,
    );
  }

  channels(): readonly Channel[] {
    return this.state.channels;
  }

  channel(id: string): Channel | undefined {
    return this.state.channels.find((candidate) => candidate.id === id);
  }

  requireChannel(id: string, caller: string): Channel {
    const found = this.channel(id);
    if (found === undefined) {
      throw new Error(`InformationEngine.${caller}: unknown channel ${id}`);
    }
    return found;
  }

  moderations(): readonly ModerationRecord[] {
    return this.state.moderations;
  }

  exposuresOf(claimId: string): readonly Exposure[] {
    return this.state.exposures.filter((exposure) => exposure.claimId === claimId);
  }

  /** What a node has been *reached* by. Not what it believes. */
  claimsHeardBy(nodeId: string): readonly CirculatingClaim[] {
    const heard = new Set(
      this.state.exposures
        .filter((exposure) => exposure.nodeId === nodeId && exposure.forgottenAt === undefined)
        .map((exposure) => exposure.claimId),
    );
    return this.state.claims.filter((claim) => heard.has(claim.id));
  }

  /**
   * The value a claim carries on one hop, before any node-specific factor.
   *
   * Source credibility, novelty and emotional charge are the spec's own
   * propagation factors, weighted and declared in `PROPAGATION`. Emotional
   * charge is here because the spec names it: charged stories travel further
   * than bland true ones, which is exactly why a loud rumour is not a
   * reliable one.
   */
  carriedValue(claim: CirculatingClaim): number {
    return clamp01(
      PROPAGATION.credibilityWeight * claim.sourceCredibility +
        PROPAGATION.noveltyWeight * claim.novelty +
        PROPAGATION.emotionalWeight * claim.emotionalCharge,
    );
  }

  /**
   * How far a claim has actually got, derived from its exposures.
   */
  reachOf(claimId: string): {
    readonly reached: number;
    readonly forgotten: number;
    readonly sources: readonly string[];
  } {
    const exposures = this.exposuresOf(claimId);
    const live = exposures.filter((exposure) => exposure.forgottenAt === undefined);
    const sources = [...new Set(live.map((exposure) => exposure.viaNodeId ?? exposure.channelId))];
    return { reached: live.length, forgotten: exposures.length - live.length, sources };
  }

  /**
   * The sources a node has heard from â€” the raw material of an information
   * bubble. Two people who have only ever heard from the same two sources
   * will agree far more readily than two who have not, and that agreement
   * is structural, not intellectual.
   */
  sourceSetOf(nodeId: string): readonly string[] {
    const sources = this.state.exposures
      .filter((exposure) => exposure.nodeId === nodeId && exposure.forgottenAt === undefined)
      .map((exposure) => exposure.viaNodeId ?? exposure.channelId);
    return [...new Set(sources)].sort();
  }

  /**
   * Whether a claim may still travel, and why. Removal stops a claim
   * outright; a downrank only weakens it. An unverified claim is *not*
   * stopped â€” the absence of verification is a fact about its status, not a
   * licence to suppress it, and treating the two as the same thing is how a
   * rumour engine becomes a censorship engine.
   */
  isPropagatable(claimId: string): { readonly propagatable: boolean; readonly factor: number; readonly reason: string } {
    const thisClaim = this.requireClaim(claimId, "isPropagatable");
    void thisClaim;
    const records = this.state.moderations
      .filter((record) => record.claimId === claimId && record.action !== "flagged")
      .sort((a, b) => (a.at as number) - (b.at as number));
    const last = records[records.length - 1];
    if (last === undefined) return { propagatable: true, factor: 1, reason: "no moderation in force" };
    if (last.action === "removed") {
      return { propagatable: false, factor: 0, reason: `removed by ${last.by}: ${last.reason}` };
    }
    if (last.action === "downranked") {
      return { propagatable: true, factor: PROPAGATION.downrankFactor, reason: `downranked: ${last.reason}` };
    }
    return { propagatable: true, factor: 1, reason: `restored: ${last.reason}` };
  }

  /**
   * The correction chain: a claim, the claim that corrected it, and the one
   * after that. Corrections chain forwards; disagreements are recorded on
   * both sides, so a dispute is visible from either end.
   */
  correctionChain(claimId: string): readonly CirculatingClaim[] {
    const chain: CirculatingClaim[] = [this.requireClaim(claimId, "correctionChain")];
    const seen = new Set<string>([chain[0]?.id ?? ""]);
    let current = chain[0];
    while (current !== undefined && current.supersedesClaimId !== undefined) {
      const next = this.claim(current.supersedesClaimId);
      if (next === undefined || seen.has(next.id)) break;
      chain.push(next);
      seen.add(next.id);
      current = next;
    }
    return chain;
  }

  /**
   * One wave of propagation: who gets the claim on this channel, computed
   * from the declared factors, the channel's reach and the social graph, and
   * recorded as exposures.
   *
   * Deterministic â€” the same world, claim and channel always reach the same
   * people. That is not how rumours work in life, and it is the price of
   * being able to assert that a rumour spread.
   */
  propagate(claimId: string, channelId: string, at: WorldTime): SpreadResult {
    this.scope.assertOwner("information");
    const claim = this.requireClaim(claimId, "propagate");
    const channel = this.requireChannel(channelId, "propagate");
    const moderation = this.isPropagatable(claimId);
    if (!moderation.propagatable) {
      // A removed claim travels nowhere. That is moderation working, not an
      // error, so the wave is recorded as reaching nobody.
      return {
        claimId,
        channelId,
        at,
        reached: [],
        notReached: [...channel.audienceIds],
        peak: undefined,
      };
    }

    const value = this.carriedValue(claim) * moderation.factor * channel.reachBase;
    const alreadyHeard = new Set(
      this.state.exposures
        .filter((exposure) => exposure.claimId === claimId && exposure.forgottenAt === undefined)
        .map((exposure) => exposure.nodeId),
    );

    // Hop one: the channel's own audience.
    const reached: string[] = [];
    const notReached: string[] = [];
    let peak: { nodeId: string; reach: number } | undefined;
    for (const nodeId of channel.audienceIds) {
      if (alreadyHeard.has(nodeId)) {
        notReached.push(nodeId);
        continue;
      }
      const reach = round4(clamp01(value * this.opennessOf(nodeId, channel.operatorId)));
      if (reach < PROPAGATION.threshold) {
        notReached.push(nodeId);
        continue;
      }
      reached.push(nodeId);
      if (peak === undefined || reach > peak.reach) peak = { nodeId, reach };
    }

    // Hop two: the audience telling the people they know, weaker for being
    // second-hand. Anyone already reached or already in the audience is left
    // to hop one, so a node is never counted twice.
    const audience = new Set(channel.audienceIds);
    const second: { nodeId: string; via: string; reach: number }[] = [];
    for (const teller of reached) {
      for (const other of this.neighboursOf(teller)) {
        if (alreadyHeard.has(other) || audience.has(other) || reached.includes(other)) continue;
        if (second.some((entry) => entry.nodeId === other)) continue;
        const reach = round4(
          clamp01(value * this.opennessOf(other, teller) * PROPAGATION.hopDecay * PROPAGATION.retellDecay),
        );
        if (reach < PROPAGATION.threshold) continue;
        second.push({ nodeId: other, via: teller, reach });
      }
    }

    const exposures: Exposure[] = reached.map((nodeId) => ({
      claimId,
      nodeId,
      at,
      channelId,
      reach: round4(clamp01(value * this.opennessOf(nodeId, channel.operatorId))),
    }));
    for (const entry of second) {
      exposures.push({ claimId, nodeId: entry.nodeId, at, channelId, viaNodeId: entry.via, reach: entry.reach });
    }
    this.state = { ...this.state, exposures: [...this.state.exposures, ...exposures] };

    return {
      claimId,
      channelId,
      at,
      reached: [...reached, ...second.map((entry) => entry.nodeId)],
      notReached,
      peak,
    };
  }

  // --------------------------------------------------------------- writes ---

  /** Registers a node in the information graph. */
  defineNode(node: InformationNode): InformationNode {
    this.scope.assertOwner("information");
    if (this.node(node.id) !== undefined) {
      throw new Error(`InformationEngine.defineNode: node ${node.id} already exists`);
    }
    if (node.credibility !== undefined) {
      requireRatio(node.credibility, "credibility", "defineNode");
    }
    this.state = { ...this.state, nodes: [...this.state.nodes, node] };
    return node;
  }

  /** Links two nodes. Structure only: a link carries no opinion. */
  link(from: string, to: string, kind: LinkKind, at: WorldTime): void {
    this.scope.assertOwner("information");
    if (!LINK_KINDS.includes(kind)) {
      throw new Error(`InformationEngine.link: unknown link kind ${String(kind)}`);
    }
    this.requireNode(from, "link");
    this.requireNode(to, "link");
    if (from === to) {
      throw new Error(`InformationEngine.link: ${from} cannot be linked to itself`);
    }
    if (this.state.links.some((existing) => existing.from === from && existing.to === to && existing.kind === kind)) {
      throw new Error(`InformationEngine.link: ${from} -> ${to} (${kind}) already exists`);
    }
    this.state = { ...this.state, links: [...this.state.links, { from, to, kind, at }] };
  }

  /**
   * Publishes a claim. It starts `unverified` â€” always, including for a
   * "reported" or "official" origin â€” because publishing something is not
   * the same as checking it, and a register that let an official source skip
   * verification would make the origin field a truth oracle.
   */
  publishClaim(request: PublishClaimRequest, at: WorldTime): CirculatingClaim {
    this.scope.assertOwner("information");
    if (this.claim(request.id) !== undefined) {
      throw new Error(`InformationEngine.publishClaim: claim ${request.id} already exists`);
    }
    if (!ORIGIN_KINDS.includes(request.origin)) {
      throw new Error(`InformationEngine.publishClaim: unknown origin ${String(request.origin)}`);
    }
    this.requireNode(request.createdBy, "publishClaim");
    if (request.subject.id.trim().length === 0 || request.text.trim().length === 0) {
      throw new Error(`InformationEngine.publishClaim: ${request.id} must name a subject and a text`);
    }
    requireRatio(request.sourceCredibility, "sourceCredibility", "publishClaim");
    requireRatio(request.novelty, "novelty", "publishClaim");
    requireRatio(request.emotionalCharge, "emotionalCharge", "publishClaim");
    if (request.derivedFromClaimId !== undefined) {
      const source = this.requireClaim(request.derivedFromClaimId, "publishClaim");
      if (source.subject.id !== request.subject.id) {
        throw new Error(
          `InformationEngine.publishClaim: ${request.id} copies ${source.id} but is about a different subject`,
        );
      }
    }
    const claim: CirculatingClaim = {
      id: request.id,
      subject: request.subject,
      text: request.text,
      createdBy: request.createdBy,
      createdAt: at,
      origin: request.origin,
      ...(request.derivedFromClaimId === undefined
        ? {}
        : { derivedFromClaimId: request.derivedFromClaimId }),
      status: "unverified",
      sourceCredibility: request.sourceCredibility,
      novelty: request.novelty,
      emotionalCharge: request.emotionalCharge,
      audience: request.audience ?? "public",
      contradictedByClaimIds: [],
      history: [
        {
          at,
          kind: "published",
          note: `${request.origin} by ${request.createdBy}: ${request.text}`,
        },
      ],
    };
    this.state = { ...this.state, claims: [...this.state.claims, claim] };
    return claim;
  }

  /**
   * Records a verification. The method and the evidence reference are
   * required: "I checked it" is not a verification anyone can audit, and a
   * status change with no evidence is how a rumour becomes a fact by decree.
   */
  verifyClaim(
    claimId: string,
    request: { readonly status: VeracityStatus; readonly method: string; readonly evidenceRef: string },
    at: WorldTime,
  ): CirculatingClaim {
    this.scope.assertOwner("information");
    const claim = this.requireClaim(claimId, "verifyClaim");
    if (!VERACITY_STATUSES.includes(request.status)) {
      throw new Error(`InformationEngine.verifyClaim: unknown status ${String(request.status)}`);
    }
    if (request.status === "unverified") {
      throw new Error("InformationEngine.verifyClaim: a claim cannot be verified as unverified");
    }
    if (request.method.trim().length === 0 || request.evidenceRef.trim().length === 0) {
      throw new Error(
        `InformationEngine.verifyClaim: ${claimId} needs both a method and an evidence reference`,
      );
    }
    const updated: CirculatingClaim = {
      ...claim,
      status: request.status,
      verifiedBy: { at, method: request.method, evidenceRef: request.evidenceRef },
      history: [
        ...claim.history,
        {
          at,
          kind: "verified",
          note: `${request.status} by ${request.method} (${request.evidenceRef})`,
        },
      ],
    };
    return this.replaceClaim(updated);
  }

  /**
   * A correction: the correcting claim names the one it replaces, and the
   * superseded claim keeps its own record. A correction never erases â€” the
   * claim that was believed for three weeks is still part of what happened.
   */
  correctClaim(correctionId: string, supersedesClaimId: string, at: WorldTime): CirculatingClaim {
    this.scope.assertOwner("information");
    const correction = this.requireClaim(correctionId, "correctClaim");
    const superseded = this.requireClaim(supersedesClaimId, "correctClaim");
    if (correction.supersedesClaimId !== undefined) {
      throw new Error(`InformationEngine.correctClaim: ${correctionId} already corrects a claim`);
    }
    if (correction.id === superseded.id) {
      throw new Error("InformationEngine.correctClaim: a claim cannot correct itself");
    }
    if (superseded.status === "verified_true" && correction.status !== "disputed") {
      // Correcting something already verified is a dispute, not a correction.
      throw new Error(
        `InformationEngine.correctClaim: ${supersedesClaimId} is verified true; dispute it instead`,
      );
    }
    const updated: CirculatingClaim = {
      ...correction,
      supersedesClaimId,
      history: [...correction.history, { at, kind: "correction", note: `corrects ${supersedesClaimId}` }],
    };
    this.replaceClaim(updated);
    this.replaceClaim({
      ...superseded,
      status: superseded.status === "unverified" ? superseded.status : "outdated",
      history: [
        ...superseded.history,
        { at, kind: "corrected", note: `corrected by ${correctionId}` },
      ],
    });
    return updated;
  }

  /**
   * Records a disagreement. Both sides are marked, so a dispute is visible
   * from either claim â€” a one-sided record would let a disputed rumour look
   * settled to everyone reading the other claim.
   */
  disputeClaim(claimId: string, otherClaimId: string, at: WorldTime, note: string): CirculatingClaim {
    this.scope.assertOwner("information");
    const claim = this.requireClaim(claimId, "disputeClaim");
    const other = this.requireClaim(otherClaimId, "disputeClaim");
    if (claim.id === other.id) {
      throw new Error("InformationEngine.disputeClaim: a claim cannot dispute itself");
    }
    this.replaceClaim({
      ...other,
      contradictedByClaimIds: [...other.contradictedByClaimIds, claimId],
      history: [...other.history, { at, kind: "disputed", note: `disputed by ${claimId}: ${note}` }],
    });
    return this.replaceClaim({
      ...claim,
      status: "disputed",
      contradictedByClaimIds: [...claim.contradictedByClaimIds, otherClaimId],
      history: [...claim.history, { at, kind: "disputed", note: `disputes ${otherClaimId}: ${note}` }],
    });
  }

  /** Defines a channel: an audience and a reach, not a transport mechanism. */
  defineChannel(request: DefineChannelRequest): Channel {
    this.scope.assertOwner("information");
    if (this.channel(request.id) !== undefined) {
      throw new Error(`InformationEngine.defineChannel: channel ${request.id} already exists`);
    }
    this.requireNode(request.operatorId, "defineChannel");
    requireRatio(request.reachBase, "reachBase", "defineChannel");
    for (const audienceId of request.audienceIds ?? []) {
      this.requireNode(audienceId, "defineChannel");
    }
    const channel: Channel = {
      id: request.id,
      kind: request.kind,
      name: request.name,
      operatorId: request.operatorId,
      reachBase: request.reachBase,
      moderated: request.moderated ?? false,
      audienceIds: [...(request.audienceIds ?? [])],
    };
    this.state = { ...this.state, channels: [...this.state.channels, channel] };
    return channel;
  }

  /**
   * Moderation. A moderator acts on a channel and names a reason, and the
   * record is kept whether or not the moderation was wise â€” an unlogged
   * removal is indistinguishable from a disappearance.
   */
  moderate(
    ids: IdAllocator,
    request: {
      readonly channelId: string;
      readonly claimId: string;
      readonly action: ModerationActionKind;
      readonly reason: string;
      readonly by: string;
    },
    at: WorldTime,
  ): ModerationRecord {
    this.scope.assertOwner("information");
    if (!MODERATION_ACTIONS.includes(request.action)) {
      throw new Error(`InformationEngine.moderate: unknown action ${String(request.action)}`);
    }
    const channel = this.requireChannel(request.channelId, "moderate");
    this.requireClaim(request.claimId, "moderate");
    this.requireNode(request.by, "moderate");
    if (request.reason.trim().length === 0) {
      throw new Error("InformationEngine.moderate: a moderation needs a reason");
    }
    if (!channel.moderated) {
      throw new Error(`InformationEngine.moderate: ${channel.id} is not a moderated channel`);
    }
    const record: ModerationRecord = {
      id: `mod-${ids.next("activity")}`,
      channelId: request.channelId,
      claimId: request.claimId,
      at,
      action: request.action,
      reason: request.reason,
      by: request.by,
    };
    this.state = { ...this.state, moderations: [...this.state.moderations, record] };
    return record;
  }

  /**
   * Forgetting. A rumour can fade, and the record that a node heard it is
   * kept: forgetting is a fact about one listener, not an erasure of the
   * spread.
   */
  forgetClaim(claimId: string, nodeId: string, at: WorldTime): void {
    this.scope.assertOwner("information");
    this.requireClaim(claimId, "forgetClaim");
    this.requireNode(nodeId, "forgetClaim");
    const index = this.state.exposures.findIndex(
      (exposure) =>
        exposure.claimId === claimId && exposure.nodeId === nodeId && exposure.forgottenAt === undefined,
    );
    if (index === -1) {
      throw new Error(`InformationEngine.forgetClaim: ${nodeId} has not heard ${claimId}`);
    }
    const exposures = [...this.state.exposures];
    exposures[index] = { ...(exposures[index] as Exposure), forgottenAt: at };
    this.state = { ...this.state, exposures };
  }

  private replaceClaim(updated: CirculatingClaim): CirculatingClaim {
    this.state = {
      ...this.state,
      claims: this.state.claims.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
    };
    return updated;
  }

  /** How open a node is to a claim from a given source, 0..1. */
  private opennessOf(nodeId: string, sourceId: string): number {
    if (nodeId === sourceId) return 1;
    const connected = this.state.links.some(
      (link) =>
        (link.from === nodeId && link.to === sourceId) || (link.from === sourceId && link.to === nodeId),
    );
    // Connected people hear more; the disconnected still sometimes do.
    return connected ? PROPAGATION.opennessBase : PROPAGATION.opennessBase * 0.5;
  }
}

// --------------------------------------------------------------- helpers ---

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function requireRatio(value: number, field: string, caller: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `InformationEngine.${caller}: ${field} must be in [0, 1], received ${String(value)}`,
    );
  }
}
