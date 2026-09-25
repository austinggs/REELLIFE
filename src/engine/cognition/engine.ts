import type { EntityId, IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import { MINUTES_PER_DAY, durationToMinutes, timeBetween } from "../primitives/time.ts";
import type { ClaimSource, InformationClaim, KnowledgeState } from "../primitives/information.ts";
import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import { clamp } from "../rng/distributions.ts";
import type {
  AttentionState,
  BeliefRecord,
  CognitionSystemState,
  MemoryRecord,
  PersonCognitionState,
} from "./types.ts";

const DEFAULT_MEMORY_DECAY_RATE_PER_DAY = 0.005;
const DEFAULT_SOURCE_CREDIBILITY = 0.5;
const DEFAULT_ATTENTION_CAPACITY = 5;

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

export function getSourceKey(source: ClaimSource): string {
  if (source.ref) {
    return `${source.ref.kind}:${source.ref.id}`;
  }
  return `kind:${source.kind}`;
}

export class CognitionEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.cognition) {
      this.scope.assertOwner("cognition");
      this.world.systems.cognition = { persons: [] } satisfies CognitionSystemState;
    }
  }

  private get state(): CognitionSystemState {
    return this.world.systems.cognition as CognitionSystemState;
  }

  private set state(value: CognitionSystemState) {
    this.world.systems.cognition = value;
  }

  registerPerson(
    personId: EntityId<"person">,
    attentionCapacity: number = DEFAULT_ATTENTION_CAPACITY,
  ): PersonCognitionState {
    this.scope.assertOwner("cognition");
    const existing = this.getPerson(personId);
    if (existing) return existing;

    const pcs: PersonCognitionState = {
      personId,
      beliefs: [],
      memories: [],
      sourceTrust: [],
      attention: {
        capacity: Math.max(1, attentionCapacity),
        focalSubjects: [],
      },
    };

    this.state = {
      ...this.state,
      persons: [...this.state.persons, pcs],
    };
    return pcs;
  }

  getPerson(personId: EntityId<"person">): PersonCognitionState | undefined {
    return this.state.persons.find((p) => p.personId === personId);
  }

  all(): readonly PersonCognitionState[] {
    return this.state.persons;
  }

  getSourceTrust(personId: EntityId<"person">, source: ClaimSource): number {
    const pcs = this.getPerson(personId);
    if (!pcs) return DEFAULT_SOURCE_CREDIBILITY;
    const key = getSourceKey(source);
    const found = pcs.sourceTrust.find((r) => r.sourceKey === key);
    return found ? found.credibility : DEFAULT_SOURCE_CREDIBILITY;
  }

  setSourceTrust(
    personId: EntityId<"person">,
    source: ClaimSource,
    credibility: number,
  ): void {
    this.scope.assertOwner("cognition");
    const key = getSourceKey(source);
    const clampedCred = clamp01(credibility);

    this._mutatePerson(personId, (pcs) => {
      const existing = pcs.sourceTrust.find((r) => r.sourceKey === key);
      const updatedList = existing
        ? pcs.sourceTrust.map((r) =>
            r.sourceKey === key
              ? {
                  ...r,
                  credibility: clampedCred,
                  evaluationsCount: r.evaluationsCount + 1,
                }
              : r,
          )
        : [
            ...pcs.sourceTrust,
            { sourceKey: key, credibility: clampedCred, evaluationsCount: 1 },
          ];
      return { ...pcs, sourceTrust: updatedList };
    });
  }

  getBelief(
    personId: EntityId<"person">,
    subject: string,
    predicate: string,
  ): BeliefRecord | undefined {
    return this.getPerson(personId)?.beliefs.find(
      (b) => b.subject === subject && b.predicate === predicate,
    );
  }

  absorbBelief(
    ids: IdAllocator,
    personId: EntityId<"person">,
    subject: string,
    predicate: string,
    value: string,
    source: ClaimSource,
    sourceConfidence: number,
    now: WorldTime,
    claimId?: EntityId<"claim">,
  ): BeliefRecord {
    this.scope.assertOwner("cognition");
    const pcs = this.getPerson(personId);
    if (!pcs) throw new Error(`Unknown person in cognition: ${personId}`);

    const sourceTrust = this.getSourceTrust(personId, source);
    const evidenceWeight = clamp01(sourceConfidence * sourceTrust);

    let status: KnowledgeState = "estimate";
    if (source.kind === "observation" || source.kind === "self") {
      status = "known";
    } else if (source.kind === "rumor") {
      status = "rumor";
    } else if (source.kind === "inference") {
      status = "inference";
    }

    const prior = pcs.beliefs.find(
      (b) => b.subject === subject && b.predicate === predicate,
    );

    let resultingBelief: BeliefRecord;

    if (!prior) {
      resultingBelief = {
        id: `belief-${ids.next("activity")}`,
        subject,
        predicate,
        value,
        confidence: evidenceWeight,
        status,
        source,
        claimId,
        acquiredAt: now,
        lastReinforcedAt: now,
        reinforcementCount: 1,
      };

      this._mutatePerson(personId, (p) => ({
        ...p,
        beliefs: [...p.beliefs, resultingBelief],
      }));
    } else if (prior.value === value) {
      const newConfidence = clamp01(
        1 - (1 - prior.confidence) * (1 - evidenceWeight),
      );
      resultingBelief = {
        ...prior,
        confidence: newConfidence,
        status: prior.status === "known" ? "known" : status,
        lastReinforcedAt: now,
        reinforcementCount: prior.reinforcementCount + 1,
      };

      this._mutatePerson(personId, (p) => ({
        ...p,
        beliefs: p.beliefs.map((b) => (b.id === prior.id ? resultingBelief : b)),
      }));
    } else {
      if (evidenceWeight > prior.confidence) {
        const revisedConfidence = clamp01(evidenceWeight - prior.confidence * 0.5);
        resultingBelief = {
          ...prior,
          value,
          confidence: revisedConfidence,
          status,
          source,
          claimId,
          lastReinforcedAt: now,
          reinforcementCount: 1,
        };
      } else {
        const erodedConfidence = clamp01(prior.confidence - evidenceWeight * 0.4);
        resultingBelief = {
          ...prior,
          confidence: erodedConfidence,
          lastReinforcedAt: now,
        };
      }

      this._mutatePerson(personId, (p) => ({
        ...p,
        beliefs: p.beliefs.map((b) => (b.id === prior.id ? resultingBelief : b)),
      }));
    }

    return resultingBelief;
  }

  learnClaim(
    ids: IdAllocator,
    personId: EntityId<"person">,
    claim: InformationClaim,
    now: WorldTime,
  ): BeliefRecord {
    return this.absorbBelief(
      ids,
      personId,
      claim.subject,
      "state",
      claim.statement,
      claim.source,
      claim.sourceConfidence,
      now,
      claim.id,
    );
  }

  recordMemory(
    ids: IdAllocator,
    personId: EntityId<"person">,
    description: string,
    domain: string,
    emotionalSalience: number,
    occurredAt: WorldTime,
    associations: readonly string[] = [],
  ): MemoryRecord {
    this.scope.assertOwner("cognition");
    const pcs = this.getPerson(personId);
    if (!pcs) throw new Error(`Unknown person in cognition: ${personId}`);

    const memory: MemoryRecord = {
      id: `mem-${ids.next("activity")}`,
      description,
      domain,
      emotionalSalience: clamp01(emotionalSalience),
      vividness: 1.0,
      occurredAt,
      lastRecalledAt: occurredAt,
      associations,
    };

    this._mutatePerson(personId, (p) => ({
      ...p,
      memories: [...p.memories, memory],
    }));
    return memory;
  }

  recallMemory(
    personId: EntityId<"person">,
    memoryId: string,
    now: WorldTime,
  ): MemoryRecord | undefined {
    this.scope.assertOwner("cognition");
    const pcs = this.getPerson(personId);
    if (!pcs) return undefined;

    const memory = pcs.memories.find((m) => m.id === memoryId);
    if (!memory) return undefined;

    const restoredVividness = clamp01(
      memory.vividness + 0.3 * (0.5 + 0.5 * memory.emotionalSalience),
    );

    const updated: MemoryRecord = {
      ...memory,
      vividness: restoredVividness,
      lastRecalledAt: now,
    };

    this._mutatePerson(personId, (p) => ({
      ...p,
      memories: p.memories.map((m) => (m.id === memoryId ? updated : m)),
    }));
    return updated;
  }

  focusAttention(personId: EntityId<"person">, subject: string): AttentionState {
    this.scope.assertOwner("cognition");
    const pcs = this.getPerson(personId);
    if (!pcs) throw new Error(`Unknown person in cognition: ${personId}`);

    const filtered = pcs.attention.focalSubjects.filter((s) => s !== subject);
    const updatedFocal = [subject, ...filtered].slice(0, pcs.attention.capacity);

    const updatedAttention: AttentionState = {
      ...pcs.attention,
      focalSubjects: updatedFocal,
    };

    this._mutatePerson(personId, (p) => ({
      ...p,
      attention: updatedAttention,
    }));
    return updatedAttention;
  }

  tick(
    personId: EntityId<"person">,
    now: WorldTime,
    decayRatePerDay: number = DEFAULT_MEMORY_DECAY_RATE_PER_DAY,
  ): PersonCognitionState | undefined {
    this.scope.assertOwner("cognition");
    const pcs = this.getPerson(personId);
    if (!pcs) return undefined;

    const updatedMemories = pcs.memories.map((m) => {
      const elapsedDays =
        durationToMinutes(timeBetween(now, m.lastRecalledAt)) / MINUTES_PER_DAY;
      if (elapsedDays <= 0) return m;

      const protectedDecayRate = decayRatePerDay * (1.0 - 0.75 * m.emotionalSalience);
      const newVividness = clamp01(m.vividness - protectedDecayRate * elapsedDays);

      return {
        ...m,
        vividness: newVividness,
      };
    });

    const updatedPcs: PersonCognitionState = {
      ...pcs,
      memories: updatedMemories,
    };

    this._mutatePerson(personId, () => updatedPcs);
    return updatedPcs;
  }

  private _mutatePerson(
    personId: EntityId<"person">,
    fn: (pcs: PersonCognitionState) => PersonCognitionState,
  ): void {
    const pcs = this.getPerson(personId);
    if (!pcs) throw new Error(`Unknown person in cognition: ${personId}`);
    const updated = fn(pcs);
    this.state = {
      ...this.state,
      persons: this.state.persons.map((p) =>
        p.personId === personId ? updated : p,
      ),
    };
  }
}
