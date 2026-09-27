/**
 * Reputation engine (System 22).
 *
 * Owns `systems.reputation`: perceptions, each one observer's view of one
 * subject in one domain, with the evidence that produced it. Every write
 * asserts ownership on that slot; reads are scope-free.
 *
 * The value is always *derived* from evidence â€” never stored as a number
 * that can drift from the reasons behind it â€” so "the docks think the mill
 * is unreliable" can be recomputed, explained, and shown to have changed
 * because the evidence changed.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";

/** A year in minutes, for the decay arithmetic. */
const MINUTES_PER_DAY = 24 * 60;

import {
  DECAY_RATE_PER_YEAR,
  EVIDENCE_WEIGHTS,
  REPUTATION_DOMAINS,
  type Perception,
  type ReputationDomain,
  type ReputationEvidence,
  type ReputationReading,
  type ReputationSystemState,
} from "./types.ts";

export interface RecordEvidenceRequest {
  readonly observerId: string;
  readonly subjectId: string;
  readonly domain: ReputationDomain;
  readonly note: string;
  readonly sourceReliability: number;
  readonly directness: number;
  readonly corroboration: number;
  /** How much weight this evidence's age gives it, 0..1, from the caller. */
  readonly recency: number;
  /** -1 damaging, +1 credit-building. */
  readonly valence: number;
  readonly claimId?: string;
}

export class ReputationEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.reputation) {
      this.scope.assertOwner("reputation");
      this.world.systems.reputation = { perceptions: [] } satisfies ReputationSystemState;
    }
  }

  private get state(): ReputationSystemState {
    return this.world.systems.reputation as ReputationSystemState;
  }

  private set state(value: ReputationSystemState) {
    this.world.systems.reputation = value;
  }

  // ---------------------------------------------------------------- reads ---

  perceptions(): readonly Perception[] {
    return this.state.perceptions;
  }

  /** The record for one observer's view of one subject, if it exists. */
  perception(observerId: string, subjectId: string, domain: ReputationDomain): Perception | undefined {
    return this.state.perceptions.find(
      (entry) =>
        entry.observerId === observerId && entry.subjectId === subjectId && entry.domain === domain,
    );
  }

  /** Everyone's view of a subject in a domain, observers included. */
  perceptionsOf(subjectId: string, domain: ReputationDomain): readonly Perception[] {
    return this.state.perceptions.filter(
      (entry) => entry.subjectId === subjectId && entry.domain === domain,
    );
  }

  // -------------------------------------------------------------- derived ---

  /**
   * What one observer thinks, from their evidence alone.
   *
   * Each piece of evidence carries a *quality* (how reliable, how direct,
   * how corroborated, how recent) and a *valence* (whether it helped or
   * harmed). Quality weights valence; confidence is the average quality
   * itself, so thin or hearsay evidence yields a reading the engine reports
   * as low-confidence rather than hiding.
   */
  reading(
    observerId: string,
    subjectId: string,
    domain: ReputationDomain,
    at: WorldTime,
  ): ReputationReading {
    const perception = this.perception(observerId, subjectId, domain);
    if (perception === undefined) {
      return {
        subjectId,
        domain,
        observerId,
        value: undefined,
        confidence: undefined,
        evidenceCount: 0,
        staleDays: 0,
      };
    }
    const staleDays = Math.max(0, Math.floor((at - perception.updatedAt) / MINUTES_PER_DAY));
    if (perception.evidence.length === 0) {
      // A view asserted outright is a real reading with nothing observed behind
      // it, so it reports zero confidence rather than borrowing any.
      return {
        subjectId,
        domain,
        observerId,
        value: perception.assertedValue,
        confidence: perception.assertedValue === undefined ? undefined : 0,
        evidenceCount: 0,
        staleDays,
      };
    }
    let weighted = 0;
    let weight = 0;
    for (const item of perception.evidence) {
      const quality = qualityOf(item);
      weighted += quality * item.valence;
      weight += quality;
    }
    const value = weight === 0 ? undefined : round4(clampUnit(weighted / weight));
    const confidence = round4(weight / perception.evidence.length);
    return {
      subjectId,
      domain,
      observerId,
      value,
      confidence,
      evidenceCount: perception.evidence.length,
      staleDays,
    };
  }

  /**
   * The reading after decay: an unrefreshed perception fades toward
   * *neutrality*, which on this scale is **zero** — and never to nothing.
   *
   * Fading toward anything but zero would be a bug with real consequences: a
   * reputation of -1 decayed halfway would read as +0.5, so the world would
   * slowly come to think better of someone it had stopped thinking badly of.
   * Forgetting is not forgiving. The evidence is untouched either way, so a
   * perception that comes back into the light is the one that was always there.
   */
  decayedReading(
    observerId: string,
    subjectId: string,
    domain: ReputationDomain,
    at: WorldTime,
  ): ReputationReading {
    const base = this.reading(observerId, subjectId, domain, at);
    if (base.value === undefined) return base;
    const years = base.staleDays / 365;
    const faded = base.value * Math.exp(-DECAY_RATE_PER_YEAR * years);
    return { ...base, value: round4(clampUnit(faded)) };
  }

  /**
   * How far apart two observers are, 0..1. Observer disagreement is one of
   * the spec's own test cases, and it is a fact about people rather than
   * about the subject.
   */
  divergence(
    subjectId: string,
    domain: ReputationDomain,
    observerA: string,
    observerB: string,
    at: WorldTime,
  ): number | undefined {
    const a = this.decayedReading(observerA, subjectId, domain, at).value;
    const b = this.decayedReading(observerB, subjectId, domain, at).value;
    if (a === undefined || b === undefined) return undefined;
    return round4(Math.min(1, Math.abs(a - b)));
  }

  /** The mean reading across every observer, for a local summary. */
  collectiveReading(subjectId: string, domain: ReputationDomain, at: WorldTime): ReputationReading {
    const entries = this.perceptionsOf(subjectId, domain);
    const readings = entries
      .map((entry) => this.decayedReading(entry.observerId, subjectId, domain, at))
      .filter((entry): entry is ReputationReading & { value: number } => entry.value !== undefined);
    if (readings.length === 0) {
      return {
        subjectId,
        domain,
        observerId: "collective",
        value: undefined,
        confidence: undefined,
        evidenceCount: 0,
        staleDays: 0,
      };
    }
    const total = readings.reduce((sum, entry) => sum + entry.value, 0);
    return {
      subjectId,
      domain,
      observerId: "collective",
      value: round4(clampUnit(total / readings.length)),
      confidence: round4(
        readings.reduce((sum, entry) => sum + (entry.confidence ?? 0), 0) / readings.length,
      ),
      evidenceCount: readings.reduce((sum, entry) => sum + entry.evidenceCount, 0),
      staleDays: 0,
    };
  }

  // --------------------------------------------------------------- writes ---

  /**
   * Records evidence and, with it, the perception it changes. One record per
   * observer/subject/domain: a second observer is a second record, not a
   * second opinion on the first.
   */
  recordEvidence(ids: IdAllocator, request: RecordEvidenceRequest, at: WorldTime): Perception {
    this.scope.assertOwner("reputation");
    if (!REPUTATION_DOMAINS.includes(request.domain)) {
      throw new Error(`ReputationEngine.recordEvidence: unknown domain ${String(request.domain)}`);
    }
    for (const [name, value] of [
      ["sourceReliability", request.sourceReliability],
      ["directness", request.directness],
      ["corroboration", request.corroboration],
      ["recency", request.recency],
    ] as const) {
      requireRatio(value, name);
    }
    if (!Number.isFinite(request.valence) || request.valence < -1 || request.valence > 1) {
      throw new Error(
        `ReputationEngine.recordEvidence: valence must be in [-1, 1], received ${String(request.valence)}`,
      );
    }
    if (request.note.trim().length === 0) {
      throw new Error("ReputationEngine.recordEvidence: evidence needs a note saying what was seen");
    }
    const evidence: ReputationEvidence = {
      id: `evd-${ids.next("activity")}`,
      at,
      ...(request.claimId === undefined ? {} : { claimId: request.claimId }),
      note: request.note,
      sourceReliability: request.sourceReliability,
      directness: request.directness,
      corroboration: request.corroboration,
      recency: request.recency,
      valence: request.valence,
    };
    return this.write({
      observerId: request.observerId,
      subjectId: request.subjectId,
      domain: request.domain,
      evidence: [...(this.perception(request.observerId, request.subjectId, request.domain)?.evidence ?? []), evidence],
      updatedAt: at,
    });
  }

  /**
   * An *asserted* perception: what an observer claims outright, with no
   * evidence behind it. Reputation is built on talk as often as on
   * witness, and the record keeps an assertion distinct from something
   * observed so nobody later mistakes one for the other.
   *
   * The value is stored, not merely validated: an assertion that was thrown away
   * would leave an observer who said "he is a thief" reading as though they had
   * said nothing at all, which would make the distinction the record is
   * carefully keeping pointless. Evidence, when it arrives, outranks the
   * assertion rather than being averaged with it.
   */
  assertPerception(
    observerId: string,
    subjectId: string,
    domain: ReputationDomain,
    value: number,
    at: WorldTime,
    note: string,
  ): Perception {
    this.scope.assertOwner("reputation");
    // Signed, like every reputation value: the whole point is that a bad name
    // can be asserted as readily as a good one.
    if (!Number.isFinite(value) || value < -1 || value > 1) {
      throw new Error(
        `ReputationEngine.assertPerception: value must be in [-1, 1], received ${String(value)}`,
      );
    }
    return this.write({
      subjectId,
      domain,
      observerId,
      // Any evidence already on record is kept. Asserting a view is something
      // an observer does *on top of* what they have seen, and dropping the
      // seeing to make room for the saying would lose the better record.
      evidence: [...(this.perception(observerId, subjectId, domain)?.evidence ?? [])],
      updatedAt: at,
      asserted: true,
      assertedValue: value,
      note,
    });
  }

  /**
   * Repairs: a restitution, an apology, a correction or an institutional
   * finding. A repair is evidence like any other â€” which is why reputation
   * can be repaired, and why it can also be repaired *insufficiently*.
   */
  recordRepair(
    ids: IdAllocator,
    request: Omit<RecordEvidenceRequest, "valence"> & { readonly effectiveness: number },
    at: WorldTime,
  ): Perception {
    requireRatio(request.effectiveness, "effectiveness");
    return this.recordEvidence(ids, { ...request, valence: request.effectiveness }, at);
  }

  private write(perception: Perception): Perception {
    const existing = this.perception(perception.observerId, perception.subjectId, perception.domain);
    this.state = {
      ...this.state,
      perceptions:
        existing === undefined
          ? [...this.state.perceptions, perception]
          : this.state.perceptions.map((entry) => (entry === existing ? perception : entry)),
    };
    return perception;
  }
}

// --------------------------------------------------------------- helpers ---

/** How much weight one piece of evidence carries, 0..1. */
function qualityOf(item: ReputationEvidence): number {
  return clamp01(
    EVIDENCE_WEIGHTS.sourceReliability * item.sourceReliability +
      EVIDENCE_WEIGHTS.directness * item.directness +
      EVIDENCE_WEIGHTS.corroboration * item.corroboration +
      EVIDENCE_WEIGHTS.recency * item.recency,
  );
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function clampUnit(value: number): number {
  return Math.min(Math.max(value, -1), 1);
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function requireRatio(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`ReputationEngine: ${field} must be in [0, 1], received ${String(value)}`);
  }
}
